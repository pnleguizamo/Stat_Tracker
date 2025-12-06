// HostGameScreen.tsx
import { useEffect, useMemo, useState } from "react";
import { WhoListenedMost } from "./minigames/WhoListenedMost";
import { useParams } from "react-router-dom";
import { socket } from "socket";
import { GameState, MinigameId } from "types/game";
// import { GenreGuessHostView } from "./minigames/GenreGuessHostView";
// etc.

type HostMinigameProps = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
};

const MINIGAME_HOST_COMPONENTS: Partial<Record<MinigameId, React.ComponentType<HostMinigameProps>>> = {
  WHO_LISTENED_MOST: WhoListenedMost,
//   GENRE_GUESS: GenreGuessHostView,
//   FIRST_PLAY: FirstPlayHostView,
//   GRAPH_GUESS: GraphGuessHostView,
//   OUTLIER_MODE: OutlierModeHostView,
};

const HostGame = () => {
  const params = useParams();
  const roomCode = params.roomCode || "";
  const [gameState, setGameState] = useState<GameState | null>(null);

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

  const currentStage = gameState?.currentStageConfig;
  const HostMinigame = useMemo(() => {
    if (!currentStage) return null;
    return MINIGAME_HOST_COMPONENTS[currentStage.minigameId] || null;
  }, [currentStage]);
  
  if (!gameState) return <div>Loading game…</div>;

  const handleAdvance = () => {
    if (!roomCode) return;
    socket.emit("advanceStageOrRound", { roomCode });
  };

  return (
    <div className="host-layout">
      {/* Shared chrome */}
      <header className="host-header">
        <div>Room {gameState.roomCode}</div>
        <div>
          {typeof gameState.currentStageIndex === "number"
            ? `Stage ${gameState.currentStageIndex + 1} / ${gameState.stagePlan.length}`
            : "Waiting for first stage"}
        </div>
      </header>

      {/* Minigame-specific view */}
      <main className="host-main">
        {HostMinigame ? (
          <HostMinigame
            gameState={gameState}
            roomCode={roomCode}
            onAdvance={handleAdvance}
          />
        ) : (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            {currentStage
              ? `${currentStage.minigameId} is not ready yet.`
              : "Waiting for the host to start the first stage."}
          </div>
        )}
      </main>
    </div>
  );
};

export default HostGame;
