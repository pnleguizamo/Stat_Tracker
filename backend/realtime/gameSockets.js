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
const { applyAwards, computeTimeScore } = require('./scoring');
const { scheduleRoundTimer, clearRoundTimer } = require('./timers');
const minigameRegistry = require('./minigames');
const { registerStagePlanListeners } = require('./stagePlanSockets');
const { monitorEventLoopDelay } = require('perf_hooks');

function initGameSockets(io) {
  const eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelayMonitor.enable();
  let lastBroadcastLogAt = 0;
  const BROADCAST_LOG_INTERVAL_MS = 2000;
  const roomBroadcastCounts = new Map();

  setInterval(() => {
    const meanMs = Math.round(eventLoopDelayMonitor.mean / 1e6);
    const maxMs = Math.round(eventLoopDelayMonitor.max / 1e6);
    console.log(`[loop] mean=${meanMs}ms max=${maxMs}ms`);
  }, 10000);

  const broadcastGameState = (roomCode) => {
    const startNs = process.hrtime.bigint();
    const state = getGameState(roomCode);
    if (!state) return null;
    roomBroadcastCounts.set(roomCode, (roomBroadcastCounts.get(roomCode) || 0) + 1);
    const now = Date.now();
    if (now - lastBroadcastLogAt > BROADCAST_LOG_INTERVAL_MS) {
      const payloadSize = Buffer.byteLength(JSON.stringify(state), 'utf8');
      const elapsedMs = now - lastBroadcastLogAt || BROADCAST_LOG_INTERVAL_MS;
      const broadcastCount = roomBroadcastCounts.get(roomCode) || 0;
      const broadcastsPerSec = (broadcastCount / (elapsedMs / 1000)).toFixed(2);
      roomBroadcastCounts.set(roomCode, 0);
      const room = io.sockets.adapter.rooms.get(roomCode);
      const socketCount = room?.size || 0;
      let blockedSockets = 0;
      if (room) {
        for (const socketId of room) {
          const client = io.of('/').sockets.get(socketId);
          if (client && client.conn?.transport && client.conn.transport.writable === false) {
            blockedSockets += 1;
          }
        }
      }
      const elapsedBroadcastMs = Number((process.hrtime.bigint() - startNs) / 1000000n);
      console.log(
        `[broadcast] room=${roomCode} size=${payloadSize}B players=${state.players?.length ?? 0} sockets=${socketCount} blocked=${blockedSockets} rate=${broadcastsPerSec}/s elapsed=${elapsedBroadcastMs}ms`
      );
      lastBroadcastLogAt = now;
    }
    io.to(roomCode).emit('gameStateUpdated', state);
    const elapsedBroadcastMs = Number((process.hrtime.bigint() - startNs) / 1000000n);
    if (elapsedBroadcastMs > 20) {
      console.log(`[broadcast-slow] room=${roomCode} elapsed=${elapsedBroadcastMs}ms`);
    }
    return state;
  };

  io.on('connection', (socket) => {
    console.log('Client connected', socket.id, 'accountId:', socket.accountId);
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
        eventLoopDelayMonitor,
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
      console.log('Client disconnected', socket.id);
    });
  });
}

module.exports = { initGameSockets };
