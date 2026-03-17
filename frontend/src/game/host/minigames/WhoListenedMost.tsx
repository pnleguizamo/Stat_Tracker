import { useTrackPreview } from "game/hooks/useTrackPreview";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useVoteTally } from "game/hooks/useVoteTally";
import { useAutoFitScale } from "game/hooks/useAutoFitScale";
import { CSSProperties, FC, useEffect, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, WhoListenedMostRoundState } from "types/game";
import {
  HostActionRow,
  HostCard,
  HostChip,
  HostMinigameStack,
  HostStateMessage,
} from "./components/HostMinigamePrimitives";
import { PlayerVotes } from "./components/PlayerVotes";
import './styles/WhoListenedMost.css'

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
  remainingMs: number | null;
};

const WaveformIcon: FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden
  >
    <rect x="2" y="10" width="3" height="4" rx="1" fill="currentColor" opacity="0.7" />
    <rect x="6.5" y="6" width="3" height="12" rx="1" fill="currentColor" />
    <rect x="11" y="8" width="3" height="8" rx="1" fill="currentColor" opacity="0.85" />
    <rect x="15.5" y="4" width="3" height="16" rx="1" fill="currentColor" />
    <rect x="20" y="9" width="3" height="6" rx="1" fill="currentColor" opacity="0.7" />
  </svg>
);

export const WhoListenedMost: FC<Props> = ({ roomCode, gameState, onAdvance, onRevealComplete, remainingMs }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "WHO_LISTENED_MOST"
      ? (gameState.currentRoundState as WhoListenedMostRoundState)
      : null;
  const players = gameState.players || [];
  const [actionBusy, setActionBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextPromptTimeoutRef = useRef<number | null>(null);
  const busyRef = useRef<"prompt" | "reveal" | null>(null);
  const roundIdRef = useRef<string | null>(null);

  const submissions = round ? Object.keys(round.answers || {}).length : 0;
  const voteTotals = round?.results?.tally || {};
  const listenCounts = (round?.results?.listenCounts as Record<string, number> | undefined) || {};

  const { voteEntries, finalTally, totalVotes } = useVoteTally({
    players,
    answers: round?.answers,
    totals: voteTotals,
  });

  const roundStatus = round?.status || "pending";

  useEffect(() => {
    busyRef.current = actionBusy;
  }, [actionBusy]);

  useEffect(() => {
    roundIdRef.current = round?.id ?? null;
  }, [round?.id]);

  const { revealComplete, revealedVoteMap, revealedTally } = useVoteReveal({
    status: roundStatus,
    voteEntries,
    totalVotes,
  });
  const promptTypeLabel =
    roundStatus === "revealed"
      ? "Results"
      : round?.prompt?.type === "TRACK"
        ? "Track"
        : round?.prompt?.type === "ARTIST"
          ? "Artist"
          : "Prompt";
  const roundStatusLabel =
    roundStatus === "revealed"
      ? "Revealed"
      : roundStatus === "collecting"
        ? "Collecting"
        : "Pending";

  const isArtistPrompt = round?.prompt?.type === "ARTIST";
  const promptTrackName = !isArtistPrompt ? round?.prompt?.track_name ?? undefined : undefined;
  const promptArtistName = isArtistPrompt
    ? round?.prompt?.artist_name || round?.prompt?.artist_names?.[0]
    : round?.prompt?.artist_names?.[0];

  useTrackPreview({
    trackName: promptTrackName,
    artistName: promptArtistName ?? undefined,
    previewKey: (round?.prompt?.id || promptTrackName || promptArtistName) ?? undefined,
    volume: round?.status === "revealed" ? 0.1 : 0.3,
    kind: isArtistPrompt ? "artist" : "track",
  });

  useEffect(() => {
    if (!revealComplete) return;
    const revealRoundId = roundIdRef.current;
    onRevealComplete(() => {
      if (!roomCode) return;
      if (!revealRoundId || roundIdRef.current !== revealRoundId) return;
      if (busyRef.current === "prompt") return;
      
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
      nextPromptTimeoutRef.current = window.setTimeout(() => {
        if (!revealRoundId || roundIdRef.current !== revealRoundId) return;
        if (busyRef.current === "prompt") return;
        handleNewPrompt();
      }, 2500);
    });

    return () => {
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
    };
  }, [revealComplete]);

  useEffect(() => {
    return () => {
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
    };
  }, []);

  const handleNewPrompt = () => {
    if (!roomCode) return;
    if (nextPromptTimeoutRef.current) {
      window.clearTimeout(nextPromptTimeoutRef.current);
      nextPromptTimeoutRef.current = null;
    }
    setActionBusy("prompt");
    setError(null);
    socket.emit("minigame:WHO_LISTENED_MOST:startRound", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) setError(resp?.error || "Failed to start a new prompt");
    });
  };

  const handleReveal = () => {
    if (!roomCode) return;
    setActionBusy("reveal");
    setError(null);
    socket.emit("minigame:WHO_LISTENED_MOST:reveal", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) setError(resp?.error || "Failed to reveal votes");
    });
  };

  useEffect(() => {
    if (!roomCode) return;
    if (round) return;
    if (actionBusy === "prompt") return;
    if (error) return;
    handleNewPrompt();
  }, [round, roomCode, actionBusy, error]);

  const { viewportRef: fitViewportRef, canvasRef: fitCanvasRef } =
    useAutoFitScale({ allowUpscale: false });
    
