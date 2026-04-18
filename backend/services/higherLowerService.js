const fs = require('fs/promises');
const path = require('path');

const { initDb, COLLECTIONS } = require('../mongo.js');
const { addYearWindows, buildWindowBounds, constants: rollupConstants } = require('./rollupService');

const DEFAULT_MAX_PER_BUCKET = 50;
const DEFAULT_MAX_ROUNDS = 40;
const DEFAULT_OPENING_WINDOW_PERCENT = 0.03;
const DEFAULT_RECENT_PROMPT_TRAIT_WINDOW = 2;
const DEFAULT_HIGHER_LOWER_MODE = 'right_advances';
const VALID_HIGHER_LOWER_MODES = new Set(['winner_stays', 'right_advances']);
const HIGHER_LOWER_LOG_PREFIX = '[higher-lower]';
const HIGHER_LOWER_DEBUG_DIR = path.resolve(__dirname, '..', 'debug', 'higher-lower');
const HIGHER_LOWER_MODE_CONFIG = {
  winner_stays: {
    openingMinPercentile: 0.1,
    openingMaxPercentile: 0.2,
    poolTrimBottomPercent: 0,
    directionLowQuantile: 0.1,
    directionHighQuantile: 0.8,
    distanceBands: [
      { minRatio: 1, maxRatio: 1.8, weight: 0.65 },
      { minRatio: 1.8, maxRatio: 3.5, weight: 0.25 },
      { minRatio: 3.5, maxRatio: 8, weight: 0.08 },
      { minRatio: 8, maxRatio: Infinity, weight: 0.02 },
    ],
  },
  right_advances: {
    openingMinPercentile: 0.4,
    openingMaxPercentile: 0.6,
    poolTrimBottomPercent: 0.3,
    directionLowQuantile: 0.2,
    directionHighQuantile: 0.99,
    distanceBands: [
      { minRatio: 1, maxRatio: 1.8, weight: 0.55 },
      { minRatio: 1.8, maxRatio: 3.5, weight: 0.25 },
      { minRatio: 3.5, maxRatio: 8, weight: 0.13 },
      { minRatio: 8, maxRatio: Infinity, weight: 0.07 },
    ],
  },
};

function startPerfTimer() {
  return process.hrtime.bigint();
}

function elapsedPerfMs(startTime) {
  return Number(process.hrtime.bigint() - startTime) / 1e6;
}

