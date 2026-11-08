const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const { io } = require('socket.io-client');
const { startBot } = require('./botClient');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=') || true];
  }));
  if (args.help) {
    console.log('npm run bots -- --room=ABCD [--users=id1,id2 | --count=4] [--config=path.json] [--seed=trailer] [--url=http://127.0.0.1:3000] [--check]');
    return;
  }
  if (process.env.ENABLE_DEV_BOTS !== 'true') throw new Error('Set ENABLE_DEV_BOTS=true in backend/.env and restart the server');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  const config = args.config ? JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')) : {};
  const roomCode = String(args.room || config.roomCode || '').toUpperCase();
  if (!args.check && !/^[A-Z0-9]{4}$/.test(roomCode)) throw new Error('Supply --room=<four character room code>');
  const serverUrl = args.url || config.serverUrl || `http://127.0.0.1:${process.env.PORT || 3000}`;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(serverUrl).hostname)) {
    throw new Error('Bot connections are restricted to the local app server');
  }
  const requested = args.users ? String(args.users).split(',') : config.bots?.map(b => b.userId);
  const count = Number(args.count || config.count || 4);
  if (!requested && (!Number.isInteger(count) || count < 1 || count > 20)) throw new Error('count must be 1–20');
  if (requested && (requested.length > 20 || new Set(requested).size !== requested.length || requested.some(id => !id))) {
    throw new Error('Provide 1–20 distinct nonempty user IDs');
  }
  const minDelayMs = config.minDelayMs ?? 2500;
  const maxDelayMs = config.maxDelayMs ?? 6000;
  if (![minDelayMs, maxDelayMs].every(n => Number.isFinite(n) && n >= 0) || minDelayMs > maxDelayMs) {
    throw new Error('Invalid delay range');
  }
  const uri = process.env.URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Set URI or MONGO_URI in backend/.env');
  const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  let profiles;
  try {
    await mongo.connect();
    const db = mongo.db(process.env.DB_NAME);
    profiles = await db.collection('oauth_tokens').find(
      requested ? { accountId: { $in: requested } } : {},
      { projection: { accountId: 1, display_name: 1, avatar_url: 1 }, sort: { accountId: 1 } }
    ).toArray();
    // Query profile fields only. The runner never reads or modifies Spotify tokens.
    const eligible = [];
    for (const p of profiles) {
      const hasData = process.env.USER_TRACK_COUNTS_COLLECTION && await db.collection(process.env.USER_TRACK_COUNTS_COLLECTION)
        .findOne({ userId: p.accountId }, { projection: { _id: 1 } });
      if (hasData) eligible.push(p);
      else console.warn(`[preflight] ${p.display_name || p.accountId}: no track rollups; skipped`);
    }
    profiles = requested ? requested.map(id => {
      const p = eligible.find(row => row.accountId === id);
      if (!p) throw new Error(`Missing saved profile or track rollups for ${id}`);
      return p;
    }) : eligible.slice(0, count);
    if (!profiles.length) throw new Error('No users with saved profiles and track rollups found');
  } finally {
    await mongo.close();
  }
  console.log(`Selected ${profiles.length} users: ${profiles.map(p => `${p.display_name || p.accountId} (${p.accountId})`).join(', ')}`);
  console.log('Profile and rollup checks passed. Song overlap, Wrapped summaries and Spotify playback are checked by the live minigames.');
  if (args.check) return;
  const stops = [];
  const stop = () => { stops.forEach(fn => fn()); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  profiles.forEach((p, index) => {
    const gid = `bot-${randomUUID()}`;
    const token = jwt.sign({ sub: p.accountId, gid, guest: true, devBot: true,
      spotifyUserId: p.accountId }, process.env.JWT_SECRET, { expiresIn: '8h' });
    const socket = io(serverUrl, { autoConnect: false, forceNew: true,
      extraHeaders: { cookie: `auth=${token}` }, reconnectionAttempts: 5,
      reconnectionDelay: 1000, timeout: 5000 });
    const personal = config.bots?.find(b => b.userId === p.accountId) || {};
    stops.push(startBot(socket, { ...personal, roomCode, userId: p.accountId,
      displayName: p.display_name, playerId: `g:${gid}`, index,
      minDelayMs, maxDelayMs, seed: args.seed || config.seed || 'trailer',
      scripts: { ...config.scripts, ...personal.scripts } }));
  });
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { main };
