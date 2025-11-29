function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// roomCode -> { players: Map<socketId, { userId, name }>, createdAt: Date }
const rooms = new Map();

function initGameSockets(io) {
  io.on('connection', (socket) => {
    console.log('Client connected', socket.id, 'accountId:', socket.accountId);

    socket.on('createRoom', ({ displayName }, callback) => {
      let roomCode = generateRoomCode();
      while (rooms.has(roomCode)) {
        roomCode = generateRoomCode();
      }

      const room = {
        players: new Map(),
        createdAt: new Date(),
      };

      rooms.set(roomCode, room);

      const profile = socket.profile || {};
      const chosenName = displayName || profile.displayName || 'Anonymous';
      room.players.set(socket.id, {
        name: chosenName,
        userId: socket.accountId,
        displayName: profile.displayName || chosenName,
        avatar: profile.avatar || null,
      });

      socket.join(roomCode);

      const payload = {
        roomCode,
        players: Array.from(room.players.entries()).map(([socketId, p]) => ({ socketId, ...p })),
      };

      io.to(roomCode).emit('roomUpdated', payload);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('joinRoom', ({ roomCode, displayName }, callback) => {
      roomCode = roomCode?.toUpperCase?.();
      const room = rooms.get(roomCode);
      if (!room) {
        if (callback) callback({ ok: false, error: 'ROOM_NOT_FOUND' });
        return;
      }

      socket.join(roomCode);
        const profile = socket.profile || {};
        const chosenName = displayName || profile.displayName || 'Anonymous';
        room.players.set(socket.id, {
          name: chosenName,
          userId: socket.accountId,
          displayName: profile.displayName || chosenName,
          avatar: profile.avatar || null,
        });

      const payload = {
        roomCode,
        players: Array.from(room.players.entries()).map(([socketId, p]) => ({ socketId, ...p })),
      };

      io.to(roomCode).emit('roomUpdated', payload);
      if (callback) callback({ ok: true, ...payload });
    });

    socket.on('updateProfile', async ({ avatar, displayName } = {}, callback) => {
      try {
        socket.profile = socket.profile || { displayName: null, avatar: null };
        if (typeof displayName === 'string') socket.profile.displayName = displayName || null;
        if (typeof avatar === 'string') socket.profile.avatar = avatar || null;

        const affectedRooms = [];
        for (const [roomCode, room] of rooms.entries()) {
          if (room.players.has(socket.id)) {
            const p = room.players.get(socket.id);
            if (p) {
              p.displayName = socket.profile.displayName || p.name;
              p.avatar = socket.profile.avatar || null;
            }
            affectedRooms.push(roomCode);
          }
        }

        for (const roomCode of affectedRooms) {
          const room = rooms.get(roomCode);
          if (!room) continue;
          const payload = {
            roomCode,
            players: Array.from(room.players.entries()).map(([socketId, p]) => ({ socketId, ...p })),
          };
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
      const room = rooms.get(roomCode);
      if (!room) return;

      room.players.delete(socket.id);
      socket.leave(roomCode);

      if (room.players.size === 0) {
        rooms.delete(roomCode);
        return;
      }

      const payload = {
        roomCode,
        players: Array.from(room.players.entries()).map(([socketId, p]) => ({ socketId, ...p })),
      };
      io.to(roomCode).emit('roomUpdated', payload);
    });

    socket.on('disconnect', () => {
      for (const [roomCode, room] of rooms.entries()) {
        if (room.players.delete(socket.id)) {
          if (room.players.size === 0) {
            rooms.delete(roomCode);
          } else {
            const payload = {
              roomCode,
              players: Array.from(room.players.entries()).map(([socketId, p]) => ({ socketId, ...p })),
            };
            io.to(roomCode).emit('roomUpdated', payload);
          }
        }
      }
      console.log('Client disconnected', socket.id);
    });
  });
}

module.exports = { initGameSockets };
