const test = require('node:test');
const assert = require('node:assert/strict');

const { computeStageRecap } = require('./stageRecap');

function buildRoom(rounds) {
  return {
    players: new Map([
      ['owner-a', { displayName: 'Owner A' }],
      ['owner-b', { displayName: 'Owner B' }],
      ['guest-c', { displayName: 'Guest C' }],
    ]),
    stagePlan: [{ minigameId: 'GUESS_SPOTIFY_WRAPPED' }],
    stageRoundHistory: [rounds],
    scoreboard: {},
  };
}

test('wrapped awards aggregate owner guess stats across multiple rounds', () => {
  const room = buildRoom([
    {
      ownerPlayerId: 'owner-a',
      results: { winners: ['owner-b'] },
      prompt: {},
    },
    {
      ownerPlayerId: 'owner-a',
      results: { winners: ['owner-b', 'guest-c'] },
      prompt: {},
    },
    {
      ownerPlayerId: 'owner-b',
      results: { winners: ['owner-a', 'guest-c'] },
      prompt: {},
    },
  ]);

  const recap = computeStageRecap(room, 0, Infinity);
  const nicheNinja = recap.awards.find((award) => award.id === 'niche_ninja');

  assert.ok(nicheNinja);
  assert.match(nicheNinja.description, /Only 75% of the group guessed their Wrappeds correctly\./);
  assert.deepEqual(
    nicheNinja.featuredPlayers.map((player) => ({
      playerId: player.playerId,
      statLabel: player.statLabel,
    })),
    [{ playerId: 'owner-a', statLabel: '75% guessed right' }]
  );
});
