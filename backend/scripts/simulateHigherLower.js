require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const { client } = require('../mongo.js');
const {
  buildHigherLowerStageState,
  pickChallenger,
  helpers: {
    appendRecentPromptTraitValues,
    displayMetricValue,
    getRecentOwnerKey,
  },
} = require('../services/higherLowerService.js');

const DEBUG_DIR = path.resolve(__dirname, '..', 'debug', 'higher-lower');
const DEFAULT_ROOM_CODE = 'SIM-HL';
const DEFAULT_METRIC = 'plays';
const DEFAULT_STRATEGY = 'perfect';
const DEFAULT_SIM_PLAYER_COUNT = 4;
const DEFAULT_SMART_ACCURACY = 0.7;
const VALID_STRATEGIES = new Set([
  'none',
  'perfect',
  'smart',
  'random',
  'always-left',
  'always-right',
]);

function parseArgs(argv = []) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      parsed[trimmed] = 'true';
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    parsed[key] = value;
  }
  return parsed;
}

function sanitizeFileSegment(value, fallback = 'unknown') {
  const normalized = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || fallback;
}

function parseNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function resolveMetric(rawMetric) {
  return rawMetric === 'minutes' ? 'minutes' : DEFAULT_METRIC;
}

function buildOptions(args = {}) {
  const options = {};
  const maxRounds = parseNumber(args['max-rounds']);
  const maxPerBucket = parseNumber(args['max-per-bucket']);
  const openingMinPercentile = parseNumber(args['opening-min-percentile']);
  const openingMaxPercentile = parseNumber(args['opening-max-percentile']);
  const openingWindowPercent = parseNumber(args['opening-window-percent']);
  const timeframes = parseList(args.timeframes);

  if (Number.isFinite(maxRounds) && maxRounds > 0) options.maxRounds = maxRounds;
  if (Number.isFinite(maxPerBucket) && maxPerBucket > 0) options.maxPerBucket = maxPerBucket;
  if (Number.isFinite(openingMinPercentile)) options.openingMinPercentile = openingMinPercentile;
  if (Number.isFinite(openingMaxPercentile)) options.openingMaxPercentile = openingMaxPercentile;
  if (Number.isFinite(openingWindowPercent)) options.openingWindowPercent = openingWindowPercent;
  if (timeframes.length) options.timeframes = timeframes;

  return options;
}

function createRoom(roomCode) {
  return {
    code: roomCode,
    roomCode,
    players: new Map(),
  };
}

function printHelp() {
  console.log(`
Usage:
  npm run higher-lower:simulate -- [options]

Options:
  --metric=plays|minutes
  --max-rounds=<number>
  --max-per-bucket=<number>
  --timeframes=last7,last30,allTime
  --strategy=none|perfect|smart|random|always-left|always-right
  --sim-players=<number>
  --accuracy=<0-1>           Used by --strategy=smart
  --room-code=<code>
  --opening-min-percentile=<0-1>
  --opening-max-percentile=<0-1>
  --opening-window-percent=<0-1>
  --help
`.trim());
}

function getChampionById(stageState, datapointId) {
  if (!datapointId) return null;
  return stageState?.pool?.find((entry) => entry?.id === datapointId) || null;
}

function rememberSeenOwners(stageState, datapoints = []) {
  if (!stageState) return;

  const seenOwners = Array.isArray(stageState.ownersSeenThisCycle)
    ? [...stageState.ownersSeenThisCycle]
    : [];

  for (const datapoint of datapoints) {
    const ownerId = getRecentOwnerKey(datapoint);
    if (!ownerId || seenOwners.includes(ownerId)) continue;
    seenOwners.push(ownerId);
  }

  stageState.ownersSeenThisCycle = seenOwners;
}

function rememberRecentPromptTraits(stageState, datapoints = []) {
  if (!stageState) return;

  stageState.recentEntityTypes = appendRecentPromptTraitValues(
    stageState.recentEntityTypes,
    datapoints.map((datapoint) => datapoint?.entityType)
  );
  stageState.recentScopes = appendRecentPromptTraitValues(
    stageState.recentScopes,
    datapoints.map((datapoint) => datapoint?.scope)
  );
}

