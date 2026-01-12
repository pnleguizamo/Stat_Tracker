import { FC, useEffect, useMemo, useRef, useState } from "react";
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
  const [lastVoteLatencyMs, setLastVoteLatencyMs] = useState<number | null>(null);
  const [lastVoteBreakdown, setLastVoteBreakdown] = useState<{
    clientToServerMs?: number;
    serverProcessingMs?: number;
    serverToClientMs?: number;
    eventLoopDelayMs?: number | null;
  } | null>(null);
  const pendingVoteRef = useRef<{ targetSocketId: string; sentAt: number } | null>(null);

  const mySocketId = socket.id;
  const myPlayer = players.find((p) => p.socketId === mySocketId);
  const myVote = mySocketId && round?.answers?.[mySocketId]?.answer?.targetSocketId
    ? round.answers[mySocketId].answer!.targetSocketId
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

  function handleVote(targetSocketId: string) {
    if (!roomCode || !targetSocketId) return;
    setVoteBusy(true);
    setVoteError(null);
    setLastVoteLatencyMs(null);
    setLastVoteBreakdown(null);
    pendingVoteRef.current = { targetSocketId, sentAt: Date.now() };
    const clientSentAt = pendingVoteRef.current.sentAt;
    socket.emit(
      "minigame:WHO_LISTENED_MOST:submitAnswer",
      { roomCode, answer: { targetSocketId }, meta: { clientSentAt } },
      (resp?: {
        ok: boolean;
        error?: string;
        timing?: {
          clientSentAt?: number;
          serverReceivedAt?: number;
          serverEmitAt?: number;
          eventLoopDelayMs?: number | null;
        };
      }) => {
        const clientReceiveAt = Date.now();
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || "Failed to submit vote");
        if (resp?.timing?.serverReceivedAt && resp?.timing?.serverEmitAt) {
          const sentAt = resp.timing.clientSentAt ?? clientSentAt;
          const clientToServerMs =
            sentAt ? Math.max(0, resp.timing.serverReceivedAt - sentAt) : undefined;
          const serverProcessingMs = Math.max(0, resp.timing.serverEmitAt - resp.timing.serverReceivedAt);
          const serverToClientMs = Math.max(0, clientReceiveAt - resp.timing.serverEmitAt);
          setLastVoteBreakdown({
            clientToServerMs,
            serverProcessingMs,
            serverToClientMs,
            eventLoopDelayMs: resp.timing.eventLoopDelayMs ?? null,
          });
        }
      }
    );
  }

  useEffect(() => {
    if (!mySocketId) return;
    if (!pendingVoteRef.current) return;
    if (!myVote) return;
    if (myVote !== pendingVoteRef.current.targetSocketId) return;
    const latency = Date.now() - pendingVoteRef.current.sentAt;
    setLastVoteLatencyMs(latency);
    console.log(latency);
    pendingVoteRef.current = null;
  }, [myVote, mySocketId]);

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
    <>

      {isResultsShown && (
        <section style={{ marginBottom: 24 }}>
          <h4>Results Revealed!</h4>
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 8 }}>
          {myVote
            ? `You voted for ${players.find((p) => p.socketId === myVote)?.displayName || "someone"}`
            : "Pick who you think listened the most"}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {players.map((player) => {
            const socketId = player.socketId;
            if (!socketId) return null;
            const isSelf = socketId === mySocketId;
            const isSelected = socketId === myVote;
            return (
              <button
                key={socketId}
                onClick={() => handleVote(socketId)}
                disabled={voteBusy || isResultsShown}
                style={{
                  padding: "0.85rem",
                  borderRadius: 10,
                  border: isSelected ? "2px solid #38bdf8" : "1px solid #1f2933",
                  background: isSelected ? "#4c6ef5" : "#0b0f17",
                  color: "#fff",
                }}
              >
                <div style={{ fontWeight: 600 }}>{renderAvatar(player, 30)}{" "}{player.displayName || player.name}</div>
                {isSelf ? <div style={{ fontSize: 12 }}>You</div> : null}
              </button>
            );
          })}
        </div>
        {voteError && <div style={{ marginTop: 8, color: "salmon" }}>{voteError}</div>}
        {!isResultsShown && !!myVote && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#94a3b8" }}>
            Waiting for the results reveal{voteBusy ? "…" : "."}
          </div>
        )}
        {lastVoteLatencyMs !== null && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#9fb2d6" }}>
            Vote received in {lastVoteLatencyMs}ms
          </div>
        )}
        {lastVoteBreakdown && (
          <div style={{ marginTop: 4, fontSize: 11, color: "#7b8db1" }}>
            c→s {lastVoteBreakdown.clientToServerMs ?? "?"}ms · server{" "}
            {lastVoteBreakdown.serverProcessingMs ?? "?"}ms · s→c{" "}
            {lastVoteBreakdown.serverToClientMs ?? "?"}ms · loop{" "}
            {lastVoteBreakdown.eventLoopDelayMs ?? "?"}ms
          </div>
        )}
      </section>

      {isPrivilegedUser && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={handleNewPrompt}>
            New Prompt
          </button>
        </div>
      )}
    </>
  );
};
