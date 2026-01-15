import { useTrackPreview } from "game/hooks/useTrackPreview";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useVoteTally } from "game/hooks/useVoteTally";
import { FC, useEffect, useState } from "react";
import { socket } from "socket";
import { GameState, WhoListenedMostRoundState } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete?: () => void;
};

export const WhoListenedMost: FC<Props> = ({ roomCode, gameState, onAdvance, onRevealComplete }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "WHO_LISTENED_MOST"
      ? (gameState.currentRoundState as WhoListenedMostRoundState)
      : null;
  const players = gameState.players || [];
  const [actionBusy, setActionBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submissions = round ? Object.keys(round.answers || {}).length : 0;
  const voteTotals = round?.results?.tally || {};
  const listenCounts = (round?.results?.listenCounts as Record<string, number> | undefined) || {};

  const { voteEntries, finalTally, totalVotes } = useVoteTally({
    players,
    answers: round?.answers,
    totals: voteTotals,
  });

  const roundStatus = round?.status || "pending";

  const { revealComplete, revealedVoteMap, revealedTally } = useVoteReveal({
    status: roundStatus,
    voteEntries,
    totalVotes,
  });

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
    volume: 0.1,
    kind: isArtistPrompt ? "artist" : "track",
  });

  useEffect(() => {
    if (!revealComplete) return;
    onRevealComplete?.();
  }, [revealComplete]);

  const handleNewPrompt = () => {
    if (!roomCode) return;
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
          background: "#14181f",
          borderRadius: 12,
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
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#8f9bb3", letterSpacing: 1 }}>
            {round.prompt.type === "TRACK" ? "Track" : round.prompt.type === "ARTIST" ? "Artist" : "Info"}
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
