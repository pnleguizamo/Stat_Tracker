require('dotenv').config();

const { initDb, COLLECTIONS } = require('../mongo.js');
const { ensureTrackStubs } = require('../services/streamNormalizationService.js');

const SCAN_BATCH_SIZE = Number(process.env.TRACK_STUB_SCAN_BATCH || 1000);

async function main() {
  try {
    const db = await initDb();
    const streamsCol = db.collection(COLLECTIONS.streams);

    // Group unique trackIds from the normalized streams collection.
    const cursor = streamsCol.aggregate(
      [
        { $match: { trackId: { $ne: null } } },
        { $group: { _id: '$trackId' } },
      ],
      { allowDiskUse: true }
    );

    const batch = [];
    let scanned = 0;
    let insertedTotal = 0;

    for await (const doc of cursor) {
      if (!doc || !doc._id) continue;
      batch.push(doc._id);
      scanned += 1;

      if (batch.length >= SCAN_BATCH_SIZE) {
        insertedTotal += await ensureTrackStubs(batch, db);
        console.log(
          `Processed ${scanned} unique trackIds; stubs inserted so far: ${insertedTotal}`
        );
        batch.length = 0;
      }
    }

    if (batch.length) {
      insertedTotal += await ensureTrackStubs(batch, db);
      console.log(
        `Processed ${scanned} unique trackIds; stubs inserted so far: ${insertedTotal}`
      );
    }

    console.log(
      `Done. Unique trackIds scanned: ${scanned}. New stubs inserted: ${insertedTotal}.`
    );
    process.exit(0);
  } catch (err) {
    console.error('Failed to ensure track stubs from streams collection:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
