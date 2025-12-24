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
  userTrackDaily: process.env.USER_TRACK_DAILY_COLLECTION || "user_track_daily",
  userStatsDaily: process.env.USER_STATS_DAILY_COLLECTION || "user_stats_daily",
  userSnapshots: process.env.USER_SNAPSHOTS_COLLECTION || "user_snapshots",
};

async function ensureIndexes(dbInstance) {
  if (indexesEnsured) return;

  const creations = [
    dbInstance
      .collection(COLLECTIONS.streams)
      .createIndex({ userId: 1, ts: 1 }, { name: "streams_user_ts" }),
    dbInstance
      .collection(COLLECTIONS.tracks)
      .createIndex({ status: 1, nextRefreshAt: 1 }, { name: "tracks_status_refresh" }),
    dbInstance
      .collection(COLLECTIONS.streams)
      .createIndex({ userId: 1, ts: 1, trackId: 1 }, { name: 'uniq_stream_per_user', unique: true }),
    dbInstance
      .collection(COLLECTIONS.tracks)
      .createIndex({ lockedAt: 1 }, { name: "tracks_locked_at" }),
    dbInstance
      .collection(COLLECTIONS.artists)
      .createIndex({ status: 1, nextRefreshAt: 1 }, { name: "artists_status_refresh" }),
    dbInstance
      .collection(COLLECTIONS.artists)
      .createIndex({ lockedAt: 1 }, { name: "artists_locked_at" }),
    dbInstance
      .collection(COLLECTIONS.albums)
      .createIndex({ status: 1, nextRefreshAt: 1 }, { name: "albums_status_refresh" }),
    dbInstance
      .collection(COLLECTIONS.albums)
      .createIndex({ lockedAt: 1 }, { name: "albums_locked_at" }),
    dbInstance
      .collection(COLLECTIONS.userTrackDaily)
      .createIndex(
        { userId: 1, day: 1, trackId: 1 },
        { unique: true, name: "utd_user_day_track" }
      ),
    dbInstance
      .collection(COLLECTIONS.userTrackDaily)
      .createIndex({ day: 1 }, { name: "utd_day" }),
    dbInstance
      .collection(COLLECTIONS.userStatsDaily)
      .createIndex(
        { userId: 1, day: 1 },
        { unique: true, name: "usd_user_day" }
      ),
    dbInstance
      .collection(COLLECTIONS.userSnapshots)
      .createIndex(
        { userId: 1 },
        { unique: true, name: "user_snapshots_user" }
      ),
  ];

  await Promise.all(creations);
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
