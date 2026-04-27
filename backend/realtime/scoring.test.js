const test = require('node:test');
const assert = require('node:assert/strict');

const { appendRoundHistory, applyAwards } = require('./scoring');

test('appendRoundHistory stores a cloned snapshot', () => {
  const room = {};
  const snapshot = {
    id: 'round-1',
    minigameId: 'HITSTER',
    prompt: {
      song: { track_name: 'Original' },
    },
    answers: {
      player: { placement: { gapIndex: 1 } },
    },
  };

  appendRoundHistory(room, 0, snapshot);
  snapshot.prompt.song.track_name = 'Mutated';
  snapshot.answers.player.placement.gapIndex = 2;

  assert.equal(room.stageRoundHistory[0][0].prompt.song.track_name, 'Original');
  assert.equal(room.stageRoundHistory[0][0].answers.player.placement.gapIndex, 1);
});

test('applyAwards keeps uncapped awardHistory while scoreboard awards stay capped', () => {
  const room = { scoreboard: {} };
  const awards = Array.from({ length: 55 }, (_, index) => ({
    socketId: 'player-1',
    points: 1,
    reason: 'correct',
    meta: { roundId: `round-${index}` },
  }));

  applyAwards(room, awards);

  assert.equal(room.awardHistory.length, 55);
  assert.equal(room.scoreboard['player-1'].awards.length, 50);
  assert.equal(room.scoreboard['player-1'].points, 55);
});
