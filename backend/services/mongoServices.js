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
                    "ts" : 1
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


mongoService.getTopPlayedArtists = async function (accessToken) {
    try {
        await client.connect();
        const collection = db.collection(collectionName);


        const pipeline = [
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
        ];


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
                    "master_metadata_album_artist_name": { "$ne": null } ,
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

mongoService.getTotalMinutesStreamed = async function () {
    try {
        await client.connect();
        const collection = db.collection(collectionName);
        const pipeline = [
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
    } finally {
        await client.close();
    }
}