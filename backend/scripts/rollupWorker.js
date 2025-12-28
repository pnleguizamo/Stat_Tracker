require('dotenv').config();

const cron = require('node-cron');
const { client } = require('../mongo.js');
const { buildUserTrackDailyFromStreams, buildUserSnapshots } = require('../services/rollupService.js');
const { rollupUserCounts } = require('../services/mongoServices.js');

const SCHEDULE = process.env.ROLLUP_CRON || '30 3 * * *'; // default: 03:30 UTC daily
const RECENT_DAYS = Number(process.env.ROLLUP_RECENT_DAYS || 40);
let cronJob = null;

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

function shutdown() {
  if (cronJob) {
    cronJob.stop();
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
  return cronJob;
}

if (require.main === module) {
  startRollupWorker();
}

module.exports = { startRollupWorker };