const liveRemainingMs =
  remainingMs ?? (round?.expiresAt ? Math.max(0, round.expiresAt - Date.now()) : null);

const timerCritical =
  roundStatus === "collecting" &&
  liveRemainingMs !== null &&
  liveRemainingMs > 0 &&
  liveRemainingMs < 5000;

  if (!round) {
    return (
      <HostStateMessage>
        <p>Loading the first prompt</p>
        {error && <p className="host-minigame-error">{error}</p>}
      </HostStateMessage>
    );
  }

  return (
    <div ref={fitViewportRef} className="wlm-fit-viewport">
      <div className="wlm-fit-center">
        <div ref={fitCanvasRef} className="wlm-fit-canvas">
          <HostMinigameStack>
            <HostCard padded className="wlm-prompt-card">
              {round.prompt.imageUrl ? (
                <div className={`wlm-prompt-art-wrap${roundStatus === 'collecting' ? ' wlm-prompt-art-wrap--playing' : ''}`}>
                  <img
                    src={round.prompt.imageUrl}
                    alt={round.prompt.track_name}
                    className="wlm-prompt-art"
                  />
                </div>
              ) : null}
              <div className="wlm-prompt-content">
                <div className="host-minigame-chip-row">
                  <HostChip>
                    <WaveformIcon size={12} /> {promptTypeLabel}
                  </HostChip>
                  <HostChip
                    className={
                      roundStatus === "revealed"
                        ? "wlm-status-chip--revealed"
                        : timerCritical
                          ? "wlm-status-chip--urgent"
                          : "wlm-status-chip--collecting"
                    }
                  >
                    {roundStatusLabel}
                    {roundStatus === "collecting" && (
                      <span className={`wlm-eq-bars${timerCritical ? ' wlm-eq-bars--urgent' : ''}`}>
                        {[0.6, 1, 0.7, 0.9, 0.5].map((h, i) => (
                          <span
                            key={i}
                            className="wlm-eq-bar"
                            style={{
                              '--wlm-eq-max-h': `${Math.round(h * 14)}px`,
                              '--wlm-eq-speed': `${(timerCritical ? 0.28 : 0.5) + i * (timerCritical ? 0.08 : 0.15)}s`,
                              animationDelay: `${i * 0.1}s`,
                            } as CSSProperties}
                          />
                        ))}
                      </span>
                    )}
                  </HostChip>
                </div>
                <h2 className="wlm-prompt-title">{round.prompt.type === "TRACK" ? round.prompt.track_name : round.prompt.artist_name}</h2>
                {round.prompt.artist_names && <div className="wlm-prompt-artists">{round.prompt.artist_names.join(', ')}</div>}
                {round.prompt.description && (
                  <p className="wlm-prompt-description">{round.prompt.description}</p>
                )}
              </div>
            </HostCard>

            <div className="wlm-votes-wrap">
              <PlayerVotes
                status={roundStatus}
                players={players}
                finalTally={finalTally}
                revealedTally={revealedTally}
                revealedVoteMap={revealedVoteMap}
                revealComplete={revealComplete}
                topSocketIds={round?.results?.topListenerSocketIds ?? undefined}
                listenCounts={listenCounts}
                showListenCounts
                submittedSocketIds={Object.keys(round.answers || {})}
                showSubmissionChecks
              />
            </div>

            {roundStatus !== "revealed" && <HostActionRow className="wlm-action-row">
              <button
                className="game-shell-button game-shell-button--dramatic"
                onClick={handleReveal}
                disabled={actionBusy === "reveal" || submissions === 0 }
              >
                {actionBusy === "reveal" ? "Revealing…" : "Reveal Votes"}
              </button>
              <button
                className="game-shell-button"
                onClick={handleNewPrompt}
                disabled={actionBusy === "prompt"}
              >
                {actionBusy === "prompt" ? "Loading…" : "New Prompt"}
              </button>
              <button className="game-shell-button game-shell-button--forward" onClick={onAdvance}>Next Stage</button>
            </HostActionRow>}

            {error && <div className="host-minigame-error">{error}</div>}
          </HostMinigameStack>
        </div>
      </div>
    </div>
  );
};
