require('dotenv').config();

const cron = require('node-cron');
const { client } = require('../mongo.js');
const { buildUserTrackDailyFromStreams, buildUserSnapshots } = require('../services/rollupService.js');
const { rollupUserCounts } = require('../services/mongoServices.js');
const { enrichRecentStreamsWithCanonicalIds } = require('../services/canonicalEnrichmentService.js');

const SCHEDULE = process.env.ROLLUP_CRON || '30 3 * * *'; // default: 03:30 UTC daily
const RECENT_DAYS = Number(process.env.ROLLUP_RECENT_DAYS || 40);
const CANONICAL_SCHEDULE = process.env.CANONICAL_ENRICH_CRON || '*/30 * * * *';
const CANONICAL_WINDOW_DAYS = Number(process.env.CANONICAL_ENRICH_WINDOW_DAYS || 7);
const CANONICAL_BATCH_SIZE = Number(process.env.CANONICAL_ENRICH_BATCH || 10000);
const CANONICAL_MAX_BATCHES = Number(process.env.CANONICAL_ENRICH_MAX_BATCHES || 5);
let cronJob = null;
let canonicalCronJob = null;

function computeRange(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

async function runRollups(reason = 'manual') {
  const { start, end } = computeRange(RECENT_DAYS);
  console.log(
    `[rollups] ${reason} run; refreshing streams from ${start.toISOString()} to ${end.toISOString()}`
  );
  
  const startTime = Date.now();
  const daily = await buildUserTrackDailyFromStreams({ startDate: start, endDate: end });
  const snapshots = await buildUserSnapshots();
  await rollupUserCounts();
  
  const endTime = Date.now();
  const ms = endTime - startTime;
  console.log(`Rollup worker finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);
  console.log('[rollups] run finished', { daily, snapshots });
}

async function runCanonicalEnrichment(reason = 'manual') {
  console.log(
    `[canonical] ${reason} enrichment start; windowDays=${CANONICAL_WINDOW_DAYS} batchSize=${CANONICAL_BATCH_SIZE} maxBatches=${CANONICAL_MAX_BATCHES}`
  );
  const start = Date.now();
  const result = await enrichRecentStreamsWithCanonicalIds({
    windowDays: CANONICAL_WINDOW_DAYS,
    batchSize: CANONICAL_BATCH_SIZE,
    maxBatches: CANONICAL_MAX_BATCHES,
    logger: console,
  });
  const duration = Date.now() - start;
  console.log(
    `[canonical] ${reason} enrichment finished in ${duration} ms (${(duration / 1000).toFixed(
      2
    )}s) scanned=${result.scanned} resolved=${result.resolved} updated=${result.updated} unresolved=${result.unresolvedTrackIds.length}`
  );
}

function shutdown() {
  if (cronJob) {
    cronJob.stop();
  }
  if (canonicalCronJob) {
    canonicalCronJob.stop();
  }
  client
    .close()
    .catch(err => console.error('Error closing Mongo client after rollup worker', err))
    .finally(() => process.exit(0));
}

function startRollupWorker(options = {}) {
  const { reason = 'startup', registerSignals = true } = options;
  if (cronJob) {
    console.log('[rollups] worker already running');
    return cronJob;
  }

  canonicalCronJob = cron.schedule(CANONICAL_SCHEDULE, () => {
    runCanonicalEnrichment('scheduled').catch(err => {
      console.error('[canonical] scheduled enrichment failed', err);
    });
  });

  cronJob = cron.schedule(SCHEDULE, () => {
    runRollups('scheduled').catch(err => {
      console.error('[rollups] scheduled run failed', err);
    });
  });

  if (registerSignals) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  console.log(`[rollups] worker scheduled with cron ${SCHEDULE}`);
  console.log(`[canonical] enrichment scheduled with cron ${CANONICAL_SCHEDULE}`);
  runCanonicalEnrichment(reason).catch(err => console.error('[canonical] startup run failed', err));

  return cronJob;
}

if (require.main === module) {
  startRollupWorker();
}

module.exports = { startRollupWorker };
