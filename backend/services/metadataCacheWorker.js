const { initDb, COLLECTIONS } = require('../mongo.js');
const { ensureDimensionStubs } = require('./streamNormalizationService.js');
const { SpotifyMetadataClient, SpotifyRateLimitError } = require('./spotifyMetadataClient.js');
const { getAccessToken } = require('./authService.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACK_BATCH_SIZE = Math.min(50, Number(process.env.METADATA_TRACK_BATCH || 25));
const ARTIST_BATCH_SIZE = Math.min(50, Number(process.env.METADATA_ARTIST_BATCH || 25));
const ALBUM_BATCH_SIZE = Math.min(20, Number(process.env.METADATA_ALBUM_BATCH || 20));
const TRACK_REFRESH_MS = Number(process.env.TRACK_REFRESH_DAYS || 7) * DAY_MS;
const ARTIST_REFRESH_MS = Number(process.env.ARTIST_REFRESH_DAYS || 7) * DAY_MS;
const ALBUM_REFRESH_MS = Number(process.env.ALBUM_REFRESH_DAYS || 30) * DAY_MS;
const ACTIVE_DELAY_MS = Number(process.env.METADATA_ACTIVE_DELAY_MS || 2000);
const IDLE_DELAY_MS = Number(process.env.METADATA_IDLE_DELAY_MS || 600000);
const ERROR_DELAY_MS = Number(process.env.METADATA_ERROR_DELAY_MS || 15000);
const ERROR_BACKOFF_MS = Number(process.env.METADATA_ERROR_BACKOFF_MS || 4 * 60 * 1000);
const MISSING_BACKOFF_MS = Number(process.env.METADATA_MISSING_BACKOFF_MS || 180 * DAY_MS);
const LOCK_TIMEOUT_MS = Number(process.env.METADATA_LOCK_TIMEOUT_MS || 10 * 60 * 1000);

let metadataAccountIdCache = null;
let singletonWorker = null;

async function resolveMetadataAccountId() {
  if (metadataAccountIdCache) return metadataAccountIdCache;
  const fromEnv =
    process.env.METADATA_ACCOUNT_ID ||
    process.env.SPOTIFY_METADATA_ACCOUNT_ID ||
    process.env.METADATA_SOURCE_ACCOUNT;
  if (fromEnv) {
    metadataAccountIdCache = fromEnv;
    return metadataAccountIdCache;
  }

  const db = await initDb();
  const row = await db.collection('oauth_tokens').findOne({}, { projection: { accountId: 1 } });
  if (!row) {
    throw new Error('Metadata worker cannot find a Spotify OAuth token to use');
  }
  metadataAccountIdCache = row.accountId;
  return metadataAccountIdCache;
}

async function metadataTokenProvider() {
  const accountId = await resolveMetadataAccountId();
  const token = await getAccessToken(accountId);
  if (!token) {
    throw new Error('Unable to acquire Spotify access token for metadata worker');
  }
  return { accountId, token };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class MetadataCacheWorker {
  constructor() {
    this.workerId = `metadata-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
    this.client = new SpotifyMetadataClient({ tokenProvider: metadataTokenProvider });
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`[MetadataWorker] Starting worker ${this.workerId}`);
    this.loop(); // fire and forget
  }

  stop() {
    console.log(`[MetadataWorker] Stopping worker ${this.workerId}`);
    this.running = false;
  }

  async loop() {
    while (this.running) {
      let delay = IDLE_DELAY_MS;
      try {
        const processedTracks = await this.processTracks();
        const processedAlbums = await this.processAlbums();
        const processedArtists = await this.processArtists();
        if (processedTracks || processedAlbums || processedArtists) {
          delay = ACTIVE_DELAY_MS;
        } else {
          console.log(`[MetadataWorker] No pending items, sleeping for ${delay}ms`);
        }
      } catch (err) {
        if (err instanceof SpotifyRateLimitError) {
          delay = Math.max(err.retryAfterMs, ACTIVE_DELAY_MS);
          console.warn(`[MetadataWorker] Spotify rate limited, sleeping for ${delay}ms`);
        } else {
          console.error('[MetadataWorker] Error in loop:', err);
          delay = ERROR_DELAY_MS;
        }
      }
      await sleep(delay);
    }
  }

  buildClaimFilter(now, lockExpiry) {
    return {
      $and: [
        {
          $or: [
            { status: 'pending' },
            {
              status: { $in: ['ready', 'error'] },
              nextRefreshAt: { $lte: now },
            },
            {
              status: 'processing',
              lockedAt: { $lte: lockExpiry },
            },
          ],
        },
        {
          $or: [
            { lockedAt: { $exists: false } },
            { lockedAt: null },
            { lockedAt: { $lte: lockExpiry } },
          ],
        },
      ],
    };
  }

  async claimDocuments(collectionKey, limit) {
    const db = await initDb();
    const col = db.collection(COLLECTIONS[collectionKey]);
    const docs = [];
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TIMEOUT_MS);
    const filter = this.buildClaimFilter(now, lockExpiry);

    while (docs.length < limit) {
      const res = await col.findOneAndUpdate(
        filter,
        {
          $set: {
            status: 'processing',
            lockedAt: now,
            lockedBy: this.workerId,
            updatedAt: now,
          },
        },
        { sort: { lastFetchedAt: 1 }, returnDocument: 'after' }
      );
      if(!res) break;

      docs.push(res);
    }
    // console.log(`[MetadataWorker] Claimed ${docs.length} docs`)
    return { db, col, docs, claimedAt: now };
  }

  async handleBatchFailure(col, ids, message) {
    if (!ids.length) return;
    const now = new Date();
    await col.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'error',
          nextRefreshAt: new Date(now.getTime() + ERROR_BACKOFF_MS),
          lastError: message,
          updatedAt: now,
          lockedAt: null,
          lockedBy: null,
        },
        $inc: { errorCount: 1 },
      }
    );
  }

  async markMissing(col, ids, message) {
    if (!ids.length) return;
    const now = new Date();
    await col.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'missing',
          lastFetchedAt: now,
          nextRefreshAt: new Date(now.getTime() + MISSING_BACKOFF_MS),
          lastError: message,
          updatedAt: now,
          lockedAt: null,
          lockedBy: null,
        },
        $inc: { errorCount: 1 },
      }
    );
  }

  async processTracks() {
    const { db, col, docs } = await this.claimDocuments('tracks', TRACK_BATCH_SIZE);
    if (!docs.length) return false;
    const ids = docs.map(doc => doc._id);
    console.log(`[MetadataWorker] Processing ${ids.length} tracks`);
    let tracks;
    try {
      tracks = await this.client.fetchTracks(ids);
    } catch (err) {
      await this.handleBatchFailure(col, ids, err.message);
      throw err;
    }

    const now = new Date();
    const trackMap = new Map();
    for (const track of tracks || []) {
      if (track && track.id) {
        trackMap.set(track.id, track);
      }
    }

    const updates = [];
    const missingIds = [];
    const albumIds = new Set();
    const artistIds = new Set();
    const artistNames = new Set();

    for (const id of ids) {
      const track = trackMap.get(id);
      if (!track) {
        missingIds.push(id);
        continue;
      }

      const albumId = track.album?.id || null;
      if (albumId) albumIds.add(albumId);

      const docArtistIds = (track.artists || [])
        .map(artist => artist?.id)
        .filter(Boolean);
      docArtistIds.forEach(id => artistIds.add(id));

      const docArtistNames = (track.artists || [])
        .map(artist => artist?.name)
        .filter(Boolean);
      docArtistNames.forEach(name => artistNames.add(name));

      updates.push({
        updateOne: {
          filter: { _id: track.id },
          update: {
            $set: {
              name: track.name,
              durationMs: track.duration_ms,
              explicit: track.explicit,
              popularity: track.popularity ?? null,
              albumId,
              albumName: track.album?.name,
              artistIds: docArtistIds,
              artistNames: docArtistNames,
              images: track.album?.images || [],
              status: 'ready',
              lastFetchedAt: now,
              nextRefreshAt: new Date(now.getTime() + TRACK_REFRESH_MS),
              errorCount: 0,
              lastError: null,
              updatedAt: now,
              lockedAt: null,
              lockedBy: null,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }

    if (updates.length) {
      await col.bulkWrite(updates, { ordered: false });
      console.log(`[MetadataWorker] Updated ${updates.length} tracks`);
    }

    if (missingIds.length) {
      await this.markMissing(col, missingIds, 'Track missing or unavailable');
      console.log(`[MetadataWorker] Marked ${missingIds.length} tracks as missing`);
    }

    if (albumIds.size) {
      await ensureDimensionStubs('albums', Array.from(albumIds), db);
      console.log(`[MetadataWorker] Ensured ${albumIds.size} album stubs`);
    }
    if (artistIds.size) {
      await ensureDimensionStubs('artists', Array.from(artistIds), db);
      console.log(`[MetadataWorker] Ensured ${artistIds.size} artist stubs`);
    }

    return true;
  }

  async processAlbums() {
    const { db, col, docs } = await this.claimDocuments('albums', ALBUM_BATCH_SIZE);
    if (!docs.length) return false;
    const ids = docs.map(doc => doc._id);
    console.log(`[MetadataWorker] Processing ${ids.length} albums`);
    let albums;
    try {
      albums = await this.client.fetchAlbums(ids);
    } catch (err) {
      await this.handleBatchFailure(col, ids, err.message);
      throw err;
    }

    const now = new Date();
    const albumMap = new Map();
    for (const album of albums || []) {
      if (album && album.id) {
        albumMap.set(album.id, album);
      }
    }

    const updates = [];
    const missingIds = [];
    const artistIds = new Set();
    const artistNames = new Set();

    for (const id of ids) {
      const album = albumMap.get(id);
      if (!album) {
        missingIds.push(id);
        continue;
      }
      const docArtistIds = (album.artists || [])
        .map(artist => artist?.id)
        .filter(Boolean);
      docArtistIds.forEach(id => artistIds.add(id));

      const docArtistNames = (album.artists || [])
        .map(artist => artist?.name)
        .filter(Boolean);
      docArtistNames.forEach(name => artistNames.add(name));

      updates.push({
        updateOne: {
          filter: { _id: album.id },
          update: {
            $set: {
              name: album.name,
              albumType: album.album_type,
              releaseDate: album.release_date,
              releaseDatePrecision: album.release_date_precision,
              totalTracks: album.total_tracks,
              label: album.label,
              artistIds: docArtistIds,
              artistNames: docArtistNames,
              images: album.images || [],
              status: 'ready',
              lastFetchedAt: now,
              nextRefreshAt: new Date(now.getTime() + ALBUM_REFRESH_MS),
              errorCount: 0,
              lastError: null,
              updatedAt: now,
              lockedAt: null,
              lockedBy: null,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }

    if (updates.length) {
      await col.bulkWrite(updates, { ordered: false });
      console.log(`[MetadataWorker] Updated ${updates.length} albums`);
    }

    if (missingIds.length) {
      await this.markMissing(col, missingIds, 'Album missing or unavailable');
      console.log(`[MetadataWorker] Marked ${missingIds.length} albums as missing`);
    }

    if (artistIds.size) {
      await ensureDimensionStubs('artists', Array.from(artistIds), db);
      console.log(`[MetadataWorker] Ensured ${artistIds.size} artist stubs`);
    }

    return true;
  }

  async processArtists() {
    const { col, docs } = await this.claimDocuments('artists', ARTIST_BATCH_SIZE);
    if (!docs.length) return false;
    const ids = docs.map(doc => doc._id);
    console.log(`[MetadataWorker] Processing ${ids.length} artists`);
    let artists;
    try {
      artists = await this.client.fetchArtists(ids);
    } catch (err) {
      await this.handleBatchFailure(col, ids, err.message);
      throw err;
    }

    const now = new Date();
    const artistMap = new Map();
    for (const artist of artists || []) {
      if (artist && artist.id) {
        artistMap.set(artist.id, artist);
      }
    }

    const updates = [];
    const missingIds = [];

    for (const id of ids) {
      const artist = artistMap.get(id);
      if (!artist) {
        missingIds.push(id);
        continue;
      }

      updates.push({
        updateOne: {
          filter: { _id: artist.id },
          update: {
            $set: {
              name: artist.name,
              popularity: artist.popularity ?? null,
              genres: artist.genres || [],
              images: artist.images || [],
              followers: artist.followers,
              status: 'ready',
              lastFetchedAt: now,
              nextRefreshAt: new Date(now.getTime() + ARTIST_REFRESH_MS),
              errorCount: 0,
              lastError: null,
              updatedAt: now,
              lockedAt: null,
              lockedBy: null,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }

    if (updates.length) {
      await col.bulkWrite(updates, { ordered: false });
      console.log(`[MetadataWorker] Updated ${updates.length} artists`);
    }

    if (missingIds.length) {
      await this.markMissing(col, missingIds, 'Artist missing or unavailable');
      console.log(`[MetadataWorker] Marked ${missingIds.length} artists as missing`);
    }

    return true;
  }
}

function startMetadataCacheWorker() {
  if (singletonWorker) return singletonWorker;
  const worker = new MetadataCacheWorker();
  worker.start();
  singletonWorker = worker;
  return worker;
}

module.exports = { startMetadataCacheWorker, SpotifyRateLimitError };
