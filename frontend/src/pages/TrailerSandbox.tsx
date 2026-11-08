import { useEffect, useMemo, useState } from 'react';
import { WhoListenedMost } from 'game/host/minigames/WhoListenedMost';
import { GuessWrappedHost } from 'game/host/minigames/GuessWrapped';
import { HigherLowerHost } from 'game/host/minigames/HigherLower';
import { HeardleHost } from 'game/host/minigames/Heardle';
import { HitsterHost } from 'game/host/minigames/Hitster';
import { socket } from 'socket';
import type { GameState, MinigameRoundState, Player } from 'types/game';
import 'styles/gameShell.css';
import 'game/host/minigames/styles/hostMinigame.css';
import './TrailerSandbox.css';

const DURATION_MS = 31000;
const SCENES = [
  { key: 'intro', start: 0, end: 2900, label: '' },
  { key: 'who', start: 2900, end: 8100, label: 'WHO LISTENED MOST?' },
  { key: 'higher', start: 8100, end: 13200, label: 'HIGHER / LOWER' },
  { key: 'wrapped', start: 13200, end: 18500, label: 'GUESS THE WRAPPED' },
  { key: 'heardle', start: 18500, end: 23300, label: 'HEARDLE' },
  { key: 'hitster', start: 23300, end: 28100, label: 'HITSTER' },
  { key: 'outro', start: 28100, end: DURATION_MS, label: '' },
] as const;

const avatar = (letters: string, a: string, b: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" rx="28" fill="url(#g)"/><text x="50" y="62" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="37" fill="white">${letters}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const art = (title: string, a: string, b: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="30"/></filter></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="310" cy="86" r="110" fill="white" opacity=".28" filter="url(#blur)"/><circle cx="100" cy="320" r="125" fill="#020617" opacity=".3"/><circle cx="200" cy="200" r="118" fill="none" stroke="white" stroke-width="2" opacity=".45"/><circle cx="200" cy="200" r="20" fill="white" opacity=".7"/><text x="32" y="355" fill="white" font-size="30" font-weight="800" font-family="Arial,sans-serif">${title}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const auroraArt = art('AFTERGLOW', '#114a9b', '#ee3d91');
const midnightArt = art('MIDNIGHT', '#2e1065', '#0ea5e9');
const sunsetArt = art('SUNSET', '#9a3412', '#facc15');

const players: Player[] = [
  { playerId: 'host', userId: 'host', name: 'DJ Nova', displayName: 'DJ Nova', isHost: true, avatar: avatar('DJ', '#06b6d4', '#1d4ed8') },
  { playerId: 'nova', userId: 'nova', name: 'Nova', displayName: 'Nova', avatar: avatar('N', '#8b5cf6', '#ec4899') },
  { playerId: 'kai', userId: 'kai', name: 'Kai', displayName: 'Kai', avatar: avatar('K', '#0891b2', '#22d3ee') },
  { playerId: 'miso', userId: 'miso', name: 'Miso', displayName: 'Miso', avatar: avatar('M', '#f97316', '#ec4899') },
  { playerId: 'echo', userId: 'echo', name: 'Echo', displayName: 'Echo', avatar: avatar('E', '#84cc16', '#14b8a6') },
];

const votes = {
  nova: { answer: { targetPlayerId: 'kai' }, at: 1 },
  kai: { answer: { targetPlayerId: 'kai' }, at: 2 },
  miso: { answer: { targetPlayerId: 'nova' }, at: 3 },
  echo: { answer: { targetPlayerId: 'kai' }, at: 4 },
};

function makeRound(scene: string, revealed: boolean): MinigameRoundState {
  const now = Date.now();
  if (scene === 'who') return {
    id: 'trailer-who', minigameId: 'WHO_LISTENED_MOST',
    status: revealed ? 'revealed' : 'collecting',
    prompt: { id: 'afterglow', type: 'TRACK', track_name: 'Afterglow', artist_name: 'The Night Drive', artist_names: ['The Night Drive'], description: 'Who played this track the most?', imageUrl: auroraArt },
    answers: votes,
    startedAt: now - 12000, expiresAt: now + 12000,
    results: revealed ? { tally: { kai: 3, nova: 1 }, totalVotes: 4, topListenerSocketIds: ['kai'], listenCounts: { host: 63, nova: 42, kai: 183, miso: 28, echo: 77 }, winners: ['nova', 'kai', 'echo'] } : undefined,
  };
  if (scene === 'higher') return {
    id: 'trailer-higher', minigameId: 'HIGHER_LOWER',
    status: revealed ? 'revealed' : 'collecting', metric: 'plays', roundNumber: 3, maxRounds: 5,
    left: { id: 'left', metric: 'plays', scope: 'PLAYER', timeframe: 'last30', entityType: 'ARTIST', ownerPlayerId: 'nova', ownerLabel: 'Nova', entityId: 'artist-left', title: 'The Night Drive', subtitle: 'Nova · Last 30 Days', imageUrl: auroraArt, displayValue: 214, value: 214 },
    right: { id: 'right', metric: 'plays', scope: 'PLAYER', timeframe: 'last30', entityType: 'ARTIST', ownerPlayerId: 'kai', ownerLabel: 'Kai', entityId: 'artist-right', title: 'Satellite Club', subtitle: 'Kai · Last 30 Days', imageUrl: midnightArt, displayValue: 327, value: 327 },
    answers: { nova: { answer: { choice: 'RIGHT' }, at: 1 }, kai: { answer: { choice: 'RIGHT' }, at: 2 }, miso: { answer: { choice: 'LEFT' }, at: 3 }, echo: { answer: { choice: 'RIGHT' }, at: 4 } },
    startedAt: now - 9000, expiresAt: now + 15000,
    results: revealed ? { leftValue: 214, rightValue: 327, leftDisplayValue: 214, rightDisplayValue: 327, winnerSide: 'RIGHT', winners: ['nova', 'kai', 'echo'], tally: { LEFT: 1, RIGHT: 3 }, totalVotes: 4 } : undefined,
  };
  if (scene === 'wrapped') return {
    id: 'trailer-wrapped', minigameId: 'GUESS_SPOTIFY_WRAPPED',
    status: revealed ? 'revealed' : 'collecting',
    prompt: { year: 2025, minutesListened: 68420,
      topGenres: [{ genre: 'Indie pop', plays: 892 }, { genre: 'Electronic', plays: 713 }, { genre: 'Alt rock', plays: 580 }],
      topArtists: [{ name: 'The Night Drive', playCount: 214, imageUrl: auroraArt }, { name: 'Satellite Club', playCount: 178, imageUrl: midnightArt }, { name: 'Sunset Static', playCount: 151, imageUrl: sunsetArt }],
      topSongs: [{ track: 'Afterglow', artist: 'The Night Drive', playCount: 117, imageUrl: auroraArt }, { track: 'Midnight Signal', artist: 'Satellite Club', playCount: 93, imageUrl: midnightArt }],
    },
    answers: { nova: { answer: { targetPlayerId: 'miso' }, at: 1 }, kai: { answer: { targetPlayerId: 'miso' }, at: 2 } },
    ownerPlayerId: 'miso', ownerProfile: { playerId: 'miso', displayName: 'Miso', avatar: players[3].avatar },
    startedAt: now - 12000, expiresAt: now + 12000,
    results: revealed ? { votes: { miso: 2 }, ownerPlayerId: 'miso', ownerProfile: { playerId: 'miso', displayName: 'Miso', avatar: players[3].avatar }, winners: ['nova', 'kai'] } : undefined,
  };
  if (scene === 'heardle') return {
    id: 'trailer-heardle', minigameId: 'HEARDLE', status: revealed ? 'revealed' : 'guessing',
    song: { id: 'midnight', track_name: 'Midnight Signal', artist_names: ['Satellite Club'], album_name: 'Night Lines', imageUrl: midnightArt, releaseDate: '2022-07-15' },
    answers: {
      nova: { guesses: [{ snippetIndex: 0, trackId: 'wrong', trackName: 'Afterglow', artistNames: ['The Night Drive'], outcome: 'wrong', at: 1 }, { snippetIndex: 1, trackId: 'midnight', trackName: 'Midnight Signal', artistNames: ['Satellite Club'], outcome: 'correct', at: 2 }] },
      kai: { guesses: [{ snippetIndex: 0, trackId: 'midnight', trackName: 'Midnight Signal', artistNames: ['Satellite Club'], outcome: 'correct', at: 1 }] },
      miso: { guesses: [{ snippetIndex: 0, trackId: 'wrong2', trackName: 'Sunset Static', artistNames: ['Sunset Static'], outcome: 'wrong', at: 1 }] },
      echo: { guesses: [] },
    },
    startedAt: now - 9000, snippetStartedAt: now - 1200, snippetPlan: [500, 1000, 3000, 7000, 12000], currentSnippetIndex: 1,
    snippetHistory: [{ index: 0, startedAt: now - 5000, endedAt: now - 4500, durationMs: 500 }],
    guessWindowMs: 40000, expiresAt: now + 25000, stageProgress: { songNumber: 2, songsPerGame: 5 },
    hints: { showPattern: true, titlePattern: 'M _ _ _ _ _ _ _   S _ _ _ _ _', artistPattern: 'S _ _ _ _ _ _ _ _   C _ _ _', showYear: true, year: '2022', revealProgressPct: 30 },
    results: revealed ? { winners: ['nova', 'kai'], guessSummary: { nova: { outcome: 'correct', snippetIndex: 1 }, kai: { outcome: 'correct', snippetIndex: 0 }, miso: { outcome: 'wrong', snippetIndex: 0 }, echo: { outcome: 'gave_up', snippetIndex: 1 } }, song: { id: 'midnight', track_name: 'Midnight Signal', artist_names: ['Satellite Club'], album_name: 'Night Lines', imageUrl: midnightArt, releaseDate: '2022-07-15' }, snippetPlan: [500, 1000, 3000, 7000, 12000], stageProgress: { songNumber: 2, songsPerGame: 5 } } : undefined,
  };
  return {
    id: 'trailer-hitster', minigameId: 'HITSTER', status: revealed ? 'revealed' : 'placing',
    song: { id: 'sunset', track_name: 'Golden Hour', artist_names: ['Sunset Static'], album_name: 'Daybreak', imageUrl: sunsetArt, releaseDate: '2018-05-12' },
    year: revealed ? 2018 : undefined,
    answers: {
      nova: { placement: { gapIndex: 1, at: 1, confirmedAt: 2 }, songGuess: null, placementCorrect: revealed ? true : null },
      kai: { placement: { gapIndex: 2, at: 1, confirmedAt: 2 }, songGuess: null, placementCorrect: revealed ? false : null },
      miso: { placement: { gapIndex: 1, at: 1, confirmedAt: 2 }, songGuess: null, placementCorrect: revealed ? true : null },
      echo: { placement: null, songGuess: null, placementCorrect: null },
    },
    startedAt: now - 7000, expiresAt: now + 23000,
    stageProgress: { roundNumber: 4, raceNumber: 1, racesPerStage: 3, targetCards: 7, leaderboard: { nova: 5, kai: 4, miso: 5, echo: 3 } },
    results: revealed ? { song: { id: 'sunset', track_name: 'Golden Hour', artist_names: ['Sunset Static'], album_name: 'Daybreak', imageUrl: sunsetArt, releaseDate: '2018-05-12' }, year: 2018, placements: { nova: { correct: true, gapIndex: 1 }, kai: { correct: false, gapIndex: 2 }, miso: { correct: true, gapIndex: 1 }, echo: { correct: false, gapIndex: 0 } }, songGuesses: {}, winners: [] } : undefined,
  };
}

function makeState(scene: string, revealed: boolean): GameState {
  const round = makeRound(scene, revealed);
  const config = { index: 0, minigameId: round.minigameId };
  return { roomCode: 'BEAT42', hostSocketId: 'host', players, phase: 'inGame', stagePlan: [config], currentStageIndex: 0, currentStageConfig: config, currentRoundState: round,
    scoreboard: { nova: { points: 420 }, kai: { points: 380 }, miso: { points: 340 }, echo: { points: 290 } },
    streaks: { nova: { current: 3, best: 3 }, kai: { current: 2, best: 4 }, miso: { current: 1, best: 2 }, echo: { current: 0, best: 2 } },
  };
}

const NOOP = () => {};

export default function TrailerSandbox() {
  const params = new URLSearchParams(window.location.search);
  const fixedScene = params.get('scene');
  const fixedPhase = params.get('phase') || 'collecting';
  const autoplay = params.get('autoplay') === '1';
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    (socket as any).playerId = 'nova';
    (window as any).__trailerReady = true;
    if (!autoplay) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(Math.min(DURATION_MS, performance.now() - start)), 40);
    return () => window.clearInterval(timer);
  }, [autoplay]);
  const scene = fixedScene ? SCENES.find(item => item.key === fixedScene) || SCENES[0] : SCENES.find(item => elapsed >= item.start && elapsed < item.end) || SCENES[SCENES.length - 1];
  const localTime = fixedScene ? (fixedPhase === 'revealed' ? 4000 : 900) : elapsed - scene.start;
  const revealAt = scene.key === 'who' || scene.key === 'wrapped' ? 900 : scene.key === 'higher' ? 2100 : 2300;
  const revealed = fixedScene ? fixedPhase === 'revealed' : localTime > revealAt;
  const showPayoff = revealed && (fixedScene ? true : localTime > revealAt + (scene.key === 'who' || scene.key === 'wrapped' ? 3400 : 1000));
  const gameState = useMemo(() => ['intro', 'outro'].includes(scene.key) ? null : makeState(scene.key, revealed), [scene.key, revealed]);
  const progress = Math.min(1, elapsed / DURATION_MS);
  const viewProps = { roomCode: 'BEAT42', gameState: gameState!, onAdvance: NOOP, onRevealComplete: NOOP, remainingMs: 12000 };

  return <main className={`trailer-root trailer-scene-${scene.key}${revealed ? ' trailer-revealed' : ''}`}>
    <div className="trailer-ambient trailer-ambient-a" /><div className="trailer-ambient trailer-ambient-b" />
    {scene.key === 'intro' ? <div className="trailer-title-card trailer-title-card-intro">
      <div className="trailer-kicker">YOUR MUSIC. YOUR FRIENDS. YOUR GAME.</div>
      <div className="trailer-brand"><span>STAT</span> TRACKER</div>
      <div className="trailer-title-sub">Think you know their listening history?</div>
      <div className="trailer-equalizer">{Array.from({length: 23}, (_, i) => <span key={i} style={{ animationDelay: `${i * 60}ms` }} />)}</div>
    </div> : scene.key === 'outro' ? <div className="trailer-title-card trailer-title-card-outro">
      <div className="trailer-kicker">FIVE WAYS TO PLAY.</div>
      <div className="trailer-brand"><span>STAT</span> TRACKER</div>
      <div className="trailer-title-sub">Bring your music into the room.</div>
      <div className="trailer-outro-tags">GUESS · COMPETE · REVEAL</div>
    </div> : <>
      <header className="trailer-chrome"><div className="trailer-mini-brand"><span>STAT</span> TRACKER</div><div className="trailer-room">ROOM BEAT42 <span>●</span> LIVE</div></header>
      <div className="trailer-scene-heading"><div className="trailer-scene-num">0{SCENES.findIndex(s => s.key === scene.key)}</div><div><div className="trailer-scene-eyebrow">MINIGAME</div><h1>{scene.label}</h1></div></div>
      <section className="trailer-game-frame" key={scene.key}>
        {scene.key === 'who' && <WhoListenedMost {...viewProps} />}
        {scene.key === 'higher' && <HigherLowerHost {...viewProps} />}
        {scene.key === 'wrapped' && <GuessWrappedHost {...viewProps} />}
        {scene.key === 'heardle' && <HeardleHost {...viewProps} />}
        {scene.key === 'hitster' && <HitsterHost {...viewProps} />}
      </section>
      <div className={`trailer-payoff ${showPayoff ? 'trailer-payoff-show' : ''}`}>{scene.key === 'who' ? 'KAI PLAYED IT 183 TIMES' : scene.key === 'higher' ? 'THE CHALLENGER WINS' : scene.key === 'wrapped' ? 'IT WAS MISO ALL ALONG' : scene.key === 'heardle' ? 'NAME THAT TRACK' : 'PLACE IT IN THE TIMELINE'}</div>
    </>}
    <div className="trailer-progress"><span style={{ width: `${progress * 100}%` }} /></div>
  </main>;
}