function roundPerfMs(startTime) {
  return Number(elapsedPerfMs(startTime).toFixed(2));
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function logHigherLowerPerf(message, details = {}) {
  console.info(`${HIGHER_LOWER_LOG_PREFIX} ${message}`, details);
}

function resolveHigherLowerMode(options = {}) {
  const candidate = options?.mode;
  return VALID_HIGHER_LOWER_MODES.has(candidate)
    ? candidate
    : DEFAULT_HIGHER_LOWER_MODE;
}

function getHigherLowerModeConfig(options = {}) {
  const mode = resolveHigherLowerMode(options);
  return {
    mode,
    ...HIGHER_LOWER_MODE_CONFIG[mode],
  };
}

function getHigherLowerDatapointById(stageState, datapointId) {
  if (!datapointId) return null;
  return stageState?.pool?.find((entry) => entry?.id === datapointId) || null;
}

function getHigherLowerAnchorDatapointId(stageState) {
  return stageState?.anchorDatapointId || null;
}

function getHigherLowerAnchorHoldCount(stageState) {
  return Math.max(0, Number(stageState?.anchorHoldCount) || 0);
}

function syncHigherLowerAnchorState(stageState, { anchorDatapointId, anchorHoldCount } = {}) {
  if (!stageState) return stageState;
  stageState.anchorDatapointId = anchorDatapointId ?? getHigherLowerAnchorDatapointId(stageState);
  stageState.anchorHoldCount = anchorHoldCount === undefined
    ? getHigherLowerAnchorHoldCount(stageState)
    : Math.max(0, Number(anchorHoldCount) || 0);
  return stageState;
}

function getHigherLowerAnchor(stageState, datapointId = getHigherLowerAnchorDatapointId(stageState)) {
  return getHigherLowerDatapointById(stageState, datapointId);
}

function resolveHigherLowerNextAnchorState(stageState, round) {
  const mode = resolveHigherLowerMode(stageState);
  const currentAnchorDatapointId = getHigherLowerAnchorDatapointId(stageState);
  const currentAnchorHoldCount = getHigherLowerAnchorHoldCount(stageState);

  if (mode === 'right_advances' || round?.results?.winnerSide === 'RIGHT') {
    return {
      anchorDatapointId: round?.right?.id || currentAnchorDatapointId,
      anchorHoldCount: 0,
    };
  }

  return {
    anchorDatapointId: round?.left?.id || currentAnchorDatapointId,
    anchorHoldCount: currentAnchorHoldCount + 1,
  };
}

function sanitizeFileSegment(value, fallback = 'unknown') {
  const normalized = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

function formatDebugDatapoint(entry, index) {
  return [
    `[${index + 1}] ${entry?.title || 'Untitled'}`,
    `id: ${entry?.id || 'n/a'}`,
    `value: ${Number(entry?.value) || 0}`,
    `displayValue: ${Number(entry?.displayValue) || 0}`,
    `scope: ${entry?.scope || 'n/a'}`,
    `timeframe: ${entry?.timeframe || 'n/a'}`,
    `entityType: ${entry?.entityType || 'n/a'}`,
    `ownerPlayerId: ${entry?.ownerPlayerId || 'n/a'}`,
    `ownerLabel: ${entry?.ownerLabel || 'n/a'}`,
    `entityId: ${entry?.entityId || 'n/a'}`,
    `subtitle: ${entry?.subtitle || 'n/a'}`,
    `imageUrl: ${entry?.imageUrl || 'n/a'}`,
  ].join('\n');
}

async function writeStagePoolDebugDump({
  room,
  metric,
  pool = [],
  openingDatapoint = null,
}) {
  const timestamp = new Date().toISOString();
  const roomCode = room?.code || room?.roomCode || 'unknown-room';
  const fileName = [
    sanitizeFileSegment(roomCode, 'room'),
    sanitizeFileSegment(metric, 'metric'),
    sanitizeFileSegment(timestamp, 'timestamp'),
  ].join('__') + '.txt';
  const filePath = path.join(HIGHER_LOWER_DEBUG_DIR, fileName);
  const sortedPool = [...pool].sort((a, b) => {
    const valueDelta = (Number(b?.value) || 0) - (Number(a?.value) || 0);
    if (valueDelta !== 0) return valueDelta;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const body = [
    `generatedAt: ${timestamp}`,
    `roomCode: ${roomCode}`,
    `metric: ${metric}`,
    `poolSize: ${pool.length}`,
    'sortOrder: value desc, id asc',
    `openingDatapointId: ${openingDatapoint?.id || 'n/a'}`,
    `openingDatapointTitle: ${openingDatapoint?.title || 'n/a'}`,
    '',
    ...sortedPool.map((entry, index) => formatDebugDatapoint(entry, index)),
  ].join('\n\n');

  await fs.mkdir(HIGHER_LOWER_DEBUG_DIR, { recursive: true });
  await fs.writeFile(filePath, `${body}\n`, 'utf8');
  return filePath;
}

function createMetadataCache() {
  return {
    tracks: new Map(),
    artists: new Map(),
    albums: new Map(),
    missingTracks: new Set(),
    missingArtists: new Set(),
    missingAlbums: new Set(),
  };
}

function cacheMissingIds(targetSet, requestedIds = [], loadedDocs = []) {
  const loadedIds = new Set(loadedDocs.map((doc) => doc?._id).filter(Boolean));
  for (const id of requestedIds) {
    if (id && !loadedIds.has(id)) {
      targetSet.add(id);
    }
  }
}

function mapDocsFromCache(ids = [], cacheMap = new Map()) {
  const result = new Map();
  for (const id of ids) {
    if (!id) continue;
    const doc = cacheMap.get(id);
    if (doc) result.set(id, doc);
  }
  return result;
}

function metricValueFromDoc(metric, doc = {}) {
  if (metric === 'minutes') {
    return Math.max(0, Number(doc.msPlayed) || 0);
  }
  return Math.max(0, Number(doc.plays) || 0);
}

function displayMetricValue(metric, value) {
  if (metric === 'minutes') {
    return Math.round((Number(value) || 0) / 60000);
  }
  return Math.round(Number(value) || 0);
}

function titleCase(value = '') {
  return String(value)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTimeframeLabel(timeframe) {
  if (!timeframe) return 'Unknown Window';
  if (/^year\d{4}$/.test(timeframe)) return timeframe.replace('year', '');
  const map = {
    last7: 'Last 7 Days',
    last30: 'Last 30 Days',
    last90: 'Last 90 Days',
    last180: 'Last 180 Days',
    ytd: 'Year to Date',
    allTime: 'All Time',
  };
  return map[timeframe] || titleCase(timeframe);
}

function buildDatapointId(parts = []) {
  return parts
    .map((part) => (part === null || part === undefined || part === '' ? 'none' : String(part)))
    .join('::');
}

function compareDatapointsByValueAsc(left, right) {
  const valueDelta = (Number(left?.value) || 0) - (Number(right?.value) || 0);
  if (valueDelta !== 0) return valueDelta;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function clonePlayerEntry(playerId, player = {}) {
  return {
    playerId,
    userId: player.userId || null,
    displayName: player.displayName || player.name || 'Player',
    avatar: player.avatar || null,
  };
}

function getEligiblePlayers(room) {
  if (!room?.players) return [];
  return Array.from(room.players.entries())
    .map(([playerId, player]) => clonePlayerEntry(playerId, player))
    .filter((player) => !!player.userId);
}

async function resolveSupportedTimeframes(db, requestedTimeframes) {
  const timer = startPerfTimer();
  const base = rollupConstants.SNAPSHOT_WINDOWS || [];
  const windows = await addYearWindows(base, db);
  const allowedKeys = new Set(windows.map((window) => window.key));
  const resolved = Array.isArray(requestedTimeframes) && requestedTimeframes.length
    ? requestedTimeframes.filter((key) => allowedKeys.has(key))
    : windows.map((window) => window.key);

  logHigherLowerPerf('resolveSupportedTimeframes complete', {
    durationMs: roundPerfMs(timer),
    requestedCount: Array.isArray(requestedTimeframes) ? requestedTimeframes.length : 0,
    resolvedCount: resolved.length,
    resolvedTimeframes: resolved,
  });

  return resolved;
}

async function loadMetadataMaps(db, idsByType = {}, context = 'unknown', metadataCache = null) {
  const timer = startPerfTimer();
  const cache = metadataCache || createMetadataCache();
  const trackIds = Array.from(idsByType.trackIds || []);
  const explicitArtistIds = Array.from(idsByType.artistIds || []);
  const explicitAlbumIds = Array.from(idsByType.albumIds || []);
  const uncachedTrackIds = trackIds.filter(
    (id) => id && !cache.tracks.has(id) && !cache.missingTracks.has(id)
  );
  const uncachedExplicitArtistIds = explicitArtistIds.filter(
    (id) => id && !cache.artists.has(id) && !cache.missingArtists.has(id)
  );
  const uncachedExplicitAlbumIds = explicitAlbumIds.filter(
    (id) => id && !cache.albums.has(id) && !cache.missingAlbums.has(id)
  );

  const baseQueryTimer = startPerfTimer();
  const [trackDocs, artistDocs, albumDocs] = await Promise.all([
    uncachedTrackIds.length
      ? db.collection(COLLECTIONS.tracks).find(
          { _id: { $in: uncachedTrackIds } },
          {
            projection: {
              name: 1,
              artistIds: 1,
              artistNames: 1,
              albumId: 1,
              albumName: 1,
              images: 1,
            },
          }
        ).toArray()
      : [],
    uncachedExplicitArtistIds.length
      ? db.collection(COLLECTIONS.artists).find(
          { _id: { $in: uncachedExplicitArtistIds } },
          { projection: { name: 1, images: 1, genres: 1 } }
        ).toArray()
      : [],
    uncachedExplicitAlbumIds.length
      ? db.collection(COLLECTIONS.albums).find(
          { _id: { $in: uncachedExplicitAlbumIds } },
          { projection: { name: 1, artistIds: 1, artistNames: 1, images: 1 } }
        ).toArray()
      : [],
  ]);
  const baseQueryMs = roundPerfMs(baseQueryTimer);

  for (const doc of trackDocs) {
    if (doc?._id) cache.tracks.set(doc._id, doc);
  }
  for (const doc of artistDocs) {
    if (doc?._id) cache.artists.set(doc._id, doc);
  }
  for (const doc of albumDocs) {
    if (doc?._id) cache.albums.set(doc._id, doc);
  }
  cacheMissingIds(cache.missingTracks, uncachedTrackIds, trackDocs);
  cacheMissingIds(cache.missingArtists, uncachedExplicitArtistIds, artistDocs);
  cacheMissingIds(cache.missingAlbums, uncachedExplicitAlbumIds, albumDocs);

  const resolvedTracks = Array.from(mapDocsFromCache(trackIds, cache.tracks).values());

  const inferredArtistIds = new Set(explicitArtistIds);
  const inferredAlbumIds = new Set(explicitAlbumIds);
  for (const doc of resolvedTracks) {
    for (const artistId of doc.artistIds || []) {
      if (artistId) inferredArtistIds.add(artistId);
    }
    if (doc.albumId) inferredAlbumIds.add(doc.albumId);
  }

  const missingArtistIds = Array.from(inferredArtistIds).filter(
    (artistId) => artistId && !cache.artists.has(artistId) && !cache.missingArtists.has(artistId)
  );
  const missingAlbumIds = Array.from(inferredAlbumIds).filter(
    (albumId) => albumId && !cache.albums.has(albumId) && !cache.missingAlbums.has(albumId)
  );

  const missingQueryTimer = startPerfTimer();
  const [extraArtistDocs, extraAlbumDocs] = await Promise.all([
    missingArtistIds.length
      ? db.collection(COLLECTIONS.artists).find(
          { _id: { $in: missingArtistIds } },
          { projection: { name: 1, images: 1, genres: 1 } }
        ).toArray()
      : [],
    missingAlbumIds.length
      ? db.collection(COLLECTIONS.albums).find(
          { _id: { $in: missingAlbumIds } },
          { projection: { name: 1, artistIds: 1, artistNames: 1, images: 1 } }
        ).toArray()
      : [],
  ]);
  const missingQueryMs = roundPerfMs(missingQueryTimer);

  for (const doc of extraArtistDocs) {
    if (doc?._id) cache.artists.set(doc._id, doc);
  }
  for (const doc of extraAlbumDocs) {
    if (doc?._id) cache.albums.set(doc._id, doc);
  }
  cacheMissingIds(cache.missingArtists, missingArtistIds, extraArtistDocs);
  cacheMissingIds(cache.missingAlbums, missingAlbumIds, extraAlbumDocs);

  const returnedTracks = mapDocsFromCache(trackIds, cache.tracks);
  const returnedArtists = mapDocsFromCache(Array.from(inferredArtistIds), cache.artists);
  const returnedAlbums = mapDocsFromCache(Array.from(inferredAlbumIds), cache.albums);

  logHigherLowerPerf('loadMetadataMaps complete', {
    context,
    durationMs: roundPerfMs(timer),
    baseQueryMs,
    missingQueryMs,
    requestedCounts: {
      trackIds: trackIds.length,
      artistIds: explicitArtistIds.length,
      albumIds: explicitAlbumIds.length,
    },
    cacheCounts: {
      trackHits: trackIds.length - uncachedTrackIds.length,
      trackMisses: uncachedTrackIds.length,
      explicitArtistHits: explicitArtistIds.length - uncachedExplicitArtistIds.length,
      explicitArtistMisses: uncachedExplicitArtistIds.length,
      explicitAlbumHits: explicitAlbumIds.length - uncachedExplicitAlbumIds.length,
      explicitAlbumMisses: uncachedExplicitAlbumIds.length,
      inferredArtistMisses: missingArtistIds.length,
      inferredAlbumMisses: missingAlbumIds.length,
    },
    loadedCounts: {
      tracks: trackDocs.length,
      artists: artistDocs.length,
      albums: albumDocs.length,
      extraArtists: extraArtistDocs.length,
      extraAlbums: extraAlbumDocs.length,
    },
    inferredCounts: {
      artistIds: inferredArtistIds.size,
      albumIds: inferredAlbumIds.size,
      missingArtistIds: missingArtistIds.length,
      missingAlbumIds: missingAlbumIds.length,
    },
    returnedCounts: {
      tracks: returnedTracks.size,
      artists: returnedArtists.size,
      albums: returnedAlbums.size,
    },
  });

  return {
    tracks: returnedTracks,
    artists: returnedArtists,
    albums: returnedAlbums,
  };
}

function sortAndLimitByMetric(metric, docs = [], limit = DEFAULT_MAX_PER_BUCKET) {
  return [...docs]
    .sort((a, b) => {
      const metricDelta = metricValueFromDoc(metric, b) - metricValueFromDoc(metric, a);
      if (metricDelta !== 0) return metricDelta;
      return String(a._id || '').localeCompare(String(b._id || ''));
    })
    .slice(0, limit);
}

function createDatapoint({
  metric,
  scope,
  timeframe,
  entityType,
  ownerPlayerId = null,
  ownerLabel = null,
  entityId = null,
  title,
  subtitle = null,
  imageUrl = null,
  previewKind = null,
  previewTrackName = null,
  previewArtistName = null,
  value,
  contributorPlayerIds = null,
}) {
  const displayValue = displayMetricValue(metric, value);
  return {
    id: buildDatapointId([metric, scope, timeframe, entityType, ownerPlayerId, entityId, title]),
    metric,
    scope,
    timeframe,
    entityType,
    ownerPlayerId,
    ownerLabel,
    entityId,
    title,
    subtitle,
    imageUrl,
    previewKind,
    previewTrackName,
    previewArtistName,
    value,
    displayValue,
    contributorPlayerIds,
  };
}

function pushPlayerSnapshotDatapoints({
  datapoints,
  snapshotDoc,
  player,
  metric,
  timeframe,
  includeAllTimeTotals = true,
  maxPerBucket = DEFAULT_MAX_PER_BUCKET,
}) {
  const window = snapshotDoc?.windows?.[timeframe];
  if (!window) return;

  const timeframeLabel = formatTimeframeLabel(timeframe);

  if (window.totals && (timeframe !== 'allTime' || includeAllTimeTotals)) {
    const totalValue = metric === 'minutes'
      ? window.totals.msPlayed || 0
      : window.totals.plays || 0;
    if (totalValue > 0) {
      datapoints.push(createDatapoint({
        metric,
        scope: 'PLAYER',
        timeframe,
        entityType: 'TOTAL',
        ownerPlayerId: player.playerId,
        ownerLabel: player.displayName,
        title: `${player.displayName} Total`,
        subtitle: timeframeLabel,
        value: totalValue,
      }));
    }
  }

  if (timeframe === 'allTime') return;

  for (const track of (window.topTracks || []).slice(0, maxPerBucket)) {
    const value = metric === 'minutes' ? track.msPlayed || 0 : track.plays || 0;
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'PLAYER',
      timeframe,
      entityType: 'TRACK',
      ownerPlayerId: player.playerId,
      ownerLabel: player.displayName,
      entityId: track.trackId || null,
      title: track.trackName || 'Unknown Track',
      subtitle: [player.displayName, formatTimeframeLabel(timeframe), ...(track.artistNames || [])].filter(Boolean).join(' · '),
      imageUrl: track.images?.[0]?.url || null,
      previewKind: 'track',
      previewTrackName: track.trackName || 'Unknown Track',
      previewArtistName: (track.artistNames || []).join(', ') || null,
      value,
    }));
  }

  for (const artist of (window.topArtists || []).slice(0, maxPerBucket)) {
    const value = metric === 'minutes' ? artist.msPlayed || 0 : artist.plays || 0;
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'PLAYER',
      timeframe,
      entityType: 'ARTIST',
      ownerPlayerId: player.playerId,
      ownerLabel: player.displayName,
      entityId: artist.artistId || null,
      title: artist.name || 'Unknown Artist',
      subtitle: [player.displayName, formatTimeframeLabel(timeframe)].join(' · '),
      imageUrl: artist.images?.[0]?.url || null,
      previewKind: 'artist',
      previewArtistName: artist.name || 'Unknown Artist',
      value,
    }));
  }

  for (const album of (window.topAlbums || []).slice(0, maxPerBucket)) {
    const value = metric === 'minutes' ? album.msPlayed || 0 : album.plays || 0;
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'PLAYER',
      timeframe,
      entityType: 'ALBUM',
      ownerPlayerId: player.playerId,
      ownerLabel: player.displayName,
      entityId: album.albumId || null,
      title: album.name || 'Unknown Album',
      subtitle: [player.displayName, formatTimeframeLabel(timeframe), ...(album.artistNames || [])].filter(Boolean).join(' · '),
      imageUrl: album.images?.[0]?.url || null,
      value,
    }));
  }

  for (const genre of (window.topGenres || []).slice(0, maxPerBucket)) {
    const value = metric === 'minutes' ? genre.msPlayed || 0 : genre.plays || 0;
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'PLAYER',
      timeframe,
      entityType: 'GENRE',
      ownerPlayerId: player.playerId,
      ownerLabel: player.displayName,
      entityId: genre.genre || null,
      title: genre.genre || 'Unknown Genre',
      subtitle: [player.displayName, formatTimeframeLabel(timeframe)].join(' · '),
      value,
    }));
  }
}

