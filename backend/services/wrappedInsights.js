const { initDb } = require('../mongo');
const { getAccessToken } = require('./authService');
const { getAlbumCover } = require('./spotifyServices');

const collectionName = process.env.COLLECTION_NAME;
const MIN_MINUTES_PER_YEAR = 500;
const MIN_TRACKS_PER_YEAR = 100;
const MAX_YEAR_CANDIDATES = 5;

async function getCollection() {
  const db = await initDb();
  return db.collection(collectionName);
}

function parseTrackId(uri) {
  if (!uri) return null;
  const parts = uri.split(':');
  return parts[2] || null;
}

async function fetchArtistMetadata(accessToken, trackIds = []) {
  if (!accessToken || !trackIds.length) return { trackById: {}, artistById: {} };

  try {
    const tracks = await getAlbumCover(accessToken, trackIds);
    const artistIds = [];
    const trackById = {};

    for (const track of tracks || []) {
      if (!track || !track.id) continue;
      trackById[track.id] = track;
      const topArtist = track.artists?.[0];
      if (topArtist?.id) {
        artistIds.push(topArtist.id);
      }
    }

    if (!artistIds.length) {
      return { trackById, artistById: {} };
    }

    const resp = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds.join(',')}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Spotify artists fetch failed ${resp.status} ${body}`);
    }
    const json = await resp.json();
    const artistById = {};
    for (const artist of json.artists || []) {
      if (artist?.id) artistById[artist.id] = artist;
    }
    return { trackById, artistById };
  } catch (err) {
    console.warn('fetchArtistMetadata error', err.message || err);
    return { trackById: {}, artistById: {} };
  }
}

function buildYearMatchStage(year) {
  return [
    {
      $addFields: {
        playedAt: { $toDate: '$ts' },
      },
    },
    {
      $addFields: {
        wrappedYear: { $year: '$playedAt' },
        wrappedMonth: { $month: '$playedAt' },
      },
    },
    {
      $match: {
        wrappedYear: year,
        wrappedMonth: { $nin: [12] },
      },
    },
  ];
}

async function getYearlyStats(collection, userId) {
  const pipeline = [
    {
      $match: {
        userId,
        reason_end: 'trackdone',
        ts: { $ne: null },
      },
    },
    {
      $addFields: {
        playedAt: { $toDate: '$ts' },
      },
    },
    {
      $addFields: {
        wrappedYear: { $year: '$playedAt' },
        wrappedMonth: { $month: '$playedAt' },
      },
    },
    {
      $match: {
        wrappedMonth: { $nin: [12] },
      },
    },
    {
      $group: {
        _id: '$wrappedYear',
        totalMsPlayed: { $sum: '$ms_played' },
        trackCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        year: '$_id',
        totalMsPlayed: 1,
        trackCount: 1,
      },
    },
    { $sort: { totalMsPlayed: -1 } },
    { $limit: 20 },
  ];

  return collection.aggregate(pipeline).toArray();
}

async function getTopArtistsForYear(collection, userId, year, limit = 5) {
  const pipeline = [
    {
      $match: {
        userId,
        reason_end: 'trackdone',
        master_metadata_album_artist_name: { $ne: null },
        spotify_track_uri: { $ne: null },
      },
    },
    ...buildYearMatchStage(year),
    {
      $group: {
        _id: '$master_metadata_album_artist_name',
        playCount: { $sum: 1 },
        totalMsPlayed: { $sum: '$ms_played' },
        sampleTrackUri: { $first: '$spotify_track_uri' },
      },
    },
    { $sort: { totalMsPlayed: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        name: '$_id',
        playCount: 1,
        totalMsPlayed: 1,
        sampleTrackUri: 1,
      },
    },
  ];

  return collection.aggregate(pipeline).toArray();
}

async function getTopSongsForYear(collection, userId, year, limit = 5) {
  const pipeline = [
    {
      $match: {
        userId,
        reason_end: 'trackdone',
        master_metadata_track_name: { $ne: null },
        master_metadata_album_artist_name: { $ne: null },
      },
    },
    ...buildYearMatchStage(year),
    {
      $group: {
        _id: {
          track: '$master_metadata_track_name',
          artist: '$master_metadata_album_artist_name',
        },
        playCount: { $sum: 1 },
        totalMsPlayed: { $sum: '$ms_played' },
      },
    },
    { $sort: { playCount: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        track: '$_id.track',
        artist: '$_id.artist',
        playCount: 1,
        totalMsPlayed: 1,
      },
    },
  ];

  return collection.aggregate(pipeline).toArray();
}

async function enrichArtists(accessToken, artists) {
  if (!accessToken || !artists?.length) return { enriched: artists, topGenre: null };
  const trackIds = artists
    .map((artist) => parseTrackId(artist.sampleTrackUri))
    .filter(Boolean);

  const { trackById, artistById } = await fetchArtistMetadata(accessToken, trackIds);
  const genreTally = {};

  const enriched = artists.map((artist) => {
    const trackId = parseTrackId(artist.sampleTrackUri);
    const track = trackId ? trackById[trackId] : null;
    const primaryArtistId = track?.artists?.[0]?.id;
    const artistMeta = primaryArtistId ? artistById[primaryArtistId] : null;

    if (artistMeta?.genres?.length) {
      for (const genre of artistMeta.genres) {
        genreTally[genre] = (genreTally[genre] || 0) + artist.playCount;
      }
    }

    return {
      ...artist,
      imageUrl: track?.album?.images?.[0]?.url || null,
      spotifyArtistId: primaryArtistId || null,
    };
  });

  const topGenre =
    Object.entries(genreTally)
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre)[0] || null;

  return { enriched, topGenre };
}

async function buildWrappedSummaryForUser(userId) {
  if (!collectionName) {
    console.warn('COLLECTION_NAME is not configured');
    return null;
  }

  const collection = await getCollection();
  const stats = await getYearlyStats(collection, userId);
  const eligible = stats.filter((s) => {
    const minutes = s.totalMsPlayed ? s.totalMsPlayed / 60000 : 0;
    return minutes >= MIN_MINUTES_PER_YEAR && s.trackCount >= MIN_TRACKS_PER_YEAR;
  });
  if (!eligible.length) return null;

  const limit = Math.min(MAX_YEAR_CANDIDATES, eligible.length);
  const choice = eligible[Math.floor(Math.random() * limit)] || eligible[0];
  const [artists, songs] = await Promise.all([
    getTopArtistsForYear(collection, userId, choice.year, 5),
    getTopSongsForYear(collection, userId, choice.year, 5),
  ]);

  if (!artists?.length || !songs?.length) return null;

  const minutesListened = Math.round((choice.totalMsPlayed || 0) / 60000);
  let summaryArtists = artists;
  let topGenre = null;

  try {
    const accessToken = await getAccessToken(userId);
    if (accessToken) {
      const { enriched, topGenre: derivedGenre } = await enrichArtists(accessToken, artists);
      summaryArtists = enriched;
      topGenre = derivedGenre;
    }
  } catch (err) {
    console.warn('wrapped summary access token error', err.message || err);
  }

  return {
    year: choice.year,
    minutesListened,
    topGenre,
    topArtists: summaryArtists.map((artist) => ({
      name: artist.name,
      playCount: artist.playCount,
      totalMsPlayed: artist.totalMsPlayed,
      imageUrl: artist.imageUrl || null,
    })),
    topSongs: songs.map((song) => ({
      track: song.track,
      artist: song.artist,
      playCount: song.playCount,
      totalMsPlayed: song.totalMsPlayed,
    })),
  };
}

module.exports = {
  buildWrappedSummaryForUser,
};
