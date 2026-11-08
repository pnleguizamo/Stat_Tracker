const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');
const { actionKey, makeActions, seededRandom } = require('./botActions');
const { startBot, emitAck } = require('./botClient');
const state = (game, extra = {}) => ({ roomCode: 'TEST', phase: 'inGame', currentStageIndex: 0,
  players: [{ playerId: 'p1', userId: 'u1' }, { playerId: 'p2', userId: 'u2' }],
  currentRoundState: { id: 'round1', minigameId: game, answers: {},
    status: game === 'HEARDLE' ? 'guessing' : game === 'HITSTER' ? 'placing' : 'collecting', ...extra } });

test('repeatable decisions, vote targets, and inactive round guards', () => {
  const a = seededRandom('take'), b = seededRandom('take');
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.equal(makeActions(state('HIGHER_LOWER'), 'p1', { choice: 'RIGHT' })[0].payload.answer.choice, 'RIGHT');
  assert.equal(makeActions(state('GUESS_SPOTIFY_WRAPPED'), 'p1', { targetUserId: 'u2' })[0].payload.answer.targetPlayerId, 'p2');
  assert.equal(actionKey(state('HIGHER_LOWER', { status: 'pending' })), null);
  assert.equal(actionKey(state('HIGHER_LOWER', { status: 'revealed' })), null);
  assert.throws(() => makeActions(state('WHO_LISTENED_MOST'), 'p1', { targetUserId: 'missing' }));
});
test('Heardle responds to each snippet and stops after success', () => {
  const s = state('HEARDLE', { currentSnippetIndex: 0, song: { id: 'song', track_name: 'Song' } });
  assert.equal(makeActions(s, 'p1', { guesses: ['wrong'] })[0].payload.guess.trackId, 'bot-wrong-guess');
  s.currentRoundState.answers.p1 = { guesses: [{ snippetIndex: 0, outcome: 'wrong' }] };
  assert.deepEqual(makeActions(s, 'p1'), []);
  const key = actionKey(s);
  s.currentRoundState.currentSnippetIndex = 1;
  assert.notEqual(actionKey(s), key);
  assert.equal(makeActions(s, 'p1', { guesses: ['wrong', 'correct'] })[0].payload.guess.trackId, 'song');
  s.currentRoundState.answers.p1.guesses.push({ snippetIndex: 1, outcome: 'correct' });
  s.currentRoundState.currentSnippetIndex = 2;
  assert.deepEqual(makeActions(s, 'p1'), []);
});
test('Hitster guesses before confirming a valid gap', () => {
  const s = state('HITSTER', { year: 2000, song: { id: 'song' }, timelines: { p1: { cards: [{ year: 1990 }, { year: 2010 }] } } });
  const actions = makeActions(s, 'p1', { gapIndex: 'correct', songGuess: 'correct' });
  assert.equal(actions[0].event, 'minigame:HITSTER:submitSongGuess');
  assert.deepEqual(actions[1].payload, { gapIndex: 1, finalize: true });
  assert.throws(() => makeActions(s, 'p1', { gapIndex: 9 }));
});
test('bot identities require opt-in in development and production; ordinary guests cannot impersonate', () => {
  const { socketAuthMiddleware } = require('../realtime/socketAuth');
  const old = { NODE_ENV: process.env.NODE_ENV, ENABLE_DEV_BOTS: process.env.ENABLE_DEV_BOTS, JWT_SECRET: process.env.JWT_SECRET };
  process.env.JWT_SECRET = 'bot-test-only';
  function auth(payload) {
    const socket = { handshake: { headers: { cookie: `auth=${jwt.sign(payload, process.env.JWT_SECRET)}` } } };
    let error; socketAuthMiddleware(socket, err => { error = err; }); return { socket, error };
  }
  try {
    process.env.NODE_ENV = 'development'; process.env.ENABLE_DEV_BOTS = 'true';
    const p = { sub: 'u1', gid: 'bot-one', guest: true, devBot: true, spotifyUserId: 'u1' };
    assert.equal(auth(p).socket.accountId, 'u1');
    assert.equal(auth({ ...p, devBot: false }).socket.accountId, null);
    assert.ok(auth({ ...p, gid: undefined }).error);
    process.env.ENABLE_DEV_BOTS = 'false'; assert.ok(auth(p).error);
    process.env.NODE_ENV = 'production';
    assert.ok(auth(p).error);
    process.env.ENABLE_DEV_BOTS = 'true';
    assert.equal(auth(p).socket.accountId, 'u1');
    assert.equal(auth({ ...p, devBot: false }).socket.accountId, null);
    assert.ok(auth({ ...p, spotifyUserId: '' }).error);
  } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});