function addRoomEntityAggregate(target, key, doc = {}) {
  if (!key) return;
  const current = target.get(key) || { plays: 0, msPlayed: 0 };
  current.plays += Number(doc.plays) || 0;
  current.msPlayed += Number(doc.msPlayed) || 0;
  target.set(key, current);
}

function buildContributorMap(docs, entityIdField, userIdToPlayerId) {
  const map = new Map();
  for (const doc of docs) {
    const entityId = doc[entityIdField];
    const playerId = userIdToPlayerId.get(doc.userId);
    if (!entityId || !playerId) continue;
    if (!map.has(entityId)) map.set(entityId, new Set());
    map.get(entityId).add(playerId);
  }
  return map;
}

async function buildAllTimeDatapoints({
  db,
  players,
  snapshotsByUserId,
  metric,
  maxPerBucket,
  metadataCache,
}) {
  const timer = startPerfTimer();
  const datapoints = [];
  const userIds = players.map((player) => player.userId).filter(Boolean);
  if (!userIds.length) {
    logHigherLowerPerf('buildAllTimeDatapoints skipped', {
      durationMs: roundPerfMs(timer),
      reason: 'no-user-ids',
    });
    return datapoints;
  }

  const queryTimer = startPerfTimer();
  const [
    playerTrackDocs,
    playerArtistDocs,
    playerAlbumDocs,
    playerGenreDocs,
    roomTrackDocs,
    roomArtistDocs,
    roomAlbumDocs,
    roomGenreDocs,
  ] = await Promise.all([
    db.collection(COLLECTIONS.userTrackCounts).find({ userId: { $in: userIds } }).toArray(),
    db.collection(COLLECTIONS.userArtistCounts).find({ userId: { $in: userIds } }).toArray(),
    db.collection(COLLECTIONS.userAlbumCounts).find({ userId: { $in: userIds } }).toArray(),
    db.collection(COLLECTIONS.userGenreCounts).find({ userId: { $in: userIds } }).toArray(),
    db.collection(COLLECTIONS.userTrackCounts).aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$trackId', plays: { $sum: '$plays' }, msPlayed: { $sum: '$msPlayed' } } },
    ]).toArray(),
    db.collection(COLLECTIONS.userArtistCounts).aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$artistId', plays: { $sum: '$plays' }, msPlayed: { $sum: '$msPlayed' } } },
    ]).toArray(),
    db.collection(COLLECTIONS.userAlbumCounts).aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$albumId', plays: { $sum: '$plays' }, msPlayed: { $sum: '$msPlayed' } } },
    ]).toArray(),
    db.collection(COLLECTIONS.userGenreCounts).aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$genre', plays: { $sum: '$plays' }, msPlayed: { $sum: '$msPlayed' } } },
    ]).toArray(),
  ]);
  const queryMs = roundPerfMs(queryTimer);

  const metadata = await loadMetadataMaps(db, {
    trackIds: new Set([
      ...playerTrackDocs.map((doc) => doc.trackId).filter(Boolean),
      ...roomTrackDocs.map((doc) => doc._id).filter(Boolean),
    ]),
    artistIds: new Set([
      ...playerArtistDocs.map((doc) => doc.artistId).filter(Boolean),
      ...roomArtistDocs.map((doc) => doc._id).filter(Boolean),
    ]),
    albumIds: new Set([
      ...playerAlbumDocs.map((doc) => doc.albumId).filter(Boolean),
      ...roomAlbumDocs.map((doc) => doc._id).filter(Boolean),
    ]),
  }, 'all-time', metadataCache);

  const playerBuildTimer = startPerfTimer();
  for (const player of players) {
    const snapshot = snapshotsByUserId.get(player.userId) || null;
    pushPlayerSnapshotDatapoints({
      datapoints,
      snapshotDoc: snapshot,
      player,
      metric,
      timeframe: 'allTime',
      includeAllTimeTotals: true,
      maxPerBucket,
    });

    const playerTracks = sortAndLimitByMetric(
      metric,
      playerTrackDocs.filter((doc) => doc.userId === player.userId).map((doc) => ({ ...doc, _id: doc.trackId })),
      maxPerBucket
    );
    for (const doc of playerTracks) {
      const meta = metadata.tracks.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'PLAYER',
        timeframe: 'allTime',
        entityType: 'TRACK',
        ownerPlayerId: player.playerId,
        ownerLabel: player.displayName,
        entityId: doc._id,
        title: meta.name || 'Unknown Track',
        subtitle: [player.displayName, 'All Time', ...(meta.artistNames || [])].filter(Boolean).join(' · '),
        imageUrl: meta.images?.[0]?.url || null,
        previewKind: 'track',
        previewTrackName: meta.name || 'Unknown Track',
        previewArtistName: (meta.artistNames || []).join(', ') || null,
        value,
      }));
    }

    const playerArtists = sortAndLimitByMetric(
      metric,
      playerArtistDocs.filter((doc) => doc.userId === player.userId).map((doc) => ({ ...doc, _id: doc.artistId })),
      maxPerBucket
    );
    for (const doc of playerArtists) {
      const meta = metadata.artists.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'PLAYER',
        timeframe: 'allTime',
        entityType: 'ARTIST',
        ownerPlayerId: player.playerId,
        ownerLabel: player.displayName,
        entityId: doc._id,
        title: meta.name || 'Unknown Artist',
        subtitle: `${player.displayName} · All Time`,
        imageUrl: meta.images?.[0]?.url || null,
        previewKind: 'artist',
        previewArtistName: meta.name || 'Unknown Artist',
        value,
      }));
    }

    const playerAlbums = sortAndLimitByMetric(
      metric,
      playerAlbumDocs.filter((doc) => doc.userId === player.userId).map((doc) => ({ ...doc, _id: doc.albumId })),
      maxPerBucket
    );
    for (const doc of playerAlbums) {
      const meta = metadata.albums.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'PLAYER',
        timeframe: 'allTime',
        entityType: 'ALBUM',
        ownerPlayerId: player.playerId,
        ownerLabel: player.displayName,
        entityId: doc._id,
        title: meta.name || 'Unknown Album',
        subtitle: [player.displayName, 'All Time', ...(meta.artistNames || [])].filter(Boolean).join(' · '),
        imageUrl: meta.images?.[0]?.url || null,
        value,
      }));
    }

    const playerGenres = sortAndLimitByMetric(
      metric,
      playerGenreDocs.filter((doc) => doc.userId === player.userId).map((doc) => ({ ...doc, _id: doc.genre })),
      maxPerBucket
    );
    for (const doc of playerGenres) {
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'PLAYER',
        timeframe: 'allTime',
        entityType: 'GENRE',
        ownerPlayerId: player.playerId,
        ownerLabel: player.displayName,
        entityId: doc._id,
        title: doc._id || 'Unknown Genre',
        subtitle: `${player.displayName} · All Time`,
        value,
      }));
    }
  }
  const playerBuildMs = roundPerfMs(playerBuildTimer);

  const userIdToPlayerId = new Map(players.map((p) => [p.userId, p.playerId]).filter(([uid]) => uid));
  const trackContributors = buildContributorMap(playerTrackDocs, 'trackId', userIdToPlayerId);
  const artistContributors = buildContributorMap(playerArtistDocs, 'artistId', userIdToPlayerId);
  const albumContributors = buildContributorMap(playerAlbumDocs, 'albumId', userIdToPlayerId);
  const genreContributors = buildContributorMap(playerGenreDocs, 'genre', userIdToPlayerId);

  const roomTotalValue = players.reduce((sum, player) => {
    const snapshot = snapshotsByUserId.get(player.userId);
    const totals = snapshot?.windows?.allTime?.totals || {};
    return sum + (metric === 'minutes' ? totals.msPlayed || 0 : totals.plays || 0);
  }, 0);
  const totalContributorPlayerIds = players
    .filter((p) => {
      const snapshot = snapshotsByUserId.get(p.userId);
      const totals = snapshot?.windows?.allTime?.totals || {};
      return (metric === 'minutes' ? totals.msPlayed || 0 : totals.plays || 0) > 0;
    })
    .map((p) => p.playerId)
    .filter(Boolean);
  if (roomTotalValue > 0) {
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'TOTAL',
      title: 'Whole Room Total',
      subtitle: 'All Time',
      value: roomTotalValue,
      contributorPlayerIds: totalContributorPlayerIds.length ? totalContributorPlayerIds : null,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomTrackDocs, maxPerBucket)) {
    const meta = metadata.tracks.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    const contributors = trackContributors.get(doc._id);
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'TRACK',
      entityId: doc._id,
      title: meta.name || 'Unknown Track',
      subtitle: ['Whole Room', 'All Time', ...(meta.artistNames || [])].filter(Boolean).join(' · '),
      imageUrl: meta.images?.[0]?.url || null,
      previewKind: 'track',
      previewTrackName: meta.name || 'Unknown Track',
      previewArtistName: (meta.artistNames || []).join(', ') || null,
      value,
      contributorPlayerIds: contributors ? Array.from(contributors) : null,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomArtistDocs, maxPerBucket)) {
    const meta = metadata.artists.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    const contributors = artistContributors.get(doc._id);
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'ARTIST',
      entityId: doc._id,
      title: meta.name || 'Unknown Artist',
      subtitle: 'Whole Room · All Time',
      imageUrl: meta.images?.[0]?.url || null,
      previewKind: 'artist',
      previewArtistName: meta.name || 'Unknown Artist',
      value,
      contributorPlayerIds: contributors ? Array.from(contributors) : null,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomAlbumDocs, maxPerBucket)) {
    const meta = metadata.albums.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    const contributors = albumContributors.get(doc._id);
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'ALBUM',
      entityId: doc._id,
      title: meta.name || 'Unknown Album',
      subtitle: ['Whole Room', 'All Time', ...(meta.artistNames || [])].filter(Boolean).join(' · '),
      imageUrl: meta.images?.[0]?.url || null,
      value,
      contributorPlayerIds: contributors ? Array.from(contributors) : null,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomGenreDocs, maxPerBucket)) {
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    const contributors = genreContributors.get(doc._id);
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'GENRE',
      entityId: doc._id,
      title: doc._id || 'Unknown Genre',
      subtitle: 'Whole Room · All Time',
      value,
      contributorPlayerIds: contributors ? Array.from(contributors) : null,
    }));
  }

  logHigherLowerPerf('buildAllTimeDatapoints complete', {
    durationMs: roundPerfMs(timer),
    queryMs,
    playerBuildMs,
    metric,
    playerCount: players.length,
    userCount: userIds.length,
    counts: {
      playerTrackDocs: playerTrackDocs.length,
      playerArtistDocs: playerArtistDocs.length,
      playerAlbumDocs: playerAlbumDocs.length,
      playerGenreDocs: playerGenreDocs.length,
      roomTrackDocs: roomTrackDocs.length,
      roomArtistDocs: roomArtistDocs.length,
      roomAlbumDocs: roomAlbumDocs.length,
      roomGenreDocs: roomGenreDocs.length,
      datapoints: datapoints.length,
    },
  });

  return datapoints;
}

