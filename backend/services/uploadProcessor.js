const fs = require('fs/promises');

const { COLLECTIONS } = require('../mongo.js');
const { ingestNormalizedStreamEvents } = require('./streamNormalizationService.js');

const RAW_STREAM_SOURCE = 'bulk-json-upload';

function createEmptyUploadSummary(userId) {
  return {
    userId,
    totalFilesReceived: 0,
    totalFilesProcessed: 0,
    totalRows: 0,
    totalInserted: 0,
    totalDuplicatesOrExisting: 0,
    totalInvalidRows: 0,
    totalNormalized: 0,
    totalNormalizedInserted: 0,
    totalTrackStubsCreated: 0,
  };
}

function createFileReport(file) {
  return {
    fileId: file.fileId || null,
    originalName: file.originalName || file.originalname || 'unknown',
    stagedName: file.stagedName || null,
    stagedPath: file.stagedPath || null,
    size: file.size || 0,
    processed: false,
    reasonSkipped: null,
    totalRows: 0,
    inserted: 0,
    duplicatesOrExisting: 0,
    invalidRows: 0,
    normalized: null,
    error: null,
  };
}

function addFileReportToSummary(summary, report) {
  summary.totalFilesReceived += 1;
  if (report.processed) summary.totalFilesProcessed += 1;
  summary.totalRows += report.totalRows || 0;
  summary.totalInserted += report.inserted || 0;
  summary.totalDuplicatesOrExisting += report.duplicatesOrExisting || 0;
  summary.totalInvalidRows += report.invalidRows || 0;
  summary.totalNormalized += report.normalized?.normalized || 0;
  summary.totalNormalizedInserted += report.normalized?.inserted || 0;
  summary.totalTrackStubsCreated += report.normalized?.trackStubsCreated || 0;
}

function buildUploadSummary(userId, reports) {
  const summary = createEmptyUploadSummary(userId);
  for (const report of reports || []) {
    addFileReportToSummary(summary, report || {});
  }
  return summary;
}

async function processStagedUploadFile({ db, file, userId }) {
  const report = createFileReport(file);

  if (!report.originalName.startsWith('Streaming_History_Audio') || !report.originalName.endsWith('.json')) {
    report.reasonSkipped = 'Filename does not look like a Spotify extended history file (Streaming_History_Audio_*.json).';
    return report;
  }

  const text = await fs.readFile(report.stagedPath, 'utf8');
  const json = JSON.parse(text);

  if (!Array.isArray(json)) {
    report.reasonSkipped = 'File JSON is not an array.';
    return report;
  }

  report.totalRows = json.length;

  const collection = db.collection(COLLECTIONS.rawStreams);
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
          ts: row.ts,
          spotify_track_uri: row.spotify_track_uri,
        },
        update: {
          $setOnInsert: {
            ...row,
            userId,
          },
        },
        upsert: true,
      },
    });

    normalizedRows.push({
      ts: row.ts,
      ms_played: row.ms_played,
      spotify_track_uri: row.spotify_track_uri,
      reason_end: row.reason_end,
    });
  }

  report.invalidRows = invalidRows;

  if (operations.length > 0) {
    const bulkResult = await collection.bulkWrite(operations, { ordered: false });
    const inserted = bulkResult.upsertedCount || 0;
    const totalCandidates = operations.length;

    report.inserted = inserted;
    report.duplicatesOrExisting = totalCandidates - inserted;
  }

  if (normalizedRows.length) {
    report.normalized = await ingestNormalizedStreamEvents(
      normalizedRows,
      userId,
      { source: RAW_STREAM_SOURCE }
    );
  }

  report.processed = true;
  return report;
}

module.exports = {
  createEmptyUploadSummary,
  createFileReport,
  addFileReportToSummary,
  buildUploadSummary,
  processStagedUploadFile,
};
