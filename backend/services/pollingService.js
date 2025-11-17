const { initDb, client } = require('../mongo.js');
const cron = require('node-cron');
const { syncRecentStreams } = require('../services/mongoServices.js');
const { getRecentlyPlayedSongs } = require('../services/spotifyServices.js');

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
        console.log("Cron started at:", new Date(start).toISOString());

        const users = await db.collection('oauth_tokens').find({}, { projection: { accountId: 1 } }).toArray();
        const stateCol = db.collection("user_polling_state");

        for (const { accountId } of users) {
            const state = await stateCol.findOne({ accountId }) || { afterMs: 0 };
            const token = await getSpotifyAccessToken(accountId);
            const { tracks, maxPlayedAtMs } = await getRecentlyPlayedSongs(token, state.afterMs);
            const newStreamsCount = await syncRecentStreams(tracks, accountId);
            console.log(`User ${accountId}: inserted ${newStreamsCount} new streams`);
            const end = Date.now();
            const ms = end - start;
            console.log(`Cron finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);

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


async function getSpotifyAccessToken(accountId) {
    const tokensCol = db.collection('oauth_tokens');
    const row = await tokensCol.findOne({ accountId });

    if (!row) throw new Error('No Spotify connection');

    if (row.accessToken && row.accessTokenExpiresAt > new Date()) {
        return row.accessToken;
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refreshToken
    });
    const basic = Buffer
        .from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`)
        .toString('base64');

    const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!r.ok) throw new Error(`Refresh failed ${r.status}`);

    const json = await r.json();
    console.log("REFRESHED ", json.refresh_token);

    const update = {
        accessToken: json.access_token,
        accessTokenExpiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000),
        updatedAt: new Date()
    };
    if (json.refresh_token) update.refreshToken = json.refresh_token;

    await tokensCol.updateOne({ accountId }, { $set: update });
    return update.accessToken;
}