async function buildTimeframedDatapoints({
  db,
  players,
  snapshotsByUserId,
  metric,
  timeframes,
  maxPerBucket,
  metadataCache,
}) {
  const timer = startPerfTimer();
  const datapoints = [];
  const userIds = players.map((player) => player.userId).filter(Boolean);
  const userIdToPlayerId = new Map(players.map((p) => [p.userId, p.playerId]).filter(([uid]) => uid));
  if (!userIds.length) {
    logHigherLowerPerf('buildTimeframedDatapoints skipped', {
      durationMs: roundPerfMs(timer),
      reason: 'no-user-ids',
    });
    return datapoints;
  }

  const statsCol = db.collection(COLLECTIONS.userStatsDaily);
  const trackDailyCol = db.collection(COLLECTIONS.userTrackDaily);

  const windowTimer = startPerfTimer();
  const windows = await addYearWindows(rollupConstants.SNAPSHOT_WINDOWS || [], db);
  const defsByKey = new Map(windows.map((window) => [window.key, window]));
  const windowMs = roundPerfMs(windowTimer);

  for (const timeframe of timeframes) {
    if (timeframe === 'allTime') continue;
    const timeframeTimer = startPerfTimer();
    const datapointCountBefore = datapoints.length;

    for (const player of players) {
      const snapshot = snapshotsByUserId.get(player.userId) || null;
      pushPlayerSnapshotDatapoints({
        datapoints,
        snapshotDoc: snapshot,
        player,
        metric,
        timeframe,
        includeAllTimeTotals: false,
        maxPerBucket,
      });
    }

    const def = defsByKey.get(timeframe);
    if (!def) continue;
    const bounds = buildWindowBounds(new Date(), def);
    const match = { userId: { $in: userIds } };
    if (bounds.start || bounds.end) {
      match.day = {};
      if (bounds.start) match.day.$gte = bounds.start;
      if (bounds.end) match.day.$lt = bounds.end;
    }

    const queryTimer = startPerfTimer();
    const [roomTotals, roomTracks] = await Promise.all([
      statsCol.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            plays: { $sum: '$totals.plays' },
            msPlayed: { $sum: '$totals.msPlayed' },
            userIds: { $addToSet: '$userId' },
          },
        },
      ]).toArray(),
      trackDailyCol.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$trackId',
            plays: { $sum: '$plays' },
            msPlayed: { $sum: '$msPlayed' },
            userIds: { $addToSet: '$userId' },
          },
        },
      ]).toArray(),
    ]);
    const queryMs = roundPerfMs(queryTimer);

    const trackIds = new Set(roomTracks.map((doc) => doc._id).filter(Boolean));
    const metadata = await loadMetadataMaps(db, { trackIds }, `timeframe:${timeframe}`, metadataCache);
    const roomArtists = new Map();
    const roomAlbums = new Map();
    const roomGenres = new Map();

    const trackContributors = new Map();
    const artistContributors = new Map();
    const albumContributors = new Map();
    const genreContributors = new Map();

    for (const track of roomTracks) {
      const meta = metadata.tracks.get(track._id) || {};
      const trackPlayerIds = (track.userIds || []).map((uid) => userIdToPlayerId.get(uid)).filter(Boolean);
      if (track._id) {
        trackContributors.set(track._id, new Set(trackPlayerIds));
      }
      for (const artistId of new Set((meta.artistIds || []).filter(Boolean))) {
        addRoomEntityAggregate(roomArtists, artistId, track);
        if (!artistContributors.has(artistId)) artistContributors.set(artistId, new Set());
        for (const pid of trackPlayerIds) artistContributors.get(artistId).add(pid);
        const artistMeta = metadata.artists.get(artistId) || {};
        for (const genre of new Set((artistMeta.genres || []).filter(Boolean))) {
          addRoomEntityAggregate(roomGenres, genre, track);
          if (!genreContributors.has(genre)) genreContributors.set(genre, new Set());
          for (const pid of trackPlayerIds) genreContributors.get(genre).add(pid);
        }
      }
      if (meta.albumId) {
        addRoomEntityAggregate(roomAlbums, meta.albumId, track);
        if (!albumContributors.has(meta.albumId)) albumContributors.set(meta.albumId, new Set());
        for (const pid of trackPlayerIds) albumContributors.get(meta.albumId).add(pid);
      }
    }

    const roomTotalValue = roomTotals[0]
      ? metric === 'minutes'
        ? roomTotals[0].msPlayed || 0
        : roomTotals[0].plays || 0
      : 0;
    const totalContributorPlayerIds = (roomTotals[0]?.userIds || [])
      .map((uid) => userIdToPlayerId.get(uid))
      .filter(Boolean);
    if (roomTotalValue > 0) {
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'TOTAL',
        title: 'Whole Room Total',
        subtitle: formatTimeframeLabel(timeframe),
        value: roomTotalValue,
        contributorPlayerIds: totalContributorPlayerIds.length ? totalContributorPlayerIds : null,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, roomTracks, maxPerBucket)) {
      const meta = metadata.tracks.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      const contributors = trackContributors.get(doc._id);
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'TRACK',
        entityId: doc._id,
        title: meta.name || 'Unknown Track',
        subtitle: ['Whole Room', formatTimeframeLabel(timeframe), ...(meta.artistNames || [])].filter(Boolean).join(' · '),
        imageUrl: meta.images?.[0]?.url || null,
        previewKind: 'track',
        previewTrackName: meta.name || 'Unknown Track',
        previewArtistName: (meta.artistNames || []).join(', ') || null,
        value,
        contributorPlayerIds: contributors ? Array.from(contributors) : null,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomArtists.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const meta = metadata.artists.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      const contributors = artistContributors.get(doc._id);
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'ARTIST',
        entityId: doc._id,
        title: meta.name || 'Unknown Artist',
        subtitle: `Whole Room · ${formatTimeframeLabel(timeframe)}`,
        imageUrl: meta.images?.[0]?.url || null,
        previewKind: 'artist',
        previewArtistName: meta.name || 'Unknown Artist',
        value,
        contributorPlayerIds: contributors ? Array.from(contributors) : null,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomAlbums.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const meta = metadata.albums.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      const contributors = albumContributors.get(doc._id);
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'ALBUM',
        entityId: doc._id,
        title: meta.name || 'Unknown Album',
        subtitle: ['Whole Room', formatTimeframeLabel(timeframe), ...(meta.artistNames || [])].filter(Boolean).join(' · '),
        imageUrl: meta.images?.[0]?.url || null,
        value,
        contributorPlayerIds: contributors ? Array.from(contributors) : null,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomGenres.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      const contributors = genreContributors.get(doc._id);
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'GENRE',
        entityId: doc._id,
        title: doc._id || 'Unknown Genre',
        subtitle: `Whole Room · ${formatTimeframeLabel(timeframe)}`,
        value,
        contributorPlayerIds: contributors ? Array.from(contributors) : null,
      }));
    }

    logHigherLowerPerf('buildTimeframedDatapoints timeframe complete', {
      timeframe,
      durationMs: roundPerfMs(timeframeTimer),
      queryMs,
      playerCount: players.length,
      userCount: userIds.length,
      counts: {
        roomTotals: roomTotals.length,
        roomTracks: roomTracks.length,
        trackIds: trackIds.size,
        roomArtists: roomArtists.size,
        roomAlbums: roomAlbums.size,
        roomGenres: roomGenres.size,
        datapointsAdded: datapoints.length - datapointCountBefore,
      },
    });
  }

  logHigherLowerPerf('buildTimeframedDatapoints complete', {
    durationMs: roundPerfMs(timer),
    windowMs,
    metric,
    timeframeCount: timeframes.filter((timeframe) => timeframe !== 'allTime').length,
    datapoints: datapoints.length,
  });

  return datapoints;
}

