const test = require('node:test');
const assert = require('node:assert/strict');

process.env.URI = process.env.URI || 'mongodb://localhost:27017/stat-tracker-test';

const { helpers } = require('./HITSTER');

test('Hitster races per stage defaults to 3', () => {
  assert.equal(helpers.resolveRacesPerStage({}), helpers.DEFAULT_RACES_PER_STAGE);
  assert.equal(helpers.resolveRacesPerStage({ racesPerStage: 2 }), 2);
});

test('Hitster marks a race complete when a player reaches the target', () => {
  const stageState = {
    raceNumber: 1,
    racesCompleted: 0,
    raceComplete: false,
    stageComplete: false,
  };

  const result = helpers.markRaceCompletion(stageState, ['player-1'], 3, 1);

  assert.deepEqual(result, { raceComplete: true, stageComplete: false });
  assert.equal(stageState.raceComplete, true);
  assert.equal(stageState.racesCompleted, 1);
  assert.equal(stageState.stageComplete, false);
});

test('Hitster allows a new race before the configured race count is reached', () => {
  const pool = [{ id: 'song-1' }];
  const usedSongIds = new Set(['song-1']);
  const previewUrlsBySongId = { 'song-1': 'preview-url' };
  const stageState = {
    pool,
    usedSongIds,
    previewUrlsBySongId,
    raceNumber: 1,
    racesCompleted: 1,
    roundsStartedInRace: 6,
    raceComplete: true,
    stageComplete: false,
    anchorCard: { songId: 'anchor-1' },
    anchorPlaced: true,
    timelines: {
      'player-1': { cards: [{ songId: 'anchor-1' }, { songId: 'song-2' }] },
    },
  };

  const result = helpers.prepareRaceForStart(stageState, 3);

  assert.equal(result.ok, true);
  assert.equal(stageState.raceNumber, 2);
  assert.equal(stageState.roundsStartedInRace, 0);
  assert.equal(stageState.raceComplete, false);
  assert.equal(stageState.anchorCard, null);
  assert.equal(stageState.anchorPlaced, false);
  assert.deepEqual(stageState.timelines, {});
  assert.equal(stageState.pool, pool);
  assert.equal(stageState.usedSongIds, usedSongIds);
  assert.equal(stageState.previewUrlsBySongId, previewUrlsBySongId);
});

test('Hitster marks the stage complete after the final configured race', () => {
  const stageState = {
    raceNumber: 2,
    racesCompleted: 1,
    raceComplete: false,
    stageComplete: false,
  };

  const result = helpers.markRaceCompletion(stageState, ['player-1'], 2, 2);

  assert.deepEqual(result, { raceComplete: true, stageComplete: true });
  assert.equal(stageState.racesCompleted, 2);
  assert.equal(stageState.stageComplete, true);
});

test('Hitster rejects starting a race after stage completion', () => {
  const stageState = {
    raceNumber: 2,
    racesCompleted: 2,
    raceComplete: true,
    stageComplete: true,
  };

  assert.deepEqual(helpers.prepareRaceForStart(stageState, 2), {
    ok: false,
    error: 'STAGE_COMPLETE',
  });
});
