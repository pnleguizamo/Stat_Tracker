const express = require('express');
const { authenticate } = require('../middleware/authMiddleware.js');
const { getAccessToken } = require('../services/authService.js');
const { searchTracks } = require('../services/mongoServices.js');

const router = express.Router();

router.get('/tracks/search', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const limit = Number(req.query.limit) || 10;
    const offset = Number(req.query.offset) || 0;

    const results = await searchTracks(q, { limit, offset });
    res.json({
      ok: true,
      results,
      nextOffset: offset + results.length,
      hasMore: results.length >= limit,
    });
  } catch (err) {
    console.error('Heardle track search failed', err);
    res.status(500).json({ ok: false, error: 'search_failed' });
  }
});

router.get('/playback/token', authenticate, async (req, res) => {
  try {
    const accessToken = await getAccessToken(req.accountId);
    if (!accessToken) {
      return res.status(400).json({ ok: false, error: 'no_access_token' });
    }
    res.json({ ok: true, accessToken });
  } catch (err) {
    console.error('Heardle playback token error', err);
    res.status(500).json({ ok: false, error: 'token_failed' });
  }
});

module.exports = router;
