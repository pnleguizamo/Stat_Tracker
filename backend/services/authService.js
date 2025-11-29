const { initDb } = require('../mongo.js');
const jwt = require('jsonwebtoken');

async function storeTokensAndCreateSession(accessToken, refreshToken, expiresIn, spotifyUser) {
  const db = await initDb();
  const oauthTokens = db.collection('oauth_tokens');
  const accountId = spotifyUser.id;

  await oauthTokens.updateOne(
    { accountId },
    {
      $set: {
        accountId: spotifyUser.id,
        display_name: spotifyUser.display_name,
        avatar_url: (spotifyUser.images && spotifyUser.images[0] && spotifyUser.images[0].url) || null,
        email: spotifyUser.email,
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
        refreshToken,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const appToken = jwt.sign({ sub: accountId }, process.env.JWT_SECRET, { expiresIn: '7d' });

  return { accountId, displayName: spotifyUser.display_name, appToken };
}

async function refreshAccessTokenWithSpotify(row) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refreshToken,
  });

  const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Spotify refresh failed ${r.status} ${txt}`);
  }

  const json = await r.json();
  return json; 
}

async function getAccessToken(accountId) {
  const db = await initDb();
  const tokensCol = db.collection('oauth_tokens');
  const row = await tokensCol.findOne({ accountId });

  if (!row) return null;

  const now = new Date();
  if (row.accessToken && row.accessTokenExpiresAt && new Date(row.accessTokenExpiresAt) > now) {
    return row.accessToken;
  }

  if (!row.refreshToken) {
    throw new Error('No refresh token available for account ' + accountId);
  }

  const refreshed = await refreshAccessTokenWithSpotify(row);
  const newAccess = refreshed.access_token;
  const expiresIn = refreshed.expires_in;

  const update = {
    accessToken: newAccess,
    accessTokenExpiresAt: new Date(Date.now() + (expiresIn - 60) * 1000),
    updatedAt: new Date(),
  };
  if (refreshed.refresh_token) update.refreshToken = refreshed.refresh_token;

  await tokensCol.updateOne({ accountId }, { $set: update });
  return newAccess;
}

async function createGuestSession() {
  const impersonate = process.env.GUEST_IMPERSONATE_ACCOUNT

  const claims = {
    sub: impersonate,
    guest: true,
    displayName: "Guest",
  };

  const appToken = jwt.sign(claims, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

  return { accountId: claims.sub, appToken };
}

module.exports = { getAccessToken, storeTokensAndCreateSession, createGuestSession };
