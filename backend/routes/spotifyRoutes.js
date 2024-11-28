const { getCurrentlyPlayingTrack } = require('../services/spotifyServices.js');
const {getAccessToken, fetchProfile, storeVerifier, getVerifier} = require('../services/spotifyAuthServices.js');

const express = require('express');
const router = express.Router();

// router.get("/auth/token/:code", async (req, res) => {
//     try {
//         res.json(await getAccessToken(req.params.code));
//     } catch (err) {
//         console.log(err);
//     }
// });

// router.post("/store_verifier", (req, res) => {
//     const { verifier } = req.body;
//     storeVerifier(verifier);
//     res.status(200).send("Verifier stored.");
// });

// router.get("/auth/profile/:code", async (req, res) => {
//     try {
//         const accessToken = await getAccessToken(req.params.code)
//         res.json(await fetchProfile(accessToken));
//     } catch (err) {
//         console.log(err);
//     }
// });

router.get("/currently_playing", async (req, res) => {
    try {
        const accessToken = await getAccessToken(req.params.code)
        const track = await getCurrentlyPlayingTrack(accessToken); 
        res.status(200).json(track);
    } catch (err) {
        console.error({ error: "An unexpected error occurred" + err });
        res.status(500).send({ error: "An unexpected error occurred" + err });
    }

});


module.exports = router;