function resetSeenOwnersIfExhausted(stageState, champion) {
  if (!stageState?.pool?.length || !champion?.id) return;

  const usedSet = new Set(Array.isArray(stageState.usedDatapointIds) ? stageState.usedDatapointIds : []);
  const availableOwnerKeys = new Set(
    stageState.pool
      .filter((entry) => entry?.id && entry.id !== champion.id && !usedSet.has(entry.id))
      .map((entry) => getRecentOwnerKey(entry))
      .filter(Boolean)
  );

  if (!availableOwnerKeys.size) return;

  const seenOwnerSet = new Set((stageState.ownersSeenThisCycle || []).filter(Boolean));
  const hasUnseenOwner = Array.from(availableOwnerKeys).some((ownerKey) => !seenOwnerSet.has(ownerKey));
  if (hasUnseenOwner) return;

  const championOwnerKey = getRecentOwnerKey(champion);
  stageState.ownersSeenThisCycle = championOwnerKey ? [championOwnerKey] : [];
}

function pickChoice({ strategy, winnerSide, accuracy, index }) {
  if (winnerSide === 'TIE') {
    if (strategy === 'always-left') return 'LEFT';
    if (strategy === 'always-right') return 'RIGHT';
    return index % 2 === 0 ? 'LEFT' : 'RIGHT';
  }

  if (strategy === 'always-left') return 'LEFT';
  if (strategy === 'always-right') return 'RIGHT';
  if (strategy === 'random') return Math.random() < 0.5 ? 'LEFT' : 'RIGHT';
  if (strategy === 'smart') {
    return Math.random() < accuracy
      ? winnerSide
      : winnerSide === 'LEFT'
      ? 'RIGHT'
      : 'LEFT';
  }

  return winnerSide;
}

function simulateAnswers({ strategy, winnerSide, simulatedPlayerCount, accuracy }) {
  if (strategy === 'none' || simulatedPlayerCount <= 0) return {};

  const answers = {};
  for (let index = 0; index < simulatedPlayerCount; index += 1) {
    const playerId = `sim-player-${index + 1}`;
    answers[playerId] = {
      answer: {
        choice: pickChoice({ strategy, winnerSide, accuracy, index }),
      },
      at: Date.now(),
    };
  }
  return answers;
}

function computeRoundResults(left, right, answers = {}) {
  const leftValue = Number(left?.value) || 0;
  const rightValue = Number(right?.value) || 0;
  const tally = { LEFT: 0, RIGHT: 0 };

  for (const submission of Object.values(answers)) {
    const choice = submission?.answer?.choice;
    if (choice === 'LEFT' || choice === 'RIGHT') {
      tally[choice] += 1;
    }
  }

  let winnerSide = 'TIE';
  if (leftValue > rightValue) winnerSide = 'LEFT';
  if (rightValue > leftValue) winnerSide = 'RIGHT';

  const winners = [];
  for (const [playerId, submission] of Object.entries(answers)) {
    const choice = submission?.answer?.choice;
    if (!choice) continue;
    if (winnerSide === 'TIE' || choice === winnerSide) {
      winners.push(playerId);
    }
  }

  return {
    leftValue,
    rightValue,
    leftDisplayValue: displayMetricValue(left?.metric, leftValue),
    rightDisplayValue: displayMetricValue(right?.metric, rightValue),
    winnerSide,
    winners,
    tally,
    totalVotes: tally.LEFT + tally.RIGHT,
  };
}

function computeRatio(leftValue, rightValue) {
  const higherValue = Math.max(leftValue, rightValue);
  const lowerValue = Math.min(leftValue, rightValue);
  return higherValue / Math.max(1, lowerValue);
}

function formatDatapointLabel(datapoint) {
  return [
    datapoint?.title || 'Untitled',
    datapoint?.ownerLabel || null,
    datapoint?.scope || null,
    datapoint?.timeframe || null,
    datapoint?.entityType || null,
  ].filter(Boolean).join(' | ');
}

function formatDatapointBlock(label, datapoint) {
  return [
    `${label}: ${datapoint?.title || 'Untitled'}`,
    `  displayValue: ${datapoint?.displayValue ?? 'n/a'}`,
    `  rawValue: ${Number(datapoint?.value) || 0}`,
    `  owner: ${datapoint?.ownerLabel || 'n/a'}`,
    `  scope: ${datapoint?.scope || 'n/a'}`,
    `  timeframe: ${datapoint?.timeframe || 'n/a'}`,
    `  entityType: ${datapoint?.entityType || 'n/a'}`,
    `  subtitle: ${datapoint?.subtitle || 'n/a'}`,
  ].join('\n');
}

