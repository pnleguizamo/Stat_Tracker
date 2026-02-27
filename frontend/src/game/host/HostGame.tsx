// HostGameScreen.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { WhoListenedMost } from "./minigames/WhoListenedMost";
import { GuessWrappedHost } from "./minigames/GuessWrapped";
import { HeardleHost } from "./minigames/Heardle";
import { StageRecap } from "./StageRecap";
import { FinalRecap } from "./FinalRecap";
import { useParams } from "react-router-dom";
import { socket } from "socket";
import { GameState, MinigameId } from "types/game";
import { Leaderboard } from "./Leaderboard";
import { useHostSfx } from "game/hooks/useHostSfx";
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

const HostGame = () => {
  const params = useParams();
  const roomCode = params.roomCode || "";
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const lastRevealedRoundIdRef = useRef<string | null>(null);
  const activeRoundRef = useRef<GameState["currentRoundState"] | null>(null);
  const leaderboardShowRef = useRef<number | null>(null);
  const leaderboardHideRef = useRef<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const previousStageIndexRef = useRef<number | null>(null);
  const previousRoundIdRef = useRef<string | null>(null);
  const { playStageTransition, playRoundTransition } = useHostSfx();

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
    if (!gameState?.currentRoundState) return;
    const round = gameState.currentRoundState;
    if (round.status !== "revealed") return;
    if (round.id === lastRevealedRoundIdRef.current) return;

    const minigameId = gameState.currentStageConfig?.minigameId;
    if (minigameId === "WHO_LISTENED_MOST") return;
    if (minigameId === "GUESS_SPOTIFY_WRAPPED") return;

    lastRevealedRoundIdRef.current = round.id;
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
  }, [gameState]);

  useEffect(() => {
    activeRoundRef.current = gameState?.currentRoundState ?? null;
  }, [gameState?.currentRoundState]);

  useEffect(() => {
    const stageIndex = gameState?.currentStageIndex;
    const minigameId = gameState?.currentStageConfig?.minigameId;
    const roundId = gameState?.currentRoundState?.id ?? null;
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
      if (!stageChanged && minigameId !== "HEARDLE") {
        playRoundTransition();
      }
    }
  }, [
    gameState?.currentStageIndex,
    gameState?.currentStageConfig?.minigameId,
    gameState?.currentRoundState?.id,
    playStageTransition,
    playRoundTransition,
  ]);

  useEffect(() => {
    const round = gameState?.currentRoundState;
    if (!round || round.status === "revealed") return;

    if (leaderboardShowRef.current) {
      window.clearTimeout(leaderboardShowRef.current);
      leaderboardShowRef.current = null;
    }
    if (leaderboardHideRef.current) {
      window.clearTimeout(leaderboardHideRef.current);
      leaderboardHideRef.current = null;
    }
    setShowLeaderboard(false);
  }, [gameState?.currentRoundState?.id, gameState?.currentRoundState?.status]);

  const handleRevealComplete = (onSequenceComplete?: () => void) => {
    const revealRoundId = activeRoundRef.current?.id ?? null;
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
      const round = gameState?.currentRoundState;
      const expiresAt = round?.expiresAt;
      if (!expiresAt || round?.status === 'revealed') {
        setRemainingMs(null);
        return;
      }
      const delta = expiresAt - Date.now();
      setRemainingMs(delta > 0 ? delta : 0);
    }, 100);
    return () => clearInterval(interval);
  }, [gameState?.currentRoundState?.expiresAt, gameState?.currentRoundState?.status]);

  const currentStage = gameState?.currentStageConfig;
  const HostMinigame = useMemo(() => {
    if (!currentStage) return null;
    return MINIGAME_HOST_COMPONENTS[currentStage.minigameId] || null;
  }, [currentStage]);
  
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
      {/* Shared chrome */}
      {gameState?.currentRoundState?.status !== "revealed" && <header className="host-header">
        <div>Room {gameState.roomCode}</div>
        <div>
          {typeof gameState.currentStageIndex === "number"
            ? `Stage ${gameState.currentStageIndex + 1} / ${gameState.stagePlan.length}`
            : "Waiting for first stage"}
        </div>
        <div>
          <h2 style={{ fontSize: 28 }}>
            {remainingMs !== null
              ? `Time left: ${Math.max(0, Math.ceil(remainingMs / 1000))}s`
              : "No timer running"}

          </h2>
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
      />
    </div>
  );
};

export default HostGame;
