import { useTrackPreview } from "game/hooks/useTrackPreview";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useVoteTally } from "game/hooks/useVoteTally";
import { FC, useEffect, useRef, useState } from "react";
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
};

export const WhoListenedMost: FC<Props> = ({ roomCode, gameState, onAdvance, onRevealComplete }) => {
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
    enabled: round?.status !== "revealed",
    volume: 0.3,
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

  if (!round) {
    return (
      <HostStateMessage>
        <p>Loading the first prompt</p>
        {error && <p className="host-minigame-error">{error}</p>}
      </HostStateMessage>
    );
  }

  return (
    <HostMinigameStack>
      <HostCard
        padded
        className="wlm-prompt-card"
      >
        {round.prompt.imageUrl ? (
          <img
            src={round.prompt.imageUrl}
            alt={round.prompt.track_name}
            className="wlm-prompt-art"
          />
        ) : null}
        <div className="wlm-prompt-content">
          <div className="host-minigame-chip-row">
            <HostChip>
              {promptTypeLabel}
            </HostChip>
            <HostChip className={roundStatus === "revealed" ? "wlm-status-chip--revealed" : "wlm-status-chip--collecting"}>
              {roundStatusLabel}
            </HostChip>
          </div>
          <h2 className="wlm-prompt-title">{round.prompt.type === "TRACK" ? round.prompt.track_name : round.prompt.artist_name}</h2>
          {round.prompt.artist_names && <div className="wlm-prompt-artists">{round.prompt.artist_names.join(', ')}</div>}
          {round.prompt.description && (
            <p className="wlm-prompt-description">{round.prompt.description}</p>
          )}
        </div>
      </HostCard>

      <div>
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

      <HostActionRow>
        <button
          className="game-shell-button"
          onClick={handleReveal}
          disabled={actionBusy === "reveal" || submissions === 0 || roundStatus === "revealed"}
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
        <button className="game-shell-button" onClick={onAdvance}>Next Stage</button>
      </HostActionRow>

      {error && <div className="host-minigame-error">{error}</div>}
    </HostMinigameStack>
  );
};
