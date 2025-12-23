const { initDb, COLLECTIONS } = require('../mongo.js');

const STREAMS_INSERT_BATCH_SIZE = Number(process.env.STREAMS_INSERT_BATCH_SIZE || 500);
const STUB_BATCH_SIZE = Number(process.env.SPOTIFY_STUB_BATCH_SIZE || 500);
const DEFAULT_REASON = 'unknown';

const LOCK_FIELDS = {
  lockedAt: null,
  lockedBy: null,
};

function parseTrackId(uri) {
  if (typeof uri !== 'string') return null;
  const lastColon = uri.lastIndexOf(':');
  if (lastColon === -1) return uri || null;
  return uri.slice(lastColon + 1) || null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sanitizeMsPlayed(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num);
}

function normalizeReason(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_REASON;
  }
  return value.trim();
}

function buildStreamDoc(raw, userId, source, now) {
  const ts = toDate(raw.ts || raw.played_at || raw.playedAt);
  const msPlayed = sanitizeMsPlayed(
    raw.ms_played ?? raw.msPlayed ?? raw.duration ?? raw.durationMs ?? raw.ms
  );
  if (!ts || msPlayed === null) {
    return null;
  }

  const reason = normalizeReason(raw.reason_end || raw.reasonEnd || raw.end_reason);
  const trackUri = raw.spotify_track_uri || raw.trackUri || raw.uri || raw.spotify_track_uri;
  const trackId = parseTrackId(trackUri);

  const doc = {
    userId,
    ts,
    msPlayed,
    reasonEnd: reason,
    trackId: trackId || null,
    createdAt: now,
    updatedAt: now,
  };

  if (source) {
    doc.source = source;
  }
  return doc;
}

async function bulkExecute(collection, operations) {
  if (!operations.length) return 0;
  const res = await collection.bulkWrite(operations, { ordered: false });
  return res.upsertedCount || 0;
}

async function ensureDimensionStubs(collectionKey, ids, dbInstance) {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (!uniqueIds.length) {
    return { inserted: 0 };
  }
  const db = dbInstance || (await initDb());
  const colName = COLLECTIONS[collectionKey];
  if (!colName) {
    throw new Error(`Unknown collection key "${collectionKey}"`);
  }
  const col = db.collection(colName);
  const now = new Date();
  let inserted = 0;
  let batch = [];

  for (const id of uniqueIds) {
    batch.push({
      updateOne: {
        filter: { _id: id },
        update: {
          $setOnInsert: {
            _id: id,
            status: 'pending',
            lastFetchedAt: null,
            nextRefreshAt: null,
            errorCount: 0,
            lastError: null,
            createdAt: now,
            ...LOCK_FIELDS,
          },
          $set: { updatedAt: now },
        },
        upsert: true,
      },
    });

    if (batch.length >= STUB_BATCH_SIZE) {
      inserted += await bulkExecute(col, batch);
      batch = [];
    }
  }

  if (batch.length) {
    inserted += await bulkExecute(col, batch);
  }

  return { inserted };
}

async function ensureTrackStubs(trackIds, dbInstance) {
  return ensureDimensionStubs('tracks', trackIds, dbInstance);
}

async function ingestNormalizedStreamEvents(events, userId, options = {}) {
  if (!Array.isArray(events) || !events.length || !userId) {
    return {
      totalEvents: events?.length || 0,
      normalized: 0,
      inserted: 0,
      skipped: events?.length || 0,
      trackStubsCreated: 0,
    };
  }

  const db = await initDb();
  const streamsCol = db.collection(COLLECTIONS.streams);
  const now = new Date();
  const normalizedDocs = [];
  const trackIds = new Set();

  for (const raw of events) {
    const doc = buildStreamDoc(raw, userId, options.source, now);
    if (!doc) continue;
    normalizedDocs.push(doc);
    if (doc.trackId) {
      trackIds.add(doc.trackId);
    }
  }

  let inserted = 0;
  let ops = [];
  for (const doc of normalizedDocs) {
    ops.push({
      updateOne: {
        filter: {
          userId: doc.userId,
          ts: doc.ts,
          trackId: doc.trackId,
        },
        update: {
          $setOnInsert: doc,
        },
        upsert: true,
      },
    });

    if (ops.length >= STREAMS_INSERT_BATCH_SIZE) {
      inserted += await bulkExecute(streamsCol, ops);
      ops = [];
    }
  }

  if (ops.length) {
    inserted += await bulkExecute(streamsCol, ops);
  }

  const stubResult = await ensureTrackStubs(Array.from(trackIds), db);

  return {
    totalEvents: events.length,
    normalized: normalizedDocs.length,
    inserted,
    skipped: events.length - normalizedDocs.length,
    trackStubsCreated: stubResult.inserted || 0,
  };
}

module.exports = {
  ingestNormalizedStreamEvents,
  ensureTrackStubs,
  ensureDimensionStubs,
  parseTrackId,
};
