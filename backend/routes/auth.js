const express = require('express');
const { storeTokensAndCreateSession, createGuestSession } = require('../services/authService.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { initDb } = require('../mongo.js');
const { getSpotifyAppConfig } = require('../config/spotifyApps.js');
const { getSpotifyInvite } = require('../config/spotifyInvites.js');

const router = express.Router();

const pkceStore = new Map();
const PKCE_TTL_MS = 1000 * 60 * 10;
const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SPOTIFY_APP_COOKIE_NAME = 'spotifyAppKey';
const SPOTIFY_APP_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

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

function buildCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
  };
}

function setSpotifyAppCookie(res, spotifyAppKey) {
  res.cookie(SPOTIFY_APP_COOKIE_NAME, spotifyAppKey, {
    ...buildCookieOptions(SPOTIFY_APP_COOKIE_MAX_AGE_MS),
    signed: true,
  });
}

function clearSpotifyAppCookie(res) {
  res.clearCookie(SPOTIFY_APP_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

function resolveSpotifyAppKey(req, res) {
  const inviteToken = typeof req.body?.inviteToken === 'string' ? req.body.inviteToken.trim() : '';
  if (inviteToken) {
    const invite = getSpotifyInvite(inviteToken);
    if (!invite) {
      return {
        ok: false,
        status: 400,
        body: { error: 'invalid_invite_token', message: 'That invite link is invalid or expired.' },
      };
    }

    try {
      getSpotifyAppConfig(invite.spotifyAppKey);
      return { ok: true, spotifyAppKey: invite.spotifyAppKey };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        body: { error: 'spotify_app_not_configured', message: 'Assigned Spotify app is not configured.' },
      };
    }
  }

  const rememberedAppKey =
    typeof req.signedCookies?.[SPOTIFY_APP_COOKIE_NAME] === 'string'
      ? req.signedCookies[SPOTIFY_APP_COOKIE_NAME].trim()
      : '';
  if (rememberedAppKey) {
    try {
      getSpotifyAppConfig(rememberedAppKey);
      return { ok: true, spotifyAppKey: rememberedAppKey };
    } catch (err) {
      clearSpotifyAppCookie(res);
    }
  }

  if (typeof req.cookies?.[SPOTIFY_APP_COOKIE_NAME] === 'string') {
    clearSpotifyAppCookie(res);
  }

  return {
    ok: false,
    status: 409,
    body: {
      error: 'first_time_setup_required',
      message: 'Use your invite link for your first Spotify login on this browser.',
    },
  };
}

router.get('/status', authenticate, async (req, res) => {
  try {
    const accountId = req.accountId;
    const isGuest = !!(req.authPayload && req.authPayload.guest);

    if (isGuest) {
      return res.json({
        accountId,
        spotifyUser: {
          id: accountId,
          display_name: req.authPayload?.displayName || 'Guest',
          email: null,
          images: [],
          is_guest: true,
        },
      });
    }

    const db = await initDb();
    const row = await db.collection('oauth_tokens').findOne({ accountId });

    const spotifyUser = {
      id: row?.accountId || accountId,
      display_name: row?.display_name || null,
      email: row?.email || null,
      images: row?.avatar_url ? [{ url: row.avatar_url }] : [],
      is_guest: false,
    };

    res.json({ accountId, spotifyUser });
  } catch (err) {
    console.error('/api/auth/status error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/start', async (req, res) => {
  try {
    const resolved = resolveSpotifyAppKey(req, res);
    if (!resolved.ok) {
      return res.status(resolved.status).json(resolved.body);
    }

    const spotifyApp = getSpotifyAppConfig(resolved.spotifyAppKey);
    const state = generateRandomString(24);
    const verifier = generateRandomString(96);
    const challenge = await generateCodeChallenge(verifier);

    pkceStore.set(state, { verifier, spotifyAppKey: spotifyApp.appKey });
    setTimeout(() => pkceStore.delete(state), PKCE_TTL_MS);

    const params = new URLSearchParams();
    params.append('client_id', spotifyApp.clientId);
    params.append('response_type', 'code');
    params.append('redirect_uri', spotifyApp.redirectUri);
    params.append('scope', 'user-read-private user-read-email user-read-playback-state user-modify-playback-state streaming user-read-recently-played user-top-read');
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

    res.cookie('auth', appToken, buildCookieOptions(AUTH_COOKIE_MAX_AGE_MS));

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

    const pkceState = pkceStore.get(state);
    if (!pkceState?.verifier) {
      console.error('No PKCE verifier found for state', state);
      return res.redirect(`${frontendRedirect}?error=no_verifier`);
    }

    let spotifyApp;
    try {
      spotifyApp = getSpotifyAppConfig(pkceState.spotifyAppKey);
    } catch (err) {
      console.error('No Spotify app assignment found for state', state, err.message);
      pkceStore.delete(state);
      return res.redirect(`${frontendRedirect}?error=no_app_assignment`);
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', spotifyApp.redirectUri);
    params.append('code_verifier', pkceState.verifier);

    const basic = Buffer.from(`${spotifyApp.clientId}:${spotifyApp.clientSecret}`).toString('base64');

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
    const db = await initDb();
    const existingAuth = await db.collection('oauth_tokens').findOne(
      { accountId: spotifyUser.id },
      { projection: { accountId: 1, spotifyAppKey: 1 } }
    );

    if (existingAuth?.spotifyAppKey && existingAuth.spotifyAppKey !== spotifyApp.appKey) {
      console.error(
        'Spotify app mismatch during callback',
        JSON.stringify({
          accountId: existingAuth.accountId,
          storedSpotifyAppKey: existingAuth.spotifyAppKey,
          attemptedSpotifyAppKey: spotifyApp.appKey,
        })
      );
      pkceStore.delete(state);
      return res.redirect(`${frontendRedirect}?error=spotify_app_mismatch`);
    }

    const { accountId, appToken } = await storeTokensAndCreateSession(
      access_token,
      refresh_token,
      expires_in,
      spotifyUser,
      spotifyApp.appKey
    );

    pkceStore.delete(state);

    res.cookie('auth', appToken, buildCookieOptions(AUTH_COOKIE_MAX_AGE_MS));
    setSpotifyAppCookie(res, spotifyApp.appKey);

    return res.redirect(`${frontendRedirect}?accountId=${encodeURIComponent(accountId)}`);
  } catch (err) {
    console.error('/api/auth/callback error', err);
    const frontendRedirect = `${process.env.FRONTEND_BASE_URL || process.env.REACT_APP_BASE_URL || ''}/callback`;
    return res.redirect(`${frontendRedirect}?error=internal`);
  }
});

module.exports = router;
