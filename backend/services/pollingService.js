const { initDb, client, COLLECTIONS } = require('../mongo.js');
const cron = require('node-cron');
const { syncRecentStreams } = require('../services/mongoServices.js');
const { getRecentlyPlayedSongs } = require('../services/spotifyServices.js');
const { getAccessToken } = require('./authService.js');

const collectionName = COLLECTIONS.rawStreams;
const SPOTIFY_RECENTLY_PLAYED_LIMIT = 50;
let db;

function logSyncStats(displayName, syncStats, suffix = '') {
    const hitRecentlyPlayedLimit = syncStats.fetched >= SPOTIFY_RECENTLY_PLAYED_LIMIT;
    const hasNewInserts = syncStats.rawInserted || syncStats.normalizedInserted;
    if (!hasNewInserts && !hitRecentlyPlayedLimit) return;

    const capWarning = hitRecentlyPlayedLimit
        ? ' (may have hit Spotify\'s 50-play cap; older plays may be missing)'
        : '';
    console.log(
        `User ${displayName}: fetched ${syncStats.fetched} recent plays, ` +
        `inserted ${syncStats.rawInserted} raw streams, ` +
        `inserted ${syncStats.normalizedInserted} normalized streams${capWarning}${suffix}`
    );
}

async function createIndex(){
    db = await initDb();

    db.collection(collectionName).createIndex(
    { userId: 1, ts: 1, spotify_track_uri: 1 },
    { unique: true, name: "uniq_play_per_user" }
    );
}

cron.schedule('*/10 * * * *', async () => {
    try {
        db = await initDb();

        const users = await db.collection('oauth_tokens').find({}, { projection: { accountId: 1, display_name : 1  } }).toArray();
        const stateCol = db.collection("user_polling_state");

        for (const { accountId, display_name } of users) {
            try {
                const state = await stateCol.findOne({ accountId }) || { afterMs: 0 };
                const token = await getAccessToken(accountId);
                const { tracks, maxPlayedAtMs } = await getRecentlyPlayedSongs(token, state.afterMs, SPOTIFY_RECENTLY_PLAYED_LIMIT);
                const syncStats = await syncRecentStreams(tracks, accountId);
                logSyncStats(display_name, syncStats);

                if (maxPlayedAtMs != null && maxPlayedAtMs > state.afterMs) {
                    await stateCol.updateOne(
                        { accountId },
                        {
                            $set: {
                                afterMs: maxPlayedAtMs + 1,   // strictly after last ingested play
                                lastRunAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                }
            } catch (e) {
                if (e.syncRecentStreamsStats) {
                    logSyncStats(display_name, e.syncRecentStreamsStats, ' before sync failed');
                }
                console.error(`cron ingest error for user ${display_name || accountId}`, e);
            }
        }
    } catch (e) {
        console.error('cron ingest error', e);
    }
});
