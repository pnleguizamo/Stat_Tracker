const express = require('express');
const router = express.Router();
const { getTrackdoneDocuments, getTopPlayedArtists, getTotalMinutesStreamed, getTopPlayedSongs, getQuery } = require('../services/mongoServices.js');

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

router.get("/test", async (req, res) => {
    try {
        const test = await getQuery();
        res.status(200).json(test);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/top_artists", verifyAccessToken, async (req, res) => {
    try {
        const artists = await getTopPlayedArtists(req.token);
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

router.get("/minutes_streamed", async (req, res) => {
    try {
        const minutes = await getTotalMinutesStreamed();
        res.status(200).json(minutes);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});


module.exports = router;