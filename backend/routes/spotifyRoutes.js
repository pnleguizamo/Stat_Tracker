const { getCurrentlyPlayingTrack, getRecentlyPlayedSongs, getAlbumCover } = require('../services/spotifyServices.js');
const { syncRecentStreams } = require('../services/mongoServices.js');

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
        const resp = await getRecentlyPlayedSongs(accessToken);
        res.status(200).json(resp.tracks);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

// router.get("/track_cover:uri", verifyAccessToken, async (req, res) => {
//     try {
//         const accessToken = req.token;
//         const cover = await getAlbumCover(accessToken, req.params.uri);
//         res.status(200).json(cover);
//     } catch (err) {
//         console.error({ error: "An unexpected error occurred" + err });
//         res.status(500).send({ error: "An unexpected error occurred" + err });
//     }

// });

// TODO remove
router.post("/sync_recent_streams", verifyAccessToken, async (req, res) => {
    try {
        const accessToken = req.token;
        const recentTracks = await getRecentlyPlayedSongs(accessToken);
        const newStreamsCount = await syncRecentStreams(recentTracks);
        res.status(200).json({ 
            message: `Successfully synced recent streams`,
            newStreamsAdded: newStreamsCount
        });
    } catch (err) {
        console.error({ error: "Failed to sync recent streams: " + err });
        res.status(500).send({ error: "Failed to sync recent streams: " + err });
    }
});

module.exports = router;