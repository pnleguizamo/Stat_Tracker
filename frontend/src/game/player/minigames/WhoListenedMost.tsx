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

  const mySocketId = socket.id;
  const myPlayer = players.find((p) => p.socketId === mySocketId);
  const myVote = mySocketId && round?.answers?.[mySocketId]?.answer?.targetSocketId
    ? round.answers[mySocketId].answer!.targetSocketId
    : null;
  const isPrivilegedUser = myPlayer?.userId === "pnleguizamo";

  const voteTotals = round?.results?.tally || {};
  const sortedResults = useMemo(() => {
    return [...players].sort((a, b) => {
      const aVotes = a.socketId ? voteTotals[a.socketId] || 0 : 0;
      const bVotes = b.socketId ? voteTotals[b.socketId] || 0 : 0;
      return bVotes - aVotes;
    });
  }, [players, voteTotals]);

  const results = round?.results;
  const isResultsShown = round?.status === "revealed";
  // const topPlayer = players.find((p: Player) => p.socketId && p.socketId === results?.topListenerSocketId);

  function handleVote(targetSocketId: string) {
    if (!roomCode || !targetSocketId) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:WHO_LISTENED_MOST:submitAnswer",
      { roomCode, answer: { targetSocketId } },
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

  const prompt = round.prompt;

  return (
    <>
      {/* <section
        style={{
          display: "flex",
          gap: 16,
          padding: 16,
          borderRadius: 12,
          background: "#10141c",
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>
            Guess who listened most
          </div>
          <h3 style={{ margin: "6px 0" }}>{prompt.track_name}</h3>
          {prompt.artist && <div style={{ color: "#b8c2dc" }}>{prompt.artist}</div>}
          {prompt.description && <p style={{ marginTop: 8, color: "#cbd5f5" }}>{prompt.description}</p>}
        </div>
      </section> */}

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
                  background: isSelected ? "#0f172a" : "#0b0f17",
                  color: "#fff",
                }}
              >
                <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
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
      </section>

      {isResultsShown && (
        <section style={{ marginBottom: 24 }}>
          <h4>Results Revealed!</h4>
          {/* <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          > */}
            {/* {sortedResults.map((player) => {
              const socketId = player.socketId;
              if (!socketId) return null;
              const votes = voteTotals[socketId] || 0;
              const isLeader = socketId === results?.topListenerSocketId;
              const actualListens = player.userId ? results?.listenCounts?.[player.userId] || 0 : 0;
              return (
                <div
                  key={socketId}
                  style={{
                    padding: "0.85rem",
                    borderRadius: 10,
                    border: "1px solid #1f2933",
                    background: isLeader ? "#132033" : "#0b1019",
                  }}
                  >
                    <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>{votes} vote(s)</div>
                    {isResultsShown && (
                      <div style={{ fontSize: 12, color: "#7dd3fc" }}>{actualListens} listens</div>
                    )}
                  </div>
                );
              })} */}
            {/* </div> */}
          {/* {topPlayer && (
            <div style={{ marginTop: 12, fontWeight: 600 }}>
              {topPlayer.displayName || topPlayer.name} actually listened the most!
            </div>
          )} */}
        </section>
      )}

      {isPrivilegedUser && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {/* <button onClick={handleReveal} disabled={actionBusy === "reveal" || submissions === 0 || roundStatus === "revealed"}>
            {actionBusy === "reveal" ? "Revealing…" : "Reveal Votes"}
          </button> */}
          <button onClick={handleNewPrompt}>
            {/* {actionBusy === "prompt" ? "Loading…" : "New Prompt"} */}
            New Prompt
          </button>
          {/* <button onClick={onAdvance}>Next Stage</button> */}
        </div>
      )}
    </>
  );
};
