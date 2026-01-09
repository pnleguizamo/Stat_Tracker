const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const http = require('http');
const { initDb } = require('./mongo.js');
const { initSocket } = require('./realtime/socketServer');
const { startMetadataCacheWorker } = require('./services/metadataCacheWorker.js');
const { startRollupWorker } = require('./scripts/rollupWorker.js');

const spotifyRoutes = require('./routes/spotifyRoutes.js');
const mongoRoutes = require('./routes/mongoRoutes.js');
const streamHistoryRoutes = require('./routes/streamHistoryRoutes.js');
const authRoutes = require('./routes/auth.js');
const heardleRoutes = require('./routes/heardleRoutes.js');


const app = express();
const allowed = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  process.env.FRONTEND_ORIGIN
];
app.use(cors({
  origin: allowed,
  credentials: true,
}));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.json());

const server = http.createServer(app);

const io = initSocket(server);

const port = process.env.PORT;
const host = "127.0.0.1";

app.use((req, res, next) => {
  console.log('Request Type:', req.method, 'Time:', Date.now(), 'Request URL:', req.originalUrl);
  next();
});

app.use('/api/spotify', spotifyRoutes);
app.use('/api/mongo', mongoRoutes);
app.use(streamHistoryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/heardle', heardleRoutes);

(async () => {
  await initDb();
  if (process.env.NODE_ENV === 'production') {
    require('./services/pollingService.js');
    startMetadataCacheWorker();
    startRollupWorker({ reason: 'server-start', registerSignals: false });
  }
})();

server.listen(port, () => {
  console.log('App listening at http://%s:%s', host, port);
});

module.exports.io = io;
