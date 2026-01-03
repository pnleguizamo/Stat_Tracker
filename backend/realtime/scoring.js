function ensureScoreboard(room) {
  if (!room) return null;
  room.scoreboard = room.scoreboard || {};
  return room.scoreboard;
}

function computeTimeScore(round, socketId, opts = {}) {
  const { maxPoints = 1000, decayPerSecond = 0.05, minPoints = 10 } = opts;
  if (!round || !round.startedAt) return minPoints;
  const submittedAt = round.answers?.[socketId]?.at;
  if (!submittedAt) return minPoints;

  const elapsedMs = Math.max(0, submittedAt - round.startedAt);
  const elapsedSeconds = elapsedMs / 1000;
  const scored = Math.round(maxPoints - elapsedMs * decayPerSecond);
  return Math.max(minPoints, scored);
}

function applyAwards(room, awards = []) {
  const board = ensureScoreboard(room);
  if (!board) return null;
  const now = Date.now();

  for (const award of awards) {
    if (!award || !award.socketId || typeof award.points !== 'number') continue;

    const entry = board[award.socketId] || { points: 0, stats: {}, awards: [] };
    entry.points += award.points;

    // Lightweight stats that work across minigames
    entry.stats.totalAwards = (entry.stats.totalAwards || 0) + 1;
    if (award.reason === 'correct') {
      entry.stats.correctAnswers = (entry.stats.correctAnswers || 0) + 1;
    }

    entry.awards = Array.isArray(entry.awards) ? entry.awards : [];
    entry.awards.push({
      points: award.points,
      reason: award.reason || 'award',
      meta: award.meta || null,
      at: now,
    });
    if (entry.awards.length > 50) {
      entry.awards = entry.awards.slice(entry.awards.length - 50);
    }

    board[award.socketId] = entry;
  }

  room.scoreboard = board;
  return board;
}

module.exports = {
  applyAwards,
  computeTimeScore,
  ensureScoreboard,
};