function dedupeDatapoints(datapoints = []) {
  const byId = new Map();
  for (const datapoint of datapoints) {
    if (!datapoint?.id) continue;
    byId.set(datapoint.id, datapoint);
  }
  return Array.from(byId.values());
}

async function buildHigherLowerDatapointPool({ room, metric = 'plays', options = {} }) {
  const timer = startPerfTimer();
  const db = await initDb();
  const players = getEligiblePlayers(room);
  if (!players.length) {
    logHigherLowerPerf('buildHigherLowerDatapointPool skipped', {
      durationMs: roundPerfMs(timer),
      metric,
      reason: 'no-eligible-players',
    });
    return [];
  }

  const timeframes = await resolveSupportedTimeframes(db, options.timeframes);
  const snapshotTimer = startPerfTimer();
  const snapshots = await db
    .collection(COLLECTIONS.userSnapshots)
    .find({ userId: { $in: players.map((player) => player.userId) } })
    .toArray();
  const snapshotMs = roundPerfMs(snapshotTimer);
  const snapshotsByUserId = new Map(snapshots.map((doc) => [doc.userId, doc]));
  const maxPerBucket = Number(options.maxPerBucket) > 0 ? Number(options.maxPerBucket) : DEFAULT_MAX_PER_BUCKET;
  const metadataCache = createMetadataCache();

  const [allTimeDatapoints, timeframedDatapoints] = await Promise.all([
    buildAllTimeDatapoints({
      db,
      players,
      snapshotsByUserId,
      metric,
      maxPerBucket,
      metadataCache,
    }),
    buildTimeframedDatapoints({
      db,
      players,
      snapshotsByUserId,
      metric,
      timeframes,
      maxPerBucket,
      metadataCache,
    }),
  ]);

  const dedupeTimer = startPerfTimer();
  const dedupedDatapoints = dedupeDatapoints([...allTimeDatapoints, ...timeframedDatapoints]);
  const dedupeMs = roundPerfMs(dedupeTimer);

  logHigherLowerPerf('buildHigherLowerDatapointPool complete', {
    durationMs: roundPerfMs(timer),
    metric,
    roomCode: room?.code || room?.roomCode || null,
    playerCount: players.length,
    timeframeCount: timeframes.length,
    snapshotCount: snapshots.length,
    snapshotMs,
    maxPerBucket,
    counts: {
      allTimeDatapoints: allTimeDatapoints.length,
      timeframedDatapoints: timeframedDatapoints.length,
      dedupedDatapoints: dedupedDatapoints.length,
    },
    dedupeMs,
  });
  
  return dedupedDatapoints;
}

