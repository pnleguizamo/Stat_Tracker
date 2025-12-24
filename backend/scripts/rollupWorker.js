require('dotenv').config();

const cron = require('node-cron');
const { client } = require('../mongo.js');
const { buildUserTrackDailyFromStreams, buildUserSnapshots } = require('../services/rollupService.js');

const SCHEDULE = process.env.ROLLUP_CRON || '30 3 * * *'; // default: 03:30 UTC daily
const RECENT_DAYS = Number(process.env.ROLLUP_RECENT_DAYS || 40);

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
  const daily = await buildUserTrackDailyFromStreams({ startDate: start, endDate: end });
  const snapshots = await buildUserSnapshots();
  console.log('[rollups] run finished', { daily, snapshots });
}

function shutdown() {
  client
    .close()
    .catch(err => console.error('Error closing Mongo client after rollup worker', err))
    .finally(() => process.exit(0));
}

if (require.main === module) {
  runRollups('startup').catch(err => {
    console.error('[rollups] startup run failed', err);
  });

  cron.schedule(SCHEDULE, () => {
    runRollups('scheduled').catch(err => {
      console.error('[rollups] scheduled run failed', err);
    });
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
