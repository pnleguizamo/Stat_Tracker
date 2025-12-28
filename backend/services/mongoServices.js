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
        generatedAt: snapshotsDoc?.generatedAt || null,
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


mongoService.getListenCountsForSong = async function(userIds, trackName, artistName) {
  try {
    const db = await initDb();
    const collection = db.collection(collectionName);

    const pipeline = [
      {
        $match: {
          userId: { $in: userIds },
          master_metadata_track_name: trackName,
          master_metadata_album_artist_name: artistName,
          reason_end: "trackdone"
        }
      },
      {
        $group: {
          _id: "$userId",
          play_count: { $sum: 1 }
        }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    console.log(results)

    const listenCounts = {};
    for (const result of results) {
      listenCounts[result._id] = result.play_count;
    }
    
    for (const userId of userIds) {
      if (!listenCounts[userId]) {
        listenCounts[userId] = 0;
      }
    }

    console.log(listenCounts);
    
    return listenCounts;
  } catch (error) {
    console.error("Error fetching listen counts for song:", error);
    throw error;
  }
}

mongoService.getSharedTopSongs = async function (userIds, accessToken, minAccountsPercentage = 0.5, sampleSize = 25) {
    try {
        if (!userIds || userIds.length === 0) {
            throw new Error('userIds array cannot be empty');
        }
        
        db = await initDb();
        const collection = db.collection(collectionName);
        const streamsCol = db.collection(COLLECTIONS.streams);
        const minAccounts = Math.max(Math.ceil(userIds.length * minAccountsPercentage), 2);

        const weightMultiplier = 4;
        const playCountStifler = 500;
        const pipeline = [
            {
                $match: {
                    userId: { $in: userIds },
                    reasonEnd: "trackdone"
                }
            },
            {
                $group: {
                    _id : "$trackId",
                    play_count: { $sum: 1 },
                    unique_users: { $addToSet: "$userId" }
                }
            },
            { $addFields: { user_count: { $size: "$unique_users" } } },
            { $match: { user_count: { $gte: minAccounts } } },
            {
                $addFields:
                {
                    playCountWeight: {
                        $divide:
                            [
                                { $multiply:
                                        [{ $pow: ["$play_count", 0.9] }, { $ln: "$play_count" }] },
                                playCountStifler
                            ]
                    },
                    userCountWeight: { $max: [1, "$user_count"] }
                },
            },
            {
                $addFields:
                    { weight: { $pow: [{ $add: ["$playCountWeight", "$userCountWeight"] }, weightMultiplier] } }
            },
            {
                $addFields:
                    { randScore: { $divide: [{ $multiply: [-1, { $ln: { $rand: {} } }] }, "$weight"] } }
            },
            { $sort: { randScore: 1 } },
            { $limit: sampleSize },
            {
                $lookup: {
                    from: "tracks",
                    localField: "_id",
                    foreignField: "_id",
                    as: "metadata"
                }
            },
            { $addFields : { metadata : {$first : "$metadata"} } },
            { $project: { weight: 0, randScore: 0 } },
            {
                $project: {
                    _id: 1,
                    play_count: 1,
                    user_count: 1,
                    listener_percentage: {
                        $multiply: [
                            { $divide: ["$user_count", userIds.length] },
                            100
                        ]
                    },
                    metadata: 1
                }
            }
        ];
        const sharedSongs = await streamsCol.aggregate(pipeline).toArray();

        const resultSongs = sharedSongs.map(song => {
            return {
                id : song._id,
                play_count : song.play_count,
                user_count: song.user_count,
                listener_percentage: song.listener_percentage,
                track_name: song.metadata.name,
                artists: song.metadata.artistNames,
                imageUrl: song?.metadata?.images?.[0].url
            };
        });
    
        return resultSongs;
    } catch (error) {
        console.error("Error fetching shared top songs:", error);
        throw error;
    }
};

mongoService.rollupUserCounts = async function (options = {}) {
    const { startDate, endDate, userIds, batchSize = 500, logger = console } = options;
    db = await initDb();
    const streamsCol = db.collection(COLLECTIONS.streams);
    const trackCountsCol = db.collection(COLLECTIONS.userTrackCounts);
    const artistCountsCol = db.collection(COLLECTIONS.userArtistCounts);

    const match = { reasonEnd: "trackdone" };
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
    let ops = [];
    const trackPipeline = [
        { $match: match },
        {
            $group: {
                _id: { userId: '$userId', trackId: '$trackId' },
                plays: { $sum: 1 },
                msPlayed: { $sum: msExpr },
                lastStreamTs: { $max: '$ts' },
            },
        },
    ];
    const trackCursor = streamsCol.aggregate(trackPipeline, { allowDiskUse: true });
    for await (const doc of trackCursor) {
        const { userId, trackId } = doc._id || {};
        if (!userId || !trackId) continue;
        ops.push({
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
        });
        trackOps += 1;
        if (ops.length >= batchSize) {
            await writeBatch(trackCountsCol, ops);
            ops = [];
        }
    }
    if (ops.length) await writeBatch(trackCountsCol, ops);

    let artistOps = 0;
    ops = [];
    const artistPipeline = [
        { $match: { ...match, artistIds: { $exists: true, $ne: null } } },
        { $unwind: '$artistIds' },
        {
            $group: {
                _id: { userId: '$userId', artistId: '$artistIds' },
                plays: { $sum: 1 },
                msPlayed: { $sum: msExpr },
                lastStreamTs: { $max: '$ts' },
            },
        },
    ];
    const artistCursor = streamsCol.aggregate(artistPipeline, { allowDiskUse: true });
    for await (const doc of artistCursor) {
        const { userId, artistId } = doc._id || {};
        if (!userId || !artistId) continue;
        ops.push({
            updateOne: {
                filter: { userId, artistId },
                update: {
                    $set: {
                        plays: doc.plays || 0,
                        msPlayed: doc.msPlayed || 0,
                        lastStreamTs: doc.lastStreamTs || null,
                    },
                },
                upsert: true,
            },
        });
        artistOps += 1;
        if (ops.length >= batchSize) {
            await writeBatch(artistCountsCol, ops);
            ops = [];
        }
    }
    if (ops.length) await writeBatch(artistCountsCol, ops);

    logger.info?.(`rollupUserCounts complete tracks=${trackOps} artists=${artistOps}`);
    return { tracks: trackOps, artists: artistOps };
};
