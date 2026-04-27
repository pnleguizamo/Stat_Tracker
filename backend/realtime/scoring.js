function ensureScoreboard(room) {
  if (!room) return null;
  room.scoreboard = room.scoreboard || {};
  return room.scoreboard;
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function computeTimeScore(round, socketId, opts = {}) {
  const { maxPoints = 1000, decayPerSecond = 0.025, minPoints = 10 } = opts;
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

    const awardSnapshot = {
      socketId: award.socketId,
      points: award.points,
      reason: award.reason || 'award',
      meta: clonePlain(award.meta || null),
      at: now,
    };

    const entry = board[award.socketId] || { points: 0, stats: {}, awards: [] };
    entry.points += award.points;

    // Lightweight stats that work across minigames
    entry.stats.totalAwards = (entry.stats.totalAwards || 0) + 1;
    if (award.reason === 'correct') {
      entry.stats.correctAnswers = (entry.stats.correctAnswers || 0) + 1;
    }

    entry.awards = Array.isArray(entry.awards) ? entry.awards : [];
    entry.awards.push({
      points: awardSnapshot.points,
      reason: awardSnapshot.reason,
      meta: awardSnapshot.meta,
      at: awardSnapshot.at,
    });
    if (entry.awards.length > 50) {
      entry.awards = entry.awards.slice(entry.awards.length - 50);
    }

    room.awardHistory = Array.isArray(room.awardHistory) ? room.awardHistory : [];
    room.awardHistory.push(awardSnapshot);

    board[award.socketId] = entry;
  }

  room.scoreboard = board;
  return board;
}

const STREAK_MILESTONES = { 3: 150, 5: 300, 7: 500, 10: 1000 };

function updateStreaks(room, stageIndex, roundId, winnerPlayerIds, minigameId) {
  room.streaks = room.streaks || {};
  room.streaks[stageIndex] = room.streaks[stageIndex] || {};
  const stage = room.streaks[stageIndex];
  const winnerSet = new Set(winnerPlayerIds);
  const bonusAwards = [];

  for (const [playerId] of room.players) {
    const entry = stage[playerId] || { current: 0, best: 0, lastRoundId: null };
    if (entry.lastRoundId === roundId) {
      stage[playerId] = entry;
      continue;
    }
    entry.lastRoundId = roundId;

    if (winnerSet.has(playerId)) {
      entry.current += 1;
      if (entry.current > entry.best) entry.best = entry.current;

      const bonus = STREAK_MILESTONES[entry.current];
      if (bonus) {
        bonusAwards.push({
          socketId: playerId,
          points: bonus,
          reason: 'streak',
          meta: { streak: entry.current, stageIndex, roundId, minigameId },
        });
      }
    } else {
      entry.current = 0;
    }

    stage[playerId] = entry;
  }

  return bonusAwards;
}

function getStreakMap(room, stageIndex) {
  if (stageIndex === null || stageIndex === undefined) return {};
  const stage = room.streaks?.[stageIndex];
  if (!stage) return {};
  const out = {};
  for (const [playerId, entry] of Object.entries(stage)) {
    out[playerId] = { current: entry.current, best: entry.best };
  }
  return out;
}

function appendRoundHistory(room, stageIndex, snapshot) {
  if (!room || typeof stageIndex !== 'number') return;
  room.stageRoundHistory = room.stageRoundHistory || {};
  room.stageRoundHistory[stageIndex] = room.stageRoundHistory[stageIndex] || [];
  room.stageRoundHistory[stageIndex].push(clonePlain(snapshot));
}

module.exports = {
  applyAwards,
  computeTimeScore,
  ensureScoreboard,
  appendRoundHistory,
  updateStreaks,
  getStreakMap,
  clonePlain,
};
