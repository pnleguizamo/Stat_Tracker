const {
  buildHigherLowerStageState,
  pickChallenger,
  helpers: {
    appendRecentPromptTraitValues,
    getHigherLowerAnchor,
    getHigherLowerAnchorHoldCount,
    getRecentOwnerKey,
    resolveHigherLowerMode,
    resolveHigherLowerNextAnchorState,
    syncHigherLowerAnchorState,
  },
} = require('../../services/higherLowerService');
const { appendRoundHistory, updateStreaks } = require('../scoring');

const ROUND_DURATION_MS = 20_000;

function safeRoomLookup(getRoom, roomCode) {
  const room = getRoom(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}

function getStageIndex(room) {
  return typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
    ? room.currentStageIndex
    : 0;
}

function getStageConfig(room, stageIndex) {
  return room?.stagePlan?.[stageIndex] || null;
}

function resolveMetric(room, stageIndex, params = {}) {
  const stageConfig = getStageConfig(room, stageIndex);
  return (
    params?.metric ||
    stageConfig?.metric ||
    stageConfig?.options?.metric ||
    'plays'
  );
}

function resolveStageOptions(room, stageIndex, params = {}) {
  const stageConfig = getStageConfig(room, stageIndex);
  return {
    ...(stageConfig?.options || {}),
    ...(params?.options || {}),
  };
}

// ??
function ensureStageStateBucket(room) {
  room.higherLowerStages = room.higherLowerStages || {};
  return room.higherLowerStages;
}

function cloneDatapoint(datapoint) {
  if (!datapoint) return null;
  return {
    ...datapoint,
    contributorPlayerIds: datapoint.contributorPlayerIds ? [...datapoint.contributorPlayerIds] : null,
  };
}

function createRoundState(stageState, anchor, candidate, overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || `higher-lower-${now}`,
    minigameId: 'HIGHER_LOWER',
    status: overrides.status || 'collecting',
    metric: stageState.metric || anchor?.metric || candidate?.metric || 'plays',
    roundNumber: stageState.roundNumber || 0,
    maxRounds: stageState.maxRounds || 0,
    left: cloneDatapoint(anchor),
    right: cloneDatapoint(candidate || anchor),
    answers: {},
    startedAt: overrides.startedAt || now,
    expiresAt: overrides.expiresAt || now,
    revealedAt: overrides.revealedAt,
    stageComplete: !!overrides.stageComplete,
    results: overrides.results,
  };
}

function getConnectedPlayerIds(room) {
  return Array.from(room.players.entries())
    .filter(([, player]) => player?.connected !== false)
    .map(([playerId]) => playerId);
}

function computeResults(round) {
  const leftValue = Number(round?.left?.value) || 0;
  const rightValue = Number(round?.right?.value) || 0;
  const leftDisplayValue = Number(round?.left?.displayValue) || 0;
  const rightDisplayValue = Number(round?.right?.displayValue) || 0;
  const tally = { LEFT: 0, RIGHT: 0 };

  for (const submission of Object.values(round?.answers || {})) {
    const choice = submission?.answer?.choice;
    if (choice === 'LEFT' || choice === 'RIGHT') {
      tally[choice] += 1;
    }
  }

  let winnerSide = 'TIE';
  if (leftValue > rightValue) winnerSide = 'LEFT';
  if (rightValue > leftValue) winnerSide = 'RIGHT';

  const winners = [];
  for (const [playerId, submission] of Object.entries(round?.answers || {})) {
    const choice = submission?.answer?.choice;
    if (!choice) continue;
    if (winnerSide === 'TIE' || choice === winnerSide) {
      winners.push(playerId);
    }
  }

  return {
    leftValue,
    rightValue,
    leftDisplayValue,
    rightDisplayValue,
    winnerSide,
    winners,
    tally,
    totalVotes: tally.LEFT + tally.RIGHT,
  };
}

