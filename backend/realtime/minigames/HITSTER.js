const { getSharedTopSongs } = require('../../services/mongoServices');
const { getAccessToken } = require('../../services/authService');
const { getTrackPreview } = require('../../services/spotifyServices');
const { appendRoundHistory, updateStreaks, computeTimeScore, applyAwards } = require('../scoring');

const DEFAULT_TARGET_CARDS = 7;
const DEFAULT_ROUND_TIMER_MS = 30000;
const DEFAULT_RACES_PER_STAGE = 3;

const CORRECT_PLACEMENT_MAX_POINTS = 1000;
const SONG_GUESS_BONUS = 500;
const SAMPLE_SIZE = 200;
const TARGET_POOL_SIZE = 60;

function safeRoomLookup(getRoom, roomCode) {
  const room = getRoom(roomCode);
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}

function getStageIndex(room) {
  return typeof room.currentStageIndex === 'number' && room.currentStageIndex >= 0
    ? room.currentStageIndex
    : 0;
}

function getStageConfig(room, stageIndex) {
  return room.stagePlan?.[stageIndex] || {};
}

function resolveStageOptions(room, stageIndex, params = {}) {
  const config = getStageConfig(room, stageIndex);
  return { ...(config.options || {}), ...params };
}

function resolvePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveTargetCards(stageOpts = {}) {
  return resolvePositiveInteger(stageOpts.targetCards, DEFAULT_TARGET_CARDS);
}

function resolveRoundTimerMs(stageOpts = {}) {
  return resolvePositiveInteger(stageOpts.roundTimerMs, DEFAULT_ROUND_TIMER_MS);
}

function resolveRacesPerStage(stageOpts = {}) {
  return resolvePositiveInteger(stageOpts.racesPerStage, DEFAULT_RACES_PER_STAGE);
}

function normalizeRaceState(stageState) {
  stageState.raceNumber = resolvePositiveInteger(stageState.raceNumber, 1);
  stageState.racesCompleted = Math.max(0, resolvePositiveInteger(stageState.racesCompleted, 0));
  stageState.roundsStartedInRace = Math.max(0, resolvePositiveInteger(stageState.roundsStartedInRace, 0));
  stageState.raceComplete = !!stageState.raceComplete;
  stageState.stageComplete = !!stageState.stageComplete;
  return stageState;
}

function getStageState(room, stageIndex) {
  room.hitsterStages = room.hitsterStages || {};
  if (!room.hitsterStages[stageIndex]) {
    room.hitsterStages[stageIndex] = {
      pool: null,
      pointer: 0,
      usedSongIds: new Set(),
      roundsStarted: 0,
      roundsStartedInRace: 0,
      roundsCompleted: 0,
      raceNumber: 1,
      racesCompleted: 0,
      raceComplete: false,
      stageComplete: false,
      anchorCard: null,
      timelines: {},
      previewUrlsBySongId: {},
    };
  }
  return normalizeRaceState(room.hitsterStages[stageIndex]);
}

function resetRaceState(stageState) {
  stageState.anchorCard = null;
  stageState.anchorPlaced = false;
  stageState.timelines = {};
  stageState.roundsStartedInRace = 0;
  stageState.raceComplete = false;
  stageState.raceNumber = resolvePositiveInteger(stageState.raceNumber, 1) + 1;
  return stageState;
}

function prepareRaceForStart(stageState, racesPerStage) {
  normalizeRaceState(stageState);
  if (stageState.stageComplete) return { ok: false, error: 'STAGE_COMPLETE' };

  if (stageState.raceComplete) {
    if (stageState.raceNumber >= racesPerStage) {
      stageState.stageComplete = true;
      return { ok: false, error: 'STAGE_COMPLETE' };
    }
    resetRaceState(stageState);
  }

  return { ok: true };
}

