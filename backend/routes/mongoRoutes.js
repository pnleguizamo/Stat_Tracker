const express = require('express');
const router = express.Router();
const { getTopPlayedArtists, getTotalMinutesStreamed, getTopPlayedSongs, getTopAlbums } = require('../services/mongoServices.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { getAccessToken } = require('../services/authService.js');

router.get("/top_artists/:timeframe", authenticate, async (req, res) => {
    try {
        const accountId = req.accountId;
        const accessToken = await getAccessToken(accountId);
        const artists = await getTopPlayedArtists(accessToken, accountId, req.params.timeframe);
        res.status(200).json(artists);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_songs", authenticate, async (req, res) => {
    try {
        const accountId = req.accountId;
        const accessToken = await getAccessToken(accountId);
        const songs = await getTopPlayedSongs(accessToken, accountId);
        res.status(200).json(songs);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_albums/:timeframe", authenticate, async (req, res) => {
    try {
        const accountId = req.accountId;
        const accessToken = await getAccessToken(accountId);
        const albums = await getTopAlbums(accessToken, accountId, req.params.timeframe);
        res.status(200).json(albums);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/minutes_streamed/:timeframe", async (req, res) => {
    try {
        const minutes = await getTotalMinutesStreamed(req.params.timeframe);
        res.status(200).json(minutes);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});


module.exports = router;