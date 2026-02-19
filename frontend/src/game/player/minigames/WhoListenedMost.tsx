import { FC, useEffect, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, Player, WhoListenedMostRoundState } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
};

export const WhoListenedMostPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "WHO_LISTENED_MOST"
      ? (gameState.currentRoundState as WhoListenedMostRoundState)
      : null;
  const players = gameState.players || [];
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myPlayer = players.find((p) => p.playerId === myPlayerId);
  const myVote = myPlayerId && round?.answers?.[myPlayerId]?.answer?.targetPlayerId
    ? round.answers[myPlayerId].answer!.targetPlayerId
    : null;
  const isPrivilegedUser = myPlayer?.userId === "pnleguizamo";
  const isResultsShown = round?.status === "revealed";

   const getInitials = (name?: string | null) => {
    return (name || "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  const renderAvatar = (player: Player, size = 32) => {
    const label = player.displayName || player.name || "";
    if (player.avatar) {
      return (
        <img
          src={player.avatar}
          alt={label}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
        />
      );
    }
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "#2b6cb0",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: Math.max(10, size * 0.35),
        }}
      >
        {getInitials(label)}
      </div>
    );
  };

  function handleVote(targetPlayerId: string) {
    if (!roomCode || !targetPlayerId) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:WHO_LISTENED_MOST:submitAnswer",
      { roomCode, answer: { targetPlayerId } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || "Failed to submit vote");
      }
    );
  }

  const handleNewPrompt = () => {
    if (!roomCode) return;
    // setActionBusy("prompt");
    // setError(null);
    socket.emit("minigame:WHO_LISTENED_MOST:startRound", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      // setActionBusy(null);
      if (!resp?.ok) console.log(resp);
    });
  };

  if (!round) {
    return <div>Waiting for the host to start this minigame…</div>;
  }
  return (
    <div
      style={{
        "--bg": "#0b0f1f",
        "--card": "rgba(15, 21, 39, 0.92)",
        "--card-border": "rgba(148, 163, 184, 0.18)",
        "--accent": "#26c6da",
        "--accent-soft": "rgba(38, 198, 218, 0.18)",
        "--text": "#e2e8f0",
        "--muted": "#94a3b8",
        fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
        color: "var(--text)",
        minHeight: "100vh",
        padding: "1.25rem 1rem 2rem",
        background:
          "radial-gradient(120% 120% at 0% 0%, rgba(38,198,218,0.25), transparent 55%), linear-gradient(180deg, #0b0f1f 0%, #0a1026 100%)",
      } as React.CSSProperties}
    >

      <section
        style={{
          marginTop: 16,
          padding: "1rem",
          borderRadius: 16,
          background: "var(--card)",
          border: "1px solid var(--card-border)",
        }}
      >
        
        <div style={{ marginBottom: 12, fontSize: 15 }}>
          {myVote
            ? `You voted for ${players.find((p) => p.playerId === myVote)?.displayName || "someone"}`
            : "Vote for who listened most"}
        </div>
        <div
          style={{
            display: "grid",
            gap: 12,
          }}
        >
          {players.map((player) => {
            const playerId = player.playerId;
            if (!playerId) return null;
            const isSelf = playerId === myPlayerId;
            const isSelected = playerId === myVote;
            return (
              <button
                key={playerId}
                onClick={() => handleVote(playerId)}
                disabled={voteBusy || isResultsShown}
                style={{
                  padding: "0.95rem",
                  borderRadius: 14,
                  border: isSelected ? "2px solid var(--accent)" : "1px solid var(--card-border)",
                  background: isSelected ? "rgba(38, 198, 218, 0.2)" : "rgba(10, 14, 26, 0.9)",
                  color: "var(--text)",
                  minHeight: 76,
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  transition: "transform 0.2s ease, border 0.2s ease",
                }}
              >
                {renderAvatar(player, 38)}
                <div>
                  <div style={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {player.displayName || player.name}
                  </div>
                  {isSelf ? <div style={{ fontSize: 12, color: "var(--muted)" }}>You</div> : null}
                </div>
              </button>
            );
          })}
        </div>
        {voteError && <div style={{ marginTop: 10, color: "salmon" }}>{voteError}</div>}
        {!isResultsShown && !!myVote && (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
            Waiting for the results reveal{voteBusy ? "…" : "."}
          </div>
        )}
        {isResultsShown && (
          <div
            style={{
              textAlign : "center",
              alignSelf: "flex-start",
              padding: "4px 10px",
              marginBottom: 10,
              marginTop: 10,
              borderRadius: 999,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            Results revealed
          </div>
        )}
      </section>

      {isPrivilegedUser && (
        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={handleNewPrompt}
            style={{
              padding: "0.75rem 1.25rem",
              borderRadius: 999,
              border: "1px solid var(--card-border)",
              background: "rgba(38, 198, 218, 0.2)",
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            New Prompt
          </button>
        </div>
      )}
    </div>
  );
};