async function waitFor(check) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for sockets'); await new Promise(r => setTimeout(r, 10)); }
}
test('real sockets: profile ready at join, one reveal, reconnect identity, stale action cancellation', async t => {
  process.env.NODE_ENV = 'production'; process.env.ENABLE_DEV_BOTS = 'true';
  process.env.JWT_SECRET = 'bot-integration-only'; process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/bot-tests';
  const mongo = require('../mongo');
  const original = mongo.initDb;
  // Substitute storage only; run actual authentication, room and minigame handlers.
  mongo.initDb = async () => ({ collection: () => ({ findOne: async ({ accountId }) => {
    await new Promise(r => setTimeout(r, 15));
    return { display_name: `Name ${accountId}`, avatar_url: `${accountId}.png` };
  } }) });
  const server = http.createServer();
  const serverIo = require('../realtime/socketServer').initSocket(server);
  const rooms = require('../realtime/rooms');
  const sockets = [], stops = []; let roomCode;
  t.after(async () => {
    stops.forEach(stop => stop());
    const room = rooms.getRoom(roomCode);
    if (room) for (const id of [...room.players.keys()]) rooms.removePlayer(roomCode, id);
    sockets.forEach(s => s.disconnect());
    await new Promise(r => serverIo.close(r));
    const remaining = rooms.getRoom(roomCode);
    if (remaining) {
      for (const id of [...remaining.players.keys()]) rooms.removePlayer(roomCode, id);
      rooms.removePlayer(roomCode, remaining.hostPlayerId);
    }
    mongo.initDb = original;
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  function connection(user, guest = false) {
    const p = guest ? { sub: user, gid: user, guest: true, devBot: true, spotifyUserId: user } : { sub: user };
    const s = io(url, { autoConnect: false, forceNew: true, extraHeaders: { cookie: `auth=${jwt.sign(p, process.env.JWT_SECRET)}` } });
    sockets.push(s); return s;
  }
  const host = connection('host'); host.connect(); await once(host, 'connect');
  ({ roomCode } = await emitAck(host, 'createRoom', {}));
  const logs = [], bot = connection('u1', true);
  stops.push(startBot(bot, { roomCode, userId: 'u1', playerId: 'g:u1', minDelayMs: 50, maxDelayMs: 50,
    scripts: { WHO_LISTENED_MOST: [{ targetUserId: 'u1' }] } }, m => logs.push(m)));
  await waitFor(() => logs.some(l => l.includes('joined')));
  const second = connection('u2', true);
  stops.push(startBot(second, { roomCode, userId: 'u2', playerId: 'g:u2',
    minDelayMs: 80, maxDelayMs: 80,
    scripts: { WHO_LISTENED_MOST: [{ targetUserId: 'u1' }] } }, m => logs.push(m)));
  await waitFor(() => logs.filter(l => l.includes('joined')).length === 2);
  const room = rooms.getRoom(roomCode);
  assert.equal(room.players.get('g:u1').displayName, 'Name u1');
  assert.equal(room.players.get('g:u1').avatar, 'u1.png');
  rooms.startGame(roomCode);
  room.roundState[0] = { ...state('WHO_LISTENED_MOST').currentRoundState, startedAt: Date.now(), prompt: { listenCounts: { u1: 10, u2: 5 } } };
  const broadcast = () => serverIo.to(roomCode).emit('gameStateUpdated', rooms.getGameState(roomCode));
  broadcast(); broadcast(); broadcast();
  await waitFor(() => room.roundState[0].status === 'revealed');
  assert.equal(room.stageRoundHistory[0].length, 1);
  assert.equal(room.roundState[0].results.totalVotes, 2);
  assert.equal(room.scoreboard['g:u1'].stats.correctAnswers, 1);
  bot.disconnect(); bot.connect();
  await waitFor(() => logs.filter(l => l.includes('joined')).length === 3);
  assert.equal(room.players.size, 2); assert.equal(room.stageRoundHistory[0].length, 1);
  room.roundState[0] = { ...room.roundState[0], id: 'cancel-me', status: 'collecting', answers: {} };
  broadcast(); await new Promise(r => setTimeout(r, 10));
  room.roundState[0].status = 'revealed'; broadcast(); await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(room.roundState[0].answers, {});
});
