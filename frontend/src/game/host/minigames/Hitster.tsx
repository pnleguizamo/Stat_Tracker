import { FC, useEffect, useState } from 'react';
import { socket } from 'socket';
import { GameState, HitsterRoundState } from 'types/game';
import { useTrackPreview } from 'game/hooks/useTrackPreview';
import {
  HostMinigameStack,
  HostCard,
  HostActionRow,
  HostChip,
  HostStateMessage,
} from './components/HostMinigamePrimitives';
import './styles/Hitster.css';

type HostMinigameProps = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
  remainingMs: number | null;
};

export const HitsterHost: FC<HostMinigameProps> = ({
  roomCode,
  gameState,
  onAdvance,
  onRevealComplete,
  remainingMs,
}) => {
  const round = gameState.currentRoundState?.minigameId === 'HITSTER'
    ? (gameState.currentRoundState as HitsterRoundState)
    : null;

  const isRevealed = round?.status === 'revealed';
  const players = gameState.players || [];
  const stageProgress = round?.stageProgress;
  const results = round?.results;
  const gameWinners = results?.winners || [];
  const stageComplete = !!stageProgress?.stageComplete;

  const [revealAnim, setRevealAnim] = useState(false);

  // Play preview on host
  const { error: previewError } = useTrackPreview({
    trackName: round?.song?.track_name || undefined,
    artistName: (round?.song?.artist_names || [])[0] || undefined,
    previewUrl: round?.song?.previewUrl || undefined,
    previewKey: round?.id || undefined,
    enabled: !!round?.song?.track_name,
    volume: isRevealed ? 0.15 : 0.45,
  });

  // Trigger reveal animation
  useEffect(() => {
    if (isRevealed && !revealAnim) {
      setRevealAnim(true);
      const timer = setTimeout(() => {
        onRevealComplete?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isRevealed]);

  // Reset on new round
  useEffect(() => {
    setRevealAnim(false);
  }, [round?.id]);

  const handleStartRound = () => {
    socket.emit('minigame:HITSTER:startRound', { roomCode }, (resp: any) => {
      if (!resp?.ok) console.error('Start round failed:', resp?.error);
    });
  };

  const handleForceReveal = () => {
    socket.emit('minigame:HITSTER:forceReveal', { roomCode }, (resp: any) => {
      if (!resp?.ok) console.error('Force reveal failed:', resp?.error);
    });
  };

  if (!round) {
    return (
      <HostMinigameStack>
        <HostCard padded>
          <div className="hitster-host-empty">
            <div className="hitster-eq-container">
              <div className="hitster-eq-bars">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="hitster-eq-bar" style={{ opacity: 0.3 }} />
                ))}
              </div>
            </div>
            <div className="hitster-mystery-label">Hitster</div>
          </div>
        </HostCard>
        <HostActionRow>
          <button className="game-shell-button" onClick={handleStartRound}>
            Start Hitster
          </button>
          <button className="game-shell-button" onClick={onAdvance}>
            Next Stage
          </button>
        </HostActionRow>
      </HostMinigameStack>
    );
  }

  const nonHostPlayers = players.filter(p => !p.isHost);
  const placedCount = Object.values(round.answers || {}).filter(a => a?.placement?.confirmedAt).length;

  return (
    <HostMinigameStack className="hitster-host-stack">
      {/* Mystery card */}
      <HostCard className={`hitster-mystery-card${isRevealed ? ' hitster-mystery-card--revealed' : ''}`}>
        <div className="hitster-mystery-header">
          <HostChip>Round {stageProgress?.roundNumber || '?'}</HostChip>
          {stageProgress?.raceNumber && stageProgress?.racesPerStage && (
            <HostChip>Race {stageProgress.raceNumber} / {stageProgress.racesPerStage}</HostChip>
          )}
          <HostChip>{isRevealed ? 'Revealed' : 'Listening'}</HostChip>
          {stageProgress && (
            <HostChip>Target: {stageProgress.targetCards}</HostChip>
          )}
        </div>

        {!isRevealed ? (
          <div className="hitster-mystery-body">
            <div className="hitster-eq-container">
              <div className="hitster-eq-bars">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="hitster-eq-bar" />
                ))}
              </div>
            </div>
            <div className="hitster-mystery-label">Mystery Song</div>
            {previewError && (
              <HostStateMessage error className="hitster-preview-error">
                {previewError}
              </HostStateMessage>
            )}
            {remainingMs !== null && (
              <div className="hitster-host-timer">{Math.ceil(remainingMs / 1000)}s</div>
            )}
          </div>
        ) : (
          <div className="hitster-reveal-body">
            {results?.song?.imageUrl && (
              <img src={results.song.imageUrl} alt="" className="hitster-host-reveal-art" />
            )}
            <div className="hitster-host-reveal-info">
              <div className="hitster-host-reveal-title">{results?.song?.track_name}</div>
              <div className="hitster-host-reveal-artist">{(results?.song?.artist_names || []).join(', ')}</div>
              <div className="hitster-host-reveal-year">{results?.year}</div>
            </div>
          </div>
        )}
      </HostCard>

      {/* Player progress */}
      <HostCard padded className="hitster-player-grid-card">
        <div className="hitster-player-grid">
          {nonHostPlayers.map((player) => {
            const playerId = player.playerId;
            const cardCount = stageProgress?.leaderboard?.[playerId] || 0;
            const target = stageProgress?.targetCards || 7;
            const answer = round.answers?.[playerId];
            const hasPlaced = !!answer?.placement?.confirmedAt;
            const placementResult = results?.placements?.[playerId];

            let status = 'waiting';
            if (isRevealed && placementResult) {
              status = placementResult.correct ? 'correct' : 'wrong';
            } else if (hasPlaced) {
              status = 'placed';
            }

            return (
              <div key={playerId} className={`hitster-player-row hitster-player-row--${status}`}>
                <div className="hitster-player-name">{player.displayName || player.name}</div>
                <div className="hitster-player-progress">
                  <div
                    className="hitster-player-progress-bar"
                    style={{ width: `${Math.min(100, (cardCount / target) * 100)}%` }}
                  />
                  <span className="hitster-player-progress-text">{cardCount}/{target}</span>
                </div>
                <div className={`hitster-player-status hitster-player-status--${status}`}>
                  {status === 'waiting' && '\u2026'}
                  {status === 'placed' && '\u2713'}
                  {status === 'correct' && '\u2713'}
                  {status === 'wrong' && '\u2717'}
                </div>
              </div>
            );
          })}
        </div>
        {!isRevealed && (
          <div className="hitster-placed-count">{placedCount}/{nonHostPlayers.length} placed</div>
        )}
      </HostCard>

      {/* Game winner banner */}
      {isRevealed && gameWinners.length > 0 && (
        <HostCard padded className="hitster-winner-card">
          <div className="hitster-winner-text">
            {gameWinners.map(id => {
              const p = players.find(pl => pl.playerId === id);
              return p?.displayName || p?.name || id;
            }).join(', ')} {stageComplete ? 'won the final race!' : 'won this race!'}
          </div>
        </HostCard>
      )}

      {/* Actions */}
      <HostActionRow>
        {!isRevealed && (
          <button className="game-shell-button" onClick={handleForceReveal}>
            Reveal
          </button>
        )}
        {isRevealed && gameWinners.length === 0 && (
          <button className="game-shell-button" onClick={handleStartRound}>
            Next Round
          </button>
        )}
        {isRevealed && gameWinners.length > 0 && !stageComplete && (
          <button className="game-shell-button" onClick={handleStartRound}>
            Next Race
          </button>
        )}
        <button className="game-shell-button" onClick={onAdvance}>
          Next Stage
        </button>
      </HostActionRow>
    </HostMinigameStack>
  );
};
