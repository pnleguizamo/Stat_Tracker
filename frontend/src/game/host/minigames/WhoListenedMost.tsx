import { useTrackPreview } from "game/hooks/useTrackPreview";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useVoteTally } from "game/hooks/useVoteTally";
import { FC, useEffect, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, WhoListenedMostRoundState } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";

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
      }, 3500);
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
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>Loading the first prompt</p>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          padding: "1.5rem",
          borderRadius: 16,
          border: "1px solid rgba(148, 163, 184, 0.25)",
          background: "linear-gradient(145deg, rgba(15, 23, 42, 0.86), rgba(8, 13, 27, 0.86))",
          boxShadow: "0 20px 36px rgba(2, 6, 23, 0.32), inset 0 1px 0 rgba(248, 250, 252, 0.04)",
        }}
      >
        {round.prompt.imageUrl ? (
          <img
            src={round.prompt.imageUrl}
            alt={round.prompt.track_name}
            style={{ width: 140, height: 140, borderRadius: 12, objectFit: "cover" }}
          />
        ) : null}
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(96, 165, 250, 0.45)",
                background: "rgba(30, 64, 175, 0.25)",
                color: "#bfdbfe",
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {promptTypeLabel}
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: roundStatus === "revealed" ? "1px solid rgba(74, 222, 128, 0.45)" : "1px solid rgba(45, 212, 191, 0.45)",
                background: roundStatus === "revealed" ? "rgba(22, 101, 52, 0.3)" : "rgba(15, 118, 110, 0.24)",
                color: roundStatus === "revealed" ? "#bbf7d0" : "#99f6e4",
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {roundStatusLabel}
            </span>
          </div>
          <h2 style={{ margin: "0.5rem 0", color: "#ffffffff", fontSize: 28 }}>{round.prompt.type === "TRACK" ? round.prompt.track_name : round.prompt.artist_name}</h2>
          {round.prompt.artist_names && <div style={{ fontSize: 16, color: "#ffffffff" }}>{round.prompt.artist_names.join(', ')}</div>}
          {round.prompt.description && (
            <p style={{ marginTop: "1rem", maxWidth: 420, color: "#cdd5ee" }}>{round.prompt.description}</p>
          )}
        </div>
      </div>

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

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={handleReveal} disabled={actionBusy === "reveal" || submissions === 0 || roundStatus === "revealed"}>
          {actionBusy === "reveal" ? "Revealing…" : "Reveal Votes"}
        </button>
        <button onClick={handleNewPrompt} disabled={actionBusy === "prompt"}>
          {actionBusy === "prompt" ? "Loading…" : "New Prompt"}
        </button>
        <button onClick={onAdvance}>Next Stage</button>
      </div>

      {error && (
        <div style={{ color: "salmon" }}>
          {error}
        </div>
      )}
    </div>
  );
};
