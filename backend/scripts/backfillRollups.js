require('dotenv').config();

const { client } = require('../mongo.js');
const { runFullBackfill } = require('../services/rollupService.js');

async function main() {
  const result = await runFullBackfill();
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