function markRaceCompletion(stageState, winners, racesPerStage, raceNumber) {
  normalizeRaceState(stageState);
  const raceComplete = Array.isArray(winners) && winners.length > 0;
  if (!raceComplete) {
    return { raceComplete: false, stageComplete: stageState.stageComplete };
  }

  stageState.raceComplete = true;
  const completedRaceNumber = resolvePositiveInteger(raceNumber, stageState.raceNumber);
  stageState.racesCompleted = Math.max(stageState.racesCompleted || 0, completedRaceNumber);
  stageState.stageComplete = stageState.racesCompleted >= racesPerStage;

  return {
    raceComplete: true,
    stageComplete: stageState.stageComplete,
  };
}

function getConnectedPlayerIds(room) {
  return Array.from(room.players.entries())
    .filter(([, player]) => player?.connected !== false)
    .map(([playerId]) => playerId);
}

function getReleaseYear(song = {}) {
  const releaseDate = song?.releaseDate || song?.release_date;
  if (!releaseDate || typeof releaseDate !== 'string') return null;
  const match = releaseDate.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function stratifiedSample(songs, targetSize) {
  const buckets = {};
  for (const song of songs) {
    const year = getReleaseYear(song);
    if (year === null) continue;
    const decade = Math.floor(year / 10) * 10;
    if (!buckets[decade]) buckets[decade] = [];
    buckets[decade].push(song);
  }
  const decadeKeys = Object.keys(buckets).sort();
  if (!decadeKeys.length) return [];
  const perBucket = Math.ceil(targetSize / decadeKeys.length);
  const result = [];
  for (const decade of decadeKeys) {
    const bucket = buckets[decade];
    const scored = bucket.map((s) => {
      const pc = s.play_count || 1;
      const uc = s.user_count || 1;
      const weight = Math.pow((Math.pow(pc, 0.9) * Math.log(pc + 1)) / 500 + Math.max(1, uc), 4);
      return { song: s, score: -Math.log(Math.random()) / weight };
    });
    scored.sort((a, b) => a.score - b.score);
    result.push(...scored.slice(0, perBucket).map((s) => s.song));
  }
  // Shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function ensureSongPool(room, stageIndex) {
  const stageState = getStageState(room, stageIndex);
  if (stageState.pool?.length) return stageState.pool;

  const userIds = [];
  room.players.forEach((player, playerId) => {
    if (player.userId && playerId !== room.hostPlayerId) userIds.push(player.userId);
  });

  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueUserIds.length) throw new Error('NO_USERS_AVAILABLE');

  const accessToken = await getAccessToken(uniqueUserIds[0]);
  const songs = await getSharedTopSongs(uniqueUserIds, accessToken, 0.5, SAMPLE_SIZE);

  const validSongs = (songs || []).filter((s) => getReleaseYear(s) !== null);
  stageState.pool = stratifiedSample(validSongs, TARGET_POOL_SIZE);
  stageState.pointer = 0;
  stageState.usedSongIds = new Set();
  return stageState.pool;
}

function pickSong(stageState) {
  if (!stageState.pool?.length) return null;

  const total = stageState.pool.length;
  let attempts = 0;
  while (attempts < total) {
    const idx = stageState.pointer % total;
    stageState.pointer = idx + 1;
    const song = stageState.pool[idx];
    if (song?.id && stageState.usedSongIds?.has(song.id)) {
      attempts += 1;
      continue;
    }
    if (song?.id) stageState.usedSongIds?.add(song.id);
    return song;
  }

  // Exhausted pool, reset used list and pick next.
  stageState.usedSongIds = new Set();
  const idx = stageState.pointer % total;
  stageState.pointer = idx + 1;
  const song = stageState.pool[idx];
  if (song?.id) stageState.usedSongIds?.add(song.id);
  return song;
}

function pruneSongFromPool(stageState, songId) {
  if (!songId || !stageState.pool?.length) return;

  const idx = stageState.pool.findIndex((song) => song?.id === songId);
  if (idx === -1) return;

  stageState.pool.splice(idx, 1);
  stageState.usedSongIds?.delete(songId);
  delete stageState.previewUrlsBySongId[songId];

  if (!stageState.pool.length) {
    stageState.pointer = 0;
    return;
  }

  if (idx < stageState.pointer) {
    stageState.pointer = Math.max(0, stageState.pointer - 1);
  }
  stageState.pointer %= stageState.pool.length;
}

