const roomsModule = require('./rooms');
const {
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
  updatePlayerProfile,
  getGameState,
} = roomsModule;
const { applyAwards, computeTimeScore } = require('./scoring');
const { scheduleRoundTimer, clearRoundTimer } = require('./timers');
const minigameRegistry = require('./minigames');
const { registerStagePlanListeners } = require('./stagePlanSockets');

const DISCONNECT_GRACE_MS = 300_000;

function initGameSockets(io) {
  const broadcastGameState = (roomCode) => {
    const state = getGameState(roomCode);
    if (!state) return null;
    io.to(roomCode).emit('gameStateUpdated', state);
    return state;
  };

  const emitRoomUpdate = (roomCode) => {
    const payload = getRoomPayload(roomCode);
    if (payload) io.to(roomCode).emit('roomUpdated', payload);
    return payload;
  };

  io.on('connection', (socket) => {
    console.log(
      'Client connected',
      socket.id,
      'playerId:',
      socket.playerId,
      'accountId:',
      socket.accountId
    );

    socket.emit('sessionIdentity', {
      playerId: socket.playerId,
      accountId: socket.accountId,
      isGuest: !!socket.isGuest,
    });

    const rejoinedRoomCodes = reconnectPlayerToRooms(socket.playerId, socket.id);
    for (const roomCode of rejoinedRoomCodes) {
      socket.join(roomCode);
      emitRoomUpdate(roomCode);
      broadcastGameState(roomCode);
    }

    // register minigame-specific listeners for this socket
    try {
      minigameRegistry.registerAll(io, socket, {
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
        broadcastGameState,
        applyAwards,
        computeTimeScore,
        scheduleRoundTimer,
        clearRoundTimer,
        logger: console,
      });
    } catch (err) {
      console.error('Failed to register minigame listeners for socket', socket.id, err);
    }

    try {
      registerStagePlanListeners(io, socket, {
        getRoom,
        updateStagePlan,
        startGame,
        getRoomPayload,
        broadcastGameState,
      });
    } catch (err) {
      console.error('Failed to register stage plan listeners for socket', socket.id, err);
    }

    socket.on('hostJoin', ({ roomCode } = {}, cb) => {
      if (!roomCode) {
        cb?.({ ok: false, error: 'ROOM_REQUIRED' });
        return;
      }
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      if (room.hostPlayerId !== socket.playerId) {
        cb?.({ ok: false, error: 'NOT_HOST' });
        return;
      }
      socket.join(roomCode);
      const state = broadcastGameState(roomCode);
      cb?.({ ok: true, state });
    });

    socket.on('playerJoinGame', ({ roomCode } = {}, cb) => {
      if (!roomCode) {
        cb?.({ ok: false, error: 'ROOM_REQUIRED' });
        return;
      }
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      if (!isPlayerInRoom(roomCode, socket.playerId)) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      socket.join(roomCode);
      const state = broadcastGameState(roomCode);
      cb?.({ ok: true, state });
    });

    socket.on('createRoom', ({ displayName }, callback) => {
      const profile = socket.profile || {};
      const { roomCode } = createRoom(
        socket.id,
        socket.playerId,
        profile,
        displayName,
        socket.accountId
      );

      socket.join(roomCode);

      const payload = emitRoomUpdate(roomCode);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('joinRoom', ({ roomCode, displayName }, callback) => {
      roomCode = roomCode?.toUpperCase?.();
      const profile = socket.profile || {};
      const room = addPlayer(
        roomCode,
        socket.playerId,
        socket.id,
        profile,
        displayName,
        socket.accountId
      );
      if (!room) {
        if (callback) callback({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }

      socket.join(roomCode);

      const payload = emitRoomUpdate(roomCode);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('updateProfile', async ({ avatar, displayName } = {}, callback) => {
      try {
        socket.profile = socket.profile || { displayName: null, avatar: null };
        if (typeof displayName === 'string') socket.profile.displayName = displayName || null;
        if (typeof avatar === 'string') socket.profile.avatar = avatar || null;

        const affectedRoomCodes = updatePlayerProfile(socket.playerId, socket.profile);

        for (const roomCode of affectedRoomCodes) {
          emitRoomUpdate(roomCode);
        }

        if (callback) callback({ ok: true });
      } catch (err) {
        console.error('updateProfile error', err);
        if (callback) callback({ ok: false, error: 'update_failed' });
      }
    });

    socket.on('leaveRoom', ({ roomCode } = {}) => {
      if (!roomCode) return;
      const room = removePlayer(roomCode, socket.playerId);
      socket.leave(roomCode);

      if (!room) return;

      emitRoomUpdate(roomCode);
      broadcastGameState(roomCode);
    });

    socket.on('disconnect', () => {
      const updated = removePlayerFromAll(socket.id, {
        graceMs: DISCONNECT_GRACE_MS,
        onRoomChanged: (roomCode) => {
          emitRoomUpdate(roomCode);
          broadcastGameState(roomCode);
        },
      });

      for (const { roomCode } of updated) {
        emitRoomUpdate(roomCode);
        broadcastGameState(roomCode);
      }
      console.log('Client disconnected', socket.id, 'playerId:', socket.playerId);
    });
  });
}

module.exports = { initGameSockets };
