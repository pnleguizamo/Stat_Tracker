// HostGameScreen.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { WhoListenedMost } from "./minigames/WhoListenedMost";
import { GuessWrappedHost } from "./minigames/GuessWrapped";
import { HeardleHost } from "./minigames/Heardle";
import { StageRecap } from "./StageRecap";
import { FinalRecap } from "./FinalRecap";
import { useParams } from "react-router-dom";
import { socket } from "socket";
import { GameState, HeardleRoundState, MinigameId } from "types/game";
import { Leaderboard } from "./Leaderboard";
import { StreakToast } from "./StreakToast";
import { PlayerAvatar } from "components/PlayerAvatar";
import { useHostSfx } from "game/hooks/useHostSfx";
import { RadialTimer } from "./minigames/components/RadialTimer";
import "../../styles/gameShell.css";
import "./minigames/styles/hostMinigame.css";

type HostMinigameProps = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
  remainingMs: number | null;
};

const MINIGAME_HOST_COMPONENTS: Partial<Record<MinigameId, React.ComponentType<HostMinigameProps>>> = {
  WHO_LISTENED_MOST: WhoListenedMost,
  GUESS_SPOTIFY_WRAPPED: GuessWrappedHost,
  HEARDLE: HeardleHost,
//   GENRE_GUESS: GenreGuessHostView,
//   FIRST_PLAY: FirstPlayHostView,
//   GRAPH_GUESS: GraphGuessHostView,
//   OUTLIER_MODE: OutlierModeHostView,
};

// Award cards stay readable at host-display scale with up to two featured players.
const FINAL_RECAP_MAX_PLAYERS_PER_AWARD = 2;

const HostGame = () => {
  const params = useParams();
  const roomCode = params.roomCode || "";
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [streakToastRoundId, setStreakToastRoundId] = useState<string | null>(null);
  const lastRevealedRoundIdRef = useRef<string | null>(null);
  const activeRoundRef = useRef<GameState["currentRoundState"] | null>(null);
  const leaderboardShowRef = useRef<number | null>(null);
  const leaderboardHideRef = useRef<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const previousStageIndexRef = useRef<number | null>(null);
  const previousRoundIdRef = useRef<string | null>(null);
  const { playStageTransition, playRoundTransition } = useHostSfx();
  const currentRoundState = gameState?.currentRoundState;
  const currentMinigameId = gameState?.currentStageConfig?.minigameId;

  useEffect(() => {
    if (!roomCode) return;
    socket.emit("hostJoin", { roomCode }, (resp?: { ok: boolean; state?: GameState }) => {
      if (resp?.ok && resp.state) setGameState(resp.state);
    });
    const handler = (state: GameState) => {
      if (state.roomCode !== roomCode) return;
      setGameState(state);
    };
    socket.on("gameStateUpdated", handler);
    return () => {
      socket.off("gameStateUpdated", handler);
    };
  }, [roomCode]);

  useEffect(() => {
    if (!currentRoundState) return;
    const round = currentRoundState;
    if (round.status !== "revealed") return;
    if (round.id === lastRevealedRoundIdRef.current) return;

    if (currentMinigameId === "WHO_LISTENED_MOST") return;
    if (currentMinigameId === "GUESS_SPOTIFY_WRAPPED") return;

    lastRevealedRoundIdRef.current = round.id;
    setStreakToastRoundId((currentRoundId) => (currentRoundId === round.id ? currentRoundId : round.id));
    if (leaderboardShowRef.current) {
      window.clearTimeout(leaderboardShowRef.current);
      leaderboardShowRef.current = null;
    }
    if (leaderboardHideRef.current) {
      window.clearTimeout(leaderboardHideRef.current);
      leaderboardHideRef.current = null;
    }
    leaderboardShowRef.current = window.setTimeout(() => setShowLeaderboard(true), 2000);
    leaderboardHideRef.current = window.setTimeout(() => setShowLeaderboard(false), 6000);
  }, [currentMinigameId, currentRoundState]);

  useEffect(() => {
    activeRoundRef.current = currentRoundState ?? null;
  }, [currentRoundState]);

  useEffect(() => {
    const stageIndex = gameState?.currentStageIndex;
    const roundId = currentRoundState?.id ?? null;
    let stageChanged = false;

    if (typeof stageIndex === "number") {
      const previousStageIndex = previousStageIndexRef.current;
      if (previousStageIndex === null) {
        previousStageIndexRef.current = stageIndex;
      } else if (stageIndex !== previousStageIndex) {
        previousStageIndexRef.current = stageIndex;
        stageChanged = true;
        playStageTransition();
      }
    }

    if (!roundId) {
      previousRoundIdRef.current = null;
      return;
    }

    const previousRoundId = previousRoundIdRef.current;
    if (previousRoundId === null) {
      previousRoundIdRef.current = roundId;
      return;
    }

    if (roundId !== previousRoundId) {
      previousRoundIdRef.current = roundId;
      if (!stageChanged && currentMinigameId !== "HEARDLE") {
        playRoundTransition();
      }
    }
  }, [
    gameState?.currentStageIndex,
    currentMinigameId,
    currentRoundState?.id,
    playStageTransition,
    playRoundTransition,
  ]);

  useEffect(() => {
    const round = currentRoundState;
    if (!round || round.status === "revealed") {
      if (!round) setStreakToastRoundId(null);
      return;
    }

    if (leaderboardShowRef.current) {
      window.clearTimeout(leaderboardShowRef.current);
      leaderboardShowRef.current = null;
    }
    if (leaderboardHideRef.current) {
      window.clearTimeout(leaderboardHideRef.current);
      leaderboardHideRef.current = null;
    }
    setShowLeaderboard(false);
    setStreakToastRoundId(null);
  }, [currentRoundState]);

  const handleRevealComplete = (onSequenceComplete?: () => void) => {
    const revealRoundId = activeRoundRef.current?.id ?? null;
    if (revealRoundId) {
      setStreakToastRoundId((currentRoundId) => (currentRoundId === revealRoundId ? currentRoundId : revealRoundId));
    }
    if (leaderboardShowRef.current) {
      window.clearTimeout(leaderboardShowRef.current);
      leaderboardShowRef.current = null;
    }
    if (leaderboardHideRef.current) {
      window.clearTimeout(leaderboardHideRef.current);
      leaderboardHideRef.current = null;
    }
    
    leaderboardShowRef.current = window.setTimeout(() => setShowLeaderboard(true), 2000);
    leaderboardHideRef.current = window.setTimeout(() => {
      const currentRound = activeRoundRef.current;
      const isStillSameRevealedRound =
        !!currentRound &&
        currentRound.status === "revealed" &&
        currentRound.id === revealRoundId;
      if (!isStillSameRevealedRound) return;

      setShowLeaderboard(false);
      onSequenceComplete?.();
    }, 6000);
  };

  useEffect(() => {
    return () => {
      if (leaderboardShowRef.current) {
        window.clearTimeout(leaderboardShowRef.current);
        leaderboardShowRef.current = null;
      }
      if (leaderboardHideRef.current) {
        window.clearTimeout(leaderboardHideRef.current);
        leaderboardHideRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const round = currentRoundState;
      const expiresAt = round?.expiresAt;
      if (!expiresAt || round?.status === 'revealed') {
        setRemainingMs(null);
        return;
      }
      const delta = expiresAt - Date.now();
      setRemainingMs(delta > 0 ? delta : 0);
    }, 100);
    return () => clearInterval(interval);
  }, [currentRoundState]);

  const currentStage = gameState?.currentStageConfig;
  const HostMinigame = useMemo(() => {
    if (!currentStage) return null;
    return MINIGAME_HOST_COMPONENTS[currentStage.minigameId] || null;
  }, [currentStage]);

  const topPlayers = useMemo(() => {
    if (!gameState?.scoreboard || !gameState?.players) return [];
    return Object.entries(gameState.scoreboard)
      .map(([id, entry]) => ({
        id,
        points: entry.points ?? 0,
        player: gameState.players.find(p => p.playerId === id),
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 4);
  }, [gameState?.scoreboard, gameState?.players]);

  const totalTimerMs = useMemo(() => {
    const round = currentRoundState;
    if (!round) return 30000;

    if (round.minigameId === "HEARDLE") {
      const heardleRound = round as HeardleRoundState;
      if (heardleRound.guessWindowMs) {
        return Math.max(1000, heardleRound.guessWindowMs);
      }
      if (heardleRound.expiresAt && heardleRound.snippetStartedAt) {
        return Math.max(1000, heardleRound.expiresAt - heardleRound.snippetStartedAt);
      }
    }

    if (!round.expiresAt || !round.startedAt) return 30000;
    return Math.max(1000, round.expiresAt - round.startedAt);
  }, [currentRoundState]);
  
  if (!gameState) {
    return (
      <div className="host-layout host-layout--viewport host-layout--center">
        <div className="game-shell-loading">Loading game…</div>
      </div>
    );
  }

  const handleAdvance = () => {
    if (!roomCode) return;
    socket.emit("startStageRecap", { roomCode });
  };

  const handleCompleteStageRecap = () => {
    if (!roomCode) return;
    socket.emit("completeStageRecap", { roomCode });
  };

  if (gameState.phase === "finalRecap" && gameState.finalRecap) {
    return (
      <FinalRecap
        recap={gameState.finalRecap}
        players={gameState.players}
        scoreboard={gameState.scoreboard}
        maxPlayersPerAward={FINAL_RECAP_MAX_PLAYERS_PER_AWARD}
      />
    );
  }

  if (gameState.phase === "stageRecap" && gameState.stageRecap) {
    return (
        <StageRecap
          recap={gameState.stageRecap}
          players={gameState.players}
          onComplete={handleCompleteStageRecap}
        />
      );
  }

  return (
    <div className="host-layout host-layout--viewport">
      {/* Scoreboard ticker header */}
      {gameState?.currentRoundState?.status !== "revealed" && <header className="host-header">
        <div>
          <span className="host-header-room-chip">{gameState.roomCode}</span>
        </div>
        <div className="host-header-scoreboard">
          {topPlayers.map(({ id, points, player }) => (
            <div key={id} className="host-header-player">
              {player && <PlayerAvatar player={player} size={48} />}
              <span className="host-header-player-name">{player?.displayName || player?.name || "?"}</span>
              <span className="host-header-player-points">{points}</span>
            </div>
          ))}
          {topPlayers.length === 0 && (
            <span style={{ color: 'var(--gs-muted)', fontSize: 13 }}>
              {typeof gameState.currentStageIndex === "number"
                ? `Stage ${gameState.currentStageIndex + 1} / ${gameState.stagePlan.length}`
                : "Waiting for first stage"}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {remainingMs !== null ? (
            <RadialTimer remainingMs={remainingMs} totalMs={totalTimerMs} size={52} strokeWidth={4} />
          ) : (
            <span style={{ color: 'var(--gs-muted)', fontSize: 13 }}>No timer</span>
          )}
        </div>
      </header>}

      {/* Minigame-specific view */}
      <main className="host-main">
        <div className="host-main-content">
          {HostMinigame ? (
            <HostMinigame
              gameState={gameState}
              roomCode={roomCode}
              onAdvance={handleAdvance}
              onRevealComplete={handleRevealComplete}
              remainingMs={remainingMs}
            />
          ) : (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              {currentStage
                ? `${currentStage.minigameId} is not ready yet.`
                : "Waiting for the host to start the first stage."}
            </div>
          )}
        </div>
      </main>

      <Leaderboard
        scoreboard={gameState.scoreboard}
        players={gameState.players}
        roundId={gameState.currentRoundState?.id}
        onClose={() => setShowLeaderboard(false)}
        isVisible={showLeaderboard && gameState.currentRoundState?.status === "revealed"}
        streaks={gameState.streaks}
      />
      <StreakToast
        players={gameState.players}
        streaks={gameState.streaks}
        roundId={streakToastRoundId}
      />
    </div>
  );
};

export default HostGame;
