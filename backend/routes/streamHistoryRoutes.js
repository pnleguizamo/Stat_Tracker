const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const multer = require('multer');

const { initDb, COLLECTIONS } = require('../mongo.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { createEmptyUploadSummary } = require('../services/uploadProcessor.js');

const router = express.Router();

const UPLOAD_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/;
const STAGING_ROOT = process.env.UPLOAD_STAGING_DIR
  || path.resolve(__dirname, '..', 'uploads', 'spotify-history');

function sanitizePathSegment(value, fallback = 'unknown') {
  const sanitized = String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

function sanitizeFileName(value) {
  const basename = path.basename(String(value || 'upload.json'));
  return basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180) || 'upload.json';
}

function getUploadId(req) {
  return String(req.get('X-Upload-Id') || '').trim();
}

function isLastBatch(req) {
  return String(req.get('X-Last-Batch') || '').toLowerCase() === 'true';
}

function publicJob(job) {
  const files = (job.files || []).map(({ stagedPath, ...file }) => file);
  return {
    uploadId: job.uploadId,
    status: job.status,
    filesAccepted: files.length,
    summary: job.summary || createEmptyUploadSummary(job.userId),
    files,
    attempts: job.attempts || 0,
    error: job.error || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    completedAt: job.completedAt || null,
  };
}

async function ensureUploadJob(req, res, next) {
  try {
    const userId = req.accountId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.authPayload?.guest) {
      return res.status(403).json({ error: 'Guest sessions are not allowed to upload files' });
    }

    const uploadId = getUploadId(req);
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      return res.status(400).json({ error: 'X-Upload-Id is required and must be a stable upload id.' });
    }

    const db = await initDb();
    const jobs = db.collection(COLLECTIONS.uploadJobs);
    const now = new Date();
    const stagingDir = path.join(
      STAGING_ROOT,
      sanitizePathSegment(userId, 'user'),
      sanitizePathSegment(uploadId, 'upload')
    );

    let job = await jobs.findOne({ userId, uploadId });
    if (!job) {
      const doc = {
        uploadId,
        userId,
        status: 'staging',
        files: [],
        summary: createEmptyUploadSummary(userId),
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        error: null,
        stagingDir,
        retained: true,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };

      try {
        await jobs.insertOne(doc);
        job = doc;
      } catch (err) {
        if (err?.code !== 11000) throw err;
        job = await jobs.findOne({ userId, uploadId });
      }
    }

    if (!job || job.status !== 'staging') {
      return res.status(409).json({
        error: `Upload ${uploadId} is already ${job?.status || 'unavailable'}.`,
      });
    }

    req.uploadJob = job;
    req.uploadId = uploadId;
    req.uploadDir = job.stagingDir || stagingDir;
    next();
  } catch (err) {
    next(err);
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdir(req.uploadDir, { recursive: true }, (err) => cb(err, req.uploadDir));
  },
  filename(req, file, cb) {
    const fileId = crypto.randomBytes(8).toString('hex');
    const stagedName = `${Date.now()}-${fileId}-${sanitizeFileName(file.originalname)}`;
    file.fileId = fileId;
    file.stagedName = stagedName;
    cb(null, stagedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

function uploadFiles(req, res, next) {
  upload.array('files')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to stage upload files.' });
    }
    next();
  });
}

router.get('/api/upload/status/:uploadId', authenticate, async (req, res, next) => {
  try {
    const uploadId = String(req.params.uploadId || '').trim();
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const db = await initDb();
    const job = await db.collection(COLLECTIONS.uploadJobs).findOne({
      userId: req.accountId,
      uploadId,
    });

    if (!job) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    return res.json(publicJob(job));
  } catch (err) {
    next(err);
  }
});

router.post('/api/upload', authenticate, ensureUploadJob, uploadFiles, async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const userId = req.accountId;
    const uploadId = req.uploadId;
    const now = new Date();
    const stagedFiles = req.files.map((file) => ({
      fileId: file.fileId || crypto.randomBytes(8).toString('hex'),
      originalName: file.originalname,
      stagedName: file.filename,
      stagedPath: file.path,
      size: file.size,
      mimetype: file.mimetype,
      processed: false,
      inserted: 0,
      duplicatesOrExisting: 0,
      invalidRows: 0,
      normalized: null,
      error: null,
      uploadedAt: now,
    }));

    const setFields = {
      updatedAt: now,
      error: null,
    };
    if (isLastBatch(req)) {
      setFields.status = 'queued';
      setFields.queuedAt = now;
    }

    const db = await initDb();
    const result = await db.collection(COLLECTIONS.uploadJobs).findOneAndUpdate(
      { userId, uploadId, status: 'staging' },
      {
        $set: setFields,
        $push: { files: { $each: stagedFiles } },
        $inc: { 'summary.totalFilesReceived': stagedFiles.length },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(409).json({ error: `Upload ${uploadId} is no longer accepting files.` });
    }

    return res.status(202).json({
      uploadId,
      jobId: String(result._id),
      status: result.status,
      filesAccepted: stagedFiles.length,
      totalFilesAccepted: result.files?.length || stagedFiles.length,
    });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Error handling upload route:', err);
  return res.status(500).json({ error: 'Error handling upload request' });
});

module.exports = router;