async function resolveSongPreview(stageState, song) {
  if (!song?.track_name) return null;

  if (song.id && stageState.previewUrlsBySongId?.[song.id]) {
    return stageState.previewUrlsBySongId[song.id];
  }

  const primaryArtist = Array.isArray(song.artist_names)
    ? song.artist_names.find((name) => typeof name === 'string' && name.trim())
    : null;
  const resp = await getTrackPreview(song.track_name, primaryArtist || null, 8);
  const previewUrl =
    resp?.previewUrl ||
    resp?.tracks?.find((track) => track?.previewUrls)?.previewUrls ||
    null;

  if (song.id) {
    if (previewUrl) {
      stageState.previewUrlsBySongId[song.id] = previewUrl;
    } else {
      pruneSongFromPool(stageState, song.id);
    }
  }

  return previewUrl;
}

async function pickSongWithPreview(stageState) {
  if (!stageState.pool?.length) return null;

  const total = stageState.pool.length;
  let attempts = 0;
  while (attempts < total) {
    const song = pickSong(stageState);
    if (!song) return null;

    const previewUrl = await resolveSongPreview(stageState, song);
    if (previewUrl) {
      return { song, previewUrl };
    }

    attempts += 1;
  }

  return null;
}

function initializeTimelines(room, stageIndex, anchorSong) {
  const stageState = getStageState(room, stageIndex);
  const year = getReleaseYear(anchorSong);
  const card = {
    songId: anchorSong.id,
    track_name: anchorSong.track_name,
    artist_names: anchorSong.artist_names || [],
    album_name: anchorSong.album_name || null,
    imageUrl: anchorSong.imageUrl || null,
    releaseDate: anchorSong.releaseDate || '',
    year,
    addedInRound: 'anchor',
  };
  stageState.anchorCard = { ...card };
  for (const [playerId] of room.players) {
    if (playerId === room.hostPlayerId) continue;
    if (!stageState.timelines[playerId]) {
      stageState.timelines[playerId] = { cards: [{ ...card }] };
    }
  }
}

function validatePlacement(cards, gapIndex, songYear) {
  if (typeof songYear !== 'number' || !Number.isInteger(gapIndex)) return false;
  if (gapIndex < 0 || gapIndex > cards.length) return false;
  // gapIndex 0: before first card. Song must be <= first card's year
  // gapIndex cards.length: after last card. Song must be >= last card's year
  // Otherwise: song must be >= card[gapIndex-1].year AND <= card[gapIndex].year
  const leftCard = gapIndex > 0 ? cards[gapIndex - 1] : null;
  const rightCard = gapIndex < cards.length ? cards[gapIndex] : null;
  if (leftCard && songYear < leftCard.year) return false;
  if (rightCard && songYear > rightCard.year) return false;
  return true;
}

function buildPlacementEntry(gapIndex, finalize, previousPlacement = null) {
  const now = Date.now();
  const preservePlacedAt =
    !!previousPlacement &&
    previousPlacement.gapIndex === gapIndex &&
    typeof previousPlacement.at === 'number';

  return {
    gapIndex,
    at: preservePlacedAt ? previousPlacement.at : now,
    confirmedAt: finalize ? now : null,
  };
}

function buildLeaderboard(room, stageIndex) {
  const stageState = getStageState(room, stageIndex);
  const lb = {};
  for (const [playerId] of room.players) {
    if (playerId === room.hostPlayerId) continue;
    lb[playerId] = stageState.timelines[playerId]?.cards?.length || 0;
  }
  return lb;
}

