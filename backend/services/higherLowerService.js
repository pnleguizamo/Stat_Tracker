const { initDb, COLLECTIONS } = require('../mongo.js');
const { addYearWindows, buildWindowBounds, constants: rollupConstants } = require('./rollupService');

const DEFAULT_MAX_PER_BUCKET = Number(process.env.HIGHER_LOWER_MAX_PER_BUCKET || 20);
const DEFAULT_MAX_ROUNDS = Number(process.env.HIGHER_LOWER_MAX_ROUNDS || 7);

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
  const base = rollupConstants.SNAPSHOT_WINDOWS || [];
  const windows = await addYearWindows(base, db);
  const allowedKeys = new Set(windows.map((window) => window.key));

  if (Array.isArray(requestedTimeframes) && requestedTimeframes.length) {
    return requestedTimeframes.filter((key) => allowedKeys.has(key));
  }
  return windows.map((window) => window.key);
}

async function loadMetadataMaps(db, idsByType = {}) {
  const trackIds = Array.from(idsByType.trackIds || []);
  const explicitArtistIds = Array.from(idsByType.artistIds || []);
  const explicitAlbumIds = Array.from(idsByType.albumIds || []);

  const [trackDocs, artistDocs, albumDocs] = await Promise.all([
    trackIds.length
      ? db.collection(COLLECTIONS.tracks).find(
          { _id: { $in: trackIds } },
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
    explicitArtistIds.length
      ? db.collection(COLLECTIONS.artists).find(
          { _id: { $in: explicitArtistIds } },
          { projection: { name: 1, images: 1, genres: 1 } }
        ).toArray()
      : [],
    explicitAlbumIds.length
      ? db.collection(COLLECTIONS.albums).find(
          { _id: { $in: explicitAlbumIds } },
          { projection: { name: 1, artistIds: 1, artistNames: 1, images: 1 } }
        ).toArray()
      : [],
  ]);

  const inferredArtistIds = new Set(explicitArtistIds);
  const inferredAlbumIds = new Set(explicitAlbumIds);
  for (const doc of trackDocs) {
    for (const artistId of doc.artistIds || []) {
      if (artistId) inferredArtistIds.add(artistId);
    }
    if (doc.albumId) inferredAlbumIds.add(doc.albumId);
  }

  const loadedArtistIds = new Set(artistDocs.map((doc) => doc._id));
  const loadedAlbumIds = new Set(albumDocs.map((doc) => doc._id));
  const missingArtistIds = Array.from(inferredArtistIds).filter(
    (artistId) => !loadedArtistIds.has(artistId)
  );
  const missingAlbumIds = Array.from(inferredAlbumIds).filter(
    (albumId) => !loadedAlbumIds.has(albumId)
  );

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

  return {
    tracks: new Map(trackDocs.map((doc) => [doc._id, doc])),
    artists: new Map([...artistDocs, ...extraArtistDocs].map((doc) => [doc._id, doc])),
    albums: new Map([...albumDocs, ...extraAlbumDocs].map((doc) => [doc._id, doc])),
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
  value,
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
    value,
    displayValue,
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

async function buildAllTimeDatapoints({
  db,
  players,
  snapshotsByUserId,
  metric,
  maxPerBucket,
}) {
  const datapoints = [];
  const userIds = players.map((player) => player.userId).filter(Boolean);
  if (!userIds.length) return datapoints;

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
  });

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

  const roomTotalValue = players.reduce((sum, player) => {
    const snapshot = snapshotsByUserId.get(player.userId);
    const totals = snapshot?.windows?.allTime?.totals || {};
    return sum + (metric === 'minutes' ? totals.msPlayed || 0 : totals.plays || 0);
  }, 0);
  if (roomTotalValue > 0) {
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'TOTAL',
      title: 'Whole Room Total',
      subtitle: 'All Time',
      value: roomTotalValue,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomTrackDocs, maxPerBucket)) {
    const meta = metadata.tracks.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'TRACK',
      entityId: doc._id,
      title: meta.name || 'Unknown Track',
      subtitle: ['Whole Room', 'All Time', ...(meta.artistNames || [])].filter(Boolean).join(' · '),
      imageUrl: meta.images?.[0]?.url || null,
      value,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomArtistDocs, maxPerBucket)) {
    const meta = metadata.artists.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'ARTIST',
      entityId: doc._id,
      title: meta.name || 'Unknown Artist',
      subtitle: 'Whole Room · All Time',
      imageUrl: meta.images?.[0]?.url || null,
      value,
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomAlbumDocs, maxPerBucket)) {
    const meta = metadata.albums.get(doc._id) || {};
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
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
    }));
  }

  for (const doc of sortAndLimitByMetric(metric, roomGenreDocs, maxPerBucket)) {
    const value = metricValueFromDoc(metric, doc);
    if (value <= 0) continue;
    datapoints.push(createDatapoint({
      metric,
      scope: 'ROOM',
      timeframe: 'allTime',
      entityType: 'GENRE',
      entityId: doc._id,
      title: doc._id || 'Unknown Genre',
      subtitle: 'Whole Room · All Time',
      value,
    }));
  }

  return datapoints;
}

