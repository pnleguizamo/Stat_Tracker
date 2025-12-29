require('dotenv').config();

const { client } = require('../mongo.js');
const { backfillCanonicalIds } = require('../services/canonicalEnrichmentService.js');

const BATCH_SIZE = Number(process.env.CANONICAL_ENRICH_BATCH || 10000); // Necessary?

async function main() {
  console.log(`[canonical-backfill] starting full backfill batchSize=${BATCH_SIZE}`);
  const start = Date.now();
  const result = await backfillCanonicalIds({ batchSize: BATCH_SIZE, logger: console });
  const duration = Date.now() - start;
  console.log(
    `[canonical-backfill] finished in ${duration} ms (${(duration / 1000).toFixed(
      2
    )}s) batches=${result.batches} scanned=${result.scanned} resolved=${result.resolved} updated=${result.updated} unresolved=${result.unresolvedTrackIds.length}`
  );
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error('[canonical-backfill] failed', err);
      process.exitCode = 1;
    })
    .finally(() => client.close());
}

module.exports = { main };
