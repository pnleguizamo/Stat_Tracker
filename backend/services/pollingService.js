const { initDb, client } = require('../mongo.js');
const cron = require('node-cron');
const { syncRecentStreams } = require('../services/mongoServices.js');
const { getRecentlyPlayedSongs } = require('../services/spotifyServices.js');
const { getAccessToken } = require('./authService.js');

const collectionName = process.env.COLLECTION_NAME;
let db;

async function createIndex(){
    db = await initDb();

    db.collection(collectionName).createIndex(
    { userId: 1, ts: 1, spotify_track_uri: 1 },
    { unique: true, name: "uniq_play_per_user" }
    );
}

cron.schedule('*/3 * * * *', async () => {
    try {
        db = await initDb();
        
        const start = Date.now();
        // console.log("Cron started at:", new Date(start).toISOString());

        const users = await db.collection('oauth_tokens').find({}, { projection: { accountId: 1, display_name : 1  } }).toArray();
        const stateCol = db.collection("user_polling_state");

        for (const { accountId, display_name } of users) {
            const state = await stateCol.findOne({ accountId }) || { afterMs: 0 };
            const token = await getAccessToken(accountId);
            const { tracks, maxPlayedAtMs } = await getRecentlyPlayedSongs(token, state.afterMs);
            const newStreamsCount = await syncRecentStreams(tracks, accountId);
            console.log(`User ${display_name}: inserted ${newStreamsCount} new streams`);
            const end = Date.now();
            const ms = end - start;
            // console.log(`Cron finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);

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
        }
    } catch (e) {
        console.error('cron ingest error', e);
    }
});
