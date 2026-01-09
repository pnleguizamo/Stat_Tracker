const { getAlbumCover } = require('../services/spotifyServices.js');
const { initDb, COLLECTIONS } = require('../mongo.js');
const { ingestNormalizedStreamEvents } = require('./streamNormalizationService.js');

const collectionName = COLLECTIONS.rawStreams;
let db;

const mongoService = module.exports = {};

const SNAPSHOT_TIMEFRAMES = new Set([
    'last7',
    'last30',
    'last90',
    'last180',
    'ytd',
    'allTime'
])

mongoService.getSnapshots = async function(accessToken, userId){
    db = await initDb();
    const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
    const snapshot = await snapshotsCol.findOne(
        { userId },
        { projection: { windows: 1 } }
    );

    return snapshot;
}

// TODO support metadata without cached DB metadata
mongoService.getTopAlbums = async function (accessToken, userId, timeframe = "allTime") {
    try {

        db = await initDb();
        const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
    
        const window = SNAPSHOT_TIMEFRAMES.has(timeframe) ? timeframe : 'allTime';
        const fieldPath = `windows.${window}.topAlbums`;
        const pipeline = [
            { $match: { userId } },
            { $project: { userId: 1, [fieldPath]: 1 } },
            { $unwind: `$${fieldPath}` },
            { $replaceRoot: { newRoot: `$${fieldPath}` } },
            { $limit: 100 }
        ];
        
        const topAlbums = await snapshotsCol.aggregate(pipeline).toArray();
        return topAlbums;
    } catch (err) {
        console.error("Error retrieving top albums:", err);
        throw err;
    }
}

mongoService.getTopPlayedArtists = async function (accessToken, userId, timeframe = "allTime") {
    try {
        db = await initDb();
        const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
    
        const window = SNAPSHOT_TIMEFRAMES.has(timeframe) ? timeframe : 'allTime';
        const fieldPath = `windows.${window}.topArtists`;
        const pipeline = [
            { $match: { userId } },
            { $project: { userId: 1, [fieldPath]: 1 } },
            { $unwind: `$${fieldPath}` },
            { $replaceRoot: { newRoot: `$${fieldPath}` } },
            { $limit: 100 }
        ];
        
        const topArtists = await snapshotsCol.aggregate(pipeline).toArray();
        return topArtists;
    } catch (error) {
        console.error("Error fetching top played artists:", error);
        throw error;
    }
}

mongoService.getTopPlayedSongs = async function (access_token, userId, timeframe = "allTime") {
    try {
        db = await initDb();
        const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);

        const window = SNAPSHOT_TIMEFRAMES.has(timeframe) ? timeframe : 'allTime';
        const fieldPath = `windows.${window}.topTracks`;
        const pipeline = [
            { $match: { userId } },
            { $project: { userId: 1, [fieldPath]: 1 } },
            { $unwind: `$${fieldPath}` },
            { $replaceRoot: { newRoot: `$${fieldPath}` } },
            { $limit: 100 }
        ];

        const topSongs = await snapshotsCol.aggregate(pipeline).toArray();
        return topSongs;
    } catch (error) {
        console.error("Error fetching top played songs:", error);
        throw error;
    }
};

mongoService.getTotalMinutesStreamed = async function (userId, timeframe = "lifetime") {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);
        
        let startDate = null;
        if (timeframe === "week") {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
        } else if (timeframe === "6months") {
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 6);
        } else if (timeframe === "year") {
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
        }

        const pipeline = [];
        if (startDate) {
            pipeline.push({
                $match: {
                    ts: { $gte: startDate.toISOString() }
                }
            });
        }
        
        pipeline.push(
            {
                $match: {
                    userId
                }
            },
            {
                $group: {
                    _id: null,
                    totalMsPlayed: { $sum: "$ms_played" }
                }
            }
        );

        const result = await collection.aggregate(pipeline).toArray();
        const totalMinutesStreamed = result.length > 0 ? result[0].totalMsPlayed / 60000 : 0;

        return totalMinutesStreamed;
    } catch (err) {
        console.error("Error fetching documents:", err);
    }
};

