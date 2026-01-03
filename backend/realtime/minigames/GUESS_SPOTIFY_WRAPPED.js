const { buildWrappedSummaryForUser } = require('../../services/wrappedInsights');

function safeRoom(getRoom, roomCode) {
  const room = getRoom(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}

function clonePlayerSnapshot(player = {}, socketId) {
  if (!player) return null;
  return {
    socketId,
    displayName: player.displayName || player.name || 'Player',
    avatar: player.avatar || null,
  };
}

async function pickWrappedSummary(room) {
  const players = Array.from(room.players.entries()).filter(([, player]) => player.userId);
  if (!players.length) return null;
  const shuffled = players.sort(() => Math.random() - 0.5);

  for (const [socketId, player] of shuffled) {
    try {
      const summary = await buildWrappedSummaryForUser(player.userId);
      if (summary) {
        return {
          ownerSocketId: socketId,
          ownerProfile: clonePlayerSnapshot(player, socketId),
          summary,
        };
      }
    } catch (err) {
      console.warn('Failed to build wrapped summary for', player.userId, err.message || err);
    }
  }
  return null;
}

function computeResults(round, room) {
  const tally = {};
  for (const submission of Object.values(round.answers || {})) {
    const target = submission?.answer?.targetSocketId;
    if (!target) continue;
    tally[target] = (tally[target] || 0) + 1;
  }
  const winners = Object.entries(round.answers || {})
    .filter(([, submission]) => submission?.answer?.targetSocketId === round.ownerSocketId)
    .map(([socketId]) => socketId);

  const ownerPlayer = room.players.get(round.ownerSocketId);

  return {
    votes: tally,
    ownerSocketId: round.ownerSocketId,
    ownerProfile: clonePlayerSnapshot(ownerPlayer, round.ownerSocketId),
    winners,
  };
}

module.exports.register = function registerGuessSpotifyWrapped(io, socket, deps = {}) {
  const { getRoom, broadcastGameState, applyAwards, computeTimeScore, scheduleRoundTimer, clearRoundTimer } = deps;
  const logger = deps.logger || console;
  const ROUND_DURATION_MS = 20000;

  const reveal = (room, roomCode, idx, cb) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'GUESS_SPOTIFY_WRAPPED') return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
    if (round.status === 'revealed') return cb?.({ ok: true, results: round.results });

    round.results = computeResults(round, room);
    round.status = 'revealed';
    round.revealedAt = Date.now();
    clearRoundTimer?.(room, idx);
    if (applyAwards && round.results?.winners?.length) {
      const awards = round.results.winners.map((socketId) => ({
        socketId,
        points: computeTimeScore(round, socketId),
        reason: 'correct',
        meta: {
          minigameId: 'GUESS_SPOTIFY_WRAPPED',
          roundId: round.id,
          stageIndex: idx,
        },
      }));
      applyAwards(room, awards);
    }
    broadcastGameState?.(roomCode);
    cb?.({ ok: true, results: round.results });
    return { ok: true, results: round.results };
  };

  socket.on('minigame:GUESS_SPOTIFY_WRAPPED:startRound', async ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoom(getRoom, roomCode);
      if (room.hostSocketId !== socket.id) {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }

      const prepared = await pickWrappedSummary(room);
      if (!prepared) {
        return cb?.({ ok: false, error: 'NO_ELIGIBLE_DATA' });
      }

      const idx =
        typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
          ? room.currentStageIndex
          : 0;
      room.roundState = room.roundState || {};
      room.roundState[idx] = {
        id: `guess-wrapped-${Date.now()}`,
        minigameId: 'GUESS_SPOTIFY_WRAPPED',
        status: 'collecting',
        prompt: prepared.summary,
        ownerSocketId: prepared.ownerSocketId,
        ownerProfile: prepared.ownerProfile,
        answers: {},
        startedAt: Date.now(),
      };
      room.roundState[idx].expiresAt = scheduleRoundTimer(room, idx, ROUND_DURATION_MS, () => {
        try {
          reveal(room, roomCode, idx);
        } catch (err) {
          logger.error('GUESS_SPOTIFY_WRAPPED auto reveal failed', err);
        }
      });

      broadcastGameState?.(roomCode);
      cb?.({ ok: true });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('GUESS_SPOTIFY_WRAPPED startRound error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:GUESS_SPOTIFY_WRAPPED:submitAnswer', ({ roomCode, answer } = {}, cb) => {
    try {
      const room = safeRoom(getRoom, roomCode);
      const idx =
        typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
          ? room.currentStageIndex
          : 0;
      room.roundState = room.roundState || {};
      const round = room.roundState[idx];
      if (!round || round.minigameId !== 'GUESS_SPOTIFY_WRAPPED') {
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      }

      round.answers = round.answers || {};
      if (round.status === 'revealed') return cb?.({ ok: false, error: 'ROUND_REVEALED' });
      round.answers[socket.id] = { answer, at: Date.now() };
      broadcastGameState?.(roomCode);

      const totalPlayers = room.players.size;
      const answersCount = Object.keys(round.answers || {}).length;
      if (totalPlayers > 0 && answersCount >= totalPlayers) {
        reveal(room, roomCode, idx);
      }
      cb?.({ ok: true });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('GUESS_SPOTIFY_WRAPPED submitAnswer error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:GUESS_SPOTIFY_WRAPPED:reveal', ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoom(getRoom, roomCode);
      if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'NOT_HOST' });
      const idx =
        typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
          ? room.currentStageIndex
          : 0;
      const result = reveal(room, roomCode, idx, cb);
      if (!cb && result?.ok) {
        broadcastGameState?.(roomCode);
      }
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('GUESS_SPOTIFY_WRAPPED reveal error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });
};
