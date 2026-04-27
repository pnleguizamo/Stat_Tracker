const { initDb, COLLECTIONS } = require('../mongo.js');
const {
  addFileReportToSummary,
  createEmptyUploadSummary,
  processStagedUploadFile,
} = require('./uploadProcessor.js');

const WORKER_INTERVAL_MS = Number(process.env.UPLOAD_WORKER_INTERVAL_MS || 3000);
const JOB_STALE_MS = Number(process.env.UPLOAD_JOB_STALE_MS || 10 * 60 * 1000);
const STAGING_TIMEOUT_MS = Number(process.env.UPLOAD_STAGING_TIMEOUT_MS || 30 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.UPLOAD_JOB_MAX_ATTEMPTS || 3);

let singletonWorker = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMinus(ms) {
  return new Date(Date.now() - ms);
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
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );

    return job || null;
  }

  async processJob(job) {
    const db = await initDb();
    const jobs = db.collection(COLLECTIONS.uploadJobs);
    const files = job.files || [];
    const summary = createEmptyUploadSummary(job.userId);
    const reports = [];

    try {
      for (const file of files) {
        const report = await processStagedUploadFile({ db, file, userId: job.userId });
        reports.push({ ...file, ...report });
        addFileReportToSummary(summary, report);

        const updatedFiles = files.map((existing, index) =>
          index < reports.length ? reports[index] : existing
        );

        await jobs.updateOne(
          { _id: job._id, lockedBy: this.workerId },
          {
            $set: {
              files: updatedFiles,
              summary,
              updatedAt: new Date(),
            },
          }
        );
      }

      await jobs.updateOne(
        { _id: job._id, lockedBy: this.workerId },
        {
          $set: {
            status: 'succeeded',
            files: reports,
            summary,
            lockedAt: null,
            lockedBy: null,
            error: null,
            updatedAt: new Date(),
            completedAt: new Date(),
          },
        }
      );

      console.log(`[UploadWorker] Upload ${job.uploadId} succeeded for user ${job.userId}`);
    } catch (err) {
      await this.handleJobError(job, err);
    }
  }

  async handleJobError(job, err) {
    const db = await initDb();
    const now = new Date();
    const attempts = job.attempts || 1;
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

    await db.collection(COLLECTIONS.uploadJobs).updateOne(
      { _id: job._id, lockedBy: this.workerId },
      { $set: update }
    );

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
