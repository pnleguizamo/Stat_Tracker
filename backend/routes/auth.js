const express = require('express');
const { storeTokensAndCreateSession } = require('../services/authService.js');

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

module.exports = router;
