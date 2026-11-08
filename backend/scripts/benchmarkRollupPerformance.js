require('dotenv').config();

const DEFAULT_WINDOW = 'ytd';
const DEFAULT_ITERATIONS = 30;
const DEFAULT_WARMUPS = 5;
const DEFAULT_LIMIT = 20;
const VALID_WINDOW_PATTERN = /^(last7|last30|last90|last180|ytd|allTime|year\d{4})$/;
let mongoClient = null;

function parseArgs(argv = []) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const separator = token.indexOf('=');
    if (separator === -1) {
      args[token.slice(2)] = true;
      continue;
    }
    args[token.slice(2, separator)] = token.slice(separator + 1);
  }
  return args;
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
Compare a raw streams aggregation with a materialized user snapshot lookup.

Usage:
  node scripts/benchmarkRollupPerformance.js [options]

Options:
  --user=<spotifyUserId>  User to benchmark. Defaults to the first snapshot
                          containing the requested window.
  --window=<key>          last7, last30, last90, last180, ytd, allTime,
                          or yearYYYY. Default: ${DEFAULT_WINDOW}
  --iterations=<n>        Measured runs per query. Default: ${DEFAULT_ITERATIONS}
  --warmups=<n>           Warm-up runs per query. Default: ${DEFAULT_WARMUPS}
  --limit=<n>             Number of top tracks to compare. Default: ${DEFAULT_LIMIT}
  --json                  Print the machine-readable report only.
  --help                  Show this help.

