const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRoom(roomCode) {
  return rooms.get(roomCode);
}

function serializePlayers(room) {
  return Array.from(room.players.entries()).map(([socketId, p]) => ({
    socketId,
    ...p,
    isHost: socketId === room.hostSocketId,
  }));
}

function removePlayerFromRoundState(room, socketId) {
  if (!room.roundState) return;
  for (const state of Object.values(room.roundState)) {
    if (state && state.answers && state.answers[socketId]) {
      delete state.answers[socketId];
    }
  }
}

function createRoom(hostSocketId, profile = {}, displayName, userId) {
  let roomCode = generateRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  const chosenName = displayName || profile.displayName || 'Anonymous';

  const room = {
    players: new Map(),
    createdAt: new Date(),
    hostSocketId,
    phase: 'lobby',
    roundState: {},
    stagePlan: [
      { index: 0, minigameId: 'WHO_LISTENED_MOST' },
      { index: 1, minigameId: 'GENRE_GUESS' },
      { index: 2, minigameId: 'OUTLIER_MODE' },
    ],
  };

  room.players.set(hostSocketId, {
    name: chosenName,
    userId,
    displayName: profile.displayName || chosenName,
    avatar: profile.avatar || null,
  });

  rooms.set(roomCode, room);
  return { roomCode, room };
}

function addPlayer(roomCode, socketId, profile = {}, displayName, userId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const chosenName = displayName || profile.displayName || 'Anonymous';
  room.players.set(socketId, {
    name: chosenName,
    userId,
    displayName: profile.displayName || chosenName,
    avatar: profile.avatar || null,
  });

  return room;
}

function updateStagePlan(roomCode, stagePlan) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  if (!Array.isArray(stagePlan) || stagePlan.length !== 3) return null;

  room.stagePlan = stagePlan;
  room.phase = 'stageConfig';
  return room;
}

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  if (!room.stagePlan || room.stagePlan.length !== 3) return null;

  room.phase = 'inGame';
  room.currentStageIndex = 0;
  room.roundState = {};

  return room;
}

function removePlayer(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.players.delete(socketId);
  removePlayerFromRoundState(room, socketId);

  if (socketId === room.hostSocketId) {
    if (room.players.size === 0) {
      rooms.delete(roomCode);
      return null;
    }
    const first = room.players.keys().next().value;
    room.hostSocketId = first;
  }

  if (room.players.size === 0) {
    rooms.delete(roomCode);
    return null;
  }

  return room;
}

function removePlayerFromAll(socketId) {
  const updatedPayloads = [];
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.delete(socketId)) {
      removePlayerFromRoundState(room, socketId);

      if (socketId === room.hostSocketId) {
        if (room.players.size === 0) {
          rooms.delete(roomCode);
          continue;
        }
        const first = room.players.keys().next().value;
        room.hostSocketId = first;
      }

      if (room.players.size === 0) {
        rooms.delete(roomCode);
        continue;
      }

      updatedPayloads.push({ roomCode, room });
    }
  }
  return updatedPayloads;
}

function getRoomPayload(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  return {
    roomCode,
    hostSocketId: room.hostSocketId,
    players: serializePlayers(room),
  };
}

function getGameState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const currentStageIndex = typeof room.currentStageIndex === 'number' ? room.currentStageIndex : null;
  const currentStageConfig =
    currentStageIndex !== null && room.stagePlan
      ? room.stagePlan[currentStageIndex] || null
      : null;
  const currentRoundState =
    currentStageIndex !== null && room.roundState
      ? room.roundState[currentStageIndex] || null
      : null;

  return {
    roomCode,
    phase: room.phase,
    hostSocketId: room.hostSocketId,
    players: serializePlayers(room),
    stagePlan: room.stagePlan || [],
    currentStageIndex,
    currentStageConfig,
    currentRoundState: currentRoundState
      ? {
          ...currentRoundState,
          answers: { ...(currentRoundState.answers || {}) },
          results: currentRoundState.results
            ? {
                ...currentRoundState.results,
                tally: { ...(currentRoundState.results.tally || {}) },
              }
            : undefined,
        }
      : null,
  };
}

function updatePlayerProfile(socketId, profile) {
  const affectedRooms = [];
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.has(socketId)) {
      const p = room.players.get(socketId);
      if (p) {
        p.displayName = profile.displayName || p.name;
        p.avatar = profile.avatar || null;
      }
      affectedRooms.push(roomCode);
    }
  }
  return affectedRooms;
}

module.exports = {
  rooms,
  getRoom,
  createRoom,
  addPlayer,
  updateStagePlan,
  startGame,
  removePlayer,
  removePlayerFromAll,
  getRoomPayload,
  getGameState,
  updatePlayerProfile,
};
