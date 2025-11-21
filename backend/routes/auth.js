const express = require('express');
const { storeTokensAndCreateSession } = require('../services/authService.js');
const { initDb } = require('../mongo.js');
const { authenticate } = require('../middleware/authMiddleware.js');

const router = express.Router();

router.post('/complete', async (req, res) => {
  try {
    const { accessToken, refreshToken, expiresIn, spotifyUser } = req.body;

    if (!accessToken || !refreshToken || !spotifyUser?.id) {
      return res.status(400).send('Missing required auth fields');
    }

    const { accountId, displayName, appToken } = await storeTokensAndCreateSession(
      accessToken,
      refreshToken,
      expiresIn,
      spotifyUser
    );

    res.cookie('auth', appToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accountId, displayName });
  } catch (err) {
    console.error('/api/auth/complete error', err);
    return res.status(500).send('Internal server error');
  }
});

router.get('/status', authenticate, async (req, res) => {
  try {
    const accountId = req.accountId;
    const db = await initDb();
    const tokensCol = db.collection('oauth_tokens');
    const doc = await tokensCol.findOne({ accountId });
    const displayName = doc?.display_name || null;
    res.json({ accountId, displayName });
  } catch (err) {
    console.error('/api/auth/status error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
