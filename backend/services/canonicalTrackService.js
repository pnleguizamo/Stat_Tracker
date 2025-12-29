const { initDb, COLLECTIONS } = require('../mongo.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeWhitespace(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function stripPunctuation(value) {
  return value.replace(/[^\p{L}\p{N}\s]/gu, '');
}

function normalizeTrackName(name) {
  if (typeof name !== 'string') return null;
  return stripPunctuation(normalizeWhitespace(name));
}

function normalizeArtistName(name) {
  if (typeof name !== 'string') return null;
  return stripPunctuation(normalizeWhitespace(name));
}

function buildCanonicalKey(name, artistNames = []) {
  const normalizedName = normalizeTrackName(name);
  const normalizedArtists = (artistNames || [])
    .map(normalizeArtistName)
    .filter(Boolean)
    .sort();

  if (!normalizedName || !normalizedArtists.length) return null;
  return `${normalizedName}::${normalizedArtists.join('|')}`;
}

function pickCanonicalTrackId(trackIds, countMap = new Map()) {
  if (!trackIds.length) return null;
  let canonical = trackIds[0];
  for (const id of trackIds) {
    const current = countMap.get(id) || 0;
    const best = countMap.get(canonical) || 0;
    if (current > best || (current === best && id < canonical)) {
      canonical = id;
    }
  }
  return canonical;
}

async function fetchPlayCounts(db, trackIds) {
  if (!trackIds.length) return new Map();
  const col = db.collection(COLLECTIONS.userTrackCounts);
  const cursor = col.aggregate([
    { $match: { trackId: { $in: trackIds } } },
    { $group: { _id: '$trackId', plays: { $sum: '$plays' } } },
  ]);
  const counts = new Map();
  for await (const doc of cursor) {
    counts.set(doc._id, doc.plays || 0);
  }
  return counts;
}

async function ensureCanonicalForKey({
  db,
  canonicalKey,
  trackIds,
  playCountMap = new Map(),
  logger = console,
}) {
  if (!canonicalKey || !trackIds?.length) return new Map();
  const aliasCol = db.collection(COLLECTIONS.trackAliases);
  const tracksCol = db.collection(COLLECTIONS.tracks);

  const existingAliases = await aliasCol
    .find({ canonicalKey }, { projection: { _id: 1, canonicalTrackId: 1 } })
    .toArray();
  const siblingTrackDocs = await tracksCol
    .find({ canonicalKey }, { projection: { _id: 1 } })
    .toArray();

  const candidateSet = new Set(trackIds);
  existingAliases.forEach(doc => {
    candidateSet.add(doc._id);
    if (doc.canonicalTrackId) {
      candidateSet.add(doc.canonicalTrackId);
    }
  });
  siblingTrackDocs.forEach(doc => candidateSet.add(doc._id));
  const candidates = Array.from(candidateSet);
  if (!candidates.length) return new Map();

  const presetCanonical = existingAliases.find(doc => doc.canonicalTrackId)?.canonicalTrackId;
  const countMap =
    playCountMap.size || presetCanonical ? playCountMap : await fetchPlayCounts(db, candidates);
  const canonicalTrackId = presetCanonical || pickCanonicalTrackId(candidates, countMap);
  const now = new Date();

  const aliasIds = new Set(existingAliases.map(doc => doc._id));
  const aliasesNeedUpdate =
    aliasIds.size !== candidates.length ||
    existingAliases.some(
      doc => !doc.canonicalTrackId || doc.canonicalTrackId !== canonicalTrackId || doc.canonicalKey !== canonicalKey
    );

  const trackIdsSet = new Set(siblingTrackDocs.map(doc => doc._id));
  const tracksNeedUpdate =
    trackIdsSet.size !== candidates.length ||
    siblingTrackDocs.some(
      doc => !doc.canonicalTrackId || doc.canonicalTrackId !== canonicalTrackId || doc.canonicalKey !== canonicalKey
    );

  if (aliasesNeedUpdate) {
    const aliasOps = candidates.map(id => ({
      updateOne: {
        filter: { _id: id },
        update: {
          $set: { canonicalTrackId, canonicalKey, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }));
    if (aliasOps.length) {
      await aliasCol.bulkWrite(aliasOps, { ordered: false });
    }
  }

  if (tracksNeedUpdate) {
    await tracksCol.updateMany(
      { _id: { $in: candidates } },
      { $set: { canonicalTrackId, canonicalKey, updatedAt: now } }
    );
  }

  const map = new Map();
  candidates.forEach(id => map.set(id, canonicalTrackId));
  return map;
}

async function ensureAliasesForTrackIds({
  trackIds,
  canonicalKeyByTrackId = new Map(),
  db: dbInstance,
  logger = console,
}) {
  if (!trackIds?.length) return new Map();
  const db = dbInstance || (await initDb());
  const tracksCol = db.collection(COLLECTIONS.tracks);
  const aliasCol = db.collection(COLLECTIONS.trackAliases);

  const trackDocs = await tracksCol
    .find(
      { _id: { $in: trackIds } },
      { projection: { _id: 1, name: 1, artistNames: 1, canonicalKey: 1, canonicalTrackId: 1 } }
    )
    .toArray();

  const aliasDocs = await aliasCol
    .find(
      { _id: { $in: trackIds } },
      { projection: { _id: 1, canonicalKey: 1, canonicalTrackId: 1 } }
    )
    .toArray();
  const aliasLookup = new Map(aliasDocs.map(doc => [doc._id, doc]));

  const byKey = new Map();
  const pendingCanonicalKeyUpdates = [];
  for (const doc of trackDocs) {
    const explicitKey =
      typeof canonicalKeyByTrackId?.get === 'function'
        ? canonicalKeyByTrackId.get(doc._id)
        : canonicalKeyByTrackId?.[doc._id];
    const aliasKey = aliasLookup.get(doc._id)?.canonicalKey;
    const canonicalKey =
      explicitKey || aliasKey || doc.canonicalKey || buildCanonicalKey(doc.name, doc.artistNames);
    if (!canonicalKey) continue;
    if (!doc.canonicalKey && canonicalKey) {
      pendingCanonicalKeyUpdates.push({ trackId: doc._id, canonicalKey });
    }
    const arr = byKey.get(canonicalKey) || [];
    arr.push(doc._id);
    byKey.set(canonicalKey, arr);
  }

  if (pendingCanonicalKeyUpdates.length) {
    const now = new Date();
    const ops = pendingCanonicalKeyUpdates.map(entry => ({
      updateOne: {
        filter: { _id: entry.trackId },
        update: { $set: { canonicalKey: entry.canonicalKey, updatedAt: now } },
      },
    }));
    await tracksCol.bulkWrite(ops, { ordered: false });
  }

  const playCountIds = new Set();
  for (const ids of byKey.values()) {
    ids.forEach(id => playCountIds.add(id));
  }
  const playCountMap = await fetchPlayCounts(db, Array.from(playCountIds));

  const aliasMap = new Map();
  for (const [canonicalKey, ids] of byKey.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const resolved = await ensureCanonicalForKey({
      db,
      canonicalKey,
      trackIds: ids,
      playCountMap,
      logger,
    });
    for (const [trackId, canonicalTrackId] of resolved.entries()) {
      aliasMap.set(trackId, canonicalTrackId);
    }
  }

  return aliasMap;
}

module.exports = {
  buildCanonicalKey,
  ensureAliasesForTrackIds,
  normalizeTrackName,
  normalizeArtistName,
  DAY_MS,
};