function pickOpeningDatapoint(pool = [], options = {}) {
  if (!pool.length) return null;
  const sorted = [...pool].sort(compareDatapointsByValueAsc);
  const modeConfig = getHigherLowerModeConfig(options);
  const minPercentile = clampNumber(
    Number(options.openingMinPercentile),
    0,
    0.99,
    modeConfig.openingMinPercentile
  );
  const maxPercentile = clampNumber(
    Number(options.openingMaxPercentile),
    minPercentile,
    1,
    modeConfig.openingMaxPercentile
  );
  const windowPercent = clampNumber(
    Number(options.openingWindowPercent),
    0,
    0.5,
    DEFAULT_OPENING_WINDOW_PERCENT
  );
  const targetPercentile = maxPercentile > minPercentile
    ? minPercentile + (Math.random() * (maxPercentile - minPercentile))
    : minPercentile;
  const centerIndex = Math.round((sorted.length - 1) * targetPercentile);
  const radius = Math.max(1, Math.floor(sorted.length * windowPercent * 0.5));
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(sorted.length, centerIndex + radius + 1);
  const candidates = sorted.slice(start, end);
  return candidates[Math.floor(Math.random() * candidates.length)] || sorted[centerIndex] || sorted[0];
}

function trimHigherLowerPoolForMode(pool = [], options = {}) {
  if (!Array.isArray(pool) || pool.length < 2) return Array.isArray(pool) ? pool : [];

  const modeConfig = getHigherLowerModeConfig(options);
  const trimBottomPercent = clampNumber(
    Number(options.poolTrimBottomPercent),
    0,
    0.95,
    modeConfig.poolTrimBottomPercent || 0
  );
  if (trimBottomPercent <= 0) return pool;

  const sorted = [...pool].sort(compareDatapointsByValueAsc);
  const maxTrimCount = Math.max(0, sorted.length - 2);
  const trimCount = Math.min(maxTrimCount, Math.floor(sorted.length * trimBottomPercent));
  if (trimCount <= 0) return pool;

  return sorted.slice(trimCount);
}

function buildSeenOwnerList(ownerIds = []) {
  if (!Array.isArray(ownerIds)) return [];
  const seenOwners = [];
  for (const ownerId of ownerIds) {
    if (!ownerId || seenOwners.includes(ownerId)) continue;
    seenOwners.push(ownerId);
  }
  return seenOwners;
}

function appendRecentPromptTraitValues(
  existingValues = [],
  nextValues = [],
  limit = DEFAULT_RECENT_PROMPT_TRAIT_WINDOW
) {
  const resolvedLimit = Math.max(1, Number(limit) || DEFAULT_RECENT_PROMPT_TRAIT_WINDOW);
  const combined = [];

  for (const value of [...(existingValues || []), ...(nextValues || [])]) {
    if (!value) continue;
    combined.push(String(value));
  }

  return combined.slice(-resolvedLimit);
}

function getRecentOwnerKey(datapoint) {
  if (!datapoint) return null;
  if (datapoint.ownerPlayerId) return datapoint.ownerPlayerId;
  return null;
}

function preferUnseenOwners(candidates = [], ownersSeenThisCycle = []) {
  if (!candidates.length) return candidates;
  const seenOwnerSet = new Set((ownersSeenThisCycle || []).filter(Boolean));
  if (!seenOwnerSet.size) return candidates;

  const filteredCandidates = candidates.filter((entry) => {
    const ownerKey = getRecentOwnerKey(entry);
    if (!ownerKey) return true;
    return !seenOwnerSet.has(ownerKey);
  });
  return filteredCandidates.length ? filteredCandidates : candidates;
}

function preferUnseenPromptTraits(
  candidates = [],
  { recentEntityTypes = [], recentScopes = [] } = {}
) {
  if (!candidates.length) return candidates;

  const hasRecentGenre = (recentEntityTypes || []).includes('GENRE');
  const hasRecentRoom = (recentScopes || []).includes('ROOM');
  if (!hasRecentGenre && !hasRecentRoom) return candidates;

  const filtered = candidates.filter((entry) => {
    if (hasRecentGenre && entry?.entityType === 'GENRE') return false;
    if (hasRecentRoom && entry?.scope === 'ROOM') return false;
    return true;
  });

  return filtered.length ? filtered : candidates;
}

function selectWeightedGroup(groups = []) {
  const availableGroups = groups.filter((group) => group?.weight > 0 && group.items?.length);
  if (!availableGroups.length) return null;

  const totalWeight = availableGroups.reduce((sum, group) => sum + group.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const group of availableGroups) {
    roll -= group.weight;
    if (roll <= 0) return group;
  }

  return availableGroups[availableGroups.length - 1];
}

function buildOutcomeSummary(candidates = [], anchorValue = 0) {
  const summary = {
    total: candidates.length,
    greaterCount: 0,
    lessCount: 0,
    equalCount: 0,
    greaterChance: 0,
    lessChance: 0,
    equalChance: 0,
  };

  for (const entry of candidates) {
    const entryValue = Number(entry?.value) || 0;
    if (entryValue > anchorValue) {
      summary.greaterCount += 1;
    } else if (entryValue < anchorValue) {
      summary.lessCount += 1;
    } else {
      summary.equalCount += 1;
    }
  }

  if (summary.total > 0) {
    summary.greaterChance = Number((summary.greaterCount / summary.total).toFixed(3));
    summary.lessChance = Number((summary.lessCount / summary.total).toFixed(3));
    summary.equalChance = Number((summary.equalCount / summary.total).toFixed(3));
  }

  return summary;
}

function buildDirectionalGroups(candidates = [], anchorValue = 0) {
  const higher = [];
  const lowerOrEqual = [];

  for (const entry of candidates) {
    const entryValue = Number(entry?.value) || 0;
    if (entryValue > anchorValue) {
      higher.push(entry);
    } else {
      lowerOrEqual.push(entry);
    }
  }

  return { higher, lowerOrEqual };
}

function getQuantileValue(sortedValues = [], quantile = 0.5) {
  if (!sortedValues.length) return 0;
  const clampedQuantile = clampNumber(Number(quantile), 0, 1, 0.5);
  const index = (sortedValues.length - 1) * clampedQuantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = Number(sortedValues[lowerIndex]) || 0;
  const upperValue = Number(sortedValues[upperIndex]) || 0;

  if (lowerIndex === upperIndex) return lowerValue;
  const weight = index - lowerIndex;
  return lowerValue + ((upperValue - lowerValue) * weight);
}

