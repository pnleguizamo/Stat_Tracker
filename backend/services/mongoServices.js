const { getAlbumCover } = require('../services/spotifyServices.js');
const { initDb } = require('../mongo.js');
const { cannotHaveAUsernamePasswordPort } = require('whatwg-url');

const collectionName = process.env.COLLECTION_NAME;
let db;

const mongoService = module.exports = {};

const getStartDate = (tf) => {
    if (tf === "month") {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d;
    } else if (tf === "6months") {
        const d = new Date();
        d.setMonth(d.getMonth() - 6);
        return d;
    } else if (tf === "year") {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d;
    }
    return null;
};

mongoService.getTopAlbums = async function (accessToken, userId, timeframe = "lifetime") {
    try {
        db = await initDb();
        const startDate = getStartDate(timeframe);

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
        const trackIds = topAlbums.map(album => album.spotify_uri.split(':')[2]);
        const tracks = await getAlbumCover(accessToken, trackIds);
        const trackMap = new Map(
            tracks.map(t => [t.id, t.album?.images?.[0]?.url || null])
        );
        return topAlbums.map(album => {
            const trackId = album.spotify_uri.split(':')[2];
            return {
                ...album,
                image_url: trackMap.get(trackId) || null
            };
        })
    } catch (err) {
        console.error("Error retrieving top albums:", err);
        throw err;
    }
}

mongoService.getTopPlayedArtists = async function (accessToken, userId, timeframe = "lifetime") {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);

        const startDate = getStartDate(timeframe);
        const matchStage = {
            userId,
            master_metadata_album_artist_name: { $ne: null },
            reason_end: "trackdone"
        };
        if (startDate) {
            matchStage.ts = { $gte: startDate.toISOString() };
        }

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: "$master_metadata_album_artist_name",
                    play_count: { $sum: 1 },
                    spotify_uri: { $first: "$spotify_track_uri" }
                }
            },
            { $sort: { play_count: -1 } },
            { $limit: 25 }
        ];


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
                const trackData = await resp.json();
                const artistByTrackId = {};

                const artistIds = trackData.tracks.map(a => a.artists[0].id);
                const resp2 = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds.join(',')}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                for (const t of trackData.tracks || []) {
                    if (t?.id && t.artists?.[0]?.id) {
                        artistByTrackId[t.id] = t.artists?.[0]?.id;
                    }
                }
                
                const artistsData = await resp2.json();
                
                const imageByArtistId = {};
                for (const t of artistsData.artists || []) {
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

        const trackIds = topSongs.map(song => song.spotify_track_uri.split(':')[2]);
        const tracks = await getAlbumCover(access_token, trackIds);
        const trackMap = new Map(
            tracks.map(t => [t.id, t.album?.images?.[0]?.url || null])
        );
        return topSongs.map(song => {
            const trackId = song.spotify_track_uri.split(':')[2];
            return {
                ...song,
                album_cover: trackMap.get(trackId) || null
            };
        });
    } catch (error) {
        console.error("Error fetching top played songs:", error);
        throw error;
    }
};

mongoService.getTotalMinutesStreamed = async function (userId, timeframe = "lifetime") {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);
        const startDate = getStartDate(timeframe);

        const matchStage = { userId };
        if (startDate) {
            matchStage.ts = { $gte: startDate.toISOString() };
        }

        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalMsPlayed: { $sum: "$ms_played" }
                }
            }
        ];

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

mongoService.getListenCountsForSong = async function(userIds, trackName, artistName) {
  try {
    const db = await initDb();
    const collection = db.collection(collectionName);

    const pipeline = [
      {
        $match: {
          userId: { $in: userIds },
          master_metadata_track_name: trackName,
          master_metadata_album_artist_name: artistName,
          reason_end: "trackdone"
        }
      },
      {
        $group: {
          _id: "$userId",
          play_count: { $sum: 1 }
        }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    console.log(results)

    const listenCounts = {};
    for (const result of results) {
      listenCounts[result._id] = result.play_count;
    }
    
    for (const userId of userIds) {
      if (!listenCounts[userId]) {
        listenCounts[userId] = 0;
      }
    }

    console.log(listenCounts);
    
    return listenCounts;
  } catch (error) {
    console.error("Error fetching listen counts for song:", error);
    throw error;
  }
}

mongoService.getSharedTopSongs = async function (userIds, accessToken, minAccountsPercentage = 1, sampleSize = 1) {
    try {
        if (!userIds || userIds.length === 0) {
            throw new Error('userIds array cannot be empty');
        }

        db = await initDb();
        const collection = db.collection(collectionName);
        const minAccounts = Math.ceil(userIds.length * minAccountsPercentage);

        const pipeline = [
            {
                $match: {
                    userId: { $in: userIds },
                    master_metadata_track_name: { $ne: null },
                    master_metadata_album_artist_name: { $ne: null },
                    reason_end: "trackdone"
                }
            },
            {
                $group: {
                    _id: {
                        track_name: "$master_metadata_track_name",
                        artist_name: "$master_metadata_album_artist_name"
                    },
                    play_count: { $sum: 1 },
                    unique_users: { $addToSet: "$userId" },
                    spotify_track_uri: { $first: "$spotify_track_uri" }
                }
            },
            {
                $addFields: {
                    user_count: { $size: "$unique_users" }
                }
            },
            {
                $match: {
                    user_count: { $gte: minAccounts }
                }
            },
            { 
                $sample: { size: sampleSize } 
            },
            {
                $sort: { play_count: -1 }
            },
            {
                $project: {
                    _id: 1,
                    play_count: 1,
                    user_count: 1,
                    spotify_track_uri: 1,
                    listener_percentage: {
                        $multiply: [
                            { $divide: ["$user_count", userIds.length] },
                            100
                        ]
                    }
                }
            }
        ];

        const sharedSongs = await collection.aggregate(pipeline).toArray();

        const trackIds = sharedSongs.map(song => song.spotify_track_uri?.split(':')[2]).filter(Boolean);
        const tracks = await getAlbumCover(accessToken, trackIds);
        const trackMap = new Map(
            tracks.map(t => [t.id, t.album?.images?.[0]?.url || null])
        );
        sharedSongs.forEach(song => {
            const trackId = song.spotify_track_uri?.split(':')[2];
            song.imageUrl = trackMap.get(trackId) || null;
        });
        

        // Enrich with album covers
        // const enhancedSongs = await Promise.all(
        //     sharedSongs.map(async (song) => {
        //         let album_cover = null;
        //         if (song.spotify_track_uri && accessToken) {
        //             try {
        //                 album_cover = await getAlbumCover(accessToken, song.spotify_track_uri);
        //             } catch (err) {
        //                 console.warn('Failed to fetch album cover for', song._id.track_name, err);
        //             }
        //         }
        //         return {
        //             ...song,
        //             album_cover
        //         };
        //     })
        // );

        return sharedSongs;
    } catch (error) {
        console.error("Error fetching shared top songs:", error);
        throw error;
    }
};