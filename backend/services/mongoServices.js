const { getAlbumCover } = require('../services/spotifyServices.js');
const { initDb } = require('../mongo.js');

const collectionName = process.env.COLLECTION_NAME;
let db;

const mongoService = module.exports = {};

mongoService.getTopAlbums = async function (accessToken, userId, timeframe = "lifetime") {
    try {
        db = await initDb();

        let startDate = null;
        if (timeframe === "month") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
        } else if (timeframe === "6months") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
        } else if (timeframe === "year") {
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const pipeline = [];
        if (startDate) {
            pipeline.push({
                $match: {
                    ts: { $gte: startDate.toISOString() }
                }
            });
        }

        pipeline.push(
            {
                "$match": {
                    "userId" : `${userId}`,
                    "reason_end": "trackdone",
                    "master_metadata_album_artist_name": { "$ne": null }
                }
            },
            {
                $group: {
                    _id: "$master_metadata_album_album_name",
                    "artist": { "$first": "$master_metadata_album_artist_name" },
                    "play_count": { $sum: 1 },
                    "spotify_uri": { "$first": "$spotify_track_uri" }
                }
            },
            {
                $sort: { "play_count": -1 }
            },
            {
                $limit: 25
            }
        );

        const topAlbums = await db.collection(collectionName).aggregate(pipeline).toArray();

        for (let album of topAlbums) {
            if (album.spotify_uri) {
                const trackId = album.spotify_uri.split(':')[2];

                const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });

                const trackData = await resp.json();
                album.image_url = trackData.album.images[0].url;
            }
        }

        return topAlbums;
    } catch (err) {
        console.error("Error retrieving top albums:", err);
        throw err;
    }
}

mongoService.getTopPlayedArtists = async function (accessToken, userId, timeframe = "lifetime") {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);

        let startDate = null;
        if (timeframe === "month") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
        } else if (timeframe === "6months") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
        } else if (timeframe === "year") {
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const pipeline = [];
        if (startDate) {
            pipeline.push({
                $match: {
                    ts: { $gte: startDate.toISOString() }
                }
            });
        }

        pipeline.push(
            {
                "$match": {
                    "userId" : `${userId}`,
                    "master_metadata_album_artist_name": { "$ne": null },
                    "reason_end": "trackdone"
                }
            },
            {
                "$group": {
                    "_id": "$master_metadata_album_artist_name",
                    "play_count": { "$sum": 1 },
                    "spotify_uri": { "$first": "$spotify_track_uri" }
                }
            },
            {
                "$sort": { "play_count": -1 }
            },
            {
                "$limit": 25
            }
        );


        const topArtists = await collection.aggregate(pipeline).toArray();

        const trackIds = topArtists.map(a => a.spotify_uri?.split(':')[2]).filter(Boolean);

        if (trackIds.length) {
            const resp = await fetch(
                `https://api.spotify.com/v1/tracks?ids=${trackIds.join(',')}`,
                {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                }
            );
            if (!resp.ok) {
                console.error('Spotify /tracks error', await resp.text());
            } else {
                const data = await resp.json();
                const artistByTrackId = {};

                const artistIds = data.tracks.map(a => a.artists[0].id);
                const resp2 = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds.join(',')}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                for (const t of data.tracks || []) {
                    if (t?.id && t.artists?.[0]?.id) {
                        artistByTrackId[t.id] = t.artists?.[0]?.id;
                    }
                }
                
                const data2 = await resp2.json();
                
                const imageByArtistId = {};
                for (const t of data2.artists || []) {
                    if (t?.id && t.images?.[0]?.url) {
                        imageByArtistId[t.id] = t.images[0].url;
                    }
                }
                for (const artist of topArtists) {
                    const trackId = artist.spotify_uri?.split(':')[2];
                    artist.image_url = trackId ? imageByArtistId[artistByTrackId[trackId]] ?? null : null;
                }
            }
        }
        // TODO Refactor getAlbumCover function
        // for (let artist of topArtists) {
        //     if (artist.spotify_uri) {
        //         const trackId = artist.spotify_uri.split(':')[2];

        //         const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        //             method: 'GET',
        //             headers: {
        //                 'Authorization': `Bearer ${accessToken}`
        //             }
        //         });

        //         const trackData = await resp.json();
        //         const artistId = trackData.artists[0].uri.split(':')[2];

        //         const spotifyApiUrl = `https://api.spotify.com/v1/artists/${artistId}`;
        //         const response = await fetch(spotifyApiUrl, {
        //             method: 'GET',
        //             headers: {
        //                 'Authorization': `Bearer ${accessToken}`
        //             }
        //         });


        //         const artistData = await response.json();
        //         artist.image_url = artistData.images[0].url;
        //     }
        // }
        // console.log(topArtists)
        return topArtists;
    } catch (error) {
        console.error("Error fetching top played artists:", error);
        throw error;
    }
}

