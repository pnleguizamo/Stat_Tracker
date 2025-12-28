const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.URI);
let db;
let indexesEnsured = false;

const COLLECTIONS = {
  rawStreams: process.env.COLLECTION_NAME || "raw_streamed_tracks",
  streams: process.env.STREAMS_COLLECTION || "streams",
  tracks: process.env.TRACKS_COLLECTION || "tracks",
  artists: process.env.ARTISTS_COLLECTION || "artists",
  albums: process.env.ALBUMS_COLLECTION || "albums",
  userTrackCounts: process.env.USER_TRACK_COUNTS_COLLECTION || "user_track_counts",
  userArtistCounts: process.env.USER_ARTIST_COUNTS_COLLECTION || "user_artist_counts",
  userTrackDaily: process.env.USER_TRACK_DAILY_COLLECTION || "user_track_daily",
  userStatsDaily: process.env.USER_STATS_DAILY_COLLECTION || "user_stats_daily",
  userSnapshots: process.env.USER_SNAPSHOTS_COLLECTION || "user_snapshots",
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
    
    { collection: COLLECTIONS.userTrackCounts, keys: { userId: 1, trackId: 1 }, options: { unique: true, name: "utc_user_track" } },
    { collection: COLLECTIONS.userArtistCounts, keys: { userId: 1, artistId: 1 }, options: { unique: true, name: "uac_user_artist" } },

    { collection: COLLECTIONS.tracks, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "tracks_status_refresh" } },
    { collection: COLLECTIONS.tracks, keys: { lockedAt: 1 }, options: { name: "tracks_locked_at" } },
    { collection: COLLECTIONS.artists, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "artists_status_refresh" } },
    { collection: COLLECTIONS.artists, keys: { lockedAt: 1 }, options: { name: "artists_locked_at" } },
    { collection: COLLECTIONS.albums, keys: { status: 1, nextRefreshAt: 1 }, options: { name: "albums_status_refresh" } },
    { collection: COLLECTIONS.albums, keys: { lockedAt: 1 }, options: { name: "albums_locked_at" } },
  
    { collection: COLLECTIONS.userTrackDaily, keys: { userId: 1, day: 1, trackId: 1 }, options: { unique: true, name: "utd_user_day_track" } },
    { collection: COLLECTIONS.userTrackDaily, keys: { day: 1 }, options: { name: "utd_day" } },
    { collection: COLLECTIONS.userStatsDaily, keys: { userId: 1, day: 1 }, options: { unique: true, name: "usd_user_day" } },
    { collection: COLLECTIONS.userSnapshots, keys: { userId: 1 }, options: { unique: true, name: "user_snapshots_user" } },
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
