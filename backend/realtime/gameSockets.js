const roomsModule = require('./rooms');
const {
  getRoom,
  createRoom,
  addPlayer,
  updateStagePlan,
  startGame,
  removePlayer,
  removePlayerFromAll,
  getRoomPayload,
  updatePlayerProfile,
  getGameState,
} = roomsModule;
const minigameRegistry = require('./minigames');

function initGameSockets(io) {
  const broadcastGameState = (roomCode) => {
    const state = getGameState(roomCode);
    if (!state) return null;
    io.to(roomCode).emit('gameStateUpdated', state);
    return state;
  };

  const ensureStageState = async (room) => {
    if (!room || !room.stagePlan) return;
    const stageIndex = typeof room.currentStageIndex === 'number' ? room.currentStageIndex : 0;
    const stageConfig = room.stagePlan[stageIndex];
    if (!stageConfig) return;
    room.roundState = room.roundState || {};
    if (room.roundState[stageIndex]) return;

    const stageModule = minigameRegistry.modules?.[stageConfig.minigameId];
    if (stageModule?.createRoundState) {
      await stageModule.createRoundState(room, { stageIndex });
      return;
    }

    room.roundState[stageIndex] = {
      id: `pending-${stageConfig.minigameId}-${Date.now()}`,
      prompt: {
        type: 'INFO',
        title: 'Coming soon',
        subtitle: stageConfig.minigameId,
        description: `${stageConfig.minigameId} is not available yet.`,
      },
      status: 'pending',
      answers: {},
    };
  };

  io.on('connection', (socket) => {
    console.log('Client connected', socket.id, 'accountId:', socket.accountId);
    // register minigame-specific listeners for this socket
    try {
      minigameRegistry.registerAll(io, socket, {
        rooms: roomsModule,
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
        logger: console,
      });
    } catch (err) {
      console.error('Failed to register minigame listeners for socket', socket.id, err);
    }
    
    socket.on('enterStageConfig', ({ roomCode }, cb) => {
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      // update phase
      room.phase = 'stageConfig';
      const payload = getRoomPayload(roomCode);
      io.to(payload.hostSocketId).emit('stagePlanUpdated', {
        stagePlan: room.stagePlan,
      });
      cb?.({ ok: true });
    });

    socket.on('updateStagePlan', async ({ roomCode, stagePlan }, cb) => {
      const updated = updateStagePlan(roomCode, stagePlan);
      if (!updated) {
        cb?.({ ok: false, error: 'INVALID_STAGE_PLAN' });
        return;
      }
      const payload = getRoomPayload(roomCode);
      io.to(payload.hostSocketId).emit('stagePlanUpdated', {
        stagePlan: updated.stagePlan,
      });
      if (!roomCode) {
        cb?.({ ok: false, error: 'ROOM_REQUIRED' });
        return;
      }
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        cb?.({ ok: false, error: 'NOT_HOST' });
        return;
      }

      const started = startGame(roomCode);
      if (!started) {
        cb?.({ ok: false, error: 'CANT_START' });
        return;
      }

      await ensureStageState(started);
      broadcastGameState(roomCode);

      cb?.({ ok: true });
    });

    socket.on('lockStagePlanAndStart', async ({ roomCode }, cb) => {
      if (!roomCode) {
        cb?.({ ok: false, error: 'ROOM_REQUIRED' });
        return;
      }
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        cb?.({ ok: false, error: 'NOT_HOST' });
        return;
      }

      const started = startGame(roomCode);
      if (!started) {
        cb?.({ ok: false, error: 'CANT_START' });
        return;
      }

      await ensureStageState(started);
      broadcastGameState(roomCode);

      cb?.({ ok: true });
    });

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
      if (room.hostSocketId !== socket.id) {
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
      if (!room.players.has(socket.id)) {
        cb?.({ ok: false, error: 'NOT_IN_ROOM' });
        return;
      }
      socket.join(roomCode);
      const state = broadcastGameState(roomCode);
      cb?.({ ok: true, state });
    });

    socket.on('advanceStageOrRound', async ({ roomCode } = {}, cb) => {
      if (!roomCode) {
        cb?.({ ok: false, error: 'ROOM_REQUIRED' });
        return;
      }
      const room = getRoom(roomCode);
      if (!room) {
        cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }
      if (room.hostSocketId !== socket.id) {
        cb?.({ ok: false, error: 'NOT_HOST' });
        return;
      }
      if (typeof room.currentStageIndex !== 'number') {
        cb?.({ ok: false, error: 'NO_STAGE_ACTIVE' });
        return;
      }

      const nextIndex = room.currentStageIndex + 1;
      if (!room.stagePlan || nextIndex >= room.stagePlan.length) {
        room.phase = 'completed';
        broadcastGameState(roomCode);
        cb?.({ ok: true, completed: true });
        return;
      }

      room.currentStageIndex = nextIndex;
      room.roundState = room.roundState || {};
      delete room.roundState[nextIndex];
      await ensureStageState(room);
      broadcastGameState(roomCode);
      cb?.({ ok: true, currentStageIndex: room.currentStageIndex });
      // stagePlan: room.stagePlan,
      //   // plus any initial state for stage 0
      // });

      // cb?.({ ok: true });
      // ok: true });
    });

    socket.on('createRoom', ({ displayName }, callback) => {
      const profile = socket.profile || {};
      const { roomCode, room } = createRoom(socket.id, profile, displayName, socket.accountId);

      socket.join(roomCode);

      const payload = getRoomPayload(roomCode);
      io.to(roomCode).emit('roomUpdated', payload);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('joinRoom', ({ roomCode, displayName }, callback) => {
      roomCode = roomCode?.toUpperCase?.();
      const profile = socket.profile || {};
      const room = addPlayer(roomCode, socket.id, profile, displayName, socket.accountId);
      if (!room) {
        if (callback) callback({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }

      socket.join(roomCode);

      const payload = getRoomPayload(roomCode);
      io.to(roomCode).emit('roomUpdated', payload);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('updateProfile', async ({ avatar, displayName } = {}, callback) => {
      try {
        socket.profile = socket.profile || { displayName: null, avatar: null };
        if (typeof displayName === 'string') socket.profile.displayName = displayName || null;
        if (typeof avatar === 'string') socket.profile.avatar = avatar || null;

        const affectedRoomCodes = updatePlayerProfile(socket.id, socket.profile);

        for (const roomCode of affectedRoomCodes) {
          const payload = getRoomPayload(roomCode);
          if (!payload) continue;
          io.to(roomCode).emit('roomUpdated', payload);
        }

        if (callback) callback({ ok: true });
      } catch (err) {
        console.error('updateProfile error', err);
        if (callback) callback({ ok: false, error: 'update_failed' });
      }
    });

    socket.on('leaveRoom', ({ roomCode } = {}) => {
      if (!roomCode) return;
      const room = removePlayer(roomCode, socket.id);
      socket.leave(roomCode);

      if (!room) return; // room deleted

      const payload = getRoomPayload(roomCode);
      io.to(roomCode).emit('roomUpdated', payload);
    });

    socket.on('disconnect', () => {
      const updated = removePlayerFromAll(socket.id);
      for (const { roomCode } of updated) {
        const payload = getRoomPayload(roomCode);
        if (payload) io.to(roomCode).emit('roomUpdated', payload);
      }
      console.log('Client disconnected', socket.id)
    });
  });
}

module.exports = { initGameSockets };