async function buildTimeframedDatapoints({
  db,
  players,
  snapshotsByUserId,
  metric,
  timeframes,
  maxPerBucket,
}) {
  const datapoints = [];
  const userIds = players.map((player) => player.userId).filter(Boolean);
  if (!userIds.length) return datapoints;

  const statsCol = db.collection(COLLECTIONS.userStatsDaily);
  const trackDailyCol = db.collection(COLLECTIONS.userTrackDaily);

  const windows = await addYearWindows(rollupConstants.SNAPSHOT_WINDOWS || [], db);
  const defsByKey = new Map(windows.map((window) => [window.key, window]));

  for (const timeframe of timeframes) {
    if (timeframe === 'allTime') continue;

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

    const [roomTotals, roomTracks] = await Promise.all([
      statsCol.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            plays: { $sum: '$totals.plays' },
            msPlayed: { $sum: '$totals.msPlayed' },
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
          },
        },
      ]).toArray(),
    ]);

    const trackIds = new Set(roomTracks.map((doc) => doc._id).filter(Boolean));
    const metadata = await loadMetadataMaps(db, { trackIds });
    const roomArtists = new Map();
    const roomAlbums = new Map();
    const roomGenres = new Map();

    for (const track of roomTracks) {
      const meta = metadata.tracks.get(track._id) || {};
      for (const artistId of new Set((meta.artistIds || []).filter(Boolean))) {
        addRoomEntityAggregate(roomArtists, artistId, track);
        const artistMeta = metadata.artists.get(artistId) || {};
        for (const genre of new Set((artistMeta.genres || []).filter(Boolean))) {
          addRoomEntityAggregate(roomGenres, genre, track);
        }
      }
      if (meta.albumId) {
        addRoomEntityAggregate(roomAlbums, meta.albumId, track);
      }
    }

    const roomTotalValue = roomTotals[0]
      ? metric === 'minutes'
        ? roomTotals[0].msPlayed || 0
        : roomTotals[0].plays || 0
      : 0;
    if (roomTotalValue > 0) {
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'TOTAL',
        title: 'Whole Room Total',
        subtitle: formatTimeframeLabel(timeframe),
        value: roomTotalValue,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, roomTracks, maxPerBucket)) {
      const meta = metadata.tracks.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'TRACK',
        entityId: doc._id,
        title: meta.name || 'Unknown Track',
        subtitle: ['Whole Room', formatTimeframeLabel(timeframe), ...(meta.artistNames || [])].filter(Boolean).join(' · '),
        imageUrl: meta.images?.[0]?.url || null,
        value,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomArtists.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const meta = metadata.artists.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'ARTIST',
        entityId: doc._id,
        title: meta.name || 'Unknown Artist',
        subtitle: `Whole Room · ${formatTimeframeLabel(timeframe)}`,
        imageUrl: meta.images?.[0]?.url || null,
        value,
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomAlbums.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const meta = metadata.albums.get(doc._id) || {};
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
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
      }));
    }

    for (const doc of sortAndLimitByMetric(metric, Array.from(roomGenres.entries()).map(([id, counts]) => ({ _id: id, ...counts })), maxPerBucket)) {
      const value = metricValueFromDoc(metric, doc);
      if (value <= 0) continue;
      datapoints.push(createDatapoint({
        metric,
        scope: 'ROOM',
        timeframe,
        entityType: 'GENRE',
        entityId: doc._id,
        title: doc._id || 'Unknown Genre',
        subtitle: `Whole Room · ${formatTimeframeLabel(timeframe)}`,
        value,
      }));
    }
  }

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
  const db = await initDb();
  const players = getEligiblePlayers(room);
  if (!players.length) return [];

  const timeframes = await resolveSupportedTimeframes(db, options.timeframes);
  const snapshots = await db
    .collection(COLLECTIONS.userSnapshots)
    .find({ userId: { $in: players.map((player) => player.userId) } })
    .toArray();
  const snapshotsByUserId = new Map(snapshots.map((doc) => [doc.userId, doc]));
  const maxPerBucket = Number(options.maxPerBucket) > 0 ? Number(options.maxPerBucket) : DEFAULT_MAX_PER_BUCKET;

  const [allTimeDatapoints, timeframedDatapoints] = await Promise.all([
    buildAllTimeDatapoints({
      db,
      players,
      snapshotsByUserId,
      metric,
      maxPerBucket,
    }),
    buildTimeframedDatapoints({
      db,
      players,
      snapshotsByUserId,
      metric,
      timeframes,
      maxPerBucket,
    }),
  ]);

  return dedupeDatapoints([...allTimeDatapoints, ...timeframedDatapoints]);
}

