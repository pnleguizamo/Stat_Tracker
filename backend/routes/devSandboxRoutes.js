const express = require('express');
const { computeStageRecap } = require('../realtime/stageRecap');

const router = express.Router();

function toPlayerMap(players = []) {
  const map = new Map();

  for (const player of Array.isArray(players) ? players : []) {
    if (!player || !player.playerId) continue;
    map.set(player.playerId, {
      playerId: player.playerId,
      userId: player.userId || null,
      name: player.name || player.displayName || 'Player',
      displayName: player.displayName || player.name || 'Player',
      avatar: player.avatar || null,
      connected: true,
    });
  }

  return map;
}

function toScoreboard(scoreboard = {}) {
  if (!scoreboard || typeof scoreboard !== 'object') return {};

  return Object.fromEntries(
    Object.entries(scoreboard).map(([playerId, entry]) => [
      playerId,
      {
        points: Number(entry?.points) || 0,
        stats: entry?.stats && typeof entry.stats === 'object' ? entry.stats : {},
        awards: Array.isArray(entry?.awards) ? entry.awards : [],
      },
    ])
  );
}

function normalizeStageRoundHistory(stageRoundHistory = {}) {
  if (Array.isArray(stageRoundHistory)) return stageRoundHistory;
  if (!stageRoundHistory || typeof stageRoundHistory !== 'object') return {};
  return stageRoundHistory;
}

router.post('/final-recap-sandbox', (req, res) => {
  try {
    const { players, stagePlan, stageRoundHistory, scoreboard } = req.body || {};

    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: 'players are required' });
    }

    if (!Array.isArray(stagePlan) || stagePlan.length === 0) {
      return res.status(400).json({ error: 'stagePlan is required' });
    }

    const room = {
      players: toPlayerMap(players),
      stagePlan,
      stageRoundHistory: normalizeStageRoundHistory(stageRoundHistory),
      scoreboard: toScoreboard(scoreboard),
    };

    const stages = stagePlan
      .map((_, stageIndex) => computeStageRecap(room, stageIndex, Infinity))
      .filter(Boolean);

    return res.json({ finalRecap: { stages } });
  } catch (err) {
    console.error('/api/dev/final-recap-sandbox error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
