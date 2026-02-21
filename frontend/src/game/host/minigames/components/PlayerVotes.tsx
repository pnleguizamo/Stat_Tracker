import { FC } from "react";
import { Player } from "types/game";
import { HostCard } from "./HostMinigamePrimitives";
import "../styles/PlayerVotes.css";

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
  const joinClasses = (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" ");

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

  if (!isRevealed) {
    return (
      <HostCard className="player-votes-card">
        <div className="player-votes-collecting-grid">
        {players.map((player) => {
          const playerId = player.playerId;
          if (!playerId) return null;

          const isTop = topSocketIds?.includes(playerId);
          const hasSubmitted = submittedSocketIds?.includes(playerId);

          return (
            <div
              key={playerId}
              // isTop is never true
              className={joinClasses("player-votes-collecting-item", isTop && "is-top")}
            >
              {renderAvatar(player, 44)}
              <div className="player-votes-player-name">
                {player.displayName || player.name}
                {showSubmissionChecks && hasSubmitted && status === "collecting" && (
                  <span className="player-votes-submitted-badge">✓</span>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </HostCard>
    );
  }

  return (
    <HostCard className="player-votes-card">
      <div className="player-votes-title">{title}</div>
      <div className="player-votes-bars">
        {players.map((player) => {
          if (!player.playerId) return null;

          const playerId = player.playerId;
          const isTop = topSocketIds?.includes(playerId);
          const currentVotes = activeTally[playerId] || 0;
          const finalVotes = finalTally[playerId] || 0;
          const votesToShow = revealComplete ? finalVotes : currentVotes;
          const highlightTop = revealComplete && isTop;
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
          const columnCount = voters.length ? Math.max(1, Math.ceil(voters.length / maxRowsPerColumn)) : 1;
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
                className="player-votes-column"
              >
                <div className="player-votes-column-head">
                  <div className="player-votes-column-name">
                    {player.displayName || player.name}
                    {isTop && revealComplete && <span>🏆</span>}
                  </div>
                  {isTop && revealComplete && <div className="player-votes-crown">👑</div>}
                  {renderAvatar(player, 50)}
                  {showListenCounts && revealComplete && (
                    <div className="player-votes-listens">
                      {actualListens} listens
                    </div>
                  )}
                </div>
                <div className="player-votes-bar-wrap">
                  <div
                    className={joinClasses("player-votes-bar", highlightTop && "is-top")}
                    style={{
                      height: barPixelHeight,
                      gap: avatarGap,
                    }}
                  >
                    <div
                      className="player-votes-voter-grid"
                      style={{
                        gridTemplateRows: `repeat(${Math.max(rows, 1)}, ${avatarSize}px)`,
                        gridAutoColumns: `${avatarSize}px`,
                        gap: avatarGap,
                      }}
                    >
                      {voters.map((voterSocketId) => {
                        const voter = players.find((p) => p.playerId === voterSocketId);
                        if (!voter) return null;
                        return (
                          <div
                            key={`${playerId}-${voterSocketId}`}
                            className="player-votes-voter"
                            style={{
                              width: avatarSize,
                              height: avatarSize,
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
                  <div className="player-votes-total">
                    {finalVotes} vote{finalVotes === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </HostCard>
  );
};
