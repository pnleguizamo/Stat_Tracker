const { initDb, COLLECTIONS } = require('../mongo.js');
// TODO 
// Incorrect stream counts, missing fields (since, album + artist metadata), test with new user upload
// Remove metadata where necessary, cut down user stats tracks
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUALIFIED_MS = Number(process.env.QUALIFIED_PLAY_MS || 30000);
const UPSERT_BATCH_SIZE = Number(process.env.ROLLUP_UPSERT_BATCH || 500);
const DAILY_TOP_LIMIT = Number(process.env.ROLLUP_DAILY_TOP_LIMIT || 50);
const SNAPSHOT_TOP_TRACKS = Number(process.env.ROLLUP_TOP_TRACKS || 200);
const SNAPSHOT_TOP_ARTISTS = Number(process.env.ROLLUP_TOP_ARTISTS || 100);
const SNAPSHOT_TOP_ALBUMS = Number(process.env.ROLLUP_TOP_ALBUMS || 100);
const SNAPSHOT_TOP_GENRES = Number(process.env.ROLLUP_TOP_GENRES || 50);

const SNAPSHOT_WINDOWS = [
  { key: 'last7', days: 7 },
  { key: 'last30', days: 30 },
  { key: 'ytd', type: 'ytd' },
  { key: 'allTime', type: 'all' },
];

function startOfDay(value) {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function buildWindowBounds(now, def) {
  const end = startOfDay(now);
  end.setUTCDate(end.getUTCDate() + 1);
  let start = null;
  if (def.type === 'ytd') {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  } else if (def.days) {
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - def.days);
  }
  return { key: def.key, start, end };
}

function isInWindow(day, bounds) {
  if (!day) return false;
  const ts = startOfDay(day).getTime();
  if (bounds.start && ts < bounds.start.getTime()) return false;
  if (bounds.end && ts >= bounds.end.getTime()) return false;
  return true;
}

function makeDayKey(userId, day) {
  return `${userId}|${startOfDay(day).toISOString()}`;
}

function addToMap(map, key, delta) {
  if (!key) return;
  const current = map.get(key) || { plays: 0, qualifiedPlays: 0, msPlayed: 0 };
  current.plays += delta.plays || 0;
  current.qualifiedPlays += delta.qualifiedPlays || 0;
  current.msPlayed += delta.msPlayed || 0;
  map.set(key, current);
}

async function loadTrackMetadata(trackIds, db) {
  if (!trackIds.length) return new Map();
  const col = db.collection(COLLECTIONS.tracks);
  const map = new Map();
  const BATCH = 500;
  for (let i = 0; i < trackIds.length; i += BATCH) {
    const slice = trackIds.slice(i, i + BATCH);
    const cursor = col.find(
      { _id: { $in: slice } },
      {
        projection: {
          name: 1,
          albumId: 1,
          albumName: 1,
          artistIds: 1,
          artistNames: 1,
          images: 1,
          spotifyRaw: 1 // TODO Remove
        },
      }
    );
    // eslint-disable-next-line no-await-in-loop
    for await (const doc of cursor) {
      map.set(doc._id, doc);
    }
  }
  return map;
}

async function loadArtistMetadata(artistIds, db) {
  if (!artistIds.length) return new Map();
  const col = db.collection(COLLECTIONS.artists);
  const map = new Map();
  const BATCH = 500;
  for (let i = 0; i < artistIds.length; i += BATCH) {
    const slice = artistIds.slice(i, i + BATCH);
    const cursor = col.find(
      { _id: { $in: slice } },
      { projection: { name: 1, genres: 1, images: 1 } }
    );
    // eslint-disable-next-line no-await-in-loop
    for await (const doc of cursor) {
      map.set(doc._id, doc);
    }
  }
  return map;
}

function sortByPlays(entries, limit) {
  return entries
    .sort((a, b) => {
      if (b.plays !== a.plays) return b.plays - a.plays;
      if (b.msPlayed !== a.msPlayed) return b.msPlayed - a.msPlayed;
      return b.qualifiedPlays - a.qualifiedPlays;
    })
    .slice(0, limit);
}

