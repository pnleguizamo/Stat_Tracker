import { FC, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, Player } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
};

export const WhoListenedMost: FC<Props> = ({ roomCode, gameState, onAdvance }) => {
  const round = gameState.currentRoundState;
  const players = gameState.players || [];
  const [actionBusy, setActionBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submissions = round ? Object.keys(round.answers || {}).length : 0;
  const voteTotals = round?.results?.tally || {};
  const listenCounts = round?.results?.listenCounts || {};
  const winners = round?.results?.winners || [];
  
  const sortedVoteBoard = useMemo(() => {
    return [...players].sort((a, b) => {
      const aVotes = a.socketId ? voteTotals[a.socketId] || 0 : 0;
      const bVotes = b.socketId ? voteTotals[b.socketId] || 0 : 0;
      return bVotes - aVotes;
    });
  }, [players, voteTotals]);

  const roundStatus = round?.status || "pending";
  const topListener = players.find((p: Player) => p.socketId && p.socketId === round?.results?.topListenerSocketId);

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

  if (!round) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>No prompt yet. Generate the first artist or track to get started!</p>
        <button onClick={handleNewPrompt} disabled={actionBusy === "prompt"}>
          {actionBusy === "prompt" ? "Generating..." : "Create Prompt"}
        </button>
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
          <h2 style={{ margin: "0.5rem 0", color: "#ffffffff", fontSize: 28 }}>{round.prompt.track_name}</h2>
          {round.prompt.artist && <div style={{ fontSize: 16, color: "#ffffffff" }}>{round.prompt.artist}</div>}
          {round.prompt.description && (
            <p style={{ marginTop: "1rem", maxWidth: 420, color: "#cdd5ee" }}>{round.prompt.description}</p>
          )}
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Status:{" "}
          {roundStatus === "revealed"
            ? "Results revealed"
            : roundStatus === "collecting"
            ? "Collecting votes"
            : "Waiting to start"}
        </div>
        <div style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
          Votes submitted: {submissions} / {players.length}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {sortedVoteBoard.map((player) => {
            const votes = player.socketId ? voteTotals[player.socketId] || 0 : 0;
            const isTop = player.socketId && player.socketId === round?.results?.topListenerSocketId;
            const isWinner = player.socketId && winners.includes(player.socketId);
            const actualListens = player.userId ? listenCounts[player.userId] || 0 : 0;
            
            return (
              <div
                key={player.socketId || player.name}
                style={{
                  border: `2px solid ${isTop ? "#48bb78" : isWinner ? "#4299e1" : "#2d3748"}`,
                  borderRadius: 8,
                  padding: "0.85rem",
                  background: isTop ? "#1d2738" : "#10131a",
                }}
              >
                <div style={{ fontWeight: 600, color: "#ffffffff" }}>
                  {player.displayName || player.name}
                  {isTop && <span style={{ marginLeft: 6, color: "#48bb78" }}>🏆</span>}
                  {isWinner && !isTop && <span style={{ marginLeft: 6, color: "#4299e1" }}>✓</span>}
                </div>
                <div style={{ fontSize: 13, color: "#9db2d0" }}>{votes} vote(s)</div>
                {roundStatus === "revealed" && (
                  <div style={{ fontSize: 12, color: "#68d391", marginTop: 4 }}>
                    {actualListens} actual listens
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {roundStatus === "revealed" && (
        <>
          {topListener && (
            <div style={{ padding: "1rem", borderRadius: 12, background: "#233044", color: "#ffffffff" }}>
              <strong>{topListener.displayName || topListener.name}</strong> is the top listener with {listenCounts[topListener.userId || ""] || 0} plays!
            </div>
          )}
          
          {winners.length > 0 && (
            <div style={{ padding: "1rem", borderRadius: 12, background: "#1a365d", color: "#ffffffff" }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Winners (guessed correctly):</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {winners.map((socketId :any) => {
                  const winner = players.find((p) => p.socketId === socketId);
                  return winner ? (
                    <span
                      key={socketId}
                      style={{
                        padding: "4px 12px",
                        background: "#2c5282",
                        borderRadius: 6,
                        fontSize: 14,
                      }}
                    >
                      {winner.displayName || winner.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </>
      )}

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
