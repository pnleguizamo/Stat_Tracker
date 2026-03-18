const DEFAULT_SPOTIFY_APP_KEYS = ['app1', 'app2', 'app3'];

function normalizeAppKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function configuredAppKeys() {
  const raw = (process.env.SPOTIFY_APP_KEYS || '')
    .split(',')
    .map(normalizeAppKey)
    .filter(Boolean);
  return raw.length ? raw : DEFAULT_SPOTIFY_APP_KEYS;
}

function resolveEnvCredentials(appKey) {
  const prefix = `SPOTIFY_${appKey.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  if (appKey === 'app1' && process.env.CLIENT_ID && process.env.CLIENT_SECRET) {
    return {
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
    };
  }

  return null;
}

function buildSpotifyApps() {
  const apps = {};
  for (const appKey of configuredAppKeys()) {
    const creds = resolveEnvCredentials(appKey);
    if (!creds) continue;
    apps[appKey] = {
      appKey,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: `${process.env.API_BASE_URL}/api/auth/callback`,
    };
  }
  return apps;
}

const SPOTIFY_APPS = Object.freeze(buildSpotifyApps());
const SPOTIFY_DEFAULT_APP_KEY = normalizeAppKey(process.env.SPOTIFY_DEFAULT_APP_KEY);

function getSpotifyApps() {
  return SPOTIFY_APPS;
}

function getDefaultSpotifyAppKey() {
  const apps = getSpotifyApps();
  const configuredKeys = Object.keys(apps);
  if (!configuredKeys.length) {
    throw new Error('No Spotify apps configured');
  }

  if (!SPOTIFY_DEFAULT_APP_KEY) {
    return configuredKeys[0];
  }

  if (!apps[SPOTIFY_DEFAULT_APP_KEY]) {
    throw new Error(`Default Spotify app "${SPOTIFY_DEFAULT_APP_KEY}" is not configured`);
  }

  return SPOTIFY_DEFAULT_APP_KEY;
}

function getSpotifyAppConfig(appKey) {
  const normalized = normalizeAppKey(appKey);
  const apps = getSpotifyApps();
  if (!normalized || !apps[normalized]) {
    throw new Error(`Unknown Spotify app "${normalized || appKey}"`);
  }
  return apps[normalized];
}

module.exports = {
  getSpotifyApps,
  getSpotifyAppConfig,
  getDefaultSpotifyAppKey,
};
