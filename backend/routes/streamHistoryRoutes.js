const multer = require('multer');
const { initDb, client, COLLECTIONS } = require('../mongo.js');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authMiddleware.js');
const { ingestNormalizedStreamEvents } = require('../services/streamNormalizationService.js');

const collectionName = COLLECTIONS.rawStreams;

// const upload = multer({ dest: 'uploads/' });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB max per file
});

router.post('/api/upload', authenticate, upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const userId = req.accountId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.authPayload && req.authPayload.guest) {
      return res.status(403).json({ error: 'Guest sessions are not allowed to upload files' });
    }

    const db = await initDb();
    const collection = db.collection(collectionName);

    const summary = {
      userId,
      totalFilesReceived: req.files.length,
      totalFilesProcessed: 0,
      totalRows: 0,
      totalInserted: 0,
      totalDuplicatesOrExisting: 0,
      totalInvalidRows: 0,
      totalNormalized: 0,
      totalNormalizedInserted: 0,
      totalTrackStubsCreated: 0,
      files: []
    };

    for (const file of req.files) {
      const fileReport = {
        originalName: file.originalname,
        processed: false,
        reasonSkipped: null,
        totalRows: 0,
        inserted: 0,
        duplicatesOrExisting: 0,
        invalidRows: 0,
        error: null
      };

      try {
        if (!file.originalname.startsWith('Streaming_History_Audio') || !file.originalname.endsWith('.json')) {
          fileReport.reasonSkipped = 'Filename does not look like a Spotify extended history file (Streaming_History_Audio_*.json).';
          summary.files.push(fileReport);
          continue;
        }

        const text = file.buffer.toString('utf8');
        const json = JSON.parse(text);

        if (!Array.isArray(json)) {
          fileReport.reasonSkipped = 'File JSON is not an array.';
          summary.files.push(fileReport);
          continue;
        }

        fileReport.totalRows = json.length;
        summary.totalRows += json.length;

        const operations = [];
        const normalizedRows = [];
        let invalidRows = 0;
        const perFileSeen = new Set(); 

        for (const row of json) {
          if (!row.ts || !row.ms_played || !row.spotify_track_uri) {
            invalidRows++;
            continue;
          }

          const dedupeKey = `${row.ts}|${row.spotify_track_uri}`;
          if (perFileSeen.has(dedupeKey)) continue;
          perFileSeen.add(dedupeKey);

          operations.push({
            updateOne: {
              filter: {
                userId,
                ts : row.ts,
                spotify_track_uri : row.spotify_track_uri
              },
              update: {
                $setOnInsert: {
                  ...row,
                  userId 
                }
              },
              upsert: true
            }
          });

          normalizedRows.push({
            ts: row.ts,
            ms_played: row.ms_played,
            spotify_track_uri: row.spotify_track_uri,
            reason_end: row.reason_end,
          });
        }

        fileReport.invalidRows = invalidRows;
        summary.totalInvalidRows += invalidRows;

        if (operations.length > 0) {
          const bulkResult = await collection.bulkWrite(operations, { ordered: false });

          const inserted = bulkResult.upsertedCount || 0;
          const totalCandidates = operations.length;
          const duplicatesOrExisting = totalCandidates - inserted; // upserts that found existing docs

          fileReport.inserted = inserted;
          fileReport.duplicatesOrExisting = duplicatesOrExisting;

          summary.totalInserted += inserted;
          summary.totalDuplicatesOrExisting += duplicatesOrExisting;
        }

        if (normalizedRows.length) {
          const normalizedStats = await ingestNormalizedStreamEvents(
            normalizedRows,
            userId,
            { source: 'bulk-json-upload' }
          );
          fileReport.normalized = normalizedStats;
          summary.totalNormalized += normalizedStats.normalized;
          summary.totalNormalizedInserted += normalizedStats.inserted;
          summary.totalTrackStubsCreated += normalizedStats.trackStubsCreated;
        }

        fileReport.processed = true;
        summary.totalFilesProcessed++;

      } catch (err) {
        console.error(`Error processing file ${file.originalname}:`, err);
        fileReport.error = err.message;
      }

      summary.files.push(fileReport);
    }
    console.log(summary);
    return res.status(200).json(summary);

  } catch (error) {
    console.error('Error processing upload:', error);
    return res.status(500).json({ error: 'Error processing upload' });
  }
});



module.exports = router;
