import { FC, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
};

export const GuessWrappedPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "GUESS_SPOTIFY_WRAPPED"
      ? (gameState.currentRoundState as GuessWrappedRoundState)
      : null;
  const players = gameState.players || [];
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myVote = myPlayerId && round?.answers?.[myPlayerId]?.answer?.targetPlayerId
    ? round.answers[myPlayerId].answer!.targetPlayerId
    : null;

  const ownerPlayerId = round?.results?.ownerPlayerId;

  function handleVote(targetPlayerId: string) {
    if (!roomCode || !targetPlayerId) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:GUESS_SPOTIFY_WRAPPED:submitAnswer",
      { roomCode, answer: { targetPlayerId } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || "Failed to submit vote");
      }
    );
  }

  if (!round) {
    return <div>Waiting for a Spotify Wrapped summary…</div>;
  }
  
  const isRevealed = round.status === "revealed";

  return (
    <>
      <section style={{ marginBottom: 24, color : "#ffffffff" }}>
        <div style={{ marginBottom: 8 }}>
          {myVote
            ? `You guessed ${players.find((p) => p.playerId === myVote)?.displayName || "someone"}`
            : "Whose Spotify Wrapped is this?"}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {players.map((player) => {
            const playerId = player.playerId;
            if (!playerId) return null;
            const isSelected = playerId === myVote;
            const isOwner = isRevealed && playerId === ownerPlayerId;
            return (
              <button
                key={playerId}
                onClick={() => handleVote(playerId)}
                disabled={voteBusy || isRevealed}
                style={{
                  padding: "0.85rem",
                  borderRadius: 10,
                  border: isSelected ? "2px solid #38bdf8" : "1px solid #1f2933",
                  background: isOwner ? "#1a2b45" : isSelected ? "#0f172a" : "#0b0f17",
                  color: "#fff",
                }}
              >
                <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                {isOwner && <div style={{ fontSize: 12, color: "#34d399" }}>Actual owner</div>}
              </button>
            );
          })}
        </div>
        {voteError && <div style={{ marginTop: 8, color: "salmon" }}>{voteError}</div>}
        {!isRevealed && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#94a3b8" }}>
            Waiting for the host to reveal the owner{voteBusy ? "…" : "."}
          </div>
        )}
      </section>
    </>
  );
};
