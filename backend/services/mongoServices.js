const { MongoClient } = require("mongodb");

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

mongoService.getTopPlayedArtists = async function () {
    try {
        await client.connect();
        const collection = db.collection(collectionName);

        // Aggregation pipeline
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
                    "play_count": { "$sum": 1 } 
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

        return topArtists;
    } catch (error) {
        console.error("Error fetching top played artists:", error);
        throw error;
    } finally {
        await client.close();
    }
}

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