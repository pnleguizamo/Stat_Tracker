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

test('buildAlbumPreviewCandidates returns a representative track first and artist fallback second', () => {
  const candidates = serviceHelpers.buildAlbumPreviewCandidates({
    albumId: 'album-1',
    artistNames: ['Album Artist'],
    trackSources: [
      {
        trackId: 'track-1',
        trackName: 'Album Opener',
        artistIds: ['artist-1'],
        artistNames: ['Album Artist'],
        albumId: 'album-1',
      },
      {
        trackId: 'track-2',
        trackName: 'Other Song',
        artistIds: ['artist-2'],
        artistNames: ['Other Artist'],
        albumId: 'album-2',
      },
    ],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Album Opener',
      artistName: 'Album Artist',
      key: 'track::track-1',
      reason: 'album_track',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Album Artist',
      key: 'artist::album artist',
      reason: 'album_artist_fallback',
    },
  ]);
});

test('buildAlbumPreviewCandidates prefers snapshot sources before targeted timeframe sources', () => {
  const candidates = serviceHelpers.buildAlbumPreviewCandidates({
    albumId: 'album-1',
    artistNames: ['Album Artist'],
    trackSources: [
      {
        trackId: 'snapshot-track',
        trackName: 'Snapshot Match',
        artistIds: ['artist-1'],
        artistNames: ['Album Artist'],
        albumId: 'album-1',
      },
      {
        trackId: 'extra-track',
        trackName: 'Extra Match',
        artistIds: ['artist-1'],
        artistNames: ['Album Artist'],
        albumId: 'album-1',
      },
    ],
  });

  assert.equal(candidates[0].trackName, 'Snapshot Match');
  assert.equal(candidates[0].key, 'track::snapshot-track');
});

test('buildAlbumPreviewCandidates uses targeted album source when snapshot tracks miss', () => {
  const { albumTrackByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-extra' }, plays: 20, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-extra', {
          name: 'Extra Album Track',
          artistIds: ['artist-1'],
          artistNames: ['Album Artist'],
          albumId: 'album-1',
        }],
      ]),
      artists: new Map(),
    },
  });
  const targetedAlbumTrack = albumTrackByUser.get('user-1').get('album-1');

  const candidates = serviceHelpers.buildAlbumPreviewCandidates({
    albumId: 'album-1',
    artistNames: ['Album Artist'],
    trackSources: [
      {
        trackId: 'snapshot-other',
        trackName: 'Snapshot Other',
        artistIds: ['artist-2'],
        artistNames: ['Other Artist'],
        albumId: 'album-2',
      },
      targetedAlbumTrack,
    ],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Extra Album Track',
      artistName: 'Album Artist',
      key: 'track::track-extra',
      reason: 'album_track',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Album Artist',
      key: 'artist::album artist',
      reason: 'album_artist_fallback',
    },
  ]);
});

test('buildAlbumPreviewCandidates falls back to artist when no source matches the album', () => {
  const candidates = serviceHelpers.buildAlbumPreviewCandidates({
    albumId: 'album-1',
    artistNames: ['Album Artist'],
    trackSources: [
      {
        trackId: 'track-other',
        trackName: 'Other Track',
        artistIds: ['artist-2'],
        artistNames: ['Other Artist'],
        albumId: 'album-2',
      },
    ],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Album Artist',
      key: 'artist::album artist',
      reason: 'album_artist_fallback',
    },
  ]);
});

test('buildGenrePreviewCandidates returns a representative matching track when available', () => {
  const candidates = serviceHelpers.buildGenrePreviewCandidates({
    genreName: 'indie pop',
    trackSources: [
      {
        trackId: 'track-a',
        trackName: 'Indie Track',
        artistIds: ['artist-a'],
        artistNames: ['Indie Artist'],
        albumId: 'album-a',
      },
      {
        trackId: 'track-b',
        trackName: 'Electronic Track',
        artistIds: ['artist-b'],
        artistNames: ['Electronic Artist'],
        albumId: 'album-b',
      },
    ],
    artistSources: [
      { artistId: 'artist-a', name: 'Indie Artist', genres: ['indie pop'] },
      { artistId: 'artist-b', name: 'Electronic Artist', genres: ['electronic'] },
    ],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Indie Track',
      artistName: 'Indie Artist',
      key: 'track::track-a',
      reason: 'genre_track',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Indie Artist',
      key: 'artist::artist-a',
      reason: 'genre_artist_fallback',
    },
  ]);
});

