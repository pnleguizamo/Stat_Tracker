import { FC, useState } from "react";
import { PlayerAvatar } from "components/PlayerAvatar";
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
  const myVote =
    myPlayerId && round?.answers?.[myPlayerId]?.answer?.targetPlayerId
      ? round.answers[myPlayerId].answer!.targetPlayerId
      : null;

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
    <div
      style={{
        "--card": "rgba(15, 21, 39, 0.92)",
        "--card-border": "rgba(148, 163, 184, 0.18)",
        "--accent": "#26c6da",
        "--accent-soft": "rgba(38, 198, 218, 0.18)",
        "--text": "#e2e8f0",
        "--muted": "#94a3b8",
        fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
        color: "var(--text)",
      } as React.CSSProperties}
    >
      <section
        style={{
          padding: "0.85rem",
          borderRadius: 16,
          background: "var(--card)",
          border: "1px solid var(--card-border)",
        }}
      >
        <div style={{ marginBottom: 12, fontSize: 15 }}>
          {myVote
            ? `You guessed ${players.find((p) => p.playerId === myVote)?.displayName || "someone"}`
            : "Whose Spotify Wrapped is this?"}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {players.map((player) => {
            const playerId = player.playerId;
            if (!playerId) return null;
            const isSelf = playerId === myPlayerId;
            const isSelected = playerId === myVote;
            return (
              <button
                key={playerId}
                onClick={() => handleVote(playerId)}
                disabled={voteBusy || isRevealed}
                style={{
                  padding: "0.65rem 0.85rem",
                  borderRadius: 12,
                  border: isSelected
                    ? "2px solid var(--accent)"
                    : "1px solid var(--card-border)",
                  background: isSelected
                    ? "rgba(38, 198, 218, 0.2)"
                    : "rgba(10, 14, 26, 0.9)",
                  color: "var(--text)",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  transition: "transform 0.2s ease, border 0.2s ease",
                }}
              >
                <PlayerAvatar player={player} size={38} variant="simple" />
                <div>
                  <div style={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {player.displayName || player.name}
                  </div>
                  {isSelf && <div style={{ fontSize: 12, color: "var(--muted)" }}>You</div>}
                </div>
              </button>
            );
          })}
        </div>
        {voteError && <div style={{ marginTop: 10, color: "salmon" }}>{voteError}</div>}
        {!isRevealed && !!myVote && (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
            Waiting for the host to reveal the owner{voteBusy ? "…" : "."}
          </div>
        )}
        {isRevealed && (
          <div
            style={{
              textAlign: "center",
              alignSelf: "flex-start",
              padding: "4px 10px",
              marginTop: 10,
              borderRadius: 999,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            Results on host screen
          </div>
        )}
      </section>
    </div>
  );
};