function buildValueScaleSummary({
  sortedValues = [],
  anchorValue = 0,
  lowQuantile = null,
  highQuantile = null,
  mode = DEFAULT_HIGHER_LOWER_MODE,
}) {
  const modeConfig = getHigherLowerModeConfig({ mode });
  const fallbackLowQuantile = modeConfig.directionLowQuantile;
  const fallbackHighQuantile = modeConfig.directionHighQuantile;
  const requestedLowQuantile = lowQuantile === null || lowQuantile === undefined
    ? fallbackLowQuantile
    : Number.isFinite(Number(lowQuantile))
    ? Number(lowQuantile)
    : fallbackLowQuantile;
  const requestedHighQuantile = highQuantile === null || highQuantile === undefined
    ? fallbackHighQuantile
    : Number.isFinite(Number(highQuantile))
    ? Number(highQuantile)
    : fallbackHighQuantile;

  if (!sortedValues.length) {
    return {
      lowQuantile: Number(requestedLowQuantile.toFixed(3)),
      highQuantile: Number(requestedHighQuantile.toFixed(3)),
      lowAnchorValue: 0,
      highAnchorValue: 0,
      logScaledPosition: 0.5,
    };
  }

  const resolvedLowQuantile = clampNumber(requestedLowQuantile, 0, 0.99, fallbackLowQuantile);
  const resolvedHighQuantile = clampNumber(
    requestedHighQuantile,
    resolvedLowQuantile + 0.01,
    1,
    fallbackHighQuantile
  );
  const lowAnchorValue = getQuantileValue(sortedValues, resolvedLowQuantile);
  const highAnchorValue = getQuantileValue(sortedValues, resolvedHighQuantile);
  const lowAnchorLog = Math.log1p(Math.max(0, lowAnchorValue));
  const highAnchorLog = Math.log1p(Math.max(0, highAnchorValue));
  const anchorLogValue = Math.log1p(Math.max(0, Number(anchorValue) || 0));
  const logRange = highAnchorLog - lowAnchorLog;
  const unclampedPosition = logRange > 1e-9
    ? (anchorLogValue - lowAnchorLog) / logRange
    : 0.5;
  const logScaledPosition = clampNumber(unclampedPosition, 0, 1, 0.5);

  return {
    lowQuantile: Number(resolvedLowQuantile.toFixed(3)),
    highQuantile: Number(resolvedHighQuantile.toFixed(3)),
    lowAnchorValue: Number(lowAnchorValue.toFixed(3)),
    highAnchorValue: Number(highAnchorValue.toFixed(3)),
    logScaledPosition: Number(logScaledPosition.toFixed(3)),
  };
}

function computeHigherDirectionChance({
  sortedValues = [],
  anchorValue = 0,
  anchorHoldCount = 0,
  mode = DEFAULT_HIGHER_LOWER_MODE,
}) {
  const valueScaleSummary = buildValueScaleSummary({
    sortedValues,
    anchorValue,
    mode,
  });
  const baseHigherChance = clampNumber(
    0.82 - (valueScaleSummary.logScaledPosition * 0.64),
    0.18,
    0.82,
    0.5
  );
  const streakBoost = Math.min(0.6, Math.max(0, Number(anchorHoldCount) || 0) * 0.1);
  const targetHigherChance = clampNumber(
    baseHigherChance + streakBoost,
    0.18,
    0.9,
    baseHigherChance
  );

  return {
    ...valueScaleSummary,
    baseHigherChance: Number(baseHigherChance.toFixed(3)),
    streakBoost: Number(streakBoost.toFixed(3)),
    targetHigherChance: Number(targetHigherChance.toFixed(3)),
  };
}

function computeRightAdvancesDirectionChance({
  sortedValues = [],
  anchorValue = 0,
  mode = DEFAULT_HIGHER_LOWER_MODE,
}) {
  const valueScaleSummary = buildValueScaleSummary({
    sortedValues,
    anchorValue,
    mode,
  });
  const targetHigherChance = clampNumber(
    0.5 + ((0.5 - valueScaleSummary.logScaledPosition) * 0.5),
    0.35,
    0.75,
    0.5
  );

  return {
    ...valueScaleSummary,
    baseHigherChance: Number(targetHigherChance.toFixed(3)),
    streakBoost: 0,
    targetHigherChance: Number(targetHigherChance.toFixed(3)),
  };
}

function planDirectionalSelection({
  targetHigherChance = 0.5,
  hasHigher = false,
  hasLowerOrEqual = false,
}) {
  if (!hasHigher && !hasLowerOrEqual) {
    return {
      sampledDirection: 'none',
      selectedDirection: 'none',
      appliedHigherChance: 0,
      flippedDirection: false,
    };
  }

  const sampledHigherChance = clampNumber(targetHigherChance, 0, 1, 0.5);
  const sampledDirection = Math.random() < sampledHigherChance ? 'higher' : 'lowerOrEqual';
  let selectedDirection = sampledDirection;
  let flippedDirection = false;

  if (sampledDirection === 'higher' && !hasHigher && hasLowerOrEqual) {
    selectedDirection = 'lowerOrEqual';
    flippedDirection = true;
  } else if (sampledDirection === 'lowerOrEqual' && !hasLowerOrEqual && hasHigher) {
    selectedDirection = 'higher';
    flippedDirection = true;
  }

  const appliedHigherChance = hasHigher && hasLowerOrEqual
    ? sampledHigherChance
    : hasHigher
    ? 1
    : 0;

  return {
    sampledDirection,
    selectedDirection,
    appliedHigherChance: Number(appliedHigherChance.toFixed(3)),
    flippedDirection,
  };
}

function buildCompatibleDirectionalGroups(groups = [], selectedDirection = 'lowerOrEqual') {
  const directionKey = selectedDirection === 'higher' ? 'higher' : 'lowerOrEqual';
  return groups
    .map((group) => ({
      ...group,
      allItems: group.items,
      items: group?.directionalGroups?.[directionKey] || [],
    }))
    .filter((group) => group.items?.length);
}

function pickDirectionalCandidate(candidates = [], selectionContext = {}) {
  const filteredPool = preferUnseenPromptTraits(candidates, selectionContext);
  const challenger =
    filteredPool[Math.floor(Math.random() * filteredPool.length)] ||
    filteredPool[0] ||
    null;

  return {
    challenger,
    filteredPoolCount: filteredPool.length,
  };
}

