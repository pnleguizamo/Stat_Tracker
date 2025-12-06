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



module.exports = {getRecentlyPlayedSongs, getAlbumCover, getCurrentlyPlayingTrack}
