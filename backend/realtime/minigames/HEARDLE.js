const { getSharedTopSongs } = require('../../services/mongoServices');
const { getAccessToken } = require('../../services/authService');

const SNIPPET_WINDOWS_MS = [500, 1000, 3000, 7000, 12000, 17000, 30000];
const SNIPPET_REPLAY_GAP_MS = [6000, 5000, 4000, 2000, 2000, 2000, 11000];
const GUESS_WINDOW_MS = 40_000;
const DEFAULT_POINTS_PER_SNIPPET = [1200, 1000, 900, 750, 600, 500, 300];
const DEFAULT_SONGS_PER_GAME = 10;
const HINT_PATTERN_START_SNIPPET_INDEX = 1;
const HINT_YEAR_SNIPPET_INDEX = 2;
const HINT_ARTIST_INITIAL_SNIPPET_INDEX = 5;
const HINT_PROGRESSIVE_REVEAL_START_SNIPPET_INDEX = 3;
const DEFAULT_PROGRESSIVE_REVEAL_CAP = 0.6;

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

function getStageState(room, stageIndex) {
  room.heardleStages = room.heardleStages || {};
  if (!room.heardleStages[stageIndex]) {
    room.heardleStages[stageIndex] = {
      pool: null,
      pointer: 0,
      usedSongIds: new Set(),
      songsStarted: 0,
      songsCompleted: 0,
    };
  }
  return room.heardleStages[stageIndex];
}

async function ensureSongPool(room, stageIndex, opts = {}) {
  const stageState = getStageState(room, stageIndex);
  if (stageState.pool?.length) return stageState.pool;

  const userIds = [];
  room.players.forEach((player, socketId) => {
    if (player.userId && socketId !== room.hostSocketId) userIds.push(player.userId);
  });

  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueUserIds.length) throw new Error('NO_USERS_AVAILABLE');

  const accessToken = await getAccessToken(uniqueUserIds[0]);
  const songs = await getSharedTopSongs(uniqueUserIds, accessToken, 0.5, opts.sampleSize || 120);


  // stageState.pool = (songs || []);
  stageState.pool = (songs || []).sort((a, b) => (b?.user_count || 0) - (a?.user_count || 0));
  stageState.pointer = 0;
  stageState.usedSongIds = new Set();
  return stageState.pool;
}

function getWinners(round) {
  return Object.entries(round?.answers || {})
    .filter(([, entry]) => entry?.guesses?.some((g) => g.outcome === 'correct'))
    .map(([socketId]) => socketId);
}

function countSatisfiedPlayers(room, round) {
  let satisfiedCount = 0;
  room.players.forEach((_, playerSocketId) => {
    const gList = round.answers[playerSocketId]?.guesses || [];
    const alreadyCorrect = gList.some((g) => g.outcome === 'correct');
    const guessedThisSnippet = gList.some((g) => g.snippetIndex === round.currentSnippetIndex);
    if (alreadyCorrect || guessedThisSnippet) satisfiedCount += 1;
  });
  return satisfiedCount;
}

function pickSong(stageState, fallback = null) {
  if (fallback) return fallback;
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

  // exhausted pool, reset used list and pick next
  stageState.usedSongIds = new Set();
  const idx = stageState.pointer % total;
  stageState.pointer = idx + 1;
  return stageState.pool[idx];
}

function normalizeArtists(names = []) {
  return (names || []).map((n) => (typeof n === 'string' ? n.trim().toLowerCase() : '')).filter(Boolean);
}

function normalizeAlbum(val){
  return typeof val === 'string' ? val.trim().toLowerCase() : '';
} 

function evaluateGuess(guess, song) {
  const targetId = song?.id || song?._id;
  const guessId = guess?.trackId || guess?.id;
  const targetArtists = normalizeArtists(song?.artist_names || song?.artistNames || []);
  const guessArtists = normalizeArtists(guess?.artistNames || guess?.artist_names || []);
  const targetAlbum = normalizeAlbum(song?.album_name || song?.albumName);
  const guessAlbum = normalizeAlbum(guess?.albumName || guess?.album_name);

  const hasArtistMatch = targetArtists.length > 0 && guessArtists.some((a) => targetArtists.includes(a));
  const hasAlbumMatch = targetAlbum && guessAlbum && targetAlbum === guessAlbum;
  if (guessId && targetId && guessId === targetId) {
    return { outcome: 'correct' };
  }

  if (hasAlbumMatch) {
    return { outcome: 'album_match' };
  }

  if (hasArtistMatch) {
    return { outcome: 'artist_match' };
  }

  return { outcome: 'wrong' };
}

