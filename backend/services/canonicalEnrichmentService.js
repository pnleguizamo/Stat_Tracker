const { initDb, COLLECTIONS } = require('../mongo.js');
const { ensureAliasesForTrackIds, DAY_MS } = require('./canonicalTrackService.js');

const DEFAULT_BATCH_SIZE = Number(process.env.CANONICAL_ENRICH_BATCH || 10000);
const DEFAULT_WINDOW_DAYS = Number(process.env.CANONICAL_ENRICH_WINDOW_DAYS || 7);
const DEFAULT_MAX_BATCHES = Number(process.env.CANONICAL_ENRICH_MAX_BATCHES || 5);

function buildMissingCanonicalQuery({ windowStart, startAfterId }) {
  const query = {
    $and: [
      {
        $or: [{ canonicalTrackId: { $exists: false } }, { canonicalTrackId: null }],
      },
      { trackId: { $ne: null } },
    ],
  };

  if (windowStart) {
    query.$and.push({ ts: { $gte: windowStart } });
  }
  if (startAfterId) {
    query.$and.push({ _id: { $gt: startAfterId } });
  }
  return query;
}

async function enrichBatch({
  db: dbInstance,
  windowStart,
  startAfterId,
  batchSize = DEFAULT_BATCH_SIZE,
  logger = console,
  createMissingAliases = true,
}) {
  const db = dbInstance || (await initDb());
  const streamsCol = db.collection(COLLECTIONS.streams);
  const aliasCol = db.collection(COLLECTIONS.trackAliases);

  const query = buildMissingCanonicalQuery({ windowStart, startAfterId });
  const docs = await streamsCol
    .find(query, { projection: { _id: 1, trackId: 1 } })
    .sort({ _id: 1 })
    .limit(batchSize)
    .toArray();
  if (!docs.length) {
    return { scanned: 0, resolved: 0, updated: 0, lastId: null, unresolvedTrackIds: [] };
  }

  const trackIds = Array.from(new Set(docs.map(doc => doc.trackId).filter(Boolean)));
  const aliasDocs = trackIds.length
    ? await aliasCol
        .find({ _id: { $in: trackIds } }, { projection: { _id: 1, canonicalTrackId: 1 } })
        .toArray()
    : [];
  const aliasMap = new Map(aliasDocs.map(doc => [doc._id, doc.canonicalTrackId]));

  const missingTrackIds = trackIds.filter(id => !aliasMap.has(id) || !aliasMap.get(id));
  if (missingTrackIds.length && createMissingAliases) {
    const createdMap = await ensureAliasesForTrackIds({ trackIds: missingTrackIds, db, logger });
    for (const [trackId, canonicalTrackId] of createdMap.entries()) {
      aliasMap.set(trackId, canonicalTrackId);
    }
  }

  const unresolvedTrackIds = new Set();
  const ops = [];
  let resolved = 0;
  for (const doc of docs) {
    const canonicalTrackId = aliasMap.get(doc.trackId);
    if (!canonicalTrackId) {
      unresolvedTrackIds.add(doc.trackId);
      continue;
    }
    resolved += 1;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { canonicalTrackId } },
      },
    });
  }

  let updated = 0;
  if (ops.length) {
    const res = await streamsCol.bulkWrite(ops, { ordered: false });
    updated = res.modifiedCount || 0;
  }

  const lastId = docs[docs.length - 1]?._id || null;
  const unresolved = Array.from(unresolvedTrackIds);
  logger.info?.(
    `[canonical] batch windowStart=${windowStart ? windowStart.toISOString() : 'full'} scanned=${docs.length} resolved=${resolved} updated=${updated} unresolved=${unresolved.length}`
  );

  return {
    scanned: docs.length,
    resolved,
    updated,
    lastId,
    unresolvedTrackIds: unresolved,
  };
}

async function enrichRecentStreamsWithCanonicalIds({
  db,
  windowDays = DEFAULT_WINDOW_DAYS,
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = DEFAULT_MAX_BATCHES,
  logger = console,
}) {
  const windowStart = windowDays ? new Date(Date.now() - windowDays * DAY_MS) : null;
  let batches = 0;
  let lastId = null;
  let totalScanned = 0;
  let totalResolved = 0;
  let totalUpdated = 0;
  const unresolvedTrackIds = new Set();

  while (batches < maxBatches) {
    const result = await enrichBatch({
      db,
      windowStart,
      startAfterId: lastId,
      batchSize,
      logger,
      createMissingAliases: true,
    });
    if (!result.scanned) break;

    batches += 1;
    totalScanned += result.scanned;
    totalResolved += result.resolved;
    totalUpdated += result.updated;
    result.unresolvedTrackIds.forEach(id => unresolvedTrackIds.add(id));
    lastId = result.lastId;

    if (result.scanned < batchSize) break;
  }

  logger.info?.(
    `[canonical] recent enrichment complete batches=${batches} scanned=${totalScanned} resolved=${totalResolved} updated=${totalUpdated} unresolved=${unresolvedTrackIds.size}`
  );

  return {
    batches,
    scanned: totalScanned,
    resolved: totalResolved,
    updated: totalUpdated,
    unresolvedTrackIds: Array.from(unresolvedTrackIds),
  };
}

async function backfillCanonicalIds({
  db,
  batchSize = DEFAULT_BATCH_SIZE,
  logger = console,
  maxBatches = Infinity,
}) {
  let batches = 0;
  let lastId = null;
  let totalScanned = 0;
  let totalResolved = 0;
  let totalUpdated = 0;
  const unresolvedTrackIds = new Set();

  while (batches < maxBatches) {
    const result = await enrichBatch({
      db,
      windowStart: null,
      startAfterId: lastId,
      batchSize,
      logger,
      createMissingAliases: true,
    });
    if (!result.scanned) break;
    batches += 1;
    totalScanned += result.scanned;
    totalResolved += result.resolved;
    totalUpdated += result.updated;
    result.unresolvedTrackIds.forEach(id => unresolvedTrackIds.add(id));
    lastId = result.lastId;
  }

  logger.info?.(
    `[canonical] full backfill complete batches=${batches} scanned=${totalScanned} resolved=${totalResolved} updated=${totalUpdated} unresolved=${unresolvedTrackIds.size}`
  );

  return {
    batches,
    scanned: totalScanned,
    resolved: totalResolved,
    updated: totalUpdated,
    unresolvedTrackIds: Array.from(unresolvedTrackIds),
  };
}

module.exports = {
  enrichRecentStreamsWithCanonicalIds,
  backfillCanonicalIds,
};
