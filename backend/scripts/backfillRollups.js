require('dotenv').config();

const { client } = require('../mongo.js');
const { runFullBackfill } = require('../services/rollupService.js');
const { rollupUserCounts } = require('../services/mongoServices.js');

async function main() {
  const userIds = [];

  const start = Date.now();

  const result = await runFullBackfill({userIds});
  await rollupUserCounts();
  
  const duration = Date.now() - start;
  console.log(`[canonical-backfill] finished in ${duration} ms (${(duration / 1000).toFixed(2)}s)`);
  console.log('Rollup backfill complete', result);
}

main()
  .catch(err => {
    console.error('Rollup backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (err) {
      console.error('Error closing Mongo client after rollup backfill', err);
    }
  });
