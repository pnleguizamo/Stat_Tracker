var express = require("express");
var cors = require("cors");
var bodyParser = require("body-parser");
var fs = require("fs");
var path = require("path");
require('dotenv').config();
const spotifyRoutes = require('./routes/spotifyRoutes.js');
const mongoRoutes = require('./routes/mongoRoutes.js');
const streamHistoryRoutes = require('./routes/streamHistoryRoutes.js')

const { initDb } = require("./mongo.js");
(async () => {
  await initDb();
  require('./services/pollingService.js');
})();

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
// app.use(express.static("public"));
// app.use("/uploads", express.static("uploads"));

const port = process.env.PORT;
const host = "localhost";

app.use((req, res, next) => {
    console.log('Request Type:', req.method, 'Time:', Date.now(), 'Request URL:', req.originalUrl);
    next();
});

app.use('/api/spotify', spotifyRoutes);
app.use('/api/mongo', mongoRoutes);
app.use(streamHistoryRoutes);

app.listen(port, () => {
    console.log("App listening at http://%s:%s", host, port);
});