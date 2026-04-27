const { initDb, COLLECTIONS } = require('../mongo.js');
const {
  buildUploadSummary,
  createFileReport,
  processStagedUploadFile,
} = require('./uploadProcessor.js');

const WORKER_INTERVAL_MS = Number(process.env.UPLOAD_WORKER_INTERVAL_MS || 3000);
const JOB_STALE_MS = Number(process.env.UPLOAD_JOB_STALE_MS || 10 * 60 * 1000);
const DEFAULT_HEARTBEAT_MS = Math.max(1000, Math.min(30000, Math.floor(JOB_STALE_MS / 3)));
const HEARTBEAT_INTERVAL_MS = Number(process.env.UPLOAD_JOB_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
const STAGING_TIMEOUT_MS = Number(process.env.UPLOAD_STAGING_TIMEOUT_MS || 30 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.UPLOAD_JOB_MAX_ATTEMPTS || 3);

let singletonWorker = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMinus(ms) {
  return new Date(Date.now() - ms);
}

class LostJobLockError extends Error {
  constructor(uploadId) {
    super(`Upload ${uploadId} is no longer owned by this worker.`);
    this.name = 'LostJobLockError';
  }
}

function isLostJobLockError(err) {
  return err instanceof LostJobLockError;
}

function createFailedFileReport(file, err) {
  if (err?.report) {
    return {
      ...file,
      ...err.report,
      processed: false,
      error: err.report.error || err.message || 'Failed to process file.',
    };
  }

  return {
    ...createFileReport(file),
    ...file,
    processed: false,
    reasonSkipped: null,
    error: err?.message || 'Failed to process file.',
  };
}

function isAudioHistoryFile(file) {
  const name = String(file?.originalName || file?.originalname || '');
  return name.startsWith('Streaming_History_Audio') && name.endsWith('.json');
}

function buildFinalJobState(reports) {
  const audioReports = (reports || []).filter(isAudioHistoryFile);
  const failedAudioReports = audioReports.filter((report) => !report.processed || report.error);

  if (!audioReports.length) {
    return {
      status: 'failed',
      error: 'No Spotify audio history files were processed.',
    };
  }

  if (failedAudioReports.length) {
    return {
      status: 'failed',
      error: `${failedAudioReports.length} Spotify audio history file(s) failed to process.`,
    };
  }

  return {
    status: 'succeeded',
    error: null,
  };
}

function isRetryableProcessingError(err) {
  const retryableNames = new Set([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError',
    'MongoTopologyClosedError',
  ]);

  const seen = new Set();
  const stack = [err];

  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    const message = String(current.message || '');
    if (retryableNames.has(current.name)
      || current.hasErrorLabel?.('RetryableWriteError')
      || current.code === 'ETIMEDOUT'
      || /timed out/i.test(message)) {
      return true;
    }

    stack.push(current.cause, current.errorResponse, current.result);
  }

  return false;
}

class UploadIngestionWorker {
  constructor() {
    this.workerId = `upload-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
    this.stopped = false;
  }

  start() {
    console.log(`[UploadWorker] Starting worker ${this.workerId}`);
    this.loop().catch((err) => {
      console.error('[UploadWorker] Loop exited unexpectedly:', err);
    });
  }

  stop() {
    this.stopped = true;
  }

  async loop() {
    await this.resetOwnRunningJobs();

    while (!this.stopped) {
      let delay = WORKER_INTERVAL_MS;
      try {
        await this.markAbandonedStagingJobs();
        const claimed = await this.claimJob();
        if (claimed) {
          await this.processJob(claimed);
          delay = 100;
        }
      } catch (err) {
        console.error('[UploadWorker] Error in loop:', err);
      }

      await sleep(delay);
    }
  }

  async resetOwnRunningJobs() {
    const db = await initDb();
    const now = new Date();
    const res = await db.collection(COLLECTIONS.uploadJobs).updateMany(
      { status: 'running', lockedBy: this.workerId },
      {
        $set: {
          status: 'queued',
          lockedAt: null,
          lockedBy: null,
          updatedAt: now,
        },
      }
    );
    if (res.modifiedCount) {
      console.log(`[UploadWorker] Re-queued ${res.modifiedCount} jobs from this worker`);
    }
  }

  async markAbandonedStagingJobs() {
    const db = await initDb();
    const now = new Date();
    const cutoff = nowMinus(STAGING_TIMEOUT_MS);
    await db.collection(COLLECTIONS.uploadJobs).updateMany(
      {
        status: 'staging',
        updatedAt: { $lte: cutoff },
      },
      {
        $set: {
          status: 'abandoned',
          error: 'Upload did not receive a final batch before the staging timeout.',
          updatedAt: now,
          completedAt: now,
        },
      }
    );
  }

  buildClaimFilter() {
    const staleCutoff = nowMinus(JOB_STALE_MS);
    return {
      $and: [
        {
          $or: [
            { status: 'queued' },
            { status: 'running', lockedAt: { $lte: staleCutoff } },
          ],
        },
        {
          $or: [
            { attempts: { $exists: false } },
            { attempts: { $lt: MAX_ATTEMPTS } },
          ],
        },
      ],
    };
  }

  async claimJob() {
    const db = await initDb();
    const now = new Date();
    const job = await db.collection(COLLECTIONS.uploadJobs).findOneAndUpdate(
      this.buildClaimFilter(),
      {
        $set: {
          status: 'running',
          lockedAt: now,
          lockedBy: this.workerId,
          startedAt: now,
          updatedAt: now,
          error: null,
        },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );

    return job || null;
  }

  async refreshJobLease(jobs, job) {
    const now = new Date();
    const res = await jobs.updateOne(
      { _id: job._id, lockedBy: this.workerId },
      {
        $set: {
          lockedAt: now,
          updatedAt: now,
        },
      }
    );

    if (res.matchedCount === 0) {
      throw new LostJobLockError(job.uploadId);
    }
  }

  async persistFileProgress(jobs, job, index, fileReport, reports) {
    const now = new Date();
    const summary = buildUploadSummary(job.userId, reports);
    const res = await jobs.updateOne(
      { _id: job._id, lockedBy: this.workerId },
      {
        $set: {
          [`files.${index}`]: fileReport,
          summary,
          lockedAt: now,
          updatedAt: now,
        },
      }
    );

    if (res.matchedCount === 0) {
      throw new LostJobLockError(job.uploadId);
    }

    return summary;
  }

  async processJob(job) {
    const db = await initDb();
    const jobs = db.collection(COLLECTIONS.uploadJobs);
    const files = job.files || [];
    const reports = files.map((file) => ({ ...file }));
    let leaseLost = false;
    let heartbeatError = null;
    let summary = buildUploadSummary(job.userId, reports);
    const heartbeat = setInterval(() => {
      this.refreshJobLease(jobs, job).catch((err) => {
        if (isLostJobLockError(err)) {
          leaseLost = true;
          return;
        }
        heartbeatError = err;
        console.error(`[UploadWorker] Heartbeat failed for upload ${job.uploadId}:`, err);
      });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    try {
      await this.refreshJobLease(jobs, job);

      for (let index = 0; index < files.length; index++) {
        if (leaseLost) return;
        if (heartbeatError) throw heartbeatError;

        const file = reports[index] || files[index];
        if (file.processed === true) {
          summary = buildUploadSummary(job.userId, reports);
          continue;
        }

        let report;
        try {
          report = await processStagedUploadFile({ db, file, userId: job.userId });
        } catch (err) {
          if (isRetryableProcessingError(err)) {
            if (err.report) {
              reports[index] = { ...file, ...err.report };
              summary = await this.persistFileProgress(jobs, job, index, reports[index], reports);
            }
            throw err;
          }
          report = createFailedFileReport(file, err);
          console.error(
            `[UploadWorker] Upload ${job.uploadId} file ${file.originalName || file.stagedName || index} failed:`,
            err
          );
        }

        reports[index] = { ...file, ...report };
        summary = await this.persistFileProgress(jobs, job, index, reports[index], reports);
      }

      const now = new Date();
      summary = buildUploadSummary(job.userId, reports);
      const finalState = buildFinalJobState(reports);
      const finalUpdate = await jobs.updateOne(
        { _id: job._id, lockedBy: this.workerId },
        {
          $set: {
            status: finalState.status,
            files: reports,
            summary,
            // Staged files are retained intentionally on the server for local forensics.
            lockedAt: null,
            lockedBy: null,
            error: finalState.error,
            updatedAt: now,
            completedAt: now,
          },
        }
      );

      if (finalUpdate.matchedCount === 0) {
        return;
      }

      console.log(`[UploadWorker] Upload ${job.uploadId} ${finalState.status} for user ${job.userId}`);
    } catch (err) {
      if (isLostJobLockError(err)) {
        return;
      }
      await this.handleJobError(job, err);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async handleJobError(job, err) {
    const db = await initDb();
    const now = new Date();
    const attempts = (job.attempts || 0) + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    const update = terminal
      ? {
          status: 'failed',
          lockedAt: null,
          lockedBy: null,
          error: err.message,
          updatedAt: now,
          completedAt: now,
        }
      : {
          status: 'queued',
          lockedAt: null,
          lockedBy: null,
          error: err.message,
          updatedAt: now,
        };

    const res = await db.collection(COLLECTIONS.uploadJobs).updateOne(
      { _id: job._id, lockedBy: this.workerId },
      {
        $set: update,
        $inc: { attempts: 1 },
      }
    );

    if (res.matchedCount === 0) {
      return;
    }

    console.error(
      `[UploadWorker] Upload ${job.uploadId} ${terminal ? 'failed' : 'will retry'}:`,
      err
    );
  }
}

function startUploadIngestionWorker() {
  if (process.env.UPLOAD_WORKER_ENABLED === 'false') {
    console.log('[UploadWorker] Disabled by UPLOAD_WORKER_ENABLED=false');
    return null;
  }

  if (singletonWorker) {
    console.log('[UploadWorker] worker already running');
    return singletonWorker;
  }

  singletonWorker = new UploadIngestionWorker();
  singletonWorker.start();
  return singletonWorker;
}

module.exports = {
  startUploadIngestionWorker,
  UploadIngestionWorker,
};