mongoService.getTopPlayedSongs = async function (access_token, userId ) {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);

        const pipeline = [
            {
                "$match": {
                    "userId" : `${userId}`,
                    "master_metadata_track_name": { "$ne": null },
                    "master_metadata_album_artist_name": { "$ne": null },
                    "reason_end": "trackdone"
                }
            },
            {
                "$group": {
                    "_id": {
                        "track_name": "$master_metadata_track_name",
                        "artist_name": "$master_metadata_album_artist_name"
                    },
                    "play_count": { "$sum": 1 },
                    "spotify_track_uri": { "$first": "$spotify_track_uri" }
                }
            },
            {
                "$sort": { "play_count": -1 }
            },
            {
                "$limit": 25
            }
        ];

        const topSongs = await collection.aggregate(pipeline).toArray();

        const enhancedSongs = await Promise.all(
            topSongs.map(async (song) => {
                const albumCover = await getAlbumCover(access_token, song.spotify_track_uri);
                return {
                    ...song,
                    album_cover: albumCover
                };
            })
        );

        return enhancedSongs;

    } catch (error) {
        console.error("Error fetching top played songs:", error);
        throw error;
    }
};

mongoService.getTotalMinutesStreamed = async function (timeframe = "lifetime") {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);

        let startDate = null;
        if (timeframe === "week") {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
        } else if (timeframe === "6months") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
        } else if (timeframe === "year") {
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const pipeline = [];
        if (startDate) {
            pipeline.push({
                $match: {
                    ts: { $gte: startDate.toISOString() }
                }
            });
        }
        pipeline.push({
            $group: {
                _id: null,
                totalMsPlayed: { $sum: "$ms_played" }
            }
        });

        const result = await collection.aggregate(pipeline).toArray();
        const totalMinutesStreamed = result.length > 0 ? result[0].totalMsPlayed / 60000 : 0;

        return totalMinutesStreamed;
    } catch (err) {
        console.error("Error fetching documents:", err);
    }
};

mongoService.syncRecentStreams = async (recentTracks, userId) => {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);        
        const ops = recentTracks.map(track => {
            return {
                updateOne: {
                    filter: {
                        userId,
                        ts : new Date(track.playedAt).toISOString(),
                        spotify_track_uri: track.trackUri
                    },
                    update: {
                        $setOnInsert: {
                            ts: new Date(track.playedAt).toISOString(),
                            userId,
                            master_metadata_track_name: track.trackName,
                            master_metadata_album_artist_name: track.artistName,
                            master_metadata_album_album_name: track.albumName,
                            spotify_track_uri: track.trackUri,
                            ms_played: track.duration, // This is the full duration since we can't know if it was fully played
                            reason_end: "trackdone", // Assuming completed since it's in recent history
                        }
                    },
                    upsert: true
                }
            };
        });

        if (!ops.length) return 0;

        const res = await collection.bulkWrite(ops, { ordered: false });
        // upsertedCount = number of brand-new docs
        return res.upsertedCount || 0;
    } catch (error) {
        console.error('Error syncing recent streams:', error);
        throw error;
    }
};

// TODO
mongoService.updateAlbumsWithImageUrls = async (accessToken) => {
    try {
        db = await initDb();
        // const albums = await db.collection(collectionName).find({}).toArray();
        const uniqueTrackUris = await db.collection(collectionName).distinct('spotify_track_uri');

        const albums = await db.collection(collectionName).find({
            spotify_track_uri: { $in: uniqueTrackUris }
        }).toArray();

        for (let uri of uniqueTrackUris) {
            // if (!album.image_url && album.spotify_track_uri) {
            const album = albums.find(a => a.spotify_track_uri === uri);

            if (album && !album.image_url && uri) {
                const trackId = uri.split(':')[2];

                try {
                    const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });

                    const trackData = await resp.json();

                    if (trackData.album && trackData.album.images && trackData.album.images.length > 0) {
                        const url = trackData.album.images[0].url;

                        await db.collection(collectionName).updateMany(
                            { spotify_track_uri: uri },
                            { $set: { image_url: url } }
                        );
                        console.log("success");
                    } else {
                        console.warn(`No images found for album with track ID ${trackId}`);
                    }

                } catch (error) {
                    console.error('Error updating albums with image URLs:', error);
                }
            }
            else {
                console.log("ALREADY DONE / ERROR")
            }
        }
    } catch (err) {
        console.error("Error updating albums with image URLs:", err);
    }
};