test('buildGenrePreviewCandidates uses targeted genre track and artist when snapshot sources miss', () => {
  const { genreTrackByUser, genreArtistByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-extra' }, plays: 20, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-extra', {
          name: 'Extra Genre Track',
          artistIds: ['artist-1'],
          artistNames: ['Genre Artist'],
          albumId: 'album-1',
        }],
      ]),
      artists: new Map([
        ['artist-1', { name: 'Genre Artist', genres: ['indie pop'] }],
      ]),
    },
  });
  const targetedGenreTrack = genreTrackByUser.get('user-1').get('indie pop');
  const targetedGenreArtist = genreArtistByUser.get('user-1').get('indie pop');

  const candidates = serviceHelpers.buildGenrePreviewCandidates({
    genreName: 'indie pop',
    trackSources: [
      {
        trackId: 'snapshot-other',
        trackName: 'Snapshot Other',
        artistIds: ['artist-2'],
        artistNames: ['Other Artist'],
        albumId: 'album-2',
      },
      targetedGenreTrack,
    ],
    artistSources: [
      { artistId: 'artist-2', name: 'Other Artist', genres: ['electronic'] },
      targetedGenreArtist,
    ],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Extra Genre Track',
      artistName: 'Genre Artist',
      key: 'track::track-extra',
      reason: 'genre_track',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Genre Artist',
      key: 'artist::artist-1',
      reason: 'genre_artist_fallback',
    },
  ]);
});

test('buildTargetedSnapshotPreviewMaps chooses highest-play album representative', () => {
  const { albumTrackByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-low' }, plays: 5, msPlayed: 500 },
      { _id: { userId: 'user-1', trackId: 'track-high' }, plays: 50, msPlayed: 100 },
    ],
    metadata: {
      tracks: new Map([
        ['track-low', {
          name: 'Low Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist'],
          albumId: 'album-shared',
        }],
        ['track-high', {
          name: 'High Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist'],
          albumId: 'album-shared',
        }],
      ]),
      artists: new Map(),
    },
  });

  assert.deepEqual(albumTrackByUser.get('user-1').get('album-shared'), {
    trackId: 'track-high',
    trackName: 'High Track',
    artistIds: ['artist-1'],
    artistNames: ['Artist'],
    albumId: 'album-shared',
  });
});

test('buildTargetedSnapshotPreviewMaps chooses highest-minute album representative', () => {
  const { albumTrackByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'minutes',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-plays' }, plays: 50, msPlayed: 100 },
      { _id: { userId: 'user-1', trackId: 'track-minutes' }, plays: 5, msPlayed: 5000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-plays', {
          name: 'Play Count Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist'],
          albumId: 'album-shared',
        }],
        ['track-minutes', {
          name: 'Minutes Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist'],
          albumId: 'album-shared',
        }],
      ]),
      artists: new Map(),
    },
  });

  assert.equal(albumTrackByUser.get('user-1').get('album-shared').trackId, 'track-minutes');
});

test('buildTargetedSnapshotPreviewMaps normalizes genre keys', () => {
  const { genreTrackByUser, genreArtistByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-1' }, plays: 10, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-1', {
          name: 'Genre Track',
          artistIds: ['artist-1'],
          artistNames: ['Genre Artist'],
          albumId: 'album-1',
        }],
      ]),
      artists: new Map([
        ['artist-1', { name: 'Genre Artist', genres: [' Indie Pop '] }],
      ]),
    },
  });

  assert.equal(genreTrackByUser.get('user-1').get('indie pop').trackId, 'track-1');
  assert.equal(genreArtistByUser.get('user-1').get('indie pop').artistId, 'artist-1');
});

test('buildGenrePreviewCandidates matches targeted genre sources with normalized keys', () => {
  const { genreTrackByUser, genreArtistByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-1' }, plays: 10, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-1', {
          name: 'Normalized Genre Track',
          artistIds: ['artist-1'],
          artistNames: ['Genre Artist'],
          albumId: 'album-1',
        }],
      ]),
      artists: new Map([
        ['artist-1', { name: 'Genre Artist', genres: ['Indie Pop'] }],
      ]),
    },
  });
  const normalizedGenre = 'indie pop';

  const candidates = serviceHelpers.buildGenrePreviewCandidates({
    genreName: '  INDIE POP  ',
    trackSources: [genreTrackByUser.get('user-1').get(normalizedGenre)],
    artistSources: [genreArtistByUser.get('user-1').get(normalizedGenre)],
  });

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Normalized Genre Track',
      artistName: 'Genre Artist',
      key: 'track::track-1',
      reason: 'genre_track',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Genre Artist',
      key: 'artist::artist-1',
      reason: 'genre_artist_fallback',
    },
  ]);
});

