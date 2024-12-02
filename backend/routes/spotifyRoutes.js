const { getCurrentlyPlayingTrack, getRecentlyPlayedSongs } = require('../services/spotifyServices.js');

const express = require('express');
const router = express.Router();


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

router.get("/currently_playing", verifyAccessToken, async (req, res) => {
    try {
        const accessToken = req.token;
        const track = await getCurrentlyPlayingTrack(accessToken);
        res.status(200).json(track);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

router.get("/recently_played", verifyAccessToken, async (req, res) => {
    try {
        const accessToken = req.token;
        const track = await getRecentlyPlayedSongs(accessToken);
        res.status(200).json(track);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});


module.exports = router;