function ensurePlayerTimeline(stageState, playerId) {
  if (stageState.timelines[playerId]) return stageState.timelines[playerId];

  const anchorCards = stageState.anchorCard ? [{ ...stageState.anchorCard }] : [];
  stageState.timelines[playerId] = { cards: anchorCards };
  return stageState.timelines[playerId];
}

async function createRoundState(room, params = {}) {
  const stageIndex = getStageIndex(room);
  room.roundState = room.roundState || {};
  const stageOpts = resolveStageOptions(room, stageIndex, params);
  const targetCards = resolveTargetCards(stageOpts);
  const roundTimerMs = resolveRoundTimerMs(stageOpts);
  const racesPerStage = resolveRacesPerStage(stageOpts);

  const stageState = getStageState(room, stageIndex);
  const raceStart = prepareRaceForStart(stageState, racesPerStage);
  if (!raceStart.ok) throw new Error(raceStart.error);

  await ensureSongPool(room, stageIndex);

  // Initialize timelines with anchor on first round
  if (!stageState.anchorPlaced) {
    const anchorSong = pickSong(stageState);
    if (!anchorSong) throw new Error('NO_SONG_AVAILABLE');
    initializeTimelines(room, stageIndex, anchorSong);
    stageState.anchorPlaced = true;
  }

  const previewableSong = await pickSongWithPreview(stageState);
  if (!previewableSong) throw new Error('NO_PREVIEWABLE_SONG_AVAILABLE');
  const { song, previewUrl } = previewableSong;

  const year = getReleaseYear(song);
  const now = Date.now();
  const roundState = {
    id: `hitster-${now}`,
    minigameId: 'HITSTER',
    status: 'placing',
    song: {
      id: song.id,
      track_name: song.track_name,
      artist_names: song.artist_names || [],
      album_name: song.album_name || null,
      imageUrl: song.imageUrl || null,
      releaseDate: song.releaseDate || null,
      uri: song.id ? `spotify:track:${song.id}` : null,
      previewUrl,
    },
    year,
    answers: {},
    startedAt: now,
    roundTimerMs,
    stageProgress: {
      roundNumber: (stageState.roundsStartedInRace || 0) + 1,
      raceNumber: stageState.raceNumber,
      racesPerStage,
      stageComplete: false,
      targetCards,
      leaderboard: buildLeaderboard(room, stageIndex),
    },
  };

  stageState.roundsStarted = (stageState.roundsStarted || 0) + 1;
  stageState.roundsStartedInRace = (stageState.roundsStartedInRace || 0) + 1;
  room.roundState[stageIndex] = roundState;
  return roundState;
}

