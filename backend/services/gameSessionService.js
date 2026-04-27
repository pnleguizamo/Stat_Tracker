const { clonePlain } = require('../realtime/scoring');

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializePlayers(room) {
  const players = [];
  const seen = new Set();

  for (const [playerId, player] of room.players?.entries?.() || []) {
    seen.add(playerId);
    players.push({
      playerId,
      userId: player?.userId || null,
      displayName: player?.displayName || player?.name || 'Anonymous',
      name: player?.name || player?.displayName || 'Anonymous',
      avatar: player?.avatar || null,
      connected: !!player?.connected,
      isHost: playerId === room.hostPlayerId,
    });
  }

  if (room.hostPlayerId && !seen.has(room.hostPlayerId)) {
    players.push({
      playerId: room.hostPlayerId,
      userId: room.hostUserId || null,
      displayName: room.hostName || 'Host',
      name: room.hostName || 'Host',
      avatar: null,
      connected: !!room.hostConnected,
      isHost: true,
    });
  }

  return players;
}

function buildCompletedGameSession(room, { roomCode, completedAt = new Date() } = {}) {
  if (!room) throw new Error('ROOM_REQUIRED');
  if (!room.sessionId) throw new Error('SESSION_ID_REQUIRED');

  const resolvedRoomCode = roomCode || room.roomCode || null;
  const resolvedCompletedAt = toDate(room.completedAt) || toDate(completedAt) || new Date();

  return {
    sessionId: room.sessionId,
    roomCode: resolvedRoomCode,
    createdAt: toDate(room.createdAt) || toDate(room.startedAt) || resolvedCompletedAt,
    startedAt: toDate(room.startedAt),
    completedAt: resolvedCompletedAt,
    hostUserId: room.hostUserId || null,
    hostPlayerId: room.hostPlayerId || null,
    players: serializePlayers(room),
    stagePlan: clonePlain(room.stagePlan || []),
    stageRoundHistory: clonePlain(room.stageRoundHistory || {}),
    scoreboard: clonePlain(room.scoreboard || {}),
    awardHistory: clonePlain(room.awardHistory || []),
    streaks: clonePlain(room.streaks || {}),
    finalRecap: clonePlain(room.finalRecap || null),
  };
}

async function getGameSessionCollection() {
  const { initDb, COLLECTIONS } = require('../mongo');
  const db = await initDb();
  return db.collection(COLLECTIONS.gameSessions);
}

async function persistGameSessionDocument(session, opts = {}) {
  const collection = opts.collection || await getGameSessionCollection();
  const now = new Date();

  await collection.updateOne(
    { sessionId: session.sessionId },
    {
      $set: {
        ...session,
        persistedAt: now,
      },
      $setOnInsert: {
        insertedAt: now,
      },
    },
    { upsert: true }
  );

  return session;
}

async function persistCompletedGameSession(room, opts = {}) {
  const session = buildCompletedGameSession(room, opts);
  return persistGameSessionDocument(session, opts);
}

module.exports = {
  buildCompletedGameSession,
  persistGameSessionDocument,
  persistCompletedGameSession,
  serializePlayers,
};
