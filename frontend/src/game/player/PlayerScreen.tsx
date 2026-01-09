import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { GameState, MinigameId } from 'types/game';
import { WhoListenedMostPlayerView } from './minigames/WhoListenedMost';
import { GuessWrappedPlayerView } from './minigames/GuessWrapped';
import { HeardlePlayerView } from './minigames/Heardle';

type PlayerMinigameProps = {
  roomCode: string;
  gameState: GameState;
};

const PLAYER_MINIGAME_COMPONENTS: Partial<Record<MinigameId, React.ComponentType<PlayerMinigameProps>>> = {
  WHO_LISTENED_MOST: WhoListenedMostPlayerView,
  GUESS_SPOTIFY_WRAPPED: GuessWrappedPlayerView,
  HEARDLE: HeardlePlayerView,
};

const PlayerScreen = () => {
  const params = useParams();
  const roomCode = params.roomCode || '';
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);

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
      : gameState.phase === 'completed'
        ? 'Completed'
        : gameState.phase
    : 'Waiting';

  const currentStageIndex = typeof gameState?.currentStageIndex === 'number' ? gameState?.currentStageIndex : null;
  const currentStage = gameState?.currentStageConfig;
  const MinigameComponent =
    currentStage && gameState ? PLAYER_MINIGAME_COMPONENTS[currentStage.minigameId] || null : null;

  return (
    <div style={{ padding: 16 }}>
      <header style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4 }}>Room {roomCode}</h2>
        <div style={{ color: '#667085', fontSize: 14 }}>Phase: {phaseLabel}</div>
        {typeof currentStageIndex === 'number' && currentStage && (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Stage {currentStageIndex + 1}: {currentStage.minigameId}
          </div>
        )}
      </header>

      <main style={{ minHeight: 320 }}>
        {gameState && MinigameComponent ? (
          <MinigameComponent roomCode={roomCode} gameState={gameState} />
        ) : (
          <div>Waiting for the host to start the next minigame…</div>
        )}
      </main>

      <footer style={{ marginTop: 24 }}>
        <button onClick={handleLeave}>Leave Room</button>
      </footer>
    </div>
  );
};

export default PlayerScreen;
