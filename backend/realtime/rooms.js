const rooms = new Map();

const DEFAULT_DISCONNECT_GRACE_MS = 300_000;

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

function ensureSocketMap(room) {
  room.socketToPlayerId = room.socketToPlayerId || new Map();
  return room.socketToPlayerId;
}

function ensurePlayerGraceTimers(room) {
  room.playerGraceTimers = room.playerGraceTimers || new Map();
  return room.playerGraceTimers;
}

function clearPlayerGraceTimer(room, playerId) {
  const timers = ensurePlayerGraceTimers(room);
  const timer = timers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(playerId);
  }
}

function clearHostGraceTimer(room) {
  if (room.hostGraceTimer) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
  }
}

function cleanupRoomTimers(room) {
  if (!room) return;
  clearHostGraceTimer(room);
  for (const timer of ensurePlayerGraceTimers(room).values()) {
    clearTimeout(timer);
  }
  room.playerGraceTimers?.clear?.();
}

function registerSocketForPlayer(room, socketId, playerId) {
  if (!socketId || !playerId) return;
  const socketMap = ensureSocketMap(room);

  const priorPlayerId = socketMap.get(socketId);
  if (priorPlayerId && priorPlayerId !== playerId) {
    const priorPlayer = room.players.get(priorPlayerId);
    if (priorPlayer && priorPlayer.socketId === socketId) {
      priorPlayer.socketId = null;
      priorPlayer.connected = false;
      priorPlayer.disconnectedAt = Date.now();
    }
  }

  socketMap.set(socketId, playerId);
}

function findPlayerIdBySocket(room, socketId) {
  const socketMap = ensureSocketMap(room);
  if (socketMap.has(socketId)) return socketMap.get(socketId);

  for (const [playerId, player] of room.players.entries()) {
    if (player?.socketId === socketId) return playerId;
  }

  return null;
}

function serializePlayers(room) {
  return Array.from(room.players.entries()).map(([playerId, p]) => ({
    playerId,
    name: p.name,
    userId: p.userId || null,
    displayName: p.displayName || p.name || 'Anonymous',
    avatar: p.avatar || null,
    connected: !!p.connected,
    isHost: playerId === room.hostPlayerId,
  }));
}

function removePlayerFromRoundState(room, playerId) {
  if (!room.roundState) return;
  for (const state of Object.values(room.roundState)) {
    if (state && state.answers && state.answers[playerId]) {
      delete state.answers[playerId];
    }
  }
}

function assignNextHost(room) {
  if (!room) return;
  const nextHostPlayerId = room.players.keys().next().value || null;
  room.hostPlayerId = nextHostPlayerId;

  if (!nextHostPlayerId) {
    room.hostSocketId = null;
    room.hostConnected = false;
    room.hostDisconnectedAt = Date.now();
    return;
  }

  const nextHost = room.players.get(nextHostPlayerId);
  room.hostSocketId = nextHost?.socketId || null;
  room.hostConnected = !!nextHost?.connected;
  room.hostDisconnectedAt = nextHost?.disconnectedAt || null;
}

function maybeDeleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return true;

  const hasHost = !!room.hostPlayerId;
  const hostConnected = !!room.hostConnected;

  if (!hasHost && room.players.size === 0) {
    cleanupRoomTimers(room);
    rooms.delete(roomCode);
    return true;
  }

  if (!hostConnected && room.players.size === 0) {
    cleanupRoomTimers(room);
    rooms.delete(roomCode);
    return true;
  }

  return false;
}

