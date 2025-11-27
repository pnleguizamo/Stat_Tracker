const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const http = require('http');
const { Server: IOServer } = require('socket.io');
const { initDb } = require('./mongo.js');
const { initGameSockets } = require('./realtime/gameSockets');

const spotifyRoutes = require('./routes/spotifyRoutes.js');
const mongoRoutes = require('./routes/mongoRoutes.js');
const streamHistoryRoutes = require('./routes/streamHistoryRoutes.js');
const authRoutes = require('./routes/auth.js');


const app = express();
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true,
  credentials: true,
}));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.json());

const server = http.createServer(app);

const io = new IOServer(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', socket.id, 'reason:', reason);
  });
});

const port = process.env.PORT;
const host = "localhost";

app.use((req, res, next) => {
  console.log('Request Type:', req.method, 'Time:', Date.now(), 'Request URL:', req.originalUrl);
  next();
});

app.use('/api/spotify', spotifyRoutes);
app.use('/api/mongo', mongoRoutes);
app.use(streamHistoryRoutes);
app.use('/api/auth', authRoutes);

(async () => {
  await initDb();
  require('./services/pollingService.js');
})();

server.listen(port, () => {
  console.log('App listening at http://%s:%s', host, port);
});

initGameSockets(io);

module.exports.io = io;