The script is read-only. It uses the snapshot's stored since/until bounds so
the raw aggregation covers the same period as the materialized window.
`);
}

function percentile(sortedValues, quantile) {
  if (!sortedValues.length) return null;
  const index = Math.max(0, Math.ceil(quantile * sortedValues.length) - 1);
  return sortedValues[index];
}

function summarizeDurations(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    runs: sorted.length,
    minMs: sorted[0] ?? null,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? null,
    meanMs: sorted.length ? total / sorted.length : null,
  };
}

function roundMetric(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}

function roundSummary(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, roundMetric(value)])
  );
}

async function timeQuery(query) {
  const startedAt = process.hrtime.bigint();
  const result = await query();
  const elapsedNs = process.hrtime.bigint() - startedAt;
  return {
    result,
    durationMs: Number(elapsedNs) / 1e6,
  };
}

function buildRawPipeline({ userId, since, until, limit }) {
  const match = {
    userId,
    canonicalTrackId: { $ne: null },
  };

  if (since || until) {
    match.ts = {};
    if (since) match.ts.$gte = since;
    if (until) match.ts.$lt = until;
  }

  return [
    { $match: match },
    {
      $project: {
        canonicalTrackId: 1,
        msPlayed: { $ifNull: ['$msPlayed', '$ms_played'] },
        reasonEnd: 1,
      },
    },
    {
      $match: {
        canonicalTrackId: { $ne: null },
        msPlayed: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$canonicalTrackId',
        plays: {
          $sum: { $cond: [{ $eq: ['$reasonEnd', 'trackdone'] }, 1, 0] },
        },
        unfinishedPlays: { $sum: 1 },
        msPlayed: { $sum: '$msPlayed' },
      },
    },
    { $sort: { plays: -1, msPlayed: -1, unfinishedPlays: -1, _id: 1 } },
    { $limit: limit },
  ];
}

function snapshotProjection(window, limit, includeBounds = false) {
  const projection = {
    _id: 0,
    userId: 1,
    updatedAt: 1,
    [`windows.${window}.topTracks`]: { $slice: limit },
  };

  if (includeBounds) {
    // MongoDB does not allow projecting a sliced nested array and its parent
    // sibling fields together reliably, so bounds are fetched separately.
    delete projection[`windows.${window}.topTracks`];
    projection[`windows.${window}.since`] = 1;
    projection[`windows.${window}.until`] = 1;
    projection[`windows.${window}.topTracks`] = 1;
  }

  return projection;
}

function getWindow(snapshot, window) {
  return snapshot?.windows?.[window] || null;
}

function normalizeRawResults(docs = []) {
  return docs.map((doc) => ({
    trackId: doc._id,
    plays: Number(doc.plays || 0),
    unfinishedPlays: Number(doc.unfinishedPlays || 0),
    msPlayed: Number(doc.msPlayed || 0),
  }));
}

function normalizeSnapshotResults(snapshot, window, limit) {
  return (getWindow(snapshot, window)?.topTracks || [])
    .slice(0, limit)
    .map((track) => ({
      trackId: track.trackId,
      plays: Number(track.plays || 0),
      unfinishedPlays: Number(track.unfinishedPlays || 0),
      msPlayed: Number(track.msPlayed || 0),
    }));
}

function compareResults(rawResults, snapshotResults) {
  const rawById = new Map(rawResults.map((row) => [row.trackId, row]));
  const snapshotById = new Map(snapshotResults.map((row) => [row.trackId, row]));
  const allIds = new Set([...rawById.keys(), ...snapshotById.keys()]);
  const mismatches = [];

  for (const trackId of allIds) {
    const raw = rawById.get(trackId);
    const snapshot = snapshotById.get(trackId);
    if (!raw || !snapshot) {
      mismatches.push({ trackId, reason: raw ? 'missing_from_snapshot' : 'missing_from_raw' });
      continue;
    }

    const differingFields = ['plays', 'unfinishedPlays', 'msPlayed']
      .filter((field) => raw[field] !== snapshot[field]);
    if (differingFields.length) {
      mismatches.push({ trackId, reason: 'metric_mismatch', differingFields, raw, snapshot });
    }
  }

  const comparedPositions = Math.min(rawResults.length, snapshotResults.length);
  let matchingPositions = 0;
  for (let index = 0; index < comparedPositions; index += 1) {
    if (rawResults[index]?.trackId === snapshotResults[index]?.trackId) {
      matchingPositions += 1;
    }
  }

  return {
    exactMetricMatch: mismatches.length === 0,
    rawResultCount: rawResults.length,
    snapshotResultCount: snapshotResults.length,
    matchingPositions,
    comparedPositions,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 10),
    mismatchOutputTruncated: mismatches.length > 10,
  };
}

function findExecutionStats(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);

  if (
    value.executionStats &&
    typeof value.executionStats === 'object' &&
    ('totalDocsExamined' in value.executionStats || 'executionTimeMillis' in value.executionStats)
  ) {
    return value.executionStats;
  }

  for (const child of Object.values(value)) {
    const found = findExecutionStats(child, seen);
    if (found) return found;
  }
  return null;
}

function summarizeExplain(explain) {
  const stats = findExecutionStats(explain) || {};
  return {
    executionTimeMillis: stats.executionTimeMillis ?? null,
    totalDocsExamined: stats.totalDocsExamined ?? null,
    totalKeysExamined: stats.totalKeysExamined ?? null,
    nReturned: stats.nReturned ?? null,
  };
}

async function benchmark({ rawQuery, snapshotQuery, warmups, iterations }) {
  for (let index = 0; index < warmups; index += 1) {
    await rawQuery();
    await snapshotQuery();
  }

  const rawDurations = [];
  const snapshotDurations = [];
  let rawResult = null;
  let snapshotResult = null;

  for (let index = 0; index < iterations; index += 1) {
    // Alternate query order to reduce systematic cache/order bias.
    const order = index % 2 === 0
      ? [['raw', rawQuery], ['snapshot', snapshotQuery]]
      : [['snapshot', snapshotQuery], ['raw', rawQuery]];

    for (const [name, query] of order) {
      const timed = await timeQuery(query);
      if (name === 'raw') {
        rawDurations.push(timed.durationMs);
        rawResult = timed.result;
      } else {
        snapshotDurations.push(timed.durationMs);
        snapshotResult = timed.result;
      }
    }
  }

  return {
    rawDurations,
    snapshotDurations,
    rawResult,
    snapshotResult,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const window = String(args.window || DEFAULT_WINDOW);
  if (!VALID_WINDOW_PATTERN.test(window)) {
    throw new Error(`Unsupported window "${window}".`);
  }

  const iterations = parsePositiveInteger(args.iterations, DEFAULT_ITERATIONS, 'iterations');
  const warmups = parsePositiveInteger(args.warmups, DEFAULT_WARMUPS, 'warmups');
  const limit = parsePositiveInteger(args.limit, DEFAULT_LIMIT, 'limit');

  const { client, COLLECTIONS } = require('../mongo.js');
  mongoClient = client;
  const streamsCollection = COLLECTIONS.streams;
  const snapshotsCollection = COLLECTIONS.userSnapshots;
  if (!streamsCollection || !snapshotsCollection) {
    throw new Error('STREAMS_COLLECTION and USER_SNAPSHOTS_COLLECTION must be configured.');
  }

  await client.connect();
  const db = client.db(process.env.DB_NAME);
  const snapshots = db.collection(snapshotsCollection);
  const windowPath = `windows.${window}`;
  const requestedUserId = typeof args.user === 'string' && args.user.trim()
    ? args.user.trim()
    : null;
  const filter = requestedUserId
    ? { userId: requestedUserId, [windowPath]: { $exists: true } }
    : { [windowPath]: { $exists: true } };

  const snapshotMetadata = await snapshots.findOne(filter, {
    projection: snapshotProjection(window, limit, true),
  });
  if (!snapshotMetadata) {
    throw new Error(
      requestedUserId
        ? `No ${window} snapshot found for user ${requestedUserId}.`
        : `No snapshot containing window ${window} was found.`
    );
  }

  const userId = snapshotMetadata.userId;
  const materializedWindow = getWindow(snapshotMetadata, window);
  const since = materializedWindow?.since ? new Date(materializedWindow.since) : null;
  const until = materializedWindow?.until ? new Date(materializedWindow.until) : null;
  const rawPipeline = buildRawPipeline({ userId, since, until, limit });
  const timedProjection = snapshotProjection(window, limit, false);

  const rawQuery = () => db
    .collection(streamsCollection)
    .aggregate(rawPipeline, { allowDiskUse: true })
    .toArray();
  const snapshotQuery = () => snapshots.findOne(
    { userId },
    { projection: timedProjection }
  );

  const measured = await benchmark({
    rawQuery,
    snapshotQuery,
    warmups,
    iterations,
  });

  const rawExplain = await db.command({
    explain: {
      aggregate: streamsCollection,
      pipeline: rawPipeline,
      cursor: {},
      allowDiskUse: true,
    },
    verbosity: 'executionStats',
  });
  const snapshotExplain = await db.command({
    explain: {
      find: snapshotsCollection,
      filter: { userId },
      projection: timedProjection,
    },
    verbosity: 'executionStats',
  });

  const rawTiming = summarizeDurations(measured.rawDurations);
  const snapshotTiming = summarizeDurations(measured.snapshotDurations);
  const rawStats = summarizeExplain(rawExplain);
  const snapshotStats = summarizeExplain(snapshotExplain);
  const rawResults = normalizeRawResults(measured.rawResult);
  const snapshotResults = normalizeSnapshotResults(measured.snapshotResult, window, limit);
  const comparison = compareResults(rawResults, snapshotResults);

  const medianSpeedup = rawTiming.medianMs && snapshotTiming.medianMs
    ? rawTiming.medianMs / snapshotTiming.medianMs
    : null;
  const documentsExaminedReduction = Number.isFinite(rawStats.totalDocsExamined)
    && rawStats.totalDocsExamined > 0
    && Number.isFinite(snapshotStats.totalDocsExamined)
    ? 1 - (snapshotStats.totalDocsExamined / rawStats.totalDocsExamined)
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    database: process.env.DB_NAME,
    collections: {
      streams: streamsCollection,
      snapshots: snapshotsCollection,
    },
    benchmark: {
      userId,
      window,
      since,
      until,
      snapshotUpdatedAt: snapshotMetadata.updatedAt || null,
      limit,
      warmups,
      iterations,
    },
    wallClock: {
      rawAggregation: roundSummary(rawTiming),
      materializedSnapshot: roundSummary(snapshotTiming),
      medianSpeedup: roundMetric(medianSpeedup),
    },
    mongoExecutionStats: {
      rawAggregation: rawStats,
      materializedSnapshot: snapshotStats,
      documentsExaminedReductionPercent: Number.isFinite(documentsExaminedReduction)
        ? roundMetric(documentsExaminedReduction * 100, 2)
        : null,
    },
    resultValidation: comparison,
    cautions: [
      'Wall-clock results are warm-cache measurements on the current host.',
      'Do not publish a speedup unless resultValidation is acceptable.',
      'Mongo executionTimeMillis for an aggregation may describe the cursor stage; wall-clock timing covers the complete pipeline.',
    ],
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('\nRollup performance comparison');
  console.log('=============================');
  console.log(`User:             ${userId}`);
  console.log(`Window:           ${window}`);
  console.log(`Bounds:           ${since?.toISOString?.() || 'beginning'} -> ${until?.toISOString?.() || 'unbounded'}`);
  console.log(`Snapshot updated: ${snapshotMetadata.updatedAt?.toISOString?.() || snapshotMetadata.updatedAt || 'unknown'}`);
  console.log(`Top tracks:       ${limit}`);
  console.log(`Runs:             ${iterations} measured + ${warmups} warm-up`);
  console.log('');
  console.log(`Raw aggregation median / p95: ${roundMetric(rawTiming.medianMs)} ms / ${roundMetric(rawTiming.p95Ms)} ms`);
  console.log(`Snapshot lookup median / p95: ${roundMetric(snapshotTiming.medianMs)} ms / ${roundMetric(snapshotTiming.p95Ms)} ms`);
  console.log(`Median speedup:                  ${roundMetric(medianSpeedup)}x`);
  console.log('');
  console.log(`Raw documents / keys examined:      ${rawStats.totalDocsExamined ?? 'n/a'} / ${rawStats.totalKeysExamined ?? 'n/a'}`);
  console.log(`Snapshot documents / keys examined: ${snapshotStats.totalDocsExamined ?? 'n/a'} / ${snapshotStats.totalKeysExamined ?? 'n/a'}`);
  console.log(`Documents examined reduction:       ${report.mongoExecutionStats.documentsExaminedReductionPercent ?? 'n/a'}%`);
  console.log('');
  console.log(`Result metrics match: ${comparison.exactMetricMatch ? 'yes' : 'NO'}`);
  console.log(`Ranking positions:    ${comparison.matchingPositions}/${comparison.comparedPositions} match`);
  if (!comparison.exactMetricMatch) {
    console.log(`Mismatches:           ${comparison.mismatchCount} (showing up to 10 in JSON below)`);
  }
  console.log('');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Rollup performance benchmark failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (!mongoClient) return;
      try {
        await mongoClient.close();
      } catch (error) {
        if (process.exitCode !== 1) {
          console.error('Failed to close Mongo client:', error);
          process.exitCode = 1;
        }
      }
    });
}

module.exports = {
  buildRawPipeline,
  compareResults,
  parseArgs,
  summarizeDurations,
};