function formatSummary(summary) {
  return [
    `roundsPlayed: ${summary.roundsPlayed}`,
    `terminationReason: ${summary.terminationReason}`,
    `leftWins: ${summary.leftWins}`,
    `rightWins: ${summary.rightWins}`,
    `ties: ${summary.ties}`,
    `championChanges: ${summary.championChanges}`,
    `averageRatio: ${summary.averageRatio}`,
    `maxRatio: ${summary.maxRatio}`,
  ].join('\n');
}

function buildTranscript({
  generatedAt,
  roomCode,
  metric,
  strategy,
  accuracy,
  simulatedPlayerCount,
  stageState,
  openingChampion,
  rounds,
  terminationReason,
}) {
  const leftWins = rounds.filter((round) => round.results.winnerSide === 'LEFT').length;
  const rightWins = rounds.filter((round) => round.results.winnerSide === 'RIGHT').length;
  const ties = rounds.filter((round) => round.results.winnerSide === 'TIE').length;
  const championChanges = rounds.filter((round) => round.results.winnerSide === 'RIGHT').length;
  const ratios = rounds
    .map((round) => round.ratio)
    .filter((ratio) => Number.isFinite(ratio));
  const averageRatio = ratios.length
    ? (ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toFixed(3)
    : 'n/a';
  const maxRatio = ratios.length ? Math.max(...ratios).toFixed(3) : 'n/a';

  const header = [
    `generatedAt: ${generatedAt}`,
    `roomCode: ${roomCode}`,
    `metric: ${metric}`,
    `strategy: ${strategy}`,
    `accuracy: ${strategy === 'smart' ? accuracy : 'n/a'}`,
    `simulatedPlayerCount: ${strategy === 'none' ? 0 : simulatedPlayerCount}`,
    `poolSize: ${stageState.pool?.length || 0}`,
    `maxRounds: ${stageState.maxRounds || 0}`,
    `openingChampion: ${formatDatapointLabel(openingChampion)}`,
    '',
    '[summary]',
    formatSummary({
      roundsPlayed: rounds.length,
      terminationReason,
      leftWins,
      rightWins,
      ties,
      championChanges,
      averageRatio,
      maxRatio,
    }),
  ].join('\n');

  const roundBlocks = rounds.map((round) => {
    const winnerTitle =
      round.results.winnerSide === 'LEFT'
        ? round.left.title
        : round.results.winnerSide === 'RIGHT'
        ? round.right.title
        : 'TIE';

    return [
      `[round ${round.roundNumber}]`,
      formatDatapointBlock('left', round.left),
      formatDatapointBlock('right', round.right),
      `winnerSide: ${round.results.winnerSide}`,
      `winnerTitle: ${winnerTitle}`,
      `difference: ${round.difference}`,
      `ratio: ${round.ratioDisplay}`,
      `votes: LEFT=${round.results.tally.LEFT} RIGHT=${round.results.tally.RIGHT}`,
      `winningPlayers: ${round.results.winners.join(', ') || 'none'}`,
      `nextChampion: ${formatDatapointLabel(round.nextChampion)}`,
      `championDefenseCount: ${round.championDefenseCount}`,
      `ownersSeenThisCycle: ${(round.ownersSeenThisCycle || []).join(', ') || 'none'}`,
      `recentEntityTypes: ${(round.recentEntityTypes || []).join(', ') || 'none'}`,
      `recentScopes: ${(round.recentScopes || []).join(', ') || 'none'}`,
    ].join('\n');
  });

  return `${[header, ...roundBlocks].join('\n\n')}\n`;
}

async function writeTranscript({ roomCode, metric, transcript }) {
  const timestamp = new Date().toISOString();
  const fileName = [
    sanitizeFileSegment(roomCode, 'room'),
    'simulation',
    sanitizeFileSegment(metric, 'metric'),
    sanitizeFileSegment(timestamp, 'timestamp'),
  ].join('__') + '.txt';
  const filePath = path.join(DEBUG_DIR, fileName);
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await fs.writeFile(filePath, transcript, 'utf8');
  return filePath;
}

async function simulateMatch({ roomCode, metric, options, strategy, simulatedPlayerCount, accuracy }) {
  const room = createRoom(roomCode);
  const stageState = await buildHigherLowerStageState({ room, metric, options });
  let champion = getChampionById(stageState, stageState.championDatapointId);

  if (!champion) {
    throw new Error('No opening champion was selected. The datapoint pool may be empty.');
  }

  const openingChampion = champion;
  const rounds = [];
  let terminationReason = 'NO_CHALLENGER_AVAILABLE';

  while (stageState.roundNumber < stageState.maxRounds) {
    resetSeenOwnersIfExhausted(stageState, champion);
    const challenger = pickChallenger({
      pool: stageState.pool || [],
      champion,
      usedIds: stageState.usedDatapointIds || [],
      ownersSeenThisCycle: stageState.ownersSeenThisCycle || [],
      recentEntityTypes: stageState.recentEntityTypes || [],
      recentScopes: stageState.recentScopes || [],
      championDefenseCount: stageState.championDefenseCount || 0,
    });

    if (!challenger) {
      terminationReason = 'NO_CHALLENGER_AVAILABLE';
      break;
    }

    stageState.roundNumber += 1;
    stageState.usedDatapointIds = Array.isArray(stageState.usedDatapointIds)
      ? stageState.usedDatapointIds
      : [];
    stageState.usedDatapointIds.push(challenger.id);
    const leftDatapoint = { ...champion };
    const rightDatapoint = { ...challenger };

    const answers = simulateAnswers({
      strategy,
      winnerSide: rightDatapoint.value > leftDatapoint.value
        ? 'RIGHT'
        : rightDatapoint.value < leftDatapoint.value
        ? 'LEFT'
        : 'TIE',
      simulatedPlayerCount,
      accuracy,
    });
    const results = computeRoundResults(leftDatapoint, rightDatapoint, answers);

    rememberSeenOwners(stageState, [leftDatapoint, rightDatapoint]);
    rememberRecentPromptTraits(stageState, [leftDatapoint, rightDatapoint]);

    if (results.winnerSide === 'RIGHT') {
      stageState.championDatapointId = challenger.id;
      stageState.championDefenseCount = 0;
      champion = challenger;
    } else {
      stageState.championDefenseCount = (Number(stageState.championDefenseCount) || 0) + 1;
    }

    rounds.push({
      roundNumber: stageState.roundNumber,
      left: leftDatapoint,
      right: rightDatapoint,
      results,
      difference: Math.abs(results.leftValue - results.rightValue),
      ratio: computeRatio(results.leftValue, results.rightValue),
      ratioDisplay: `${computeRatio(results.leftValue, results.rightValue).toFixed(3)}x`,
      nextChampion: { ...champion },
      championDefenseCount: stageState.championDefenseCount,
      ownersSeenThisCycle: [...(stageState.ownersSeenThisCycle || [])],
      recentEntityTypes: [...(stageState.recentEntityTypes || [])],
      recentScopes: [...(stageState.recentScopes || [])],
    });

    if (stageState.roundNumber >= stageState.maxRounds) {
      terminationReason = 'MAX_ROUNDS_REACHED';
      break;
    }
  }

  return {
    roomCode,
    metric,
    strategy,
    accuracy,
    simulatedPlayerCount,
    stageState,
    openingChampion,
    rounds,
    terminationReason,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printHelp();
    return;
  }

  const roomCode = args['room-code'] || DEFAULT_ROOM_CODE;
  const metric = resolveMetric(args.metric);
  const strategy = VALID_STRATEGIES.has(args.strategy) ? args.strategy : DEFAULT_STRATEGY;
  const resolvedSimPlayerCount = parseNumber(args['sim-players'], DEFAULT_SIM_PLAYER_COUNT);
  const simulatedPlayerCount = Math.max(0, resolvedSimPlayerCount ?? DEFAULT_SIM_PLAYER_COUNT);
  const accuracy = clamp(
    parseNumber(args.accuracy, DEFAULT_SMART_ACCURACY),
    0,
    1,
    DEFAULT_SMART_ACCURACY
  );
  const options = buildOptions(args);

  const result = await simulateMatch({
    roomCode,
    metric,
    options,
    strategy,
    simulatedPlayerCount,
    accuracy,
  });

  const generatedAt = new Date().toISOString();
  const transcript = buildTranscript({
    generatedAt,
    ...result,
  });
  const filePath = await writeTranscript({
    roomCode,
    metric,
    transcript,
  });

  console.log(`Higher / Lower simulation complete: ${filePath}`);
  console.log(`Rounds played: ${result.rounds.length}`);
  console.log(`Termination: ${result.terminationReason}`);
}

main()
  .catch((error) => {
    console.error('Higher / Lower simulation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (error) {
      console.error('Failed to close Mongo client after Higher / Lower simulation', error);
    }
  });
