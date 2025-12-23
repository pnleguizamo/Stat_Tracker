class SpotifyRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'SpotifyRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

class SpotifyMetadataClient {
  constructor({ tokenProvider }) {
    if (typeof tokenProvider !== 'function') {
      throw new Error('tokenProvider is required');
    }
    this.tokenProvider = tokenProvider;
    this.baseUrl = 'https://api.spotify.com/v1';
  }

  async request(path) {
    const { token } = await this.tokenProvider();
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 5;
      throw new SpotifyRateLimitError('Spotify rate limited the worker', retryAfter * 1000);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(`Spotify API error ${response.status}: ${text}`);
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  async fetchTracks(trackIds) {
    if (!trackIds.length) return [];
    const data = await this.request(`/tracks?ids=${trackIds.join(',')}`);
    return data.tracks || [];
  }

  async fetchAlbums(albumIds) {
    if (!albumIds.length) return [];
    const data = await this.request(`/albums?ids=${albumIds.join(',')}`);
    return data.albums || [];
  }

  async fetchArtists(artistIds) {
    if (!artistIds.length) return [];
    const data = await this.request(`/artists?ids=${artistIds.join(',')}`);
    return data.artists || [];
  }
}

module.exports = { SpotifyMetadataClient, SpotifyRateLimitError };
