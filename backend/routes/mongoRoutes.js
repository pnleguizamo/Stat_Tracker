const express = require('express');
const router = express.Router();
const { getTrackdoneDocuments, getTopPlayedArtists, getTotalMinutesStreamed } = require('../services/mongoServices.js');

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

router.get("/top_artists", async (req, res) => {
    try {
        const artists = await getTopPlayedArtists();
        console.log(artists);
        res.status(200).json(artists);
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