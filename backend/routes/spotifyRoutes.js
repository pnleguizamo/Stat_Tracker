const { getCurrentlyPlayingTrack, getRecentlyPlayedSongs } = require('../services/spotifyServices.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { getAccessToken } = require('../services/authService.js');

const express = require('express');
const router = express.Router();

router.get("/currently_playing", authenticate, async (req, res) => {
    try {
        const accountId = req.accountId;
        const accessToken = await getAccessToken(accountId);
        const track = await getCurrentlyPlayingTrack(accessToken);
        res.status(200).json(track);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/recently_played", authenticate, async (req, res) => {
    try {
        const accountId = req.accountId;
        const accessToken = await getAccessToken(accountId);
        const resp = await getRecentlyPlayedSongs(accessToken);
        res.status(200).json(resp.tracks);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

module.exports = router;