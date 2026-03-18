function parseInviteEnv() {
  const raw = process.env.SPOTIFY_INVITES_JSON;
  if (!raw) return new Map();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('SPOTIFY_INVITES_JSON must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SPOTIFY_INVITES_JSON must be an object keyed by invite token');
  }

  const invites = new Map();
  for (const [inviteToken, value] of Object.entries(parsed)) {
    const normalizedInviteToken = typeof inviteToken === 'string' ? inviteToken.trim() : '';
    const spotifyAppKey = typeof value?.spotifyAppKey === 'string' ? value.spotifyAppKey.trim() : '';
    const label = typeof value?.label === 'string' ? value.label.trim() : null;

    if (!normalizedInviteToken) {
      throw new Error('SPOTIFY_INVITES_JSON contains an empty invite token');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`SPOTIFY_INVITES_JSON["${normalizedInviteToken}"] must be an object`);
    }
    if (!spotifyAppKey) {
      throw new Error(`SPOTIFY_INVITES_JSON["${normalizedInviteToken}"].spotifyAppKey is required`);
    }

    invites.set(normalizedInviteToken, {
      inviteToken: normalizedInviteToken,
      spotifyAppKey,
      label,
    });
  }

  return invites;
}

const SPOTIFY_INVITES = parseInviteEnv();

function getSpotifyInvites() {
  return SPOTIFY_INVITES;
}

function getSpotifyInvite(inviteToken) {
  const normalized = typeof inviteToken === 'string' ? inviteToken.trim() : '';
  if (!normalized) return null;
  return getSpotifyInvites().get(normalized) || null;
}

module.exports = { getSpotifyInvite, getSpotifyInvites };
