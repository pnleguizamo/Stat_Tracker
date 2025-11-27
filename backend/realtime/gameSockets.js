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
    console.log('Client connected', socket.id);

    // Optional: you could get userId/displayName from auth here:
    // const { userId, displayName } = socket.handshake.auth;

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

      // add creator as a player
      room.players.set(socket.id, {
        name: displayName || 'Anonymous',
        // userId: optional if you have auth
      });

      socket.join(roomCode);

      const payload = {
        roomCode,
        players: Array.from(room.players.values()),
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
      room.players.set(socket.id, {
        name: displayName || 'Anonymous',
      });

      const payload = {
        roomCode,
        players: Array.from(room.players.values()),
      };

      io.to(roomCode).emit('roomUpdated', payload);
      if (callback) callback({ ok: true, ...payload });
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
        players: Array.from(room.players.values()),
      };
      io.to(roomCode).emit('roomUpdated', payload);
    });

    socket.on('disconnect', () => {
      // clean up player from all rooms
      for (const [roomCode, room] of rooms.entries()) {
        if (room.players.delete(socket.id)) {
          if (room.players.size === 0) {
            rooms.delete(roomCode);
          } else {
            const payload = {
              roomCode,
              players: Array.from(room.players.values()),
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
