const { initDb, COLLECTIONS } = require('../mongo');

const MIN_MINUTES_PER_YEAR = 500;
const MIN_TRACKS_PER_YEAR = 100;
const MAX_YEAR_CANDIDATES = 5;

function pickTopGenre(artists = []) {
  const tally = {};
  for (const artist of artists) {
    for (const genre of artist.genres || []) {
      tally[genre] = (tally[genre] || 0) + (artist.plays || 0);
    }
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

async function buildWrappedSummaryForUser(userId) {
  const db = await initDb();
  const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
  const snapshot = await snapshotsCol.findOne(
    { userId },
    { projection: { windows: 1 } }
  );

  const windows = snapshot?.windows || {};
  const candidates = Object.entries(windows)
    .filter(([key, win]) => key.startsWith('year') && win?.totals)
    .map(([key, win]) => {
      const minutes = Math.round((win.totals?.msPlayed || 0) / 60000);
      const trackCount = win.uniqueTracks ?? win.totals?.plays ?? 0;
      const year = Number(key.replace('year', ''));
      return {
        key,
        year,
        minutes,
        trackCount,
        window: win,
      };
    })
    .filter((c) => c.minutes >= MIN_MINUTES_PER_YEAR && c.trackCount >= MIN_TRACKS_PER_YEAR)
    .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));

  if (!candidates.length) return null;

  const limit = Math.min(MAX_YEAR_CANDIDATES, candidates.length);
  const choice = candidates[Math.floor(Math.random() * limit)] || candidates[0];

  const window = choice.window || {};
  const topArtists = (window.topArtists || []).slice(0, 5);
  const topTracks = (window.topTracks || []).slice(0, 5);

  if (!topArtists.length || !topTracks.length) return null;

  const topGenre = pickTopGenre(topArtists);

  return {
    year: choice.year || null,
    minutesListened: choice.minutes || 0,
    topGenre,
    topArtists: topArtists.map((artist) => ({
      name: artist.name || null,
      playCount: artist.plays || 0,
      totalMsPlayed: artist.msPlayed || 0,
      imageUrl: artist.images?.[0]?.url || null,
    })),
    topSongs: topTracks.map((track) => ({
      track: track.trackName || null,
      artist: track.artistNames?.[0] || null,
      playCount: track.plays || 0,
      totalMsPlayed: track.msPlayed || 0,
      imageUrl: track.images?.[0]?.url || null,
    })),
  };
}

module.exports = {
  buildWrappedSummaryForUser,
};
