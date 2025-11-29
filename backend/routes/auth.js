const express = require('express');
const { storeTokensAndCreateSession, createGuestSession } = require('../services/authService.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { initDb } = require('../mongo.js');

const router = express.Router();

const pkceStore = new Map();
const PKCE_TTL_MS = 1000 * 60 * 10;

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandomString(length = 64) {
  return base64UrlEncode(require('crypto').randomBytes(length)).slice(0, length);
}

async function generateCodeChallenge(verifier) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

router.get('/status', authenticate, async (req, res) => {
  try {
    const accountId = req.accountId;
    const db = await initDb();
    const row = await db.collection('oauth_tokens').findOne({ accountId });
    
    spotifyUser = {
      id: row.accountId,
      display_name: row.display_name || null,
      email: row.email || null,
      images: row.avatar_url ? [{ url: row.avatar_url }] : [],
      is_guest: false,
    };
    

    if (req.authPayload && req.authPayload.guest){
      spotifyUser.is_guest = true;
      spotifyUser.display_name = "Guest";
    }
    
    res.json({ accountId, spotifyUser });
  } catch (err) {
    console.error('/api/auth/status error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/start', async (req, res) => {
  try {
    const state = generateRandomString(24);
    const verifier = generateRandomString(96);
    const challenge = await generateCodeChallenge(verifier);

    pkceStore.set(state, verifier);
    setTimeout(() => pkceStore.delete(state), PKCE_TTL_MS);

    const params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('response_type', 'code');
    params.append('redirect_uri', `${process.env.API_BASE_URL}/api/auth/callback`);
    params.append('scope', 'user-read-private user-read-email user-read-playback-state user-read-recently-played user-top-read');
    params.append('state', state);
    params.append('code_challenge_method', 'S256');
    params.append('code_challenge', challenge);

    const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
    return res.json({ url, state });
  } catch (err) {
    console.error('/api/auth/start error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/guest', async (req, res) => {
  try {
    const { accountId, appToken } = await createGuestSession();

    res.cookie('auth', appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accountId });
  } catch (err) {
    console.error('/api/auth/guest error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const frontendRedirect = `${process.env.FRONTEND_ORIGIN}/dashboard`;

    if (error) {
      console.error('Spotify callback error', error);
      return res.redirect(`${frontendRedirect}?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.error('Missing code or state in callback');
      return res.redirect(`${frontendRedirect}?error=missing_code_or_state`);
    }

    const verifier = pkceStore.get(state);
    if (!verifier) {
      console.error('No PKCE verifier found for state', state);
      return res.redirect(`${frontendRedirect}?error=no_verifier`);
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', `${process.env.API_BASE_URL}/api/auth/callback`);
    params.append('code_verifier', verifier);

    const basic = Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      console.error('Spotify token exchange failed (callback)', tokenRes.status, txt);
      return res.redirect(`${frontendRedirect}?error=token_exchange_failed`);
    }

    const tokenJson = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenJson;

    if (!access_token) {
      console.error('No access token returned from Spotify in callback');
      return res.redirect(`${frontendRedirect}?error=no_access_token`);
    }

    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileRes.ok) {
      const txt = await profileRes.text().catch(() => '');
      console.error('Failed fetching profile from Spotify (callback)', profileRes.status, txt);
      return res.redirect(`${frontendRedirect}?error=fetch_profile_failed`);
    }

    const spotifyUser = await profileRes.json();

    const { accountId, appToken } = await storeTokensAndCreateSession(
      access_token,
      refresh_token,
      expires_in,
      spotifyUser
    );

    pkceStore.delete(state);

    res.cookie('auth', appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.redirect(`${frontendRedirect}?accountId=${encodeURIComponent(accountId)}`);
  } catch (err) {
    console.error('/api/auth/callback error', err);
    const frontendRedirect = `${process.env.FRONTEND_BASE_URL || process.env.REACT_APP_BASE_URL || ''}/callback`;
    return res.redirect(`${frontendRedirect}?error=internal`);
  }
});

module.exports = router;
