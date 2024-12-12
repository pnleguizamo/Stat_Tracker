const { MongoClient } = require("mongodb");
const { getAlbumCover } = require('../services/spotifyServices.js');

const url = process.env.URI;
const dbName = process.env.DB_NAME;
const client = new MongoClient(url);
const db = client.db(dbName);
const collectionName = process.env.COLLECTION_NAME;


const mongoService = module.exports = {};

mongoService.getTrackdoneDocuments = async function () {
    try {
        await client.connect();
        const collection = db.collection(collectionName);
        const query = { reason_end: "trackdone" };
        // const query ={ ts: {
        //     $gte: "2019-01-01T00:00:00Z",
        //     $lt: "2020-02-01T00:00:00Z"
        //   }
        // }
        const documents = await collection.find(query).toArray();
        return documents;
    } catch (err) {
        console.error("Error fetching documents:", err);
    } finally {
        await client.close();
    }
}

mongoService.getTopAlbums = async function (accessToken, timeframe = "lifetime") {
    try {
        await client.connect();

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

mongoService.getQuery = async function () {
    try {
        await client.connect();
        const collection = db.collection(collectionName);


        const pipeline = [
            {
                "$match": {
                    "ts": {
                        // $gte: "2020-01-01T00:00:00Z",
                        $lte: "2016-11-01T00:00:00Z"
                    },
                    "reason_end": "trackdone",
                    "master_metadata_album_artist_name": { "$ne": null }
                }
            },
            {
                "$project": {
                    "master_metadata_track_name": 1,
                    "master_metadata_album_artist_name": 1,
                    "ts": 1
                }
            }
            // {
            //     "$group": {
            //         "_id": "$master_metadata_album_artist_name", // Group by track name
            //         "trackCount": { "$sum": 1 }, // Count the occurrences
            //         "totalMinutesPlayed": { "$sum": "$ms_played" }
            //     }
            // }
            // {
            //     "$sort": { "totalMinutesPlayed": -1 } // Sort by track count in descending order
            // },
            // {
            //     "$limit": 10 // Limit to top 10 tracks
            // }



            // {
            //     "$group": {
            //         "_id": "$master_metadata_track_name",
            //         "totalMinutesPlayed": { "$sum": "$ms_played" },
            //         "artist": { "$first": "$master_metadata_album_artist_name" } 
            //     }
            // },
            // {
            //     "$group": {
            //         "_id": "$artist",
            //         "totalMinutesPlayed": { "$sum": "$totalMinutesPlayed" },
            //         "songs": {
            //             "$push": {
            //                 "track_name": "$_id",
            //                 "minutes_played": "$totalMinutesPlayed"
            //             }
            //         }
            //     }
            // },
            // {
            //     "$sort": { "totalMinutesPlayed": -1 }
            // },
            // {
            //     "$limit": 10
            // }
        ];

        const topSongsAndArtists = await collection.aggregate(pipeline).toArray();
        console.log(topSongsAndArtists);

        return topSongsAndArtists;
    } catch (error) {
        console.error("Error fetching top played artists:", error);
        throw error;
    } finally {
        await client.close();
    }
}


mongoService.getTopPlayedArtists = async function (accessToken, timeframe = "lifetime") {
    try {
        await client.connect();
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

        // TODO Refactor getAlbumCover function
        for (let artist of topArtists) {
            if (artist.spotify_uri) {
                const trackId = artist.spotify_uri.split(':')[2];

                const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });

                const trackData = await resp.json();
                const artistId = trackData.artists[0].uri.split(':')[2];

                const spotifyApiUrl = `https://api.spotify.com/v1/artists/${artistId}`;
                const response = await fetch(spotifyApiUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });


                const artistData = await response.json();
                artist.image_url = artistData.images[0].url;
            }
        }

        return topArtists;
    } catch (error) {
        console.error("Error fetching top played artists:", error);
        throw error;
    } finally {
        await client.close();
    }
}

mongoService.getTopPlayedSongs = async function (access_token) {
    try {
        await client.connect();
        const collection = db.collection(collectionName);

        const pipeline = [
            {
                "$match": {
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
    } finally {
        await client.close();
    }
};

mongoService.getTotalMinutesStreamed = async function (timeframe = "lifetime") {
    try {
        await client.connect();
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
    } finally {
        await client.close();
    }
};

mongoService.getSongOfTheDay = async (accessToken) =>{
    try {
        await client.connect();
        const collection = db.collection("rating");
    
        const sotd = await collection.findOne({});

        return sotd;
    
      } catch (error) {
        console.error('Error fetching song of the day:', error);
      } finally {
        await client.close();
      }
}

mongoService.updateSongOfTheDay = async (rating) => {
    try {
        await client.connect();
        const collection = db.collection("rating");
    

        const result = await collection.updateOne(
          {}, // Empty filter to match the single document
          { $set: { rating: rating } }
        );
    
      } catch (error) {
        console.error('Error updating track rating:', error);
        res.status(500).json({ error: 'Internal server error' });
      } finally {
        await client.close();
      }
}


mongoService.updateAlbumsWithImageUrls = async (accessToken) => {
    try {
        // Fetch all albums from the collection
        // const albums = await db.collection(collectionName).find({}).toArray();
        const uniqueTrackUris = await db.collection(collectionName).distinct('spotify_track_uri');

        const albums = await db.collection(collectionName).find({
            spotify_track_uri: { $in: uniqueTrackUris }
        }).toArray();

        // Iterate over each album
        for (let uri of uniqueTrackUris) {
            // if (!album.image_url && album.spotify_track_uri) {
            const album = albums.find(a => a.spotify_track_uri === uri);

            if (album && !album.image_url && uri) {
                const trackId = uri.split(':')[2];

                try {
                    // Fetch track data from Spotify API to get image URL
                    const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });

                    const trackData = await resp.json();

                    if (trackData.album && trackData.album.images && trackData.album.images.length > 0) {
                        const url = trackData.album.images[0].url;

                        // Update the database with the new image URL
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