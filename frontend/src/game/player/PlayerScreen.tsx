import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { GameState, MinigameId, StreakEntry } from 'types/game';
import { WhoListenedMostPlayerView } from './minigames/WhoListenedMost';
import { HigherLowerPlayerView } from './minigames/HigherLower';
import { GuessWrappedPlayerView } from './minigames/GuessWrapped';
import { HeardlePlayerView } from './minigames/Heardle';
import '../../styles/gameShell.css';

type PlayerMinigameProps = {
  roomCode: string;
  gameState: GameState;
};

const PLAYER_MINIGAME_COMPONENTS: Partial<Record<MinigameId, React.ComponentType<PlayerMinigameProps>>> = {
  WHO_LISTENED_MOST: WhoListenedMostPlayerView,
  HIGHER_LOWER: HigherLowerPlayerView,
  GUESS_SPOTIFY_WRAPPED: GuessWrappedPlayerView,
  HEARDLE: HeardlePlayerView,
};

const EMPTY_STREAK: StreakEntry = { current: 0, best: 0 };

const PlayerScreen = () => {
  const params = useParams();
  const roomCode = params.roomCode || '';
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const scoreAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomCode) return;
    socket.emit('playerJoinGame', { roomCode }, (resp?: { ok: boolean; state?: GameState }) => {
      if (resp?.ok && resp.state) setGameState(resp.state);
    });

    const handler = (state: GameState) => {
      if (state.roomCode !== roomCode) return;
      setGameState(state);
    };
    socket.on('gameStateUpdated', handler);

    return () => {
      socket.off('gameStateUpdated', handler);
    };
  }, [roomCode]);

  function handleLeave() {
    if (roomCode) socket.emit('leaveRoom', { roomCode });
    navigate('/lobby');
  }

  const phaseLabel = gameState?.phase
    ? gameState.phase === 'inGame'
      ? 'In Game'
      : gameState.phase === 'stageRecap'
        ? 'Stage Complete'
        : gameState.phase === 'finalRecap'
          ? 'All Awards'
          : gameState.phase === 'completed'
            ? 'Completed'
            : gameState.phase
    : 'Waiting';

  const currentStageIndex = typeof gameState?.currentStageIndex === 'number' ? gameState?.currentStageIndex : null;
  const currentStage = gameState?.currentStageConfig;
  const MinigameComponent =
    currentStage && gameState ? PLAYER_MINIGAME_COMPONENTS[currentStage.minigameId] || null : null;
  const myPlayerId = (((socket as any).playerId || socket.id) as string | undefined) ?? null;
  const myScore = useMemo(() => {
    if (!gameState?.scoreboard || !myPlayerId) return 0;
    return gameState.scoreboard[myPlayerId]?.points ?? 0;
  }, [gameState?.scoreboard, myPlayerId]);
  const myStreak = useMemo(() => {
    if (!gameState?.streaks || !myPlayerId) return EMPTY_STREAK;
    return gameState.streaks[myPlayerId] ?? EMPTY_STREAK;
  }, [gameState?.streaks, myPlayerId]);
  const [displayedStats, setDisplayedStats] = useState(() => ({
    points: 0,
    streak: EMPTY_STREAK,
    initialized: false,
  }));
  const [animatedScore, setAnimatedScore] = useState(0);
  const roundStatus = gameState?.currentRoundState?.status ?? null;
  const revealPhase = gameState?.revealPhase ?? null;
  const roundId = gameState?.currentRoundState?.id ?? null;
  const myAwards = useMemo(() => {
    if (!gameState?.scoreboard || !myPlayerId) return [];
    return gameState.scoreboard[myPlayerId]?.awards || [];
  }, [gameState?.scoreboard, myPlayerId]);

  useEffect(() => {
    const shouldApplyLiveStats =
      !displayedStats.initialized ||
      roundStatus !== 'revealed' ||
      revealPhase === 'postReveal';

    if (!shouldApplyLiveStats) return;

    setDisplayedStats((current) => {
      if (
        current.initialized &&
        current.points === myScore &&
        current.streak.current === myStreak.current &&
        current.streak.best === myStreak.best
      ) {
        return current;
      }

      return {
        points: myScore,
        streak: myStreak,
        initialized: true,
      };
    });
  }, [displayedStats.initialized, myScore, myStreak, revealPhase, roundStatus]);

  useEffect(() => {
    if (scoreAnimationRef.current) {
      cancelAnimationFrame(scoreAnimationRef.current);
      scoreAnimationRef.current = null;
    }

    const resolvedScore = displayedStats.initialized ? displayedStats.points : myScore;
    if (revealPhase !== 'postReveal' || roundStatus !== 'revealed' || !roundId) {
      setAnimatedScore(resolvedScore);
      return;
    }

    const roundDelta = myAwards
      .filter((award) => award.meta?.roundId === roundId)
      .reduce((sum, award) => sum + (award.points || 0), 0);
    const baseScore = resolvedScore - roundDelta;

    if (roundDelta <= 0) {
      setAnimatedScore(resolvedScore);
      return;
    }

    setAnimatedScore(baseScore);
    const durationMs = 1400;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setAnimatedScore(Math.round(baseScore + roundDelta * progress));

      if (progress < 1) {
        scoreAnimationRef.current = requestAnimationFrame(step);
      } else {
        scoreAnimationRef.current = null;
      }
    };

    scoreAnimationRef.current = requestAnimationFrame(step);
    return () => {
      if (scoreAnimationRef.current) {
        cancelAnimationFrame(scoreAnimationRef.current);
        scoreAnimationRef.current = null;
      }
    };
  }, [displayedStats.initialized, displayedStats.points, gameState?.scoreboard, myAwards, myScore, revealPhase, roundId, roundStatus]);

  const visibleScore = animatedScore;
  const visibleStreak = displayedStats.initialized ? displayedStats.streak : myStreak;
  const streakHint =
    visibleStreak.current > 0
      ? visibleStreak.best > visibleStreak.current
        ? `Best ${visibleStreak.best}`
        : 'Active'
      : visibleStreak.best > 0
        ? `Best ${visibleStreak.best}`
        : 'No streak';

  return (
    <div className="player-layout player-layout--viewport">
      <header className="player-header">
        <div className="player-header-main">
          <div>
            <h2 className="player-title">Room {roomCode}</h2>
            <div className="player-stage">
              {phaseLabel}{typeof currentStageIndex === 'number' && currentStage ? ` · Stage ${currentStageIndex + 1}` : ''}
            </div>
          </div>
          <div className="player-status-strip" aria-label="Your current game stats">
            <div className="player-stat-chip">
              <span className="player-stat-chip__icon" aria-hidden="true">✦</span>
              <span className="player-stat-chip__body">
                <span className="player-stat-chip__value">{visibleScore}</span>
                <span className="player-stat-chip__label">Points</span>
              </span>
            </div>
            <div
              className={`player-stat-chip player-stat-chip--streak${
                visibleStreak.current >= 3 ? ' player-stat-chip--hot' : ''
              }`}
            >
              <span className="player-stat-chip__icon" aria-hidden="true">
                {visibleStreak.current > 0 ? '🔥' : '○'}
              </span>
              <span className="player-stat-chip__body">
                <span className="player-stat-chip__value">{visibleStreak.current}</span>
                <span className="player-stat-chip__label">{streakHint}</span>
              </span>
            </div>
          </div>
        </div>
        <button className="game-shell-button" onClick={handleLeave}>Leave</button>
      </header>

      <main className="player-main">
        {gameState?.phase === 'stageRecap' || gameState?.phase === 'finalRecap' ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gs-muted)' }}>
            {gameState.phase === 'finalRecap' ? 'All awards incoming…' : 'Awards ceremony in progress…'}
          </div>
        ) : gameState && MinigameComponent ? (
          <MinigameComponent roomCode={roomCode} gameState={gameState} />
        ) : (
          <div>Waiting for the host to start the next minigame…</div>
        )}
      </main>
    </div>
  );
};

export default PlayerScreen;
