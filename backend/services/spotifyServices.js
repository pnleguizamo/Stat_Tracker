async function getCurrentlyPlayingTrack(accessToken) {
    const endpoint = "https://api.spotify.com/v1/me/player/currently-playing";

    try {
        const response = await fetch(endpoint, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (response.status === 204) {
            console.log("No track is currently playing.");
            return null;
        }

        if (!response.ok) {
            throw new Error(`Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.item) {
            const track = {
                name: data.item.name,
                artists: data.item.artists.map((artist) => artist.name).join(", "),
                album: data.item.album.name,
                url: data.item.external_urls.spotify,
                image: data.item.album.images[0]?.url,
            };

            return track;
        }

        console.log("No track is currently playing.");
        return null;
    } catch (error) {
        console.error("Failed to retrieve currently playing track:", error);
        return null;
    }
}

async function getRecentlyPlayedSongs(accessToken, afterMs = null, limit = 50) {
  let allTracks = [];
  let maxPlayedAtMs = afterMs; 
  let url = new URL("https://api.spotify.com/v1/me/player/recently-played");

  if (afterMs != null && afterMs > 0) {
    url.searchParams.set("after", String(afterMs));
  }
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Error fetching recently played songs: ${response.status} ${text}`);
    }

    const data = await response.json();
    const items = data.items || [];

    const pageTracks = items.map(item => {
      const playedAtDate = new Date(item.played_at);
      const playedAtMs = playedAtDate.getTime();
      if (maxPlayedAtMs === null || playedAtMs > maxPlayedAtMs) {
        maxPlayedAtMs = playedAtMs;
      }

      return {
        trackName: item.track.name,
        artistName: item.track.artists[0].name,
        albumName: item.track.album.name,
        trackUri: item.track.uri,
        playedAt: item.played_at,
        duration: item.track.duration_ms
      };
    });

    allTracks.push(...pageTracks);

    return { tracks: allTracks, maxPlayedAtMs };
  } catch (error) {
    console.error("Error in getRecentlyPlayedSongs:", error.message);
    return { tracks: [], maxPlayedAtMs: afterMs };
  }
}

async function getTrackPreview(songName, artistName, limit = 5) {
  try {
    if (!songName) {
      throw new Error('Song name is required');
    }

    const cleanedSongName = songName.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (!cleanedSongName) {
      throw new Error('Song name is required');
    }

    const searchQuery = artistName
      ? `track:"${cleanedSongName}" artist:"${artistName}"`
      : cleanedSongName;

    const url = new URL('https://api.deezer.com/search');
    url.search = new URLSearchParams({
      q: searchQuery,
      limit: String(limit),
    }).toString();

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(`Deezer API error ${response.status}: ${text}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const tracks = data.data || [];

    if (!tracks.length) {
      return { tracks: [], searchQuery };
    }

    const results = tracks.map((track) => ({
      name: `${track.title} - ${track.artist && track.artist.name}`,
      deezerUrl: track.link,
      previewUrls: track.preview || null,
      trackId: track.id,
      albumName: track.album && track.album.title,
      releaseDate: track.release_date || (track.album && track.album.release_date),
      popularity: track.rank,
      durationMs: track.duration ? track.duration * 1000 : undefined,
    }));

    return { tracks: results, searchQuery };
  } catch (error) {
    console.error('deezer preview search failed', {
      songName,
      artist: artistName || null,
      error: error.message,
      status: error.status,
    });
    return { tracks: [], searchQuery: null };
  }
}

async function getArtistPreview(artistName, limit = 1) {
  try {
    if (!artistName) {
      throw new Error('Artist name is required');
    }

    const searchUrl = new URL('https://api.deezer.com/search/artist');
    searchUrl.search = new URLSearchParams({
      q: artistName,
      limit: '1',
    }).toString();

    const searchResponse = await fetch(searchUrl.toString());
    if (!searchResponse.ok) {
      const text = await searchResponse.text().catch(() => '');
      const err = new Error(`Deezer artist search error ${searchResponse.status}: ${text}`);
      err.status = searchResponse.status;
      throw err;
    }

    const searchData = await searchResponse.json();
    const artist = searchData.data?.[0];
    if (!artist?.id) {
      return { tracks: [], artistId: null, searchQuery: artistName };
    }

    const topUrl = new URL(`https://api.deezer.com/artist/${artist.id}/top`);
    topUrl.search = new URLSearchParams({
      limit: String(limit),
    }).toString();

    const topResponse = await fetch(topUrl.toString());
    if (!topResponse.ok) {
      const text = await topResponse.text().catch(() => '');
      const err = new Error(`Deezer artist top tracks error ${topResponse.status}: ${text}`);
      err.status = topResponse.status;
      throw err;
    }

    const topData = await topResponse.json();
    const tracks = topData.data || [];

    if (!tracks.length) {
      return { tracks: [], artistId: artist.id, searchQuery: artistName };
    }

    const results = tracks.map((track) => ({
      name: `${track.title} - ${track.artist && track.artist.name}`,
      previewUrl: track.preview || null,
      trackId: track.id,
      albumName: track.album && track.album.title,
      releaseDate: track.release_date || (track.album && track.album.release_date),
      popularity: track.rank,
      durationMs: track.duration ? track.duration * 1000 : undefined,
    }));

    return { tracks: results, artistId: artist.id, searchQuery: artistName };
  } catch (error) {
    console.error('deezer artist preview failed', {
      artistName,
      error: error.message,
      status: error.status,
    });
    return { tracks: [], artistId: null, searchQuery: null };
  }
}


async function getAlbumCover(accessToken, trackIds) {
    try {
        const url = `https://api.spotify.com/v1/tracks?ids=${trackIds.join(',')}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const data = await response.json();
        return data.tracks || [];
    } catch (error) {
        console.error("Error fetching album cover:", error.response?.data || error.message);
        throw error;
    }
}



module.exports = {getRecentlyPlayedSongs, getAlbumCover, getCurrentlyPlayingTrack, getTrackPreview, getArtistPreview}