function registerHitster(io, socket, deps = {}) {
  const { getRoom, broadcastGameState, scheduleRoundTimer, clearRoundTimer } = deps;
  const logger = deps.logger || console;

  function attachTimelines(room, roundState) {
    const idx = getStageIndex(room);
    const stageState = getStageState(room, idx);
    roundState.timelines = {};
    for (const [playerId] of room.players) {
      if (stageState.timelines[playerId]) {
        roundState.timelines[playerId] = {
          cards: [...stageState.timelines[playerId].cards],
        };
      }
    }
  }

  const reveal = (room, roomCode, idx, cb) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'HITSTER') return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
    if (round.status === 'revealed') return cb?.({ ok: true, results: round.results });

    const stageState = getStageState(room, idx);
    const stageOpts = resolveStageOptions(room, idx);
    const targetCards = resolveTargetCards(stageOpts);
    const racesPerStage = resolveRacesPerStage(stageOpts);

    const placements = {};
    const songGuesses = {};
    const winnerPlayerIds = [];
    const awards = [];

    for (const [playerId, entry] of Object.entries(round.answers || {})) {
      const timeline = stageState.timelines[playerId]?.cards || [];
      const placement = entry?.placement;

      if (placement && typeof placement.gapIndex === 'number') {
        const correct = validatePlacement(timeline, placement.gapIndex, round.year);
        placements[playerId] = { correct, gapIndex: placement.gapIndex };
        entry.placementCorrect = correct;

        if (correct) {
          winnerPlayerIds.push(playerId);
          // Insert card into timeline
          const newCard = {
            songId: round.song.id,
            track_name: round.song.track_name,
            artist_names: round.song.artist_names || [],
            album_name: round.song.album_name || null,
            imageUrl: round.song.imageUrl || null,
            releaseDate: round.song.releaseDate || '',
            year: round.year,
            addedInRound: round.id,
          };
          stageState.timelines[playerId].cards.splice(placement.gapIndex, 0, newCard);

          // Speed-based points for correct placement
          const points = computeTimeScore(
            { startedAt: round.startedAt, answers: { [playerId]: { at: placement.at } } },
            playerId,
            { maxPoints: CORRECT_PLACEMENT_MAX_POINTS }
          );
          awards.push({
            socketId: playerId,
            points,
            reason: 'correct',
            meta: { minigameId: 'HITSTER', roundId: round.id, stageIndex: idx },
          });
        }
      } else {
        placements[playerId] = { correct: false, gapIndex: -1 };
        entry.placementCorrect = false;
      }

      // Song name guess bonus
      if (entry?.songGuess && entry.songGuess.outcome === 'correct') {
        songGuesses[playerId] = { correct: true };
        awards.push({
          socketId: playerId,
          points: SONG_GUESS_BONUS,
          reason: 'song_guess',
          meta: { minigameId: 'HITSTER', roundId: round.id, stageIndex: idx },
        });
      } else if (entry?.songGuess) {
        songGuesses[playerId] = { correct: false };
      }
    }

    if (awards.length) {
      applyAwards(room, awards);
    }
    const bonuses = updateStreaks(room, idx, round.id, winnerPlayerIds, 'HITSTER');
    if (bonuses.length) {
      applyAwards(room, bonuses);
    }

    // Check win condition
    const gameWinners = [];
    for (const [playerId] of room.players) {
      if (playerId === room.hostPlayerId) continue;
      const cardCount = stageState.timelines[playerId]?.cards?.length || 0;
      if (cardCount >= targetCards) gameWinners.push(playerId);
    }
    const raceProgress = markRaceCompletion(
      stageState,
      gameWinners,
      racesPerStage,
      round.stageProgress?.raceNumber || stageState.raceNumber
    );

    round.results = {
      song: round.song,
      year: round.year,
      placements,
      songGuesses,
      winners: gameWinners,
    };
    round.status = 'revealed';
    round.revealedAt = Date.now();
    round.stageProgress.raceNumber = round.stageProgress.raceNumber || stageState.raceNumber;
    round.stageProgress.racesPerStage = racesPerStage;
    round.stageProgress.stageComplete = raceProgress.stageComplete;
    round.stageProgress.leaderboard = buildLeaderboard(room, idx);

    clearRoundTimer?.(room, idx);

    stageState.roundsCompleted = (stageState.roundsCompleted || 0) + 1;

    attachTimelines(room, round);

    appendRoundHistory(room, idx, {
      id: round.id,
      minigameId: 'HITSTER',
      startedAt: round.startedAt,
      revealedAt: round.revealedAt,
      prompt: {
        song: round.song,
        year: round.year,
        stageProgress: round.stageProgress,
      },
      answers: round.answers || {},
      song: { track_name: round.song?.track_name, artist_names: round.song?.artist_names },
      timelines: round.timelines || {},
      stageProgress: round.stageProgress,
      results: round.results,
    });

    broadcastGameState?.(roomCode);
    cb?.({ ok: true, results: round.results });
    return { ok: true, results: round.results };
  };

  const maybeAutoReveal = (room, roomCode, idx) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'HITSTER' || round.status === 'revealed') return;
    const connectedPlayerIds = getConnectedPlayerIds(room).filter((id) => id !== room.hostPlayerId);
    if (!connectedPlayerIds.length) return;
    const allPlaced = connectedPlayerIds.every((id) => round.answers[id]?.placement?.confirmedAt != null);
    if (allPlaced) {
      reveal(room, roomCode, idx);
    }
  };

  socket.on('minigame:HITSTER:startRound', async ({ roomCode, params } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id && socket.accountId !== 'pnleguizamo') {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }
      const roundState = await createRoundState(room, params);
      const idx = getStageIndex(room);

      roundState.expiresAt = scheduleRoundTimer?.(
        room,
        idx,
        roundState.roundTimerMs || DEFAULT_ROUND_TIMER_MS,
        () => {
          try {
            reveal(room, roomCode, idx);
          } catch (err) {
            logger.error('HITSTER auto-reveal failed', err);
          }
        }
      );

      attachTimelines(room, roundState);
      broadcastGameState?.(roomCode);
      cb?.({ ok: true, roundState });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (err.message === 'STAGE_COMPLETE') return cb?.({ ok: false, error: 'STAGE_COMPLETE' });
      logger.error('HITSTER startRound error', err);
      cb?.({ ok: false, error: err.message || 'server_error' });
    }
  });

  socket.on('minigame:HITSTER:submitPlacement', ({ roomCode, gapIndex, finalize = true } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = getStageIndex(room);
      room.roundState = room.roundState || {};
      const round = room.roundState[idx];
      if (!round || round.minigameId !== 'HITSTER')
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      if (round.status === 'revealed') return cb?.({ ok: false, error: 'ROUND_REVEALED' });

      const existingPlacement = round.answers[socket.playerId]?.placement;
      if (existingPlacement?.confirmedAt) {
        return cb?.({ ok: false, error: 'ALREADY_PLACED' });
      }

      // Lazy-initialize timeline for late joiners
      const stageState = getStageState(room, idx);
      const playerTimeline = ensurePlayerTimeline(stageState, socket.playerId);
      if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > playerTimeline.cards.length) {
        return cb?.({ ok: false, error: 'INVALID_GAP_INDEX' });
      }

      round.answers[socket.playerId] = round.answers[socket.playerId] || {
        placement: null,
        songGuess: null,
        placementCorrect: null,
      };
      round.answers[socket.playerId].placement = buildPlacementEntry(
        gapIndex,
        finalize,
        existingPlacement
      );

      attachTimelines(room, round);
      broadcastGameState?.(roomCode);
      maybeAutoReveal(room, roomCode, idx);
      cb?.({ ok: true, confirmed: finalize });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HITSTER submitPlacement error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HITSTER:submitSongGuess', ({ roomCode, guess } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = getStageIndex(room);
      room.roundState = room.roundState || {};
      const round = room.roundState[idx];
      if (!round || round.minigameId !== 'HITSTER')
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      if (round.status === 'revealed') return cb?.({ ok: false, error: 'ROUND_REVEALED' });

      if (round.answers[socket.playerId]?.songGuess) {
        return cb?.({ ok: false, error: 'ALREADY_GUESSED' });
      }

      const correct = guess?.trackId === round.song.id;
      round.answers[socket.playerId] = round.answers[socket.playerId] || {
        placement: null,
        songGuess: null,
        placementCorrect: null,
      };
      round.answers[socket.playerId].songGuess = {
        trackId: guess?.trackId || null,
        trackName: guess?.trackName || null,
        artistNames: guess?.artistNames || [],
        outcome: correct ? 'correct' : 'wrong',
        at: Date.now(),
      };

      attachTimelines(room, round);
      broadcastGameState?.(roomCode);
      cb?.({ ok: true, correct });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HITSTER submitSongGuess error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HITSTER:forceReveal', ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id && socket.accountId !== 'pnleguizamo') {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }
      const idx = getStageIndex(room);
      reveal(room, roomCode, idx, cb);
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HITSTER forceReveal error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });
}

module.exports = {
  register: registerHitster,
  createRoundState,
  helpers: {
    DEFAULT_RACES_PER_STAGE,
    resolveRacesPerStage,
    prepareRaceForStart,
    resetRaceState,
    markRaceCompletion,
  },
};
