var express = require("express");
var cors = require("cors");
var fs = require("fs");
var path = require("path");
var bodyParser = require("body-parser");
var crypto = require('crypto');
var querystring = require('querystring');

const { MongoClient } = require("mongodb");
require('dotenv').config();
const spotifyRoutes = require('./routes/spotifyRoutes.js');

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const port = process.env.PORT;
console.log(port);
const host = "localhost";

// const url = "mongodb://localhost:27017";
const url = process.env.URI;
const dbName = "stat_tracker";
const client = new MongoClient(url);
const db = client.db(dbName);
const collectionName = 'streamed_tracks';

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = 'http://localhost:8080/callback';


const generateRandomString = (length) => {
    return crypto
        .randomBytes(60)
        .toString('hex')
        .slice(0, length);
}

var stateKey = 'spotify_auth_state';

// app.use(express.static(__dirname + '/public'))
//     .use(cors())
//     .use(cookieParser());

app.get('/login', function (req, res) {

    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    // your application requests authorization
    var scope = 'user-read-private user-read-email user-read-playback-state user-read-recently-played user-top-read';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: client_id,
            scope: scope,
            redirect_uri: redirect_uri,
            state: state
        }));
});

app.get('/callback', async function (req, res) {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect('/#' +
            querystring.stringify({
                error: 'state_mismatch'
            }));
    } else {
        res.clearCookie(stateKey);

        const authOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
            },
            body: querystring.stringify({
                code: code,
                redirect_uri: redirect_uri,
                grant_type: 'authorization_code'
            })
        };

        try {
            const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
            if (!response.ok) {
                return res.redirect('/#' + querystring.stringify({
                    error: 'invalid_token'
                }));
            }

            const body = await response.json();
            const access_token = body.access_token;
            const refresh_token = body.refresh_token;

            const userInfoResponse = await fetch('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': 'Bearer ' + access_token }
            });

            const userInfo = await userInfoResponse.json();
            console.log(userInfo);

            // Redirect to the client with the tokens
            // res.redirect('/#' + querystring.stringify({
            //   access_token: access_token,
            //   refresh_token: refresh_token
            // }));

        } catch (error) {
            console.error('Error during token exchange:', error);
            res.redirect('/#' + querystring.stringify({
                error: 'token_exchange_failed'
            }));
        }
    }
});

app.get('/refresh_token', async function (req, res) {
    const refresh_token = req.query.refresh_token;

    const authOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
        },
        body: querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        })
    };

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
        if (!response.ok) {
            return res.status(500).send({ error: 'Failed to refresh token' });
        }

        const body = await response.json();
        const newAccessToken = body.access_token;
        const newRefreshToken = body.refresh_token;

        res.send({
            'access_token': newAccessToken,
            'refresh_token': newRefreshToken
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).send({ error: 'Failed to refresh token' });
    }
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