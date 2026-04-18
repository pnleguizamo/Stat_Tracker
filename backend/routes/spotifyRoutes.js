const { getCurrentlyPlayingTrack, getRecentlyPlayedSongs, getTrackPreview, getArtistPreview } = require('../services/spotifyServices.js');
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

router.get("/track_preview", authenticate, async (req, res) => {
    try {
        const trackName = (req.query.trackName || '').toString().trim();
        const artistName = (req.query.artistName || '').toString().trim();
        const limit = Number(req.query.limit) || 5;
        if (!trackName) {
            return res.status(400).json({ ok: false, error: 'missing_track_name' });
        }

        const resp = await getTrackPreview(trackName, artistName || null, limit);
        const tracks = Array.isArray(resp.tracks) ? resp.tracks : [];
        const firstPreviewUrl = tracks[0]?.previewUrls || null;
        const selectedTrack = tracks.find((track) => track?.previewUrls) || null;
        const selectedIndex = selectedTrack
            ? tracks.findIndex((track) => track?.trackId === selectedTrack.trackId)
            : -1;
        const usedFallbackPreview = selectedIndex > 0;
        console.info('track_preview selection', {
            trackName,
            artistName: artistName || null,
            resultCount: tracks.length,
            firstResultHasPreview: !!firstPreviewUrl,
            fallbackPreviewSearchRan: !firstPreviewUrl && tracks.length > 1,
            selectedIndex,
            usedFallbackPreview,
        });
        const previewUrl = selectedTrack?.previewUrls || null;
        if (!previewUrl) {
            return res.status(404).json({ ok: false, error: 'no_preview' });
        }
        return res.status(200).json({ ok: true, previewUrl, results: resp.tracks });
    } catch (err) {
        console.error({ error: "Track preview error " + err });
        res.status(500).send({ ok: false, error: "track_preview_failed" });
    }

});

router.get("/artist_preview", async (req, res) => {
    try {
        const artistName = (req.query.artistName || '').toString().trim();
        const limit = Number(req.query.limit) || 1;
        if (!artistName) {
            return res.status(400).json({ ok: false, error: 'missing_artist_name' });
        }

        const resp = await getArtistPreview(artistName, limit);
        const tracks = Array.isArray(resp.tracks) ? resp.tracks : [];
        const firstPreviewUrl = tracks[0]?.previewUrl || null;
        const selectedTrack = tracks.find((track) => track?.previewUrl) || null;
        const selectedIndex = selectedTrack
            ? tracks.findIndex((track) => track?.trackId === selectedTrack.trackId)
            : -1;
        const usedFallbackPreview = selectedIndex > 0;
        console.info('artist_preview selection', {
            artistName,
            resultCount: tracks.length,
            firstResultHasPreview: !!firstPreviewUrl,
            fallbackPreviewSearchRan: !firstPreviewUrl && tracks.length > 1,
            selectedIndex,
            usedFallbackPreview,
        });
        const previewUrl = selectedTrack?.previewUrl || null;
        if (!previewUrl) {
            return res.status(404).json({ ok: false, error: 'no_preview' });
        }
        return res.status(200).json({ ok: true, previewUrl, results: resp.tracks });
    } catch (err) {
        console.error({ error: "Artist preview error " + err });
        res.status(500).send({ ok: false, error: "artist_preview_failed" });
    }
});

module.exports = router;
