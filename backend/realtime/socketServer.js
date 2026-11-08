const { Server: IOServer } = require('socket.io');
const { socketAuthMiddleware } = require('./socketAuth');
const { initGameSockets } = require('./gameSockets');

let ioInstance = null;

function initSocket(server) {
  if (ioInstance) return ioInstance;

  ioInstance = new IOServer(server, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || true,
      methods: ['GET', 'POST'],
      credentials: true,
    }
  });

  ioInstance.use(socketAuthMiddleware);
  // Finish profile loading before room listeners can receive joinRoom.
  ioInstance.use(async (socket, next) => {
    try {
      const { initDb } = require('../mongo');
      let profile = {};

      if (socket.accountId) {
        try {
          const db = await initDb();
          const row = await db.collection('oauth_tokens').findOne({ accountId: socket.accountId });
          if (!row && socket.isBot) return next(new Error('Bot profile not found'));
          if (row) {
            profile.displayName = row.display_name;
            profile.avatar = row.avatar_url;
          }
        } catch (err) {
          if (socket.isBot) return next(new Error('Bot profile lookup failed'));
          console.warn('socket profile DB lookup failed', err);
        }
      }

      socket.profile = profile;
    } catch (err) {
      if (socket.isBot) return next(new Error('Bot profile lookup failed'));
      socket.profile = { displayName: null, avatar: null };
    }

    next();
  });

  ioInstance.on('connection', (socket) => {
    console.log('Socket connected:', socket.id, 'accountId:', socket.accountId);
    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', socket.id, 'accountId:', socket.accountId, 'reason:', reason);
    });
  });
  
  initGameSockets(ioInstance);

  return ioInstance;
}

function getIo() {
  if (!ioInstance) throw new Error('IO not initialized');
  return ioInstance;
}

module.exports = { initSocket, getIo };