mongoService.getRollupDashboard = async function (userId, options = {}) {
    function startOfUtcDay(value = new Date()) {
        const d = new Date(value);
        d.setUTCHours(0, 0, 0, 0);
        return d;
    }

    const { days = 30 } = options;
    const db = await initDb();
    const snapshotsCol = db.collection(COLLECTIONS.userSnapshots);
    const statsCol = db.collection(COLLECTIONS.userStatsDaily);

    const snapshotsDoc = await snapshotsCol.findOne({ userId });

    const end = startOfUtcDay(new Date());
    end.setUTCDate(end.getUTCDate() + 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const stats = await statsCol
        .find(
            { userId, day: { $gte: start, $lt: end } },
            { projection: { userId: 0 } }
        )
        .sort({ day: 1 })
        .toArray();

    const daily = stats.map(doc => {
        const msPlayed = doc?.totals?.msPlayed || 0;
        return {
            day: doc.day,
            msPlayed,
            minutes: Math.round((msPlayed / 60000) * 10) / 10,
        };
    });

    const highlightKey = snapshotsDoc?.windows?.last30
        ? 'last30'
        : snapshotsDoc?.windows?.last7
            ? 'last7'
            : null;
    const highlightWindow = highlightKey ? snapshotsDoc.windows[highlightKey] : null;
    const highlights = highlightWindow
        ? {
            window: highlightKey,
            track: highlightWindow.topTracks?.[0] || null,
            artist: highlightWindow.topArtists?.[0] || null,
            album: highlightWindow.topAlbums?.[0] || null,
            genre: highlightWindow.topGenres?.[0] || null,
        }
        : null;

    return {
        snapshots: snapshotsDoc?.windows || {},
        highlights,
        daily,
        updatedAt: snapshotsDoc?.updatedAt || null,
    };
}

mongoService.syncRecentStreams = async (recentTracks, userId) => {
    try {
        db = await initDb();
        const collection = db.collection(collectionName);
        const ops = recentTracks.map(track => {
            const tsIso = new Date(track.playedAt).toISOString();
            return {
                updateOne: {
                    filter: {
                        userId,
                        ts: tsIso,
                        spotify_track_uri: track.trackUri
                    },
                    update: {
                        $setOnInsert: {
                            ts: tsIso,
                            userId,
                            master_metadata_track_name: track.trackName,
                            master_metadata_album_artist_name: track.artistName,
                            master_metadata_album_album_name: track.albumName,
                            spotify_track_uri: track.trackUri,
                            ms_played: track.duration, // This is the full duration since we can't know if it was fully played
                            reason_end: "trackdone", // Assuming completed since it's in recent history
                        }
                    },
                    upsert: true
                }
            };
        });

        let insertedCount = 0;
        if (ops.length) {
            const res = await collection.bulkWrite(ops, { ordered: false });
            insertedCount = res.upsertedCount || 0;
        }

        await ingestNormalizedStreamEvents(
            recentTracks.map(track => ({
                ts: track.playedAt,
                ms_played: track.duration,
                spotify_track_uri: track.trackUri,
                reason_end: 'trackdone',
            })),
            userId,
            { source: 'recent-playback' }
        );

        return insertedCount;
    } catch (error) {
        console.error('Error syncing recent streams:', error);
        throw error;
    }
};


mongoService.getListenCountsForSong = async function(userIds, trackId, artistName) {
  try {
    const db = await initDb();
    const trackCountsCol = db.collection(COLLECTIONS.userTrackCounts);

    const pipeline = [
      {
        $match: {
          userId: { $in: userIds },
          trackId
        }
      }
    ];

    const results = await trackCountsCol.aggregate(pipeline).toArray();

    const listenCounts = {};
    for (const result of results) {
      listenCounts[result.userId] = result.plays;
    }
    
    for (const userId of userIds) {
      if (!listenCounts[userId]) {
        listenCounts[userId] = 0;
      }
    }
    
    return listenCounts;
  } catch (error) {
    console.error("Error fetching listen counts for song:", error);
    throw error;
  }
}

mongoService.getSharedTopArtists = async function (userIds, accessToken, minAccountsPercentage = 0.5, sampleSize = 100) {
    try {
        if (!userIds || userIds.length === 0) {
            throw new Error('userIds array cannot be empty');
        }

        db = await initDb();

        const start = Date.now();

        const streamsCol = db.collection(COLLECTIONS.streams);
        const artistCountsCol = db.collection(COLLECTIONS.userArtistCounts);
        const minAccounts = Math.max(Math.ceil(userIds.length * minAccountsPercentage), 2);

        // hasRollups is never false
        const hasRollups = await artistCountsCol.findOne({ userId: { $in: userIds } }, { projection: { _id: 1 } });

        const weightMultiplier = 4;
        const playCountStifler = 1000;

        const basePipeline = [
            { $addFields:
                {
                    playCountWeight: {
                        $divide: [
                            { $multiply: [{ $pow: ["$play_count", 0.7] }, { $ln: "$play_count" }] },
                            playCountStifler
                        ]
                    },
                    userCountWeight: { $max: [1, "$user_count"] }
                },
            },
            { $addFields: { weight: { $pow: [{ $add: ["$playCountWeight", "$userCountWeight"] }, weightMultiplier] } } },
            { $addFields: { randScore: { $divide: [{ $multiply: [-1, { $ln: { $rand: {} } }] }, "$weight"] } } },
            { $sort: { randScore: 1 } },
            { $limit: sampleSize },
            { $project: { weight: 0, randScore: 0 } },
            {
                $project: {
                    _id: 1,
                    play_count: 1,
                    user_count: 1,
                    users: 1,
                    listener_percentage: {
                        $multiply: [
                            { $divide: ["$user_count", userIds.length] },
                            100
                        ]
                    }
                }
            }
        ];

        const sourcePipeline = hasRollups
            ? [
                { $match: { userId: { $in: userIds } } },
                {
                    $group: {
                        _id: "$artistId",
                        play_count: { $sum: "$plays" },
                        unique_users: { $addToSet: "$userId" },
                        users: {
                            $push: { userId: '$userId', plays: '$plays' }
                        },
                    }
                },
                { $addFields: { user_count: { $size: "$unique_users" } } },
                { $match: { user_count: { $gte: minAccounts } } },
            ]
            : [
                {
                    $match: {
                        userId: { $in: userIds },
                        reasonEnd: "trackdone",
                        canonicalTrackId: { $ne: null },
                        artistId: { $ne: null },
                    }
                },
                {
                    $group: {
                        _id : "$artistId",
                        play_count: { $sum: 1 },
                        unique_users: { $addToSet: "$userId" }
                    }
                },
                { $addFields: { user_count: { $size: "$unique_users" } } },
                { $match: { user_count: { $gte: minAccounts } } },
            ];

        const pipeline = [...sourcePipeline, ...basePipeline];
        const sourceCol = hasRollups ? artistCountsCol : streamsCol;
        const sharedArtists = await sourceCol.aggregate(pipeline).toArray();


        const artistIds = sharedArtists.map(artist => artist?._id).filter(Boolean);
        const artistsCol = db.collection(COLLECTIONS.artists);
        const metadata = artistIds.length
            ? await artistsCol
                .find(
                    { _id: { $in: artistIds } },
                    { projection: { name: 1, images: 1 } }
                )
                .toArray()
            : [];
        const metaMap = new Map(metadata.map(doc => [doc._id, doc]));

        const resultArtists = sharedArtists.map(artist => {
            const meta = metaMap.get(artist._id) || {};
            return {
                id: artist._id,
                play_count: artist.play_count,
                user_count: artist.user_count,
                listener_percentage: artist.listener_percentage,
                users: artist.users,
                topUserId: (artist.users || []).reduce((best, u) => (u && u.plays > (best?.plays || 0) ? u : best), null)?.userId,
                artist_name: meta.name || null,
                weight: artist.weight,
                imageUrl: meta.images?.[0]?.url || null
            };
        });

        const end = Date.now();
        const ms = end - start;
        console.log(`Query (artists) finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);
        return resultArtists;
    } catch (error) {
        console.error("Error fetching shared top artists:", error);
        throw error;
    }
};

mongoService.getSharedTopSongs = async function (userIds, accessToken, minAccountsPercentage = 0.5, sampleSize = 100) {
    try {
        if (!userIds || userIds.length === 0) {
            throw new Error('userIds array cannot be empty');
        }
        
        db = await initDb();


        const start = Date.now();

        const streamsCol = db.collection(COLLECTIONS.streams);
        const minAccounts = Math.max(Math.ceil(userIds.length * minAccountsPercentage), 2);

        const trackCountsCol = db.collection(COLLECTIONS.userTrackCounts);
        // hasRollups is never false
        const hasRollups = await trackCountsCol.findOne({ userId: { $in: userIds } }, { projection: { _id: 1 } });

        const weightMultiplier = 4;
        const playCountStifler = 500;

        const basePipeline = [
            { $addFields:
                {
                    playCountWeight: {
                        $divide: [
                            { $multiply: [{ $pow: ["$play_count", 0.9] }, { $ln: "$play_count" }] },
                            playCountStifler
                        ]
                    },
                    userCountWeight: { $max: [1, "$user_count"] }
                },
            },
            { $addFields: { weight: { $pow: [{ $add: ["$playCountWeight", "$userCountWeight"] }, weightMultiplier] } } },
            { $addFields: { randScore: { $divide: [{ $multiply: [-1, { $ln: { $rand: {} } }] }, "$weight"] } } },
            { $sort: { randScore: 1 } },
            { $limit: sampleSize },
            { $project: { weight: 0, randScore: 0 } },
            {
                $project: {
                    _id: 1,
                    play_count: 1,
                    user_count: 1,
                    users: 1,
                    listener_percentage: {
                        $multiply: [
                            { $divide: ["$user_count", userIds.length] },
                            100
                        ]
                    }
                }
            }
        ];

        const sourcePipeline = hasRollups
            ? [
                { $match: { userId: { $in: userIds } } },
                {
                    $group: {
                        _id: "$trackId",
                        play_count: { $sum: "$plays" },
                        unique_users: { $addToSet: "$userId" },
                        users: {
                            $push: { userId: '$userId', plays: '$plays' }
                        },
                    }
                },
                { $addFields: { user_count: { $size: "$unique_users" } } },
                { $match: { user_count: { $gte: minAccounts } } },
            ]
            : [
                {
                    $match: {
                        userId: { $in: userIds },
                        reasonEnd: "trackdone",
                        canonicalTrackId: { $ne: null }
                    }
                },
                {
                    $group: {
                        _id : "$canonicalTrackId",
                        play_count: { $sum: 1 },
                        unique_users: { $addToSet: "$userId" }
                    }
                },
                { $addFields: { user_count: { $size: "$unique_users" } } },
                { $match: { user_count: { $gte: minAccounts } } },
            ];

        const pipeline = [...sourcePipeline, ...basePipeline];
        const sourceCol = hasRollups ? trackCountsCol : streamsCol;
        const sharedSongs = await sourceCol.aggregate(pipeline).toArray();

        
        const trackIds = sharedSongs.map(song => song?._id).filter(Boolean);
        const tracksCol = db.collection(COLLECTIONS.tracks);
        const metadata = trackIds.length
            ? await tracksCol
                .find(
                    { _id: { $in: trackIds } },
                    { projection: { name: 1, artistNames: 1, albumName: 1, images: 1, durationMs: 1 } }
                )
                .toArray()
            : [];
        const metaMap = new Map(metadata.map(doc => [doc._id, doc]));

        const resultSongs = sharedSongs.map(song => {
            const meta = metaMap.get(song._id) || {};
            return {
                id: song._id,
                play_count: song.play_count,
                user_count: song.user_count,
                listener_percentage: song.listener_percentage,
                users: song.users,
                topUserId: (song.users || []).reduce((best, u) => (u && u.plays > (best?.plays || 0) ? u : best),null)?.userId,
                track_name: meta.name || null,
                artist_names: meta.artistNames || [],
                album_name: meta.albumName || null,
                imageUrl: meta.images?.[0]?.url || null,
                durationMs: meta.durationMs || null,
            };
        });
        
        const end = Date.now();
        const ms = end - start;
        console.log(`Query finished in ${ms} ms (${(ms / 1000).toFixed(2)} seconds)`);
        return resultSongs;
    } catch (error) {
        console.error("Error fetching shared top songs:", error);
        throw error;
    }
};

mongoService.searchTracks = async function (query, options = {}) {
    const { limit = 10, offset = 0 } = options;
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
        return [];
    }

    db = await initDb();
    const tracksCol = db.collection(COLLECTIONS.tracks);

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const terms = query
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);
    const regexes = terms
        .map(t => t.replace(/[’']/g, '')) 
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .filter(t => t.length)
        .map(t => {
            const flexible = t.split('').join("[’']?");
            return new RegExp(flexible, 'i');
        });

    const cursor = tracksCol
        .find(
            {
                $and: [
                    { $expr: { $eq: ['$_id', '$canonicalTrackId'] } },
                    ...regexes.map((rx) => ({
                        $or: [
                            { name: rx },
                            { artistNames: rx },
                            { albumName: rx },
                        ],
                    })),
                ],
            },
            {
                projection: {
                    name: 1,
                    artistNames: 1,
                    albumName: 1,
                    images: 1,
                    durationMs: 1,
                },
            }
        )
        .skip(safeOffset)
        .limit(safeLimit);

    const docs = await cursor.toArray();
    return docs.map(track => ({
        id: track._id,
        name: track.name,
        artistNames: track.artistNames || [],
        albumName: track.albumName || null,
        imageUrl: track.images?.[0]?.url || null,
        durationMs: track.durationMs || null,
    }));
};

// TODOo make a raw trackCounts collection that uses original trackId for pickCanonicalTrackId to use 
mongoService.rollupUserCounts = async function (options = {}) {
    const { startDate, endDate, userIds, batchSize = 500, logger = console } = options;
    db = await initDb();
    const streamsCol = db.collection(COLLECTIONS.streams);
    const trackCountsCol = db.collection(COLLECTIONS.userTrackCounts);
    const artistCountsCol = db.collection(COLLECTIONS.userArtistCounts);
    const tracksCol = db.collection(COLLECTIONS.tracks);
    
    if (!startDate) artistCountsCol.deleteMany({});

    const match = { reasonEnd: "trackdone", canonicalTrackId: { $ne: null } };
    if (startDate || endDate) {
        match.ts = {};
        if (startDate) match.ts.$gte = startDate;
        if (endDate) match.ts.$lt = endDate;
    }
    if (userIds?.length) {
        match.userId = { $in: userIds };
    }

    const msExpr = { $ifNull: ['$msPlayed', '$ms_played'] };

    const writeBatch = async (col, ops) => {
        if (!ops.length) return;
        await col.bulkWrite(ops, { ordered: false });
    };

    let trackOps = 0;
    let artistOps = 0;
    let batch = [];

    const flushBatch = async () => {
        if (!batch.length) return;
        const trackOpsPayload = batch.map(doc => {
            const { userId, trackId } = doc._id || {};
            return {
                updateOne: {
                    filter: { userId, trackId },
                    update: {
                        $set: {
                            plays: doc.plays || 0,
                            msPlayed: doc.msPlayed || 0,
                            lastStreamTs: doc.lastStreamTs || null,
                        },
                    },
                    upsert: true,
                },
            };
        });
        await writeBatch(trackCountsCol, trackOpsPayload);
        trackOps += trackOpsPayload.length;

        const trackIds = Array.from(new Set(batch.map(d => d._id?.trackId).filter(Boolean)));
        const metas = trackIds.length
            ? await tracksCol
                .find({ _id: { $in: trackIds } }, { projection: { artistIds: 1 } })
                .toArray()
            : [];
        const metaMap = new Map(metas.map(m => [m._id, m.artistIds || []]));

        const artistOpsPayload = [];
        for (const doc of batch) {
            const { userId, trackId } = doc._id || {};
            if (!userId || !trackId) continue;
            const artistIds = metaMap.get(trackId) || [];
            for (const artistId of artistIds) {
                artistOpsPayload.push({
                    updateOne: {
                        filter: { userId, artistId },
                        update: {
                            $inc: {
                                plays: doc.plays || 0,
                                msPlayed: doc.msPlayed || 0,
                            },
                            $max: { lastStreamTs: doc.lastStreamTs || null },
                        },
                        upsert: true,
                    },
                });
            }
        }
        if (artistOpsPayload.length) {
            await writeBatch(artistCountsCol, artistOpsPayload);
            artistOps += artistOpsPayload.length;
        }

        batch = [];
    };

    const trackPipeline = [
        { $match: match },
        {
            $group: {
                _id: { userId: '$userId', trackId: '$canonicalTrackId' },
                plays: { $sum: 1 },
                msPlayed: { $sum: msExpr },
                lastStreamTs: { $max: '$ts' },
            },
        },
    ];
    const trackCursor = streamsCol.aggregate(trackPipeline, { allowDiskUse: true });
    for await (const doc of trackCursor) {
        batch.push(doc);
        if (batch.length >= batchSize) {
            await flushBatch();
        }
    }
    await flushBatch();

    logger.info?.(`rollupUserCounts complete tracks=${trackOps} artists=${artistOps}`);
    return { tracks: trackOps, artists: artistOps };
};
