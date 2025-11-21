const express = require('express');
const router = express.Router();
const { getTrackdoneDocuments, getTopPlayedArtists, getTotalMinutesStreamed, getTopPlayedSongs, getQuery, getTopAlbums, updateAlbumsWithImageUrls, getSongOfTheDay, updateSongOfTheDay, storeToken } = require('../services/mongoServices.js');
const { authenticate } = require('../middleware/authMiddleware.js');
const { getAccessToken } = require('../services/authService.js');

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

router.get("/test", async (req, res) => {
    try {
        // const test = await updateAlbumsWithImageUrls(req.token);
        res.status(200).json(test);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});

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
        const songs = await getTopPlayedSongs(accessToken);
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
        const albums = await getTopAlbums(accessToken, req.params.timeframe);
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

// router.post("/store_token", async (req, res) => {
//     try {
//         const { accessToken, refreshToken, expiresIn, spotifyUser } = req.body;

//         if (!refreshToken) {
//             return res.status(400).json({ error: "No refresh token from Spotify" });
//         }

//         const resp = await storeToken(accessToken, refreshToken, expiresIn, spotifyUser);
//         res.status(200).json(resp);

//     } catch (err) {
//         console.error({ error: "An unexpected error occurred" + err });
//         res.status(500).send({ error: "An unexpected error occurred" + err });
//     }
// });


module.exports = router;