function createRoom(hostSocketId, hostPlayerId, profile = {}, displayName, userId) {
  let roomCode = generateRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  const chosenName = displayName || profile.displayName || 'Anonymous';

  const room = {
    players: new Map(),
    socketToPlayerId: new Map(),
    playerGraceTimers: new Map(),
    hostGraceTimer: null,
    createdAt: new Date(),
    hostSocketId,
    hostPlayerId,
    hostConnected: true,
    hostDisconnectedAt: null,
    hostName: chosenName,
    hostUserId: userId || null,
    phase: 'lobby',
    scoreboard: {},
    roundState: {},
    stagePlan: [
      { index: 0, minigameId: 'WHO_LISTENED_MOST' },
      { index: 1, minigameId: 'GUESS_SPOTIFY_WRAPPED' },
      { index: 2, minigameId: 'HEARDLE' },
    ],
  };

  rooms.set(roomCode, room);
  return { roomCode, room };
}

function addPlayer(roomCode, playerId, socketId, profile = {}, displayName, userId) {
  if (!playerId) return null;

  const room = rooms.get(roomCode);
  if (!room) return null;

  clearPlayerGraceTimer(room, playerId);

  const existing = room.players.get(playerId);
  const chosenName =
    displayName ||
    profile.displayName ||
    existing?.displayName ||
    existing?.name ||
    'Anonymous';

  room.players.set(playerId, {
    name: chosenName,
    userId: typeof userId === 'string' ? userId : existing?.userId || null,
    displayName: profile.displayName || displayName || existing?.displayName || chosenName,
    avatar:
      typeof profile.avatar === 'string'
        ? profile.avatar || null
        : (existing?.avatar || null),
    socketId,
    connected: true,
    disconnectedAt: null,
  });

  registerSocketForPlayer(room, socketId, playerId);

  if (room.hostPlayerId === playerId) {
    clearHostGraceTimer(room);
    room.hostSocketId = socketId;
    room.hostConnected = true;
    room.hostDisconnectedAt = null;
  }

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
  room.scoreboard = {};
  room.roundTimers = {};

  return room;
}

function removePlayer(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  clearPlayerGraceTimer(room, playerId);

  const player = room.players.get(playerId);
  if (player?.socketId) {
    ensureSocketMap(room).delete(player.socketId);
  }

  room.players.delete(playerId);
  removePlayerFromRoundState(room, playerId);

  if (playerId === room.hostPlayerId) {
    assignNextHost(room);
  }

  if (maybeDeleteRoom(roomCode)) return null;

  return room;
}

function schedulePlayerFinalRemoval(roomCode, playerId, graceMs, onRoomChanged) {
  const room = rooms.get(roomCode);
  if (!room) return;

  clearPlayerGraceTimer(room, playerId);

  const timers = ensurePlayerGraceTimers(room);
  const timer = setTimeout(() => {
    const currentRoom = rooms.get(roomCode);
    if (!currentRoom) return;

    const currentPlayer = currentRoom.players.get(playerId);
    if (!currentPlayer || currentPlayer.connected) return;

    removePlayer(roomCode, playerId);
    onRoomChanged?.(roomCode);
  }, graceMs);

  timers.set(playerId, timer);
}

function scheduleHostFinalHandling(roomCode, expectedHostPlayerId, graceMs, onRoomChanged) {
  const room = rooms.get(roomCode);
  if (!room) return;

  clearHostGraceTimer(room);

  room.hostGraceTimer = setTimeout(() => {
    const currentRoom = rooms.get(roomCode);
    if (!currentRoom) return;

    if (currentRoom.hostPlayerId !== expectedHostPlayerId) return;
    if (currentRoom.hostConnected) return;

    assignNextHost(currentRoom);
    if (maybeDeleteRoom(roomCode)) {
      onRoomChanged?.(roomCode);
      return;
    }

    onRoomChanged?.(roomCode);
  }, graceMs);
}

function removePlayerFromAll(socketId, opts = {}) {
  const updatedPayloads = [];
  const graceMs = Number(opts.graceMs) > 0 ? Number(opts.graceMs) : DEFAULT_DISCONNECT_GRACE_MS;
  const onRoomChanged = typeof opts.onRoomChanged === 'function' ? opts.onRoomChanged : null;

  for (const [roomCode, room] of rooms.entries()) {
    let touched = false;

    const playerId = findPlayerIdBySocket(room, socketId);
    if (playerId) {
      const player = room.players.get(playerId);
      if (player) {
        player.socketId = null;
        player.connected = false;
        player.disconnectedAt = Date.now();
        ensureSocketMap(room).delete(socketId);
        schedulePlayerFinalRemoval(roomCode, playerId, graceMs, onRoomChanged);
        touched = true;
      }
    }

    if (room.hostSocketId === socketId) {
      room.hostSocketId = null;
      room.hostConnected = false;
      room.hostDisconnectedAt = Date.now();
      scheduleHostFinalHandling(roomCode, room.hostPlayerId, graceMs, onRoomChanged);
      touched = true;
    }

    if (touched) {
      updatedPayloads.push({ roomCode, room });
    }
  }
  
  return updatedPayloads;
}

function reconnectPlayerToRooms(playerId, socketId) {
  if (!playerId || !socketId) return [];

  const updatedRoomCodes = [];
  for (const [roomCode, room] of rooms.entries()) {
    let touched = false;

    if (room.hostPlayerId === playerId) {
      clearHostGraceTimer(room);
      room.hostSocketId = socketId;
      room.hostConnected = true;
      room.hostDisconnectedAt = null;
      touched = true;
    }

    const player = room.players.get(playerId);
    if (player) {
      clearPlayerGraceTimer(room, playerId);
      player.socketId = socketId;
      player.connected = true;
      player.disconnectedAt = null;
      touched = true;
    }

    if (touched) {
      registerSocketForPlayer(room, socketId, playerId);
      updatedRoomCodes.push(roomCode);
    }
  }

  return updatedRoomCodes;
}

function isPlayerInRoom(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room || !playerId) return false;
  if (room.hostPlayerId === playerId) return true;
  return room.players.has(playerId);
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
      ? (() => {
          const clone = {
            ...currentRoundState,
            answers: { ...(currentRoundState.answers || {}) },
            results: (() => {
              if (!currentRoundState.results) return undefined;
              const resClone = { ...currentRoundState.results };
              if (currentRoundState.results.tally) {
                resClone.tally = { ...currentRoundState.results.tally };
              }
              if (currentRoundState.results.votes) {
                resClone.votes = { ...currentRoundState.results.votes };
              }
              if (currentRoundState.results.listenCounts) {
                resClone.listenCounts = { ...currentRoundState.results.listenCounts };
              }
              if (currentRoundState.results.guessSummary) {
                resClone.guessSummary = { ...currentRoundState.results.guessSummary };
              }
              return resClone;
            })(),
          };
          if (clone.status !== 'revealed') {
            if (clone.ownerPlayerId) clone.ownerPlayerId = null;
            if (clone.ownerProfile) clone.ownerProfile = null;
            if (clone.results) {
              if (clone.results.ownerPlayerId) clone.results.ownerPlayerId = null;
              if (clone.results.ownerProfile) clone.results.ownerProfile = null;
            }
          }
          return clone;
        })()
      : null,
    scoreboard: (() => {
      const board = room.scoreboard || {};
      const clone = {};

      for (const playerId of room.players.keys()) {
        const entry = board[playerId] || null;
        clone[playerId] = {
          points: entry?.points || 0,
          stats: { ...(entry?.stats || {}) },
          awards: Array.isArray(entry?.awards) ? [...entry.awards] : [],
        };
      }

      for (const [playerId, entry] of Object.entries(board)) {
        if (clone[playerId]) continue;
        clone[playerId] = {
          points: entry?.points || 0,
          stats: { ...(entry?.stats || {}) },
          awards: Array.isArray(entry?.awards) ? [...entry.awards] : [],
        };
      }
      return clone;
    })(),
  };
}

function updatePlayerProfile(playerId, profile) {
  const affectedRooms = [];
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.has(playerId)) {
      const p = room.players.get(playerId);
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
  reconnectPlayerToRooms,
  isPlayerInRoom,
  getRoomPayload,
  getGameState,
  updatePlayerProfile,
};
