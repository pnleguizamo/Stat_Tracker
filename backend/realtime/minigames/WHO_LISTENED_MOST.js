const { getSharedTopSongs } = require("../../services/mongoServices");
const { getAccessToken } = require('../../services/authService.js');

function safeRoomLookup(getRoom, roomCode) {
  const room = getRoom(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}

async function buildPromptPool(room) {
  if (room.promptPool?.length) return room.promptPool;

  const userIds = [];
  room.players.forEach((player, socketId) => {
    if (player.userId && socketId !== room.hostSocketId) userIds.push(player.userId);
  });

  const accessToken = await getAccessToken(userIds[0]);
  const sharedTopSongs = await getSharedTopSongs(userIds, accessToken);
  const prompts = (sharedTopSongs || []).map(song => {
    const listenCounts = {};
    (song.users || []).forEach(entry => {
      if (!entry?.userId) return;
      listenCounts[entry.userId] = entry.plays || 0;
    });
    return {
      ...song,
      type: 'TRACK',
      description: `Who listened to ${song.track_name} most?`,
      listenCounts,
    };
  });

  room.promptPool = prompts;
  return prompts;
}

async function pickPrompt(room, customPrompt) {
  if (customPrompt) return customPrompt;

  const pool = await buildPromptPool(room);
  if (!pool.length) {
    throw new Error('NO_PROMPTS_AVAILABLE');
  }

  const winnersUsed = room.winnersUsed || new Set();
  const tracksSeen = room.tracksSeen || new Set();
  if (winnersUsed.size >= pool.length) {
    winnersUsed.clear();
  }

  const total = pool.length;
  room.promptPointer = typeof room.promptPointer === 'number' ? room.promptPointer : 0;
  let attempts = 0;
  let selected = null;

  while (attempts < total && !selected) {
    const promptIdx = room.promptPointer % total;
    const prompt = pool[promptIdx];
    room.promptPointer = promptIdx + 1;

    if (tracksSeen.has(prompt.id)) {
      attempts += 1;
      continue;
    }

    if (prompt.topUserId && !winnersUsed.has(prompt.topUserId)) {
      selected = prompt;
      winnersUsed.add(prompt.topUserId);
      tracksSeen.add(prompt.id);
      break;
    }

    attempts += 1;
  }

  if (!selected) {
    winnersUsed.clear();
    let fallbackAttempts = 0;
    while (fallbackAttempts < total && !selected) {
      const promptIdx = room.promptPointer % total;
      const prompt = pool[promptIdx];
      room.promptPointer = promptIdx + 1;
      if (tracksSeen.has(prompt.id)) {
        fallbackAttempts += 1;
        continue;
      }
      selected = prompt;
      if (selected?.topUserId) winnersUsed.add(selected.topUserId);
      if (selected?.id) tracksSeen.add(selected.id);
    }
  }

  room.winnersUsed = winnersUsed;
  room.tracksSeen = tracksSeen;
  room.promptPointer = room.promptPointer ?? 0;
  return selected;
}

async function createRoundState(room, params = {}) {
  const idx =
    typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
      ? room.currentStageIndex
      : 0;
  room.roundState = room.roundState || {};

  const roundState = {
    id: params.roundId || `wlm-${Date.now()}`,
    minigameId: 'WHO_LISTENED_MOST',
    prompt: await pickPrompt(room, params.prompt),
    answers: {},
    status: 'collecting',
    startedAt: Date.now(),
  };

  room.roundState[idx] = roundState;
  return roundState;
}

function computeResults(roundState, room) {
  if (!roundState || !roundState.answers) {
    return { 
      tally: {}, 
      totalVotes: 0, 
      correctSocketId: null,
      listenCounts: {},
      winners: []
    };
  }

  let maxListens = 0;
  const listenCounts = roundState?.prompt?.listenCounts || {};
  
  room.players.forEach((player, socketId) => {
    if (player.userId) {
      const count = listenCounts[player.userId] || 0;
      if (count > maxListens) {
        maxListens = count;
      }
    }
  });

  const correctSocketsSet = new Set();

  room.players.forEach((player, socketId) => {
      if(player.userId && (listenCounts[player.userId] || 0) == maxListens)
        correctSocketsSet.add(socketId);
  });

  const tally = {};
  for (const submission of Object.values(roundState.answers)) {
    const target = submission?.answer?.targetSocketId;
    if (!target) continue;
    tally[target] = (tally[target] || 0) + 1;
  }

  const winners = [];
  for (const [voterSocketId, submission] of Object.entries(roundState.answers)) {
    if (correctSocketsSet.has(submission?.answer?.targetSocketId)) {
      winners.push(voterSocketId);
    }
  }

  const totalVotes = Object.values(tally).reduce((sum, count) => sum + count, 0);

  return {
    tally, 
    totalVotes, 
    topListenerSocketIds: Array.from(correctSocketsSet),
    listenCounts,
    winners
  };
}

function registerWHO_LISTENED_MOST(io, socket, deps = {}) {
  const { getRoom, broadcastGameState } = deps;
  const logger = deps.logger || console;

  socket.on('minigame:WHO_LISTENED_MOST:startRound', async ({ roomCode, params } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id) {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }

      const roundState = await createRoundState(room, params);

      // io.to(roomCode).emit('minigame:WHO_LISTENED_MOST:roundStarted', { roundState });
      broadcastGameState?.(roomCode);
      cb?.({ ok: true, roundState });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('WHO_LISTENED_MOST startRound error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:WHO_LISTENED_MOST:submitAnswer', ({ roomCode, answer } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = room.currentStageIndex || 0;
      room.roundState = room.roundState || {};
      room.roundState[idx] = room.roundState[idx] || { answers: {} };
      room.roundState[idx].answers[socket.id] = {
        answer,
        at: Date.now(),
      };
      broadcastGameState?.(roomCode);

      // io.to(roomCode).emit('minigame:WHO_LISTENED_MOST:answerReceived', { socketId: socket.id });
      cb?.({ ok: true });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('WHO_LISTENED_MOST submitAnswer error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:WHO_LISTENED_MOST:reveal', async ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'NOT_HOST' });

      const idx = room.currentStageIndex || 0;
      const round = room.roundState?.[idx];

      const results = computeResults(round, room);
      if (round) {
        round.results = results;
        round.status = 'revealed';
        round.revealedAt = Date.now();
      }
      console.log(results);

      // io.to(roomCode).emit('minigame:WHO_LISTENED_MOST:revealResults', { results });
      broadcastGameState?.(roomCode);
      cb?.({ ok: true, results });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('WHO_LISTENED_MOST reveal error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });
}

module.exports = {
  register: registerWHO_LISTENED_MOST,
  createRoundState,
};
