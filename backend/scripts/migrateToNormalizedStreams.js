require('dotenv').config();
const { initDb, client, COLLECTIONS } = require('../mongo.js');
const { ingestNormalizedStreamEvents } = require('../services/streamNormalizationService.js');

const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 1000);

async function run() {
  const db = await initDb();
  const rawCol = db.collection(COLLECTIONS.rawStreams);
  const cursor = rawCol.find(
    {},
    {
      projection: {
        ts: 1,
        ms_played: 1,
        spotify_track_uri: 1,
        reason_end: 1,
        userId: 1,
      }
    }
  );

  const perUser = new Map();
  const summary = {
    totalRows: 0,
    normalized: 0,
    inserted: 0,
    skipped: 0,
    trackStubs: 0,
  };
  const usersSeen = new Set();

  async function flushUser(userId) {
    const rows = perUser.get(userId);
    if (!rows || !rows.length) return;
    const stats = await ingestNormalizedStreamEvents(rows, userId, { source: 'migration-script' });
    summary.normalized += stats.normalized;
    summary.inserted += stats.inserted;
    summary.skipped += stats.skipped;
    summary.trackStubs += stats.trackStubsCreated;
    usersSeen.add(userId);
    perUser.set(userId, []);
  }

  for await (const doc of cursor) {
    if (!doc.userId) continue;
    summary.totalRows++;
    if (!perUser.has(doc.userId)) {
      perUser.set(doc.userId, []);
    }
    const buffer = perUser.get(doc.userId);
    buffer.push(doc);
    if (buffer.length >= BATCH_SIZE) {
      await flushUser(doc.userId);
    }
  }

  for (const [userId, rows] of perUser.entries()) {
    if (rows.length) {
      await flushUser(userId);
    }
  }

  summary.usersProcessed = usersSeen.size;
  console.log('Migration summary:', summary);
}

run()
  .catch(err => {
    console.error('Migration failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (err) {
      console.error('Error closing Mongo client', err);
    }
  });