function rememberSeenOwners(stageState, datapoints = []) {
  if (!stageState) return;
  const seenOwners = Array.isArray(stageState.ownersSeenThisCycle)
    ? [...stageState.ownersSeenThisCycle]
    : [];

  for (const datapoint of datapoints) {
    const ownerId = getRecentOwnerKey(datapoint);
    if (!ownerId) continue;
    if (!seenOwners.includes(ownerId)) seenOwners.push(ownerId);
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

function resetSeenOwnersIfExhausted(stageState, anchor) {
  if (!stageState?.pool?.length || !anchor?.id) return;

  const usedSet = new Set(Array.isArray(stageState.usedDatapointIds) ? stageState.usedDatapointIds : []);
  const availableOwnerKeys = new Set(
    stageState.pool
      .filter((entry) => entry?.id && entry.id !== anchor.id && !usedSet.has(entry.id))
      .map((entry) => getRecentOwnerKey(entry))
      .filter(Boolean)
  );

  if (!availableOwnerKeys.size) return;

  const seenOwnerSet = new Set((stageState.ownersSeenThisCycle || []).filter(Boolean));
  const hasUnseenOwner = Array.from(availableOwnerKeys).some((ownerKey) => !seenOwnerSet.has(ownerKey));
  if (hasUnseenOwner) return;

  const anchorOwnerKey = getRecentOwnerKey(anchor);
  stageState.ownersSeenThisCycle = anchorOwnerKey ? [anchorOwnerKey] : [];
}

function canAdvanceStage(room, socket) {
  return room?.hostPlayerId && socket?.playerId && room.hostPlayerId === socket.playerId;
}

function registerHIGHER_LOWER(io, socket, deps = {}) {
  const {
    getRoom,
    broadcastGameState,
    applyAwards,
    computeTimeScore,
    scheduleRoundTimer,
    clearRoundTimer,
  } = deps;
  const logger = deps.logger || console;

  const reveal = (room, idx, roomCode, cb) => {
    const round = room.roundState?.[idx];
    const stageState = ensureStageStateBucket(room)[idx];
    if (!round || round.minigameId !== 'HIGHER_LOWER') {
      return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
    }
    if (!stageState) {
      return cb?.({ ok: false, error: 'STAGE_NOT_READY' });
    }
    if (round.status === 'revealed') {
      return cb?.({ ok: true, results: round.results, roundState: round });
    }

    round.results = computeResults(round);
    round.status = 'revealed';
    round.revealedAt = Date.now();
    clearRoundTimer?.(room, idx);

    if (applyAwards && round.results.winners.length) {
      const awards = round.results.winners.map((playerId) => ({
        socketId: playerId,
        points: computeTimeScore(round, playerId),
        reason: 'correct',
        meta: {
          minigameId: 'HIGHER_LOWER',
          roundId: round.id,
          stageIndex: idx,
        },
      }));
      applyAwards(room, awards);
    }

    const bonuses = updateStreaks(
      room,
      idx,
      round.id,
      round.results.winners,
      'HIGHER_LOWER'
    );
    if (bonuses.length && applyAwards) {
      applyAwards(room, bonuses);
    }

    syncHigherLowerAnchorState(stageState, resolveHigherLowerNextAnchorState(stageState, round));
    rememberSeenOwners(stageState, [round.left, round.right]);
    rememberRecentPromptTraits(stageState, [round.left, round.right]);

    
    console.log(stageState.ownersSeenThisCycle);
    console.log(stageState.recentEntityTypes);
    console.log(stageState.recentScopes);

    const nextAnchor =
      getHigherLowerAnchor(stageState) || round.right || round.left;
    resetSeenOwnersIfExhausted(stageState, nextAnchor);
    const mode = resolveHigherLowerMode(stageState);
    const hasNextChallenger = !!pickChallenger({
      pool: stageState.pool || [],
      anchor: nextAnchor,
      usedIds: stageState.usedDatapointIds || [],
      ownersSeenThisCycle: stageState.ownersSeenThisCycle || [],
      recentEntityTypes: stageState.recentEntityTypes || [],
      recentScopes: stageState.recentScopes || [],
      mode,
      anchorHoldCount: getHigherLowerAnchorHoldCount(stageState),
      logSelection: false,
    });
    if (stageState.roundNumber >= stageState.maxRounds || !hasNextChallenger) {
      round.stageComplete = true;
    }

    appendRoundHistory(room, idx, {
      id: round.id,
      minigameId: 'HIGHER_LOWER',
      metric: round.metric,
      roundNumber: round.roundNumber,
      startedAt: round.startedAt,
      revealedAt: round.revealedAt,
      stageComplete: !!round.stageComplete,
      left: cloneDatapoint(round.left),
      right: cloneDatapoint(round.right),
      answers: round.answers || {},
      results: round.results,
    });

    broadcastGameState?.(roomCode);
    cb?.({ ok: true, results: round.results, roundState: round });
    return { ok: true, results: round.results, roundState: round };
  };

  socket.on('minigame:HIGHER_LOWER:startRound', async ({ roomCode, params } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (!canAdvanceStage(room, socket)) {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }

      const idx = getStageIndex(room);
      const stageStates = ensureStageStateBucket(room);
      let stageState = stageStates[idx];

      if (!stageState) {
        const preloadPromise = room._hlPreloads?.get(idx);
        if (preloadPromise) {
          stageState = await preloadPromise;
          room._hlPreloads.delete(idx);
        }
        if (!stageState) {
          stageState = await buildHigherLowerStageState({
            room,
            metric: resolveMetric(room, idx, params),
            options: resolveStageOptions(room, idx, params),
          });
        }
        stageStates[idx] = stageState;
      }

      const anchor = getHigherLowerAnchor(stageState);
      if (!anchor) {
        return cb?.({ ok: false, error: 'NO_DATAPOINTS_AVAILABLE' });
      }

      resetSeenOwnersIfExhausted(stageState, anchor);
      const mode = resolveHigherLowerMode(stageState);
      const challenger = pickChallenger({
        pool: stageState.pool || [],
        anchor,
        usedIds: stageState.usedDatapointIds || [],
        ownersSeenThisCycle: stageState.ownersSeenThisCycle || [],
        recentEntityTypes: stageState.recentEntityTypes || [],
        recentScopes: stageState.recentScopes || [],
        mode,
        anchorHoldCount: getHigherLowerAnchorHoldCount(stageState),
      });

      room.roundState = room.roundState || {};

      if (!challenger) {
        clearRoundTimer?.(room, idx);
        room.roundState[idx] = createRoundState(stageState, anchor, null, {
          status: 'pending',
          stageComplete: true,
        });
        broadcastGameState?.(roomCode);
        cb?.({ ok: true, roundState: room.roundState[idx], stageComplete: true });
        return;
      }

      stageState.roundNumber += 1;
      stageState.usedDatapointIds = Array.isArray(stageState.usedDatapointIds)
        ? stageState.usedDatapointIds
        : [];
      stageState.usedDatapointIds.push(challenger.id);

      const roundState = createRoundState(stageState, anchor, challenger);
      room.roundState[idx] = roundState;
      roundState.expiresAt = scheduleRoundTimer?.(room, idx, ROUND_DURATION_MS, () => {
        try {
          reveal(room, idx, roomCode);
        } catch (err) {
          logger.error('HIGHER_LOWER auto reveal failed', err);
        }
      }) || roundState.expiresAt;

      broadcastGameState?.(roomCode);
      cb?.({ ok: true, roundState });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') {
        return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      }
      logger.error('HIGHER_LOWER startRound error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HIGHER_LOWER:submitAnswer', ({ roomCode, answer } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = getStageIndex(room);
      const round = room.roundState?.[idx];
      if (!round || round.minigameId !== 'HIGHER_LOWER') {
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      }
      if (round.status === 'revealed') {
        return cb?.({ ok: false, error: 'ROUND_REVEALED' });
      }

      const choice = answer?.choice;
      if (choice !== 'LEFT' && choice !== 'RIGHT') {
        return cb?.({ ok: false, error: 'CHOICE_REQUIRED' });
      }

      round.answers = round.answers || {};
      round.answers[socket.playerId] = {
        answer: { choice },
        at: Date.now(),
      };
      broadcastGameState?.(roomCode);

      const connectedPlayerIds = getConnectedPlayerIds(room);
      const answersCount = connectedPlayerIds.filter((playerId) => !!round.answers?.[playerId]).length;
      if (connectedPlayerIds.length > 0 && answersCount >= connectedPlayerIds.length) {
        reveal(room, idx, roomCode);
      }

      cb?.({ ok: true });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') {
        return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      }
      logger.error('HIGHER_LOWER submitAnswer error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HIGHER_LOWER:reveal', ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (!canAdvanceStage(room, socket)) {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }

      const idx = getStageIndex(room);
      reveal(room, idx, roomCode, cb);
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') {
        return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      }
      logger.error('HIGHER_LOWER reveal error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });
}

function preloadStages(room) {
  if (!room?.stagePlan) return;
  room._hlPreloads = room._hlPreloads || new Map();

  let chain = Promise.resolve();
  for (let idx = 0; idx < room.stagePlan.length; idx++) {
    const config = room.stagePlan[idx];
    if (config?.minigameId !== 'HIGHER_LOWER') continue;
    if (room.higherLowerStages?.[idx] || room._hlPreloads.has(idx)) continue;

    const metric = config?.metric || config?.options?.metric || 'plays';
    const options = config?.options || {};
    const stageIdx = idx;

    const promise = chain = chain.then(() =>
      buildHigherLowerStageState({ room, metric, options })
        .catch(err => {
          console.error(`[HIGHER_LOWER] preload failed for stage ${stageIdx}:`, err);
          return null;
        })
    );
    room._hlPreloads.set(stageIdx, promise);
  }
}

module.exports = {
  register: registerHIGHER_LOWER,
  preloadStages,
};
