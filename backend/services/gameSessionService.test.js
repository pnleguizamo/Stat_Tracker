const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompletedGameSession,
  persistCompletedGameSession,
} = require('./gameSessionService');

function buildRoom() {
  return {
    roomCode: 'ABCD',
    sessionId: 'session-1',
    createdAt: new Date('2026-04-27T12:00:00Z'),
    startedAt: new Date('2026-04-27T12:01:00Z'),
    completedAt: new Date('2026-04-27T12:30:00Z'),
    hostUserId: 'host-user',
    hostPlayerId: 'host-player',
    hostName: 'Host',
    hostConnected: true,
    players: new Map([
      ['player-1', {
        userId: 'user-1',
        displayName: 'Player One',
        name: 'Player One',
        avatar: 'avatar.png',
        connected: false,
      }],
    ]),
    stagePlan: [{ index: 0, minigameId: 'HEARDLE' }],
    stageRoundHistory: {
      0: [{
        id: 'round-1',
        minigameId: 'HEARDLE',
        answers: { 'player-1': { guesses: [{ outcome: 'correct' }] } },
      }],
    },
    scoreboard: {
      'player-1': {
        points: 100,
        awards: [{ points: 100, reason: 'correct', at: 1 }],
      },
    },
    awardHistory: [{ socketId: 'player-1', points: 100, reason: 'correct', at: 1 }],
    streaks: { 0: { 'player-1': { current: 1, best: 1 } } },
    finalRecap: { stages: [{ stageIndex: 0, minigameId: 'HEARDLE', awards: [] }] },
  };
}

test('buildCompletedGameSession serializes room maps and skips transient room fields', () => {
  const room = buildRoom();
  room.playerGraceTimers = new Map([['player-1', setTimeout(() => {}, 1000)]]);
  room.hostGraceTimer = setTimeout(() => {}, 1000);
  room._hlPreloads = new Map();

  try {
    const session = buildCompletedGameSession(room);

    assert.equal(session.sessionId, 'session-1');
    assert.equal(session.players.length, 2);
    assert.deepEqual(
      session.players.map((player) => ({ playerId: player.playerId, isHost: player.isHost })),
      [
        { playerId: 'player-1', isHost: false },
        { playerId: 'host-player', isHost: true },
      ]
    );
    assert.equal(session.playerGraceTimers, undefined);
    assert.equal(session.hostGraceTimer, undefined);
    assert.equal(session._hlPreloads, undefined);
    assert.equal(session.stageRoundHistory[0][0].answers['player-1'].guesses[0].outcome, 'correct');
  } finally {
    clearTimeout(room.playerGraceTimers.get('player-1'));
    clearTimeout(room.hostGraceTimer);
  }
});

test('persistCompletedGameSession upserts by sessionId without duplicating embedded arrays', async () => {
  const docs = new Map();
  const collection = {
    async updateOne(filter, update, options) {
      assert.deepEqual(options, { upsert: true });
      const prior = docs.get(filter.sessionId) || {};
      docs.set(filter.sessionId, {
        ...prior,
        ...update.$setOnInsert,
        ...update.$set,
      });
      return { acknowledged: true };
    },
  };

  const room = buildRoom();
  await persistCompletedGameSession(room, { collection });
  await persistCompletedGameSession(room, { collection });

  assert.equal(docs.size, 1);
  const saved = docs.get('session-1');
  assert.equal(saved.awardHistory.length, 1);
  assert.equal(saved.stageRoundHistory[0].length, 1);
});