function pickOpeningDatapoint(pool = []) {
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => a.value - b.value);
  const middle = Math.floor(sorted.length / 2);
  const offset = Math.max(1, Math.floor(sorted.length * 0.15));
  const start = Math.max(0, middle - offset);
  const end = Math.min(sorted.length, middle + offset + 1);
  const candidates = sorted.slice(start, end);
  return candidates[Math.floor(Math.random() * candidates.length)] || sorted[middle] || sorted[0];
}

function pickChallenger({ pool = [], champion, usedIds = [], maxAttempts = 4 }) {
  if (!champion) return null;
  const usedSet = new Set(usedIds);
  const available = pool.filter((entry) => entry?.id && entry.id !== champion.id && !usedSet.has(entry.id));
  if (!available.length) return null;

  const sorted = [...available].sort((a, b) => a.value - b.value);
  const championValue = Math.max(1, champion.value || 1);
  const ratios = [1.8, 3.5, 8, Infinity];

  for (let i = 0; i < Math.min(maxAttempts, ratios.length); i += 1) {
    const ratio = ratios[i];
    const candidates = sorted.filter((entry) => {
      const low = entry.value / championValue;
      const high = championValue / entry.value;
      return Math.max(low, high) <= ratio;
    });
    if (candidates.length) {
      return candidates[Math.floor(Math.random() * candidates.length)] || candidates[0];
    }
  }

  return sorted[Math.floor(Math.random() * sorted.length)] || sorted[0];
}

async function buildHigherLowerStageState({ room, metric = 'plays', options = {} }) {
  const pool = await buildHigherLowerDatapointPool({ room, metric, options });
  const openingDatapoint = pickOpeningDatapoint(pool);
  return {
    metric,
    maxRounds: Number(options.maxRounds) > 0 ? Number(options.maxRounds) : DEFAULT_MAX_ROUNDS,
    roundNumber: 0,
    pool,
    usedDatapointIds: openingDatapoint?.id ? [openingDatapoint.id] : [],
    championDatapointId: openingDatapoint?.id || null,
  };
}

module.exports = {
  buildHigherLowerDatapointPool,
  buildHigherLowerStageState,
  pickOpeningDatapoint,
  pickChallenger,
  helpers: {
    displayMetricValue,
    formatTimeframeLabel,
    getEligiblePlayers,
    resolveSupportedTimeframes,
  },
};
