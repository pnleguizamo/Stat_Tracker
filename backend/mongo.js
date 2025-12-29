const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.URI);
let db;
let indexesEnsured = false;

const COLLECTIONS = {
  rawStreams: process.env.COLLECTION_NAME,
  streams: process.env.STREAMS_COLLECTION,
  tracks: process.env.TRACKS_COLLECTION,
  artists: process.env.ARTISTS_COLLECTION,
  albums: process.env.ALBUMS_COLLECTION,
  trackAliases: process.env.TRACK_ALIASES_COLLECTION || 'track_aliases',
  userTrackCounts: process.env.USER_TRACK_COUNTS_COLLECTION,
  userArtistCounts: process.env.USER_ARTIST_COUNTS_COLLECTION,
  userTrackDaily: process.env.USER_TRACK_DAILY_COLLECTION,
  userStatsDaily: process.env.USER_STATS_DAILY_COLLECTION,
  userSnapshots: process.env.USER_SNAPSHOTS_COLLECTION,
};

async function ensureIndexes(dbInstance) {
  if (indexesEnsured) return;

  const indexDefs = [
    { collection: COLLECTIONS.streams, keys: { userId: 1, ts: 1 }, options: { name: "streams_user_ts" } },
    { collection: COLLECTIONS.streams, keys: { userId: 1, ts: 1, trackId: 1 }, options: { name: "uniq_stream_per_user", unique: true } },
    {
      collection: COLLECTIONS.streams,
      keys: { userId: 1, trackId: 1 },
      options: { name: "streams_user_track_trackdone", partialFilterExpression: { reasonEnd: "trackdone" } },
    },
    { collection: COLLECTIONS.streams, keys: { canonicalTrackId: 1 }, options: { name: "streams_canonical_track" } },
    
    { collection: COLLECTIONS.userTrackCounts, keys: { userId: 1, trackId: 1 }, options: { unique: true, name: "utc_user_track" } },
    { collection: COLLECTIONS.userArtistCounts, keys: { userId: 1, artistId: 1 }, options: { unique: true, name: "uac_user_artist" } },

    { collection: COLLECTIONS.tracks, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "tracks_status_refresh" } },
    { collection: COLLECTIONS.tracks, keys: { lockedAt: 1 }, options: { name: "tracks_locked_at" } },
    { collection: COLLECTIONS.tracks, keys: { canonicalKey: 1 }, options: { name: "tracks_canonical_key" } },
    { collection: COLLECTIONS.tracks, keys: { canonicalTrackId: 1 }, options: { name: "tracks_canonical_id" } },
    { collection: COLLECTIONS.artists, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "artists_status_refresh" } },
    { collection: COLLECTIONS.artists, keys: { lockedAt: 1 }, options: { name: "artists_locked_at" } },
    { collection: COLLECTIONS.albums, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "albums_status_refresh" } },
    { collection: COLLECTIONS.albums, keys: { lockedAt: 1 }, options: { name: "albums_locked_at" } },
  
    { collection: COLLECTIONS.userTrackDaily, keys: { userId: 1, day: 1, trackId: 1 }, options: { unique: true, name: "utd_user_day_track" } },
    { collection: COLLECTIONS.userTrackDaily, keys: { day: 1 }, options: { name: "utd_day" } },
    { collection: COLLECTIONS.userStatsDaily, keys: { userId: 1, day: 1 }, options: { unique: true, name: "usd_user_day" } },
    { collection: COLLECTIONS.userSnapshots, keys: { userId: 1 }, options: { unique: true, name: "user_snapshots_user" } },
    { collection: COLLECTIONS.trackAliases, keys: { canonicalKey: 1 }, options: { name: "track_aliases_canonical_key" } },
  ];

  await Promise.all(
    indexDefs.map(({ collection, keys, options }) =>
      dbInstance.collection(collection).createIndex(keys, options)
    )
  );
  indexesEnsured = true;
}

async function initDb() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    await ensureIndexes(db);
    console.log("Mongo connected");
  }
  return db;
}

module.exports = { initDb, client, COLLECTIONS };