function pickChallenger({
  pool = [],
  anchor,
  usedIds = [],
  maxAttempts = 4,
  ownersSeenThisCycle = [],
  recentEntityTypes = [],
  recentScopes = [],
  mode = DEFAULT_HIGHER_LOWER_MODE,
  anchorHoldCount = 0,
  logSelection = true,
}) {
  if (!anchor) return null;
  const resolvedMode = resolveHigherLowerMode({ mode });
  const usedSet = new Set(usedIds);
  const available = pool.filter((entry) => entry?.id && entry.id !== anchor.id && !usedSet.has(entry.id));
  if (!available.length) {
    if (logSelection) {
      logHigherLowerPerf('pickChallenger no candidates', {
        anchorId: anchor?.id || null,
        anchorTitle: anchor?.title || null,
        usedCount: usedSet.size,
        poolSize: pool.length,
      });
    }
    return null;
  }

  const sorted = [...available].sort(compareDatapointsByValueAsc);
  const sortedValues = sorted.map((entry) => Math.max(0, Number(entry?.value) || 0));
  const rawAnchorValue = Number(anchor.value) || 0;
  const anchorValue = Math.max(1, rawAnchorValue || 1);
  const availableOutcomeSummary = buildOutcomeSummary(sorted, rawAnchorValue);
  const directionPlan = resolvedMode === 'right_advances'
    ? computeRightAdvancesDirectionChance({
        sortedValues,
        anchorValue: rawAnchorValue,
        mode: resolvedMode,
      })
    : computeHigherDirectionChance({
        sortedValues,
        anchorValue: rawAnchorValue,
        anchorHoldCount,
        mode: resolvedMode,
      });
  const distanceBands = getHigherLowerModeConfig({ mode: resolvedMode })
    .distanceBands
    .slice(0, Math.max(1, maxAttempts));

  const groupedCandidates = distanceBands.map((band, index) => {
    const rawCandidates = sorted.filter((entry) => {
      const entryValue = Math.max(1, entry.value || 1);
      const ratio = Math.max(entryValue / anchorValue, anchorValue / entryValue);
      const withinLowerBound = index === 0 ? ratio >= band.minRatio : ratio > band.minRatio;
      return withinLowerBound && ratio <= band.maxRatio;
    });
    const candidates = preferUnseenOwners(rawCandidates, ownersSeenThisCycle);

    return {
      key: `${band.minRatio}-${band.maxRatio === Infinity ? 'inf' : band.maxRatio}`,
      label: `${band.minRatio}x-${band.maxRatio === Infinity ? 'inf' : band.maxRatio}x`,
      minRatio: band.minRatio,
      maxRatio: band.maxRatio,
      weight: band.weight,
      rawCount: rawCandidates.length,
      rawOutcomeSummary: buildOutcomeSummary(rawCandidates, rawAnchorValue),
      unseenOwnerCount: candidates.length,
      items: candidates,
      directionalGroups: buildDirectionalGroups(candidates, rawAnchorValue),
      outcomeSummary: buildOutcomeSummary(candidates, rawAnchorValue),
    };
  });

  const hasHigher = groupedCandidates.some((group) => group.directionalGroups.higher.length > 0);
  const hasLowerOrEqual = groupedCandidates.some((group) => group.directionalGroups.lowerOrEqual.length > 0);
  const directionSelection = planDirectionalSelection({
    targetHigherChance: directionPlan.targetHigherChance,
    hasHigher,
    hasLowerOrEqual,
  });
  const compatibleGroups = buildCompatibleDirectionalGroups(
    groupedCandidates,
    directionSelection.selectedDirection
  );
  const compatibleWeight = compatibleGroups.reduce((sum, group) => sum + group.weight, 0);
  const selectedGroup = selectWeightedGroup(compatibleGroups);
  if (selectedGroup?.items?.length) {
    const directionalPick = pickDirectionalCandidate(
      selectedGroup.items,
      { recentEntityTypes, recentScopes }
    );
    const challenger = directionalPick.challenger;
    if (!challenger) return null;

    if (logSelection) {
      logHigherLowerPerf('pickChallenger selected challenger', {
        anchor: {
          id: anchor?.id || null,
          title: anchor?.title || null,
          value: rawAnchorValue,
          holdCount: Number(anchorHoldCount) || 0,
        },
        mode: resolvedMode,
        ownersSeenThisCycle,
        recentEntityTypes,
        recentScopes,
        availableCount: sorted.length,
        availableOutcomeSummary,
        directionPlan,
        directionAvailability: {
          hasHigher,
          hasLowerOrEqual,
        },
        compatibleWeight: Number(compatibleWeight.toFixed(2)),
        selectedBand: {
          key: selectedGroup.key,
          label: selectedGroup.label,
          weight: selectedGroup.weight,
          effectiveChance: compatibleWeight > 0
            ? Number((selectedGroup.weight / compatibleWeight).toFixed(3))
            : 0,
          rawCandidateCount: selectedGroup.rawCount,
          candidateCount: selectedGroup.allItems.length,
          outcomeSummary: selectedGroup.outcomeSummary,
          directionalCounts: {
            higher: selectedGroup.directionalGroups.higher.length,
            lowerOrEqual: selectedGroup.directionalGroups.lowerOrEqual.length,
          },
          directionalCandidateCount: selectedGroup.items.length,
          filteredPoolCount: directionalPick.filteredPoolCount,
        },
        selectedDirection: {
          sampledKey: directionSelection.sampledDirection,
          key: directionSelection.selectedDirection,
          flipped: directionSelection.flippedDirection,
          appliedHigherChance: directionSelection.appliedHigherChance,
        },
        challenger: {
          id: challenger?.id || null,
          title: challenger?.title || null,
          value: Number(challenger?.value) || 0,
          relationToAnchor: (Number(challenger?.value) || 0) > rawAnchorValue
            ? 'higher'
            : (Number(challenger?.value) || 0) < rawAnchorValue
            ? 'lower'
            : 'equal',
        },
      });
    }

    return challenger;
  }

  const fallbackCandidates = preferUnseenOwners(sorted, ownersSeenThisCycle);
  const fallbackDirectionalGroups = buildDirectionalGroups(fallbackCandidates, rawAnchorValue);
  const fallbackDirectionSelection = planDirectionalSelection({
    targetHigherChance: directionPlan.targetHigherChance,
    hasHigher: fallbackDirectionalGroups.higher.length > 0,
    hasLowerOrEqual: fallbackDirectionalGroups.lowerOrEqual.length > 0,
  });
  const fallbackDirectionalPool =
    fallbackDirectionSelection.selectedDirection === 'higher'
      ? fallbackDirectionalGroups.higher
      : fallbackDirectionalGroups.lowerOrEqual;
  const directionalPick = pickDirectionalCandidate(
    fallbackDirectionalPool,
    { recentEntityTypes, recentScopes }
  );
  const challenger = directionalPick.challenger;
  if (!challenger) return null;

  if (logSelection) {
      logHigherLowerPerf('pickChallenger fallback challenger', {
      anchor: {
        id: anchor?.id || null,
        title: anchor?.title || null,
        value: rawAnchorValue,
        holdCount: Number(anchorHoldCount) || 0,
      },
      mode: resolvedMode,
      ownersSeenThisCycle,
      recentEntityTypes,
      recentScopes,
      availableCount: sorted.length,
      availableOutcomeSummary,
      directionPlan,
      fallbackCandidateCount: fallbackCandidates.length,
      fallbackOutcomeSummary: buildOutcomeSummary(fallbackCandidates, rawAnchorValue),
      fallbackDirectionalCounts: {
        higher: fallbackDirectionalGroups.higher.length,
        lowerOrEqual: fallbackDirectionalGroups.lowerOrEqual.length,
      },
      filteredPoolCount: directionalPick.filteredPoolCount,
      selectedDirection: {
        sampledKey: fallbackDirectionSelection.sampledDirection,
        key: fallbackDirectionSelection.selectedDirection,
        flipped: fallbackDirectionSelection.flippedDirection,
        appliedHigherChance: fallbackDirectionSelection.appliedHigherChance,
      },
      challenger: {
        id: challenger?.id || null,
        title: challenger?.title || null,
        value: Number(challenger?.value) || 0,
        relationToAnchor: (Number(challenger?.value) || 0) > rawAnchorValue
          ? 'higher'
          : (Number(challenger?.value) || 0) < rawAnchorValue
          ? 'lower'
          : 'equal',
      },
    });
  }

  return challenger;
}

async function buildHigherLowerStageState({ room, metric = 'plays', options = {} }) {
  const timer = startPerfTimer();
  const mode = resolveHigherLowerMode(options);
  const untrimmedPool = await buildHigherLowerDatapointPool({ room, metric, options });
  const pool = trimHigherLowerPoolForMode(untrimmedPool, { ...options, mode });
  const openingDatapoint = pickOpeningDatapoint(pool, { ...options, mode });
  const stageState = {
    mode,
    metric,
    maxRounds: Number(options.maxRounds) > 0 ? Number(options.maxRounds) : DEFAULT_MAX_ROUNDS,
    roundNumber: 0,
    anchorHoldCount: 0,
    anchorDatapointId: openingDatapoint?.id || null,
    pool,
    usedDatapointIds: openingDatapoint?.id ? [openingDatapoint.id] : [],
    ownersSeenThisCycle: buildSeenOwnerList([getRecentOwnerKey(openingDatapoint)]),
    recentEntityTypes: appendRecentPromptTraitValues([], [openingDatapoint?.entityType]),
    recentScopes: appendRecentPromptTraitValues([], [openingDatapoint?.scope]),
  };
  let debugDumpPath = null;

  try {
    debugDumpPath = await writeStagePoolDebugDump({
      room,
      metric,
      pool,
      openingDatapoint,
    });
  } catch (error) {
    logHigherLowerPerf('buildHigherLowerStageState debug dump failed', {
      metric,
      roomCode: room?.code || room?.roomCode || null,
      error: error?.message || String(error),
    });
  }

  logHigherLowerPerf('buildHigherLowerStageState complete', {
    durationMs: roundPerfMs(timer),
    mode,
    metric,
    roomCode: room?.code || room?.roomCode || null,
    untrimmedPoolSize: untrimmedPool.length,
    poolSize: pool.length,
    trimmedPoolCount: Math.max(0, untrimmedPool.length - pool.length),
    maxRounds: stageState.maxRounds,
    ownersSeenThisCycle: stageState.ownersSeenThisCycle,
    recentEntityTypes: stageState.recentEntityTypes,
    recentScopes: stageState.recentScopes,
    debugDumpPath,
    openingDatapoint: openingDatapoint
      ? {
          id: openingDatapoint.id,
          title: openingDatapoint.title,
          scope: openingDatapoint.scope,
          timeframe: openingDatapoint.timeframe,
          entityType: openingDatapoint.entityType,
          value: openingDatapoint.value,
        }
      : null,
  });

  return stageState;
}

module.exports = {
  buildHigherLowerDatapointPool,
  buildHigherLowerStageState,
  pickOpeningDatapoint,
  pickChallenger,
  helpers: {
    appendRecentPromptTraitValues,
    buildContributorMap,
    buildSeenOwnerList,
    displayMetricValue,
    formatTimeframeLabel,
    getEligiblePlayers,
    getHigherLowerAnchor,
    getHigherLowerAnchorDatapointId,
    getHigherLowerAnchorHoldCount,
    getHigherLowerDatapointById,
    getRecentOwnerKey,
    resolveHigherLowerNextAnchorState,
    resolveHigherLowerMode,
    resolveSupportedTimeframes,
    syncHigherLowerAnchorState,
    trimHigherLowerPoolForMode,
  },
};