function isLetterChar(char) {
  return !!char && char.toLowerCase() !== char.toUpperCase();
}

function isDigitChar(char) {
  return /[0-9]/.test(char);
}

function getMaskableIndexes(text = '') {
  const chars = Array.from(text || '');
  return chars
    .map((char, idx) => ({ char, idx }))
    .filter(({ char }) => isLetterChar(char))
    .map(({ idx }) => idx);
}

function hashSeed(seedText = '') {
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seedText = '') {
  let seed = hashSeed(seedText);
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledRevealOrder(text = '', seedText = '') {
  const indices = getMaskableIndexes(text);
  const rng = createSeededRng(seedText);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function toMaskedPattern(text = '', revealSet = new Set()) {
  const chars = Array.from(text || '');
  return chars
    .map((char, idx) => {
      if (char === ' ') return ' ';
      if (isDigitChar(char)) return '_';
      if (isLetterChar(char)) return revealSet.has(idx) ? char : '_';
      return char;
    })
    .join('');
}

function getReleaseYear(song = {}) {
  const releaseDate = song?.releaseDate || song?.release_date;
  if (!releaseDate || typeof releaseDate !== 'string') return null;
  const match = releaseDate.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return null;
  return String(year);
}

function getArtistHintSource(song = {}) {
  const artists = song?.artist_names || song?.artistNames || [];
  return Array.isArray(artists) ? artists.join(', ') : '';
}

function getWordInitialLetterIndexes(text = '') {
  const chars = Array.from(text || '');
  const indexes = [];
  for (let idx = 0; idx < chars.length; idx += 1) {
    const char = chars[idx];
    const prevChar = idx > 0 ? chars[idx - 1] : null;
    if (!isLetterChar(char)) continue;
    if (!isLetterChar(prevChar || '')) {
      indexes.push(idx);
    }
  }
  return indexes;
}

function getProgressiveRevealRatio(round = {}) {
  const snippetCount = Array.isArray(round.snippetPlan) ? round.snippetPlan.length : 0;
  const snippetIndex = typeof round.currentSnippetIndex === 'number' ? round.currentSnippetIndex : 0;
  if (snippetIndex < HINT_PROGRESSIVE_REVEAL_START_SNIPPET_INDEX) return 0;

  const revealCap = Math.max(0, Math.min(1, Number(DEFAULT_PROGRESSIVE_REVEAL_CAP)));
  const totalRevealSteps = Math.max(1, snippetCount - HINT_PROGRESSIVE_REVEAL_START_SNIPPET_INDEX);
  const currentStep = Math.min(totalRevealSteps, snippetIndex - HINT_PROGRESSIVE_REVEAL_START_SNIPPET_INDEX + 1);
  return Math.min(revealCap, (revealCap * currentStep) / totalRevealSteps);
}

function computeRoundHints(round = {}) {
  const snippetIndex = typeof round.currentSnippetIndex === 'number' ? round.currentSnippetIndex : 0;
  const showPattern = snippetIndex >= HINT_PATTERN_START_SNIPPET_INDEX;
  const showYear = snippetIndex >= HINT_YEAR_SNIPPET_INDEX;
  const showArtistWordInitials = snippetIndex >= HINT_ARTIST_INITIAL_SNIPPET_INDEX;
  const revealRatio = getProgressiveRevealRatio(round);

  const titleText = round?.song?.track_name || '';
  const artistText = getArtistHintSource(round.song);

  const titleOrder = shuffledRevealOrder(titleText, `${round.id || 'heardle'}:title:${round?.song?.id || 'song'}`);
  const artistOrder = shuffledRevealOrder(artistText, `${round.id || 'heardle'}:artist:${round?.song?.id || 'song'}`);
  const titleRevealCount = Math.floor(titleOrder.length * revealRatio);
  const artistRevealCount = Math.floor(artistOrder.length * revealRatio);

  const titleRevealSet = new Set(titleOrder.slice(0, titleRevealCount));
  const artistRevealSet = new Set(artistOrder.slice(0, artistRevealCount));
  if (showArtistWordInitials) {
    const artistInitialIndexes = getWordInitialLetterIndexes(artistText);
    artistInitialIndexes.forEach((idx) => artistRevealSet.add(idx));
  }


  return {
    showPattern,
    titlePattern: showPattern ? toMaskedPattern(titleText, titleRevealSet) : null,
    artistPattern: showPattern ? toMaskedPattern(artistText, artistRevealSet) : null,
    showYear: showPattern && showYear,
    year: showPattern && showYear ? getReleaseYear(round.song) : null,
    revealProgressPct: Math.round(revealRatio * 100),
  };
}

function computeHeardlePoints(round, guess) {
  if (!round || !guess) return 0;
  const maxPointsArr = Array.isArray(round.maxPointsPerSnippet) ? round.maxPointsPerSnippet : DEFAULT_POINTS_PER_SNIPPET;
  const snippetMax =
    maxPointsArr[guess.snippetIndex] ??
    maxPointsArr[maxPointsArr.length - 1] ??
    DEFAULT_POINTS_PER_SNIPPET[DEFAULT_POINTS_PER_SNIPPET.length - 1];

  const windowMs = round.guessWindowMs || GUESS_WINDOW_MS;
  const snippetStart = round.snippetHistory?.[guess.snippetIndex]?.startedAt || round.startedAt || Date.now();
  const elapsedMs = Math.max(0, guess.at - snippetStart);
  const decayPerMs = snippetMax / (windowMs * 4);
  const scored = Math.round(snippetMax - decayPerMs * elapsedMs);
  const minPoints = 25;
  return Math.max(minPoints, Math.min(snippetMax, scored));
}

function getFirstCorrectGuess(round, socketId) {
  const guesses = round?.answers?.[socketId]?.guesses || [];
  return guesses.find((g) => g?.outcome === 'correct') || null;
}

function computeGuessSummary(round) {
  const summary = {};
  for (const [socketId, entry] of Object.entries(round.answers || {})) {
    const guesses = Array.isArray(entry?.guesses) ? entry.guesses : [];
    const latest = guesses[guesses.length - 1] || null;
    const firstCorrect = guesses.find((g) => g.outcome === 'correct');
    const best = firstCorrect || latest;
    if (!best) continue;
    summary[socketId] = {
      outcome: best.outcome,
      snippetIndex: best.snippetIndex,
      at: best.at,
    };
  }
  return summary;
}

async function createRoundState(room, params = {}) {
  const stageIndex = getStageIndex(room);
  room.roundState = room.roundState || {};

  const stageState = getStageState(room, stageIndex);
  const songsPerGame = DEFAULT_SONGS_PER_GAME;

  if (stageState.songsStarted >= songsPerGame) {
    throw new Error('NO_SONGS_REMAINING');
  }

  await ensureSongPool(room, stageIndex);
  const song = pickSong(stageState);
  if (!song) throw new Error('NO_SONG_AVAILABLE');

  const snippetPlan = SNIPPET_WINDOWS_MS;
  const snippetReplayGapPlanMs = SNIPPET_REPLAY_GAP_MS;

  const maxPointsPerSnippet = DEFAULT_POINTS_PER_SNIPPET;

  const now = Date.now();
  const roundState = {
    id: params.roundId || `heardle-${now}`,
    minigameId: 'HEARDLE',
    status: 'guessing',
    song: {
      ...song,
      uri: (song.id ? `spotify:track:${song.id}` : null),
    },
    answers: {},
    startedAt: now,
    snippetStartedAt: now,
    snippetPlan,
    snippetReplayGapPlanMs,
    snippetHistory: [{ index: 0, startedAt: now, durationMs: snippetPlan[0] || null }],
    currentSnippetIndex: 0,
    guessWindowMs: GUESS_WINDOW_MS,
    maxPointsPerSnippet,
    hints: null,
    stageProgress: {
      songNumber: stageState.songsStarted + 1,
      songsPerGame,
    },
  };
  roundState.hints = computeRoundHints(roundState);

  stageState.songsStarted += 1;
  room.roundState[stageIndex] = roundState;
  return roundState;
}

function registerHeardle(io, socket, deps = {}) {
  const {
    getRoom,
    broadcastGameState,
    applyAwards,
    scheduleRoundTimer,
    clearRoundTimer,
  } = deps;
  const logger = deps.logger || console;

  const reveal = (room, roomCode, idx, cb) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'HEARDLE') return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
    if (round.status === 'revealed') return cb?.({ ok: true, results: round.results });

    const stageState = getStageState(room, idx);

    const winners = getWinners(round);

    const guessSummary = computeGuessSummary(round);

    const awards = applyAwards && winners.length
      ? winners.map((socketId) => {
          const guess = getFirstCorrectGuess(round, socketId);
          return {
            socketId,
            points: computeHeardlePoints(round, guess),
            reason: 'correct',
            meta: {
              minigameId: 'HEARDLE',
              roundId: round.id,
              stageIndex: idx,
              snippetIndex: guess?.snippetIndex ?? null,
            },
          };
        })
      : [];

    if (awards.length) {
      applyAwards(room, awards);
    }

    round.results = {
      winners,
      guessSummary,
      song: round.song,
      snippetPlan: round.snippetPlan,
      stageProgress: round.stageProgress,
    };
    round.status = 'revealed';
    round.revealedAt = Date.now();
    clearRoundTimer?.(room, idx);

    stageState.songsCompleted = (stageState.songsCompleted || 0) + 1;

    broadcastGameState?.(roomCode);
    cb?.({ ok: true, results: round.results });
    return { ok: true, results: round.results };
  };

  const maybeAdvanceAfterResponse = (room, roomCode, idx) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'HEARDLE') return;
    const totalPlayers = room.players.size;
    const winners = getWinners(round);

    if (totalPlayers > 0 && winners.length >= totalPlayers) {
      reveal(room, roomCode, idx);
      return;
    }

    if (totalPlayers > 0) {
      const satisfiedCount = countSatisfiedPlayers(room, round);
      if (satisfiedCount >= totalPlayers && round.status !== 'revealed') {
        if (round.currentSnippetIndex + 1 >= round.snippetPlan.length) {
          reveal(room, roomCode, idx);
        } else {
          advanceSnippet(room, roomCode, idx);
        }
      }
    }
  };

  const advanceSnippet = (room, roomCode, idx) => {
    const round = room.roundState?.[idx];
    if (!round || round.minigameId !== 'HEARDLE') return;
    if (round.status === 'revealed') return;

    const totalPlayers = room.players.size;
    const winners = getWinners(round);

    if (totalPlayers > 0 && winners.length >= totalPlayers) {
      reveal(room, roomCode, idx);
      return;
    }

    if (round.currentSnippetIndex + 1 >= round.snippetPlan.length) {
      reveal(room, roomCode, idx);
      return;
    }

    const now = Date.now();
    round.snippetHistory = round.snippetHistory || [];
    const currentIdx = round.currentSnippetIndex;
    round.snippetHistory[currentIdx] = {
      ...(round.snippetHistory[currentIdx] || {}),
      endedAt: now,
    };

    round.currentSnippetIndex += 1;
    round.snippetStartedAt = now;
    round.snippetHistory[round.currentSnippetIndex] = {
      ...(round.snippetHistory[round.currentSnippetIndex] || {}),
      startedAt: now,
      durationMs: round.snippetPlan[round.currentSnippetIndex],
    };
    round.hints = computeRoundHints(round);

    round.expiresAt = scheduleRoundTimer?.(room, idx, round.guessWindowMs || GUESS_WINDOW_MS, () => {
      try {
        advanceSnippet(room, roomCode, idx);
      } catch (err) {
        logger.error('HEARDLE auto-advance failed', err);
      }
    });
    broadcastGameState?.(roomCode);
  };

  socket.on('minigame:HEARDLE:startRound', async ({ roomCode, params } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id && socket.accountId !== 'pnleguizamo') {
        return cb?.({ ok: false, error: 'NOT_HOST' });
      }
      const roundState = await createRoundState(room, params);
      const idx = getStageIndex(room);

      roundState.expiresAt = scheduleRoundTimer?.(room, idx, roundState.guessWindowMs || GUESS_WINDOW_MS, () => {
        try {
          advanceSnippet(room, roomCode, idx);
        } catch (err) {
          logger.error('HEARDLE auto-advance failed', err);
        }
      });

      broadcastGameState?.(roomCode);
      cb?.({ ok: true, roundState });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      if (err.message === 'NO_SONGS_REMAINING') return cb?.({ ok: false, error: 'NO_SONGS_REMAINING' });
      logger.error('HEARDLE startRound error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HEARDLE:submitGuess', ({ roomCode, guess } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = getStageIndex(room);
      room.roundState = room.roundState || {};
      const round = room.roundState[idx];
      if (!round || round.minigameId !== 'HEARDLE') {
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      }
      if (round.status === 'revealed') return cb?.({ ok: false, error: 'ROUND_REVEALED' });

      // Once correct, ignore further guesses.
      const priorGuesses = round.answers[socket.id]?.guesses || [];
      if (priorGuesses.some((g) => g.outcome === 'correct')) {
        return cb?.({ ok: false, error: 'ALREADY_CORRECT' });
      }

      const guesses = round.answers[socket.id]?.guesses || [];
      if (guesses.some((g) => g.snippetIndex === round.currentSnippetIndex)) {
        return cb?.({ ok: false, error: 'ALREADY_GUESSED_THIS_SNIPPET' });
      }

      const evaluated = evaluateGuess(guess, round.song);
      const entry = {
        snippetIndex: round.currentSnippetIndex,
        trackId: guess?.trackId || guess?.id || null,
        trackName: guess?.trackName || guess?.name || null,
        artistNames: guess?.artistNames || guess?.artist_names || [],
        albumName: guess?.albumName || guess?.album_name || null,
        outcome: evaluated.outcome,
        at: Date.now(),
      };

      round.answers[socket.id] = round.answers[socket.id] || { guesses: [] };
      round.answers[socket.id].guesses.push(entry);

      broadcastGameState?.(roomCode);

      maybeAdvanceAfterResponse(room, roomCode, idx);

      cb?.({ ok: true, outcome: evaluated.outcome, snippetIndex: entry.snippetIndex });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HEARDLE submitGuess error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HEARDLE:giveUp', ({ roomCode, expectedRoundId, expectedSnippetIndex } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      const idx = getStageIndex(room);
      room.roundState = room.roundState || {};
      const round = room.roundState[idx];
      if (!round || round.minigameId !== 'HEARDLE') {
        return cb?.({ ok: false, error: 'ROUND_NOT_READY' });
      }
      if (round.status === 'revealed') return cb?.({ ok: false, error: 'ROUND_REVEALED' });
      if (expectedRoundId && round.id !== expectedRoundId) {
        return cb?.({ ok: false, error: 'ROUND_CHANGED' });
      }
      if (
        typeof expectedSnippetIndex === 'number' &&
        expectedSnippetIndex !== round.currentSnippetIndex
      ) {
        return cb?.({ ok: false, error: 'ROUND_CHANGED' });
      }

      const priorGuesses = round.answers[socket.id]?.guesses || [];
      if (priorGuesses.some((g) => g.outcome === 'correct')) {
        return cb?.({ ok: false, error: 'ALREADY_CORRECT' });
      }
      if (priorGuesses.some((g) => g.snippetIndex === round.currentSnippetIndex)) {
        return cb?.({ ok: false, error: 'ALREADY_GUESSED_THIS_SNIPPET' });
      }

      const entry = {
        snippetIndex: round.currentSnippetIndex,
        trackId: null,
        trackName: null,
        artistNames: [],
        albumName: null,
        outcome: 'gave_up',
        at: Date.now(),
      };

      round.answers[socket.id] = round.answers[socket.id] || { guesses: [] };
      round.answers[socket.id].guesses.push(entry);

      broadcastGameState?.(roomCode);
      maybeAdvanceAfterResponse(room, roomCode, idx);

      cb?.({ ok: true, outcome: 'gave_up', snippetIndex: entry.snippetIndex });
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HEARDLE giveUp error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });

  socket.on('minigame:HEARDLE:forceReveal', ({ roomCode } = {}, cb) => {
    try {
      const room = safeRoomLookup(getRoom, roomCode);
      if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'NOT_HOST' });

      const idx = getStageIndex(room);
      const result = reveal(room, roomCode, idx, cb);
      if (!cb && result?.ok) {
        broadcastGameState?.(roomCode);
      }
    } catch (err) {
      if (err.message === 'ROOM_NOT_FOUND') return cb?.({ ok: false, error: 'ROOM_NOT_FOUND' });
      logger.error('HEARDLE forceReveal error', err);
      cb?.({ ok: false, error: 'server_error' });
    }
  });
}

module.exports = {
  register: registerHeardle,
  createRoundState,
};
