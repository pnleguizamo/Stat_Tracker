var express = require("express");
var cors = require("cors");
var bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
var fs = require("fs");
var path = require("path");
require('dotenv').config();
const spotifyRoutes = require('./routes/spotifyRoutes.js');

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
// app.use(express.static("public"));
// app.use("/uploads", express.static("uploads"));

const port = process.env.PORT;
const host = "localhost";

// const url = "mongodb://localhost:27017";
const url = process.env.URI;
const dbName = process.env.DB_NAME;
const client = new MongoClient(url);
const db = client.db(dbName);
const collectionName = process.env.COLLECTION_NAME;


app.use((req, res, next) => {
    console.log('Request Type:', req.method, 'Time:', Date.now(), 'Request URL:', req.originalUrl);
    next();
});

app.use('/api/spotify', spotifyRoutes);

app.listen(port, () => {
    console.log("App listening at http://%s:%s", host, port);
});



// const folderPath = '/mnt/c/Users/legui/Documents/Spotify Data/my_spotify_data/Mongo Data';
// async function importJSONFiles(db, collectionName, folderPath) {
//     const collection = db.collection(collectionName);

//     const files = fs.readdirSync(folderPath);
//     console.log("Branch");

//     if (files){
//         // console.log("files: " + files);

//     }
//     for (const file of files) {
//         console.log("Enter loop");
//         if (file.endsWith('.json')) {
//             const filePath = path.join(folderPath, file);
//             const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
//             // console.log(data);
//             await collection.insertMany(data); // Insert into collection
//             console.log("Done");
//         }
//         else{
//             console.log("Not JSON");
//         }
//     }
//     console.log("Branch 2");

//     await client.close();
// }