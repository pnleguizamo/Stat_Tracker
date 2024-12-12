const express = require('express');
const router = express.Router();
const { getTrackdoneDocuments, getTopPlayedArtists, getTotalMinutesStreamed, getTopPlayedSongs, getQuery, getTopAlbums, updateAlbumsWithImageUrls, getSongOfTheDay, updateSongOfTheDay } = require('../services/mongoServices.js');

const verifyAccessToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header missing' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token missing' });
    }

    req.token = token;
    next();
};

router.get("/completed_tracks", async (req, res) => {
    try {
        const tracks = await getTrackdoneDocuments();
        console.log(tracks.length);
        res.status(200).json(tracks.length);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});


router.get('/song-of-the-day', async (req, res) => {
    const sotd = await getSongOfTheDay();

    res.status(200).json(sotd);
});


router.put('/update-rating', async (req, res) => {
    const { rating } = req.body;
    updateSongOfTheDay(rating);
    if (typeof rating !== 'number' || rating < 0 || rating > 5) {
        return res.status(400).json({ error: 'Invalid rating. Must be a number between 0 and 5.' });
    }
    res.json({ message: 'Track rating updated successfully.' });
});

router.get("/test", verifyAccessToken, async (req, res) => {
    try {
        // const test = await updateAlbumsWithImageUrls(req.token);
        res.status(200).json(test);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_artists/:timeframe", verifyAccessToken, async (req, res) => {
    try {
        const artists = await getTopPlayedArtists(req.token, req.params.timeframe);
        // console.log(artists);
        res.status(200).json(artists);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_songs", verifyAccessToken, async (req, res) => {
    try {
        const songs = await getTopPlayedSongs(req.token);
        console.log(songs);
        res.status(200).json(songs);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_albums/:timeframe", verifyAccessToken, async (req, res) => {
    try {
        const albums = await getTopAlbums(req.token, req.params.timeframe);
        console.log(albums);
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