import { FC, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, Player, WhoListenedMostRoundState } from "types/game";

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

  const voteEntries = useMemo(() => {
    if (!round?.answers) return [];
    return Object.entries(round.answers)
      .map(([voterSocketId, submission]) => ({
        voterSocketId,
        targetSocketId: submission?.answer?.targetSocketId,
        at: submission?.at || 0,
      }))
      .filter((entry) => entry.targetSocketId)
      .sort((a, b) => a.at - b.at);
  }, [round?.answers]);

  const finalTally = useMemo(() => {
    if (Object.keys(voteTotals || {}).length) return voteTotals;
    const tally: Record<string, number> = {};
    voteEntries.forEach((entry) => {
      if (!entry.targetSocketId) return;
      tally[entry.targetSocketId] = (tally[entry.targetSocketId] || 0) + 1;
    });
    return tally;
  }, [voteEntries, voteTotals]);

  const [revealProgress, setRevealProgress] = useState(0);
  const [revealComplete, setRevealComplete] = useState(false);
  const revealIntervalRef = useRef<number | null>(null);
  const revealDelayRef = useRef<number | null>(null);
  const revealCompleteDelayRef = useRef<number | null>(null);

  const roundStatus = round?.status || "pending";

  const totalVotes = voteEntries.length;
  const maxVotes = Math.max(1, ...Object.values(finalTally));

  const revealedVoteMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    const activeVotes = voteEntries.slice(0, revealProgress);
    activeVotes.forEach((entry) => {
      if (!entry.targetSocketId) return;
      map[entry.targetSocketId] = map[entry.targetSocketId] || [];
      map[entry.targetSocketId].push(entry.voterSocketId);
    });
    return map;
  }, [voteEntries, revealProgress]);

  const revealedTally = useMemo(() => {
    const tally: Record<string, number> = {};
    Object.entries(revealedVoteMap).forEach(([targetSocketId, voters]) => {
      tally[targetSocketId] = voters.length;
    });
    return tally;
  }, [revealedVoteMap]);

  useEffect(() => {
    if (roundStatus !== "revealed") {
      setRevealProgress(0);
      if (revealIntervalRef.current) {
        window.clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      if (revealDelayRef.current) {
        window.clearTimeout(revealDelayRef.current);
        revealDelayRef.current = null;
      }
      return;
    }

    setRevealProgress(0);
    if (revealIntervalRef.current) window.clearInterval(revealIntervalRef.current);
    if (revealDelayRef.current) window.clearTimeout(revealDelayRef.current);

    revealDelayRef.current = window.setTimeout(() => {
      revealIntervalRef.current = window.setInterval(() => {
        setRevealProgress((prev) => {
          if (prev >= voteEntries.length) {
            if (revealIntervalRef.current) {
              window.clearInterval(revealIntervalRef.current);
              revealIntervalRef.current = null;
            }
            return prev;
          }
          return prev + 1;
        });
      }, Math.min(2500 / totalVotes, 750));
    }, 400);

    return () => {
      if (revealIntervalRef.current) {
        window.clearInterval(revealIntervalRef.current);
        revealIntervalRef.current = null;
      }
      if (revealDelayRef.current) {
        window.clearTimeout(revealDelayRef.current);
        revealDelayRef.current = null;
      }
    };
  }, [roundStatus, round?.id, voteEntries.length]);

  useEffect(() => {
    if (roundStatus === "revealed" && revealProgress >= totalVotes){
      revealCompleteDelayRef.current = window.setTimeout(() => {
        setRevealComplete(roundStatus === "revealed" && revealProgress >= totalVotes);
      }, 1000);
    }
    else{
      setRevealComplete(roundStatus === "revealed" && revealProgress >= totalVotes);
    }
    return () => {
      if (revealCompleteDelayRef.current) {
        window.clearTimeout(revealCompleteDelayRef.current);
        revealCompleteDelayRef.current = null;
      }
    };
  }, [roundStatus, revealProgress])

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
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              opacity: roundStatus === "revealed" ? 0 : 1,
              maxHeight: roundStatus === "revealed" ? 0 : 600,
              overflow: "hidden",
              transform: roundStatus === "revealed" ? "translateY(-12px)" : "translateY(0)",
              transition: "opacity 0.4s ease, transform 0.4s ease, max-height 0.5s ease",
            }}
          >
            {players.map((player) => {
              const isTop = player.socketId && round?.results?.topListenerSocketIds?.includes(player.socketId);

              return (
                <div
                  key={player.socketId || player.name}
                  style={{
                    border: `2px solid ${isTop ? "#48bb78" : "#2d3748"}`,
                    borderRadius: 8,
                    padding: "0.85rem",
                    background: isTop ? "#1d2738" : "#10131a",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  {renderAvatar(player, 44)}
                  <div>
                    <div style={{ fontWeight: 600, color: "#ffffffff", display: "flex", gap: 6, alignItems: "center" }}>
                      {player.displayName || player.name}
                      {!!(player.socketId && round.answers?.[player.socketId] && roundStatus === "collecting") && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "#2f855a",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 12,
              padding: "1rem",
              borderRadius: 12,
              background: "#101522",
              border: "1px solid #1f2b3d",
              opacity: roundStatus === "revealed" ? 1 : 0,
              maxHeight: roundStatus === "revealed" ? 520 : 0,
              overflow: "hidden",
              transform: roundStatus === "revealed" ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.5s ease 0.2s, transform 0.5s ease 0.2s, max-height 0.6s ease",
            }}
          >
            <div style={{ fontWeight: 600, color: "#dbe7ff", marginBottom: 12 }}>
              Vote reveal
            </div>
            <div style={{ display: "flex", gap: 18, alignItems: "flex-end", minHeight: 260 }}>
              {players.map((player) => {
                if (!player.socketId) return null;
                const socketId = player.socketId;
                const isTop = round?.results?.topListenerSocketIds?.includes(socketId);
                const currentVotes = revealedTally[socketId] || 0;
                const finalVotes = finalTally[socketId] || 0;
                const votesToShow = revealComplete ? finalVotes : currentVotes;
                const barHeight = Math.round((votesToShow / maxVotes) * 220);
                const voters = revealedVoteMap[socketId] || [];
                const barPixelHeight = Math.max(18, barHeight);
                const avatarGap = 4;
                const barInnerHeight = Math.max(0, barPixelHeight - 16);
                const minAvatarSize = 30;
                const maxAvatarSize = 100;
                const maxRowsPerColumn = Math.max(
                  1,
                  Math.floor((barInnerHeight + avatarGap) / (minAvatarSize + avatarGap))
                );
                const columnCount = voters.length
                  ? Math.max(1, Math.ceil(voters.length / maxRowsPerColumn))
                  : 1;
                const rows = voters.length ? Math.ceil(voters.length / columnCount) : 0;
                const avatarSize = voters.length
                  ? Math.max(
                      minAvatarSize,
                      Math.min(
                        maxAvatarSize,
                        Math.floor((barInnerHeight - avatarGap * Math.max(0, rows - 1)) / rows)
                      )
                    )
                  : 0;
                const actualListens = player.userId ? listenCounts[player.userId] || 0 : 0;

                return (
                  <div
                    key={socketId}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      color: "#e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 24,
                        textAlign: "center",
                        minHeight: 32,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      
                      <div style={{ fontWeight: 600, display: "flex", gap: 4, alignItems: "center", marginBottom: "0px" }}>
                        {player.displayName || player.name}
                        {isTop && revealComplete && <span>🏆</span>}
                      </div>
                      {isTop && revealComplete && (
                        <div
                          style={{
                            marginTop: -18,
                            fontSize: 30,
                          }}
                        >
                          👑
                        </div>
                      )}
                      {renderAvatar(player, 50)}
                      {revealComplete && (
                        <div style={{ fontSize: 15, color: "#e2e8f0", marginTop: 4 }}>
                          {actualListens} listens
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        minHeight: 240,
                      }}
                    >

                      <div
                        style={{
                          width: "70%",
                          minWidth: 56,
                          height: barPixelHeight,
                          background: revealComplete ? isTop ? "linear-gradient(180deg, #46e28e, #1b754c)" : "linear-gradient(180deg, #4c6ef5, #2741a8)" : "linear-gradient(180deg, #4c6ef5, #2741a8)",
                          borderRadius: 12,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          padding: "8px 6px",
                          gap: avatarGap,
                          boxShadow: "0 12px 24px rgba(8, 17, 33, 0.35)",
                          transition: "height 0.35s ease",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridAutoFlow: "column",
                            gridTemplateRows: `repeat(${Math.max(rows, 1)}, ${avatarSize}px)`,
                            gridAutoColumns: `${avatarSize}px`,
                            gap: avatarGap,
                            alignItems: "end",
                            justifyContent: "center",
                          }}
                        >
                          {voters.map((voterSocketId) => {
                            const voter = players.find((p) => p.socketId === voterSocketId);
                            if (!voter) return null;
                            return (
                              <div
                                key={`${socketId}-${voterSocketId}`}
                                style={{
                                  width: avatarSize,
                                  height: avatarSize,
                                  borderRadius: "50%",
                                  border: "2px solid rgba(255,255,255,0.6)",
                                  background: "#0f172a",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {renderAvatar(voter, Math.max(10, avatarSize - 4))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {revealComplete && (
                      <div style={{ fontSize: 15, color: "#9fb2d6" }}>
                        {finalVotes} vote{finalVotes === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