async function getStreamsDateRange(dbInstance) {
  const db = dbInstance || (await initDb());
  const col = db.collection(COLLECTIONS.streams);
  const [minDoc, maxDoc] = await Promise.all([
    col.find({}, { projection: { ts: 1 } }).sort({ ts: 1 }).limit(1).toArray(),
    col.find({}, { projection: { ts: 1 } }).sort({ ts: -1 }).limit(1).toArray(),
  ]);
  return {
    min: minDoc?.[0]?.ts || null,
    max: maxDoc?.[0]?.ts || null,
  };
}

async function buildUserTrackDailyFromStreams(options = {}) {
  const {
    startDate,
    endDate,
    userIds,
    qualifiedMsThreshold = DEFAULT_QUALIFIED_MS,
    allowDiskUse = true,
    logger = console,
  } = options;

  logger.info?.(
    `[rollups] buildUserTrackDailyFromStreams start startDate=${startDate?.toISOString?.() || 'n/a'} endDate=${endDate?.toISOString?.() || 'n/a'} users=${userIds?.length || 'all'} thresholdMs=${qualifiedMsThreshold}`
  );

  const db = await initDb();
  const streamsCol = db.collection(COLLECTIONS.streams);
  const userTrackDailyCol = db.collection(COLLECTIONS.userTrackDaily);
  const userStatsDailyCol = db.collection(COLLECTIONS.userStatsDaily);
  const now = new Date();

  const match = {};
  if (startDate || endDate) {
    match.ts = {};
    if (startDate) {
      match.ts.$gte = startOfDay(startDate);
    }
    if (endDate) {
      match.ts.$lt = endDate instanceof Date ? endDate : new Date(endDate);
    }
  }
  if (userIds?.length) {
    match.userId = { $in: userIds };
  }

  const msExpr = { $ifNull: ['$msPlayed', '$ms_played'] };

  const totalsPipeline = [
    { $match: match },
    { $project: { userId: 1, ts: 1, ms: msExpr } },
    {
      $match: {
        userId: { $ne: null },
        ts: { $ne: null },
        ms: { $ne: null },
      },
    },
    {
      $addFields: {
        day: {
          $dateFromParts: {
            year: { $year: '$ts' },
            month: { $month: '$ts' },
            day: { $dayOfMonth: '$ts' },
          },
        },
        qualified: {
          $cond: [{ $gte: ['$ms', qualifiedMsThreshold] }, 1, 0],
        },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', day: '$day' },
        plays: { $sum: 1 },
        qualifiedPlays: { $sum: '$qualified' },
        msPlayed: { $sum: '$ms' },
        lastStreamTs: { $max: '$ts' },
      },
    },
  ];

  const totalsCursor = streamsCol.aggregate(totalsPipeline, { allowDiskUse });
  const totalsMap = new Map();

  for await (const doc of totalsCursor) {
    const { userId, day } = doc._id;
    const key = makeDayKey(userId, day);
    totalsMap.set(key, {
      userId,
      day,
      totals: {
        plays: doc.plays || 0,
        qualifiedPlays: doc.qualifiedPlays || 0,
        msPlayed: doc.msPlayed || 0,
      },
      lastStreamTs: doc.lastStreamTs || day,
    });
  }

  const trackMatch = { ...match, trackId: { $ne: null } };
  const trackPipeline = [
    { $match: trackMatch },
    { $project: { userId: 1, trackId: 1, ts: 1, ms: msExpr } },
    {
      $match: {
        userId: { $ne: null },
        trackId: { $ne: null },
        ts: { $ne: null },
        ms: { $ne: null },
      },
    },
    {
      $addFields: {
        day: {
          $dateFromParts: {
            year: { $year: '$ts' },
            month: { $month: '$ts' },
            day: { $dayOfMonth: '$ts' },
          },
        },
        qualified: {
          $cond: [{ $gte: ['$ms', qualifiedMsThreshold] }, 1, 0],
        },
      },
    },
    {
      $group: {
        _id: { userId: '$userId', day: '$day', trackId: '$trackId' },
        plays: { $sum: 1 },
        qualifiedPlays: { $sum: '$qualified' },
        msPlayed: { $sum: '$ms' },
        lastStreamTs: { $max: '$ts' },
      },
    },
  ];

  const dailyStatsMap = new Map();
  const trackIds = new Set();
  const bulkOps = [];
  let inserted = 0;
  let modified = 0;

  async function flushBulk() {
    if (!bulkOps.length) return;
    const res = await userTrackDailyCol.bulkWrite(bulkOps, { ordered: false });
    inserted += res.upsertedCount || 0;
    modified += res.modifiedCount || 0;
    bulkOps.length = 0;
  }

  const trackCursor = streamsCol.aggregate(trackPipeline, { allowDiskUse });
  for await (const doc of trackCursor) {
    const { userId, day, trackId } = doc._id;
    const dayKey = makeDayKey(userId, day);
    trackIds.add(trackId);

    const totalsEntry = totalsMap.get(dayKey);
    const statEntry =
      dailyStatsMap.get(dayKey) ||
      {
        userId,
        day,
        totals: totalsEntry ? totalsEntry.totals : { plays: 0, qualifiedPlays: 0, msPlayed: 0 },
        tracks: [],
        lastStreamTs: totalsEntry?.lastStreamTs || doc.lastStreamTs || day,
      };

    statEntry.tracks.push({
      trackId,
      plays: doc.plays || 0,
      qualifiedPlays: doc.qualifiedPlays || 0,
      msPlayed: doc.msPlayed || 0,
    });
    statEntry.lastStreamTs =
      new Date(
        Math.max(
          statEntry.lastStreamTs instanceof Date ? statEntry.lastStreamTs.getTime() : 0,
          doc.lastStreamTs instanceof Date ? doc.lastStreamTs.getTime() : 0
        )
      ) || statEntry.lastStreamTs;

    dailyStatsMap.set(dayKey, statEntry);

    bulkOps.push({
      updateOne: {
        filter: { userId, day, trackId },
        update: {
          $set: {
            plays: doc.plays || 0,
            qualifiedPlays: doc.qualifiedPlays || 0,
            msPlayed: doc.msPlayed || 0,
            lastStreamTs: doc.lastStreamTs || day,
            qualifiedMsThreshold,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });

    if (bulkOps.length >= UPSERT_BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      await flushBulk();
    }
  }
  await flushBulk();

  for (const [key, totalsEntry] of totalsMap.entries()) {
    if (!dailyStatsMap.has(key)) {
      dailyStatsMap.set(key, {
        userId: totalsEntry.userId,
        day: totalsEntry.day,
        totals: totalsEntry.totals,
        tracks: [],
        lastStreamTs: totalsEntry.lastStreamTs,
      });
    } else {
      const entry = dailyStatsMap.get(key);
      entry.totals = totalsEntry.totals;
      entry.lastStreamTs = entry.lastStreamTs || totalsEntry.lastStreamTs;
      dailyStatsMap.set(key, entry);
    }
  }

  const trackMeta = await loadTrackMetadata(Array.from(trackIds), db);
  const artistIds = new Set();
  const albumMeta = new Map();
  for (const meta of trackMeta.values()) {
    (meta.artistIds || []).forEach(id => artistIds.add(id));
    if (meta.albumId && !albumMeta.has(meta.albumId)) {
      albumMeta.set(meta.albumId, {
        albumId: meta.albumId,
        name: meta.albumName || meta.spotifyRaw.album.name || null,
        artistIds: meta.artistIds || [],
        images: meta.images || [],
      });
    }
  }
  const artistMeta = await loadArtistMetadata(Array.from(artistIds), db);

  const dailyStatOps = [];
  let statsWritten = 0;

  for (const entry of dailyStatsMap.values()) {
    const uniqueArtists = new Set();
    const uniqueAlbums = new Set();
    const artistAgg = new Map();
    const albumAgg = new Map();

    const trackEntries = entry.tracks.map(t => {
      const meta = trackMeta.get(t.trackId) || {};
      (meta.artistIds || []).forEach(id => uniqueArtists.add(id));
      if (meta.albumId) uniqueAlbums.add(meta.albumId);
      (meta.artistIds || []).forEach(id => addToMap(artistAgg, id, t));
      if (meta.albumId) addToMap(albumAgg, meta.albumId, t);

      return {
        trackId: t.trackId,
        plays: t.plays,
        qualifiedPlays: t.qualifiedPlays,
        msPlayed: t.msPlayed,
        trackName: meta.name || null,
        albumId: meta.albumId || null,
        albumName: meta.albumName || meta.spotifyRaw.album.name || null, // TODO update 
        artistIds: meta.artistIds || [],
        artistNames: meta.artistNames || [],
      };
    });

    const topTracks = sortByPlays(trackEntries, DAILY_TOP_LIMIT);
    const topArtists = sortByPlays(
      Array.from(artistAgg.entries()).map(([artistId, counts]) => ({
        artistId,
        name: artistMeta.get(artistId)?.name || null,
        genres: artistMeta.get(artistId)?.genres || [],
        plays: counts.plays,
        qualifiedPlays: counts.qualifiedPlays,
        msPlayed: counts.msPlayed,
      })),
      DAILY_TOP_LIMIT
    );

    const topAlbums = sortByPlays(
      Array.from(albumAgg.entries()).map(([albumId, counts]) => {
        const meta = albumMeta.get(albumId) || {};
        return {
          albumId,
          name: meta.name || null,
          artistIds: meta.artistIds || [],
          plays: counts.plays,
          qualifiedPlays: counts.qualifiedPlays,
          msPlayed: counts.msPlayed,
        };
      }),
      DAILY_TOP_LIMIT
    );

    dailyStatOps.push({
      updateOne: {
        filter: { userId: entry.userId, day: entry.day },
        update: {
          $set: {
            totals: entry.totals,
            uniqueTracks: entry.tracks.length,
            uniqueArtists: uniqueArtists.size,
            uniqueAlbums: uniqueAlbums.size,
            topTracks,
            topArtists,
            topAlbums,
            lastStreamTs: entry.lastStreamTs,
            qualifiedMsThreshold,
            generatedAt: now,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now, userId: entry.userId, day: entry.day },
        },
        upsert: true,
      },
    });

    if (dailyStatOps.length >= UPSERT_BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const res = await userStatsDailyCol.bulkWrite(dailyStatOps, { ordered: false });
      statsWritten += (res.upsertedCount || 0) + (res.modifiedCount || 0);
      dailyStatOps.length = 0;
    }
  }

  if (dailyStatOps.length) {
    const res = await userStatsDailyCol.bulkWrite(dailyStatOps, { ordered: false });
    statsWritten += (res.upsertedCount || 0) + (res.modifiedCount || 0);
  }

  logger.info?.(
    `[rollups] Daily track rollups upserted ${inserted} new docs, modified ${modified}; daily stats upserts ${statsWritten}`
  );

  return {
    userTrackDailyInserted: inserted,
    userTrackDailyModified: modified,
    userStatsDailyUpserts: statsWritten,
    qualifiedMsThreshold,
  };
}

async function buildUserSnapshots(options = {}) {
  const {
    userIds,
    windows = SNAPSHOT_WINDOWS,
    qualifiedMsThreshold = DEFAULT_QUALIFIED_MS,
    logger = console,
  } = options;

  const db = await initDb();
  const trackCol = db.collection(COLLECTIONS.userTrackDaily);
  const statsCol = db.collection(COLLECTIONS.userStatsDaily);
  const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
  const now = new Date();

  const bounds = windows.map(def => buildWindowBounds(now, def));
  logger.info?.(
    `[rollups] buildUserSnapshots start users=${userIds?.length || 'all'} windows=${bounds
      .map(w => w.key)
      .join(',')} thresholdMs=${qualifiedMsThreshold}`
  );
  const minStart = bounds.reduce((acc, w) => {
    if (!w.start) return acc;
    if (!acc) return w.start;
    return w.start < acc ? w.start : acc;
  }, null);

  const users =
    userIds && userIds.length ? userIds : await trackCol.distinct('userId');

  let snapshotsWritten = 0;

  for (const userId of users) {
    const statsMatch = { userId };
    if (minStart) {
      statsMatch.day = { $gte: minStart };
    }
    const statDocs = await statsCol
      .find(statsMatch, { projection: { day: 1, totals: 1 } })
      .toArray();
    const dayTotalsMap = new Map(
      statDocs.map(doc => [startOfDay(doc.day).toISOString(), doc.totals || {}])
    );

    const facet = {};
    for (const bound of bounds) {
      const facetMatch = { userId };
      if (bound.start) {
        facetMatch.day = { ...facetMatch.day, $gte: bound.start };
      }
      if (bound.end) {
        facetMatch.day = { ...facetMatch.day, $lt: bound.end };
      }
      facet[bound.key] = [
        { $match: facetMatch },
        {
          $group: {
            _id: '$trackId',
            plays: { $sum: '$plays' },
            qualifiedPlays: { $sum: '$qualifiedPlays' },
            msPlayed: { $sum: '$msPlayed' },
          },
        },
      ];
    }

    const baseMatch = { userId };
    if (minStart) {
      baseMatch.day = { $gte: minStart };
    }
    const aggCursor = trackCol.aggregate([{ $match: baseMatch }, { $facet: facet }], {
      allowDiskUse: true,
    });
    const agg = await aggCursor.next();
    if (!agg) continue;

    const windowTrackAgg = {};
    const allTrackIds = new Set();
    for (const bound of bounds) {
      const docs = agg[bound.key] || [];
      windowTrackAgg[bound.key] = docs.map(doc => ({
        trackId: doc._id,
        plays: doc.plays || 0,
        qualifiedPlays: doc.qualifiedPlays || 0,
        msPlayed: doc.msPlayed || 0,
      }));
      docs.forEach(doc => allTrackIds.add(doc._id));
    }

    if (!allTrackIds.size && !statDocs.length) {
      continue;
    }

    const trackIds = Array.from(allTrackIds);
    const trackMeta = await loadTrackMetadata(trackIds, db);
    const artistIds = new Set();
    const albumMeta = new Map();
    for (const meta of trackMeta.values()) {
      (meta.artistIds || []).forEach(id => artistIds.add(id));
      if (meta.albumId && !albumMeta.has(meta.albumId)) {
        albumMeta.set(meta.albumId, {
          albumId: meta.albumId,
          name: meta.albumName || null,
          artistIds: meta.artistIds || [],
          images: meta.images || [],
        });
      }
    }
    const artistMeta = await loadArtistMetadata(Array.from(artistIds), db);

    const aggregates = {};
    for (const bound of bounds) {
      aggregates[bound.key] = {
        start: bound.start,
        end: bound.end,
        totals: { plays: 0, qualifiedPlays: 0, msPlayed: 0 },
        trackMap: new Map(),
        artistMap: new Map(),
        albumMap: new Map(),
        genreMap: new Map(),
        uniqueTracks: new Set(),
        uniqueArtists: new Set(),
        uniqueAlbums: new Set(),
      };
    }

    for (const bound of bounds) {
      const bucket = aggregates[bound.key];
      const tracks = windowTrackAgg[bound.key] || [];

      // totals from user_stats_daily so trackless events still count
      const statTotals = statDocs
        .filter(stat => isInWindow(stat.day, bound))
        .reduce(
          (acc, stat) => ({
            plays: acc.plays + (stat.totals?.plays || 0),
            qualifiedPlays: acc.qualifiedPlays + (stat.totals?.qualifiedPlays || 0),
            msPlayed: acc.msPlayed + (stat.totals?.msPlayed || 0),
          }),
          { plays: 0, qualifiedPlays: 0, msPlayed: 0 }
        );

      if (statTotals.plays || statTotals.qualifiedPlays || statTotals.msPlayed) {
        bucket.totals = statTotals;
      } else {
        for (const track of tracks) {
          bucket.totals.plays += track.plays || 0;
          bucket.totals.qualifiedPlays += track.qualifiedPlays || 0;
          bucket.totals.msPlayed += track.msPlayed || 0;
        }
      }

      for (const track of tracks) {
        const meta = trackMeta.get(track.trackId) || {};
        bucket.uniqueTracks.add(track.trackId);
        (meta.artistIds || []).forEach(id => bucket.uniqueArtists.add(id));
        if (meta.albumId) bucket.uniqueAlbums.add(meta.albumId);

        addToMap(bucket.trackMap, track.trackId, track);
        (meta.artistIds || []).forEach(artistId => {
          addToMap(bucket.artistMap, artistId, track);
          const artist = artistMeta.get(artistId);
          for (const genre of artist?.genres || []) {
            addToMap(bucket.genreMap, genre, track);
          }
        });
        if (meta.albumId) {
          addToMap(bucket.albumMap, meta.albumId, track);
        }
      }
    }

    const windowsDoc = {};
    for (const bound of bounds) {
      const bucket = aggregates[bound.key];
      const topTracks = sortByPlays(
        Array.from(bucket.trackMap.entries()).map(([trackId, counts]) => {
          const meta = trackMeta.get(trackId) || {};
          return {
            trackId,
            trackName: meta.name || null,
            artistIds: meta.artistIds || [],
            artistNames: meta.artistNames || [],
            albumId: meta.albumId || null,
            albumName: meta.albumName || null,
            plays: counts.plays,
            qualifiedPlays: counts.qualifiedPlays,
            msPlayed: counts.msPlayed,
          };
        }),
        SNAPSHOT_TOP_TRACKS
      );

      const topArtists = sortByPlays(
        Array.from(bucket.artistMap.entries()).map(([artistId, counts]) => {
          const meta = artistMeta.get(artistId) || {};
          return {
            artistId,
            name: meta.name || null,
            genres: meta.genres || [],
            plays: counts.plays,
            qualifiedPlays: counts.qualifiedPlays,
            msPlayed: counts.msPlayed,
          };
        }),
        SNAPSHOT_TOP_ARTISTS
      );

      const topAlbums = sortByPlays(
        Array.from(bucket.albumMap.entries()).map(([albumId, counts]) => {
          const meta = albumMeta.get(albumId) || {};
          return {
            albumId,
            name: meta.name || null,
            artistIds: meta.artistIds || [],
            plays: counts.plays,
            qualifiedPlays: counts.qualifiedPlays,
            msPlayed: counts.msPlayed,
          };
        }),
        SNAPSHOT_TOP_ALBUMS
      );

      const topGenres = sortByPlays(
        Array.from(bucket.genreMap.entries()).map(([genre, counts]) => ({
          genre,
          plays: counts.plays,
          qualifiedPlays: counts.qualifiedPlays,
          msPlayed: counts.msPlayed,
        })),
        SNAPSHOT_TOP_GENRES
      );

      windowsDoc[bound.key] = {
        since: bucket.start,
        until: bucket.end,
        totals: bucket.totals,
        uniqueTracks: bucket.uniqueTracks.size,
        uniqueArtists: bucket.uniqueArtists.size,
        uniqueAlbums: bucket.uniqueAlbums.size,
        topTracks,
        topArtists,
        topAlbums,
        topGenres,
      };
      // console.log(windowsDoc[bound.key])
    }

    await snapshotsCol.updateOne(
      { userId },
      {
        $set: {
          userId,
          windows: windowsDoc,
          generatedAt: now,
          qualifiedMsThreshold,
          topTrackLimit: SNAPSHOT_TOP_TRACKS,
          topArtistLimit: SNAPSHOT_TOP_ARTISTS,
          topAlbumLimit: SNAPSHOT_TOP_ALBUMS,
          topGenreLimit: SNAPSHOT_TOP_GENRES,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    snapshotsWritten += 1;
  }

  logger.info?.(`[rollups] Snapshots rebuilt for ${snapshotsWritten} users`);
  return {
    snapshotsWritten,
    qualifiedMsThreshold,
    windows: bounds.map(b => b.key),
  };
}

async function runFullBackfill(options = {}) {
  const { logger = console } = options;
  const db = await initDb();
  logger.info?.('[rollups] runFullBackfill start');
  const range = await getStreamsDateRange(db);
  if (!range.min || !range.max) {
    logger.warn?.('[rollups] No streams found; skipping rollup backfill');
    return { daily: null, snapshots: null };
  }

  
  console.log("Debugger 0");
  debugger;

  const start = startOfDay(range.min);
  const end = new Date(startOfDay(range.max).getTime() + DAY_MS);

  // const daily = await buildUserTrackDailyFromStreams({
  //   startDate: start,
  //   endDate: end,
  //   logger,
  //   userIds: ['pnleguizamo']
  // });
  const snapshots = await buildUserSnapshots({ logger, 
    userIds: ['pnleguizamo'] });
  // return { daily, snapshots };
  return { snapshots };
}

module.exports = {
  buildUserTrackDailyFromStreams,
  buildUserSnapshots,
  getStreamsDateRange,
  runFullBackfill,
  constants: {
    DEFAULT_QUALIFIED_MS,
    DAILY_TOP_LIMIT,
    SNAPSHOT_TOP_TRACKS,
    SNAPSHOT_TOP_ARTISTS,
    SNAPSHOT_TOP_ALBUMS,
    SNAPSHOT_TOP_GENRES,
    SNAPSHOT_WINDOWS,
  },
};
