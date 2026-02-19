import { FC } from "react";
import { Player } from "types/game";

type Props = {
  status?: string;
  title?: string;
  players: Player[];
  finalTally: Record<string, number>;
  revealedTally?: Record<string, number>;
  revealedVoteMap?: Record<string, string[]>;
  revealComplete?: boolean;
  topSocketIds?: string[];
  listenCounts?: Record<string, number>;
  showListenCounts?: boolean;
  submittedSocketIds?: string[];
  showSubmissionChecks?: boolean;
};

export const PlayerVotes: FC<Props> = ({
  status = "collecting",
  title = "Vote reveal",
  players,
  finalTally,
  revealedTally,
  revealedVoteMap,
  revealComplete = false,
  topSocketIds,
  listenCounts,
  showListenCounts = false,
  submittedSocketIds,
  showSubmissionChecks = false,
}) => {
  const maxVotes = Math.max(1, ...Object.values(finalTally));
  const activeTally = revealComplete ? finalTally : revealedTally || {};
  const isRevealed = status === "revealed";

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

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          opacity: isRevealed ? 0 : 1,
          maxHeight: isRevealed ? 0 : 600,
          overflow: "hidden",
          transform: isRevealed ? "translateY(-12px)" : "translateY(0)",
          transition: "opacity 0.4s ease, transform 0.4s ease, max-height 0.5s ease",
        }}
      >
        {players.map((player) => {
          const playerId = player.playerId;
          if (!playerId) return null;
          const isTop = topSocketIds?.includes(playerId);
          const hasSubmitted = submittedSocketIds?.includes(playerId);

          return (
            <div
              key={playerId}
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
                  {showSubmissionChecks && hasSubmitted && status === "collecting" && (
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
          opacity: isRevealed ? 1 : 0,
          maxHeight: isRevealed ? 520 : 0,
          overflow: "hidden",
          transform: isRevealed ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.5s ease 0.2s, transform 0.5s ease 0.2s, max-height 0.6s ease",
        }}
      >
        <div style={{ fontWeight: 600, color: "#dbe7ff", marginBottom: 12 }}>
          {title}
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-end", minHeight: 260 }}>
          {players.map((player) => {
            if (!player.playerId) return null;
            const playerId = player.playerId;
            const isTop = topSocketIds?.includes(playerId);
            const currentVotes = activeTally[playerId] || 0;
            const finalVotes = finalTally[playerId] || 0;
            const votesToShow = revealComplete ? finalVotes : currentVotes;
            const barHeight = Math.round((votesToShow / maxVotes) * 220);
            const voters = revealedVoteMap?.[playerId] || [];
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
            const actualListens = player.userId ? listenCounts?.[player.userId] || 0 : 0;

            return (
              <div
                key={playerId}
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
                  {showListenCounts && revealComplete && (
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
                      background: revealComplete
                        ? isTop
                          ? "linear-gradient(180deg, #46e28e, #1b754c)"
                          : "linear-gradient(180deg, #4c6ef5, #2741a8)"
                        : "linear-gradient(180deg, #4c6ef5, #2741a8)",
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
                        const voter = players.find((p) => p.playerId === voterSocketId);
                        if (!voter) return null;
                        return (
                          <div
                            key={`${playerId}-${voterSocketId}`}
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
  );
};
