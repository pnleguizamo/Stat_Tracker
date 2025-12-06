const { getSharedTopSongs, getListenCountsForSong } = require("../../services/mongoServices");
const { getAccessToken } = require('../../services/authService.js');

function safeRoomLookup(getRoom, roomCode) {
  const room = getRoom(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}

async function pickPrompt(room, customPrompt) {
  if (customPrompt) return customPrompt;
  // const idx = Math.floor(Math.random() * SAMPLE_PROMPTS.length);

  const userIds = []
  room.players.forEach((player, socketId) => {
    if (player.userId && socketId !== room.hostSocketId) userIds.push(player.userId);
  });
  
  const accessToken = await getAccessToken(userIds[0]);
  const sharedTopSongs = await getSharedTopSongs(userIds, accessToken);

  const prompt = sharedTopSongs[0];
  console.log(prompt);

  return {
    ...prompt, 
    type: "TRACK", 
    description: `Who listened to ${prompt._id.track_name} most?`, 
    track_name: prompt._id.track_name, 
    artist: prompt._id.artist_name 
  };
}

async function createRoundState(room, params = {}) {
  const idx =
    typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
      ? room.currentStageIndex
      : 0;
  room.roundState = room.roundState || {};

  const roundState = {
    id: params.roundId || `wlm-${Date.now()}`,
    prompt: await pickPrompt(room, params.prompt),
    answers: {},
    status: 'collecting',
    startedAt: Date.now(),
  };

  room.roundState[idx] = roundState;
  return roundState;
}

function computeResults(roundState, room, listenCounts) {
  if (!roundState || !roundState.answers) {
    return { 
      tally: {}, 
      totalVotes: 0, 
      correctSocketId: null,
      listenCounts: {},
      winners: []
    };
  }

  let correctSocketId = null;
  let maxListens = 0;
  const socketIdToUserId = {};
  
  room.players.forEach((player, socketId) => {
    if (player.userId) {
      socketIdToUserId[socketId] = player.userId;
      const count = listenCounts[player.userId] || 0;
      if (count > maxListens) {
        maxListens = count;
        correctSocketId = socketId;
      }
    }
  });

  const tally = {};
  for (const submission of Object.values(roundState.answers)) {
    const target = submission?.answer?.targetSocketId;
    if (!target) continue;
    tally[target] = (tally[target] || 0) + 1;
  }

  const winners = [];
  for (const [voterSocketId, submission] of Object.entries(roundState.answers)) {
    if (submission?.answer?.targetSocketId === correctSocketId) {
      winners.push(voterSocketId);
    }
  }

  const totalVotes = Object.values(tally).reduce((sum, count) => sum + count, 0);

  return {
    tally, 
    totalVotes, 
    topListenerSocketId : correctSocketId,
    listenCounts,
    winners
  };
}

// function computeResults(roundState) {
//   if (!roundState || !roundState.answers) return { tally: {}, totalVotes: 0, topListenerSocketId: null };
//   const tally = {};
//   for (const submission of Object.values(roundState.answers)) {
//     const target = submission?.answer?.targetSocketId;
//     if (!target) continue;
//     tally[target] = (tally[target] || 0) + 1;
//   }
//   let topListenerSocketId = null;
//   let maxVotes = 0;
//   for (const [socketId, votes] of Object.entries(tally)) {
//     if (votes > maxVotes) {
//       maxVotes = votes;
//       topListenerSocketId = socketId;
//     }
//   }
//   const totalVotes = Object.values(tally).reduce((sum, count) => sum + count, 0);
//   return { tally, totalVotes, topListenerSocketId };
// }

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

      const userIds = []
      room.players.forEach((player, socketId) => {
        if (player.userId && socketId !== room.hostSocketId) userIds.push(player.userId);
      });

      const listenCounts = await getListenCountsForSong(userIds, round.prompt.track_name, round.prompt.artist);
      console.log(listenCounts);

      const results = computeResults(round, room, listenCounts);
      if (round) {
        round.results = results;
        round.status = 'revealed';
        round.revealedAt = Date.now();
      }

      io.to(roomCode).emit('minigame:WHO_LISTENED_MOST:revealResults', { results });
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
