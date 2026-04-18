const test = require('node:test');
const assert = require('node:assert/strict');

const { helpers: serviceHelpers } = require('../../services/higherLowerService');

test('resolveHigherLowerMode falls back to the default mode', () => {
  assert.equal(serviceHelpers.resolveHigherLowerMode({ mode: 'winner_stays' }), 'winner_stays');
  assert.equal(serviceHelpers.resolveHigherLowerMode({ mode: 'right_advances' }), 'right_advances');
  assert.equal(serviceHelpers.resolveHigherLowerMode({ mode: 'unknown' }), 'right_advances');
  assert.equal(serviceHelpers.resolveHigherLowerMode({}), 'right_advances');
});

test('trimHigherLowerPoolForMode keeps the full pool for winner_stays', () => {
  const pool = Array.from({ length: 10 }, (_, index) => ({
    id: `dp-${index + 1}`,
    value: index + 1,
  }));

  const trimmedPool = serviceHelpers.trimHigherLowerPoolForMode(pool, { mode: 'winner_stays' });

  assert.equal(trimmedPool.length, 10);
  assert.deepEqual(trimmedPool.map((entry) => entry.id), pool.map((entry) => entry.id));
});

test('trimHigherLowerPoolForMode removes the bottom 30 percent for right_advances', () => {
  const pool = Array.from({ length: 10 }, (_, index) => ({
    id: `dp-${index + 1}`,
    value: index + 1,
  }));

  const trimmedPool = serviceHelpers.trimHigherLowerPoolForMode(pool, { mode: 'right_advances' });

  assert.equal(trimmedPool.length, 7);
  assert.deepEqual(
    trimmedPool.map((entry) => entry.id),
    ['dp-4', 'dp-5', 'dp-6', 'dp-7', 'dp-8', 'dp-9', 'dp-10']
  );
});

test('syncHigherLowerAnchorState preserves anchor state', () => {
  const stageState = {
    anchorDatapointId: 'anchor-a',
    anchorHoldCount: 2,
  };

  serviceHelpers.syncHigherLowerAnchorState(stageState);

  assert.equal(stageState.anchorDatapointId, 'anchor-a');
  assert.equal(stageState.anchorHoldCount, 2);
});

test('winner_stays keeps the left anchor on non-right results', () => {
  const stageState = {
    mode: 'winner_stays',
    anchorDatapointId: 'left-id',
    anchorHoldCount: 1,
  };

  const nextState = serviceHelpers.resolveHigherLowerNextAnchorState(stageState, {
    left: { id: 'left-id' },
    right: { id: 'right-id' },
    results: { winnerSide: 'LEFT' },
  });

  assert.deepEqual(nextState, {
    anchorDatapointId: 'left-id',
    anchorHoldCount: 2,
  });
});

test('winner_stays advances to the right anchor on right wins', () => {
  const stageState = {
    mode: 'winner_stays',
    anchorDatapointId: 'left-id',
    anchorHoldCount: 3,
  };

  const nextState = serviceHelpers.resolveHigherLowerNextAnchorState(stageState, {
    left: { id: 'left-id' },
    right: { id: 'right-id' },
    results: { winnerSide: 'RIGHT' },
  });

  assert.deepEqual(nextState, {
    anchorDatapointId: 'right-id',
    anchorHoldCount: 0,
  });
});

test('right_advances always advances to the right anchor', () => {
  const stageState = {
    mode: 'right_advances',
    anchorDatapointId: 'left-id',
    anchorHoldCount: 5,
  };

  const nextState = serviceHelpers.resolveHigherLowerNextAnchorState(stageState, {
    left: { id: 'left-id' },
    right: { id: 'right-id' },
    results: { winnerSide: 'LEFT' },
  });

  assert.deepEqual(nextState, {
    anchorDatapointId: 'right-id',
    anchorHoldCount: 0,
  });
});

test('buildContributorMap maps entity ids to sets of player ids', () => {
  const userIdToPlayerId = new Map([['user-1', 'player-1'], ['user-2', 'player-2']]);
  const docs = [
    { trackId: 'track-a', userId: 'user-1' },
    { trackId: 'track-b', userId: 'user-2' },
  ];

  const map = serviceHelpers.buildContributorMap(docs, 'trackId', userIdToPlayerId);

  assert.deepEqual(Array.from(map.get('track-a')), ['player-1']);
  assert.deepEqual(Array.from(map.get('track-b')), ['player-2']);
});

test('buildContributorMap merges multiple players for the same entity', () => {
  const userIdToPlayerId = new Map([['user-1', 'player-1'], ['user-2', 'player-2']]);
  const docs = [
    { artistId: 'artist-x', userId: 'user-1' },
    { artistId: 'artist-x', userId: 'user-2' },
  ];

  const map = serviceHelpers.buildContributorMap(docs, 'artistId', userIdToPlayerId);

  assert.equal(map.get('artist-x').size, 2);
  assert.ok(map.get('artist-x').has('player-1'));
  assert.ok(map.get('artist-x').has('player-2'));
});

test('buildContributorMap skips docs with missing userId or entityId', () => {
  const userIdToPlayerId = new Map([['user-1', 'player-1']]);
  const docs = [
    { trackId: null, userId: 'user-1' },
    { trackId: 'track-c', userId: null },
    { trackId: 'track-d', userId: 'user-unknown' },
  ];

  const map = serviceHelpers.buildContributorMap(docs, 'trackId', userIdToPlayerId);

  assert.equal(map.size, 0);
});