test('buildTargetedSnapshotPreviewMaps uses the matching artist from the best genre track', () => {
  const { genreTrackByUser, genreArtistByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-1' }, plays: 20, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-1', {
          name: 'Collaborative Track',
          artistIds: ['artist-electronic', 'artist-indie'],
          artistNames: ['Electronic Artist', 'Indie Artist'],
          albumId: 'album-1',
        }],
      ]),
      artists: new Map([
        ['artist-electronic', { name: 'Electronic Artist', genres: ['electronic'] }],
        ['artist-indie', { name: 'Indie Artist', genres: ['indie pop'] }],
      ]),
    },
  });

  assert.equal(genreTrackByUser.get('user-1').get('indie pop').trackId, 'track-1');
  assert.equal(genreArtistByUser.get('user-1').get('indie pop').artistId, 'artist-indie');
});

test('buildTargetedSnapshotPreviewMaps keeps per-user representatives for the same album', () => {
  const { albumTrackByUser } = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-user-1' }, plays: 10, msPlayed: 1000 },
      { _id: { userId: 'user-2', trackId: 'track-user-2' }, plays: 20, msPlayed: 2000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-user-1', {
          name: 'User One Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist One'],
          albumId: 'album-shared',
        }],
        ['track-user-2', {
          name: 'User Two Track',
          artistIds: ['artist-2'],
          artistNames: ['Artist Two'],
          albumId: 'album-shared',
        }],
      ]),
      artists: new Map(),
    },
  });

  assert.equal(albumTrackByUser.get('user-1').get('album-shared').trackId, 'track-user-1');
  assert.equal(albumTrackByUser.get('user-2').get('album-shared').trackId, 'track-user-2');
});

test('buildTargetedSnapshotPreviewMaps exposes per-entity maps instead of broad source arrays', () => {
  const targetedMaps = serviceHelpers.buildTargetedSnapshotPreviewMaps({
    metric: 'plays',
    userTrackDocs: [
      { _id: { userId: 'user-1', trackId: 'track-album-1' }, plays: 20, msPlayed: 1000 },
      { _id: { userId: 'user-1', trackId: 'track-album-2' }, plays: 10, msPlayed: 1000 },
    ],
    metadata: {
      tracks: new Map([
        ['track-album-1', {
          name: 'Album One Track',
          artistIds: ['artist-1'],
          artistNames: ['Artist One'],
          albumId: 'album-1',
        }],
        ['track-album-2', {
          name: 'Album Two Track',
          artistIds: ['artist-2'],
          artistNames: ['Artist Two'],
          albumId: 'album-2',
        }],
      ]),
      artists: new Map([
        ['artist-1', { name: 'Artist One', genres: ['indie pop'] }],
        ['artist-2', { name: 'Artist Two', genres: ['electronic'] }],
      ]),
    },
  });

  assert.equal(targetedMaps.trackSourcesByUserId, undefined);
  assert.equal(targetedMaps.artistSourcesByUserId, undefined);
  assert.equal(targetedMaps.albumTrackByUser.get('user-1').get('album-2').trackId, 'track-album-2');
  assert.equal(targetedMaps.genreTrackByUser.get('user-1').get('electronic').trackId, 'track-album-2');
});

test('dedupePreviewCandidates drops duplicate preview keys and keeps stable order', () => {
  const candidates = serviceHelpers.dedupePreviewCandidates([
    serviceHelpers.buildTrackPreviewCandidate({
      trackName: 'Song',
      artistName: 'Artist',
      key: 'track::song-1',
      reason: 'primary',
    }),
    serviceHelpers.buildTrackPreviewCandidate({
      trackName: 'Song',
      artistName: 'Artist',
      key: 'track::song-1',
      reason: 'duplicate',
    }),
    serviceHelpers.buildArtistPreviewCandidate({
      artistName: 'Artist',
      key: 'artist::artist-1',
      reason: 'fallback',
    }),
  ]);

  assert.deepEqual(candidates, [
    {
      kind: 'track',
      trackName: 'Song',
      artistName: 'Artist',
      key: 'track::song-1',
      reason: 'primary',
    },
    {
      kind: 'artist',
      trackName: null,
      artistName: 'Artist',
      key: 'artist::artist-1',
      reason: 'fallback',
    },
  ]);
});

test('total datapoints remain non-previewable', () => {
  const trackCandidate = serviceHelpers.buildTrackPreviewCandidate({
    trackName: null,
    artistName: 'Artist',
    key: 'track::invalid',
  });

  assert.equal(trackCandidate, null);
  assert.deepEqual(serviceHelpers.dedupePreviewCandidates([]), []);
});
