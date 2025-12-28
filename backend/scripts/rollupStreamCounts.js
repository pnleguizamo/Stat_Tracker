require('dotenv').config();

const { initDb, COLLECTIONS } = require('../mongo.js');
const { rollupUserCounts } = require('../services/mongoServices.js');

async function main() {
  try {
    const start = Date.now();
    
    await rollupUserCounts();
    
    const end = Date.now();
    const ms = end - start;
    console.log(`Rollup stream counts finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);
    
    process.exit(0);
  } catch (err) {
    console.error('Failed to rollup stream counts:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
