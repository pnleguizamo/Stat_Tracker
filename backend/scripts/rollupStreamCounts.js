require('dotenv').config();

const { initDb, COLLECTIONS } = require('../mongo.js');
const { rollupUserCounts } = require('../services/mongoServices.js');

async function main() {
  try {
    const db = await initDb();
    
    const users = await db.collection('oauth_tokens').find({}, { projection: { accountId: 1, display_name : 1  } }).toArray();
    const userIds = users.map((user) => user.accountId);

    const start = Date.now();
    console.log("Cron started at:", new Date(start).toISOString());
    
    await rollupUserCounts({userIds});
    
    const end = Date.now();
    const ms = end - start;
    console.log(`Cron finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);
    console.log(
      `Done. Unique trackIds scanned: ${scanned}. New stubs inserted: ${insertedTotal}.`
    );
    process.exit(0);
  } catch (err) {
    console.error('Failed to rollup stream counts:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
