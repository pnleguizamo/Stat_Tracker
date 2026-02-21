import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "types/game";
import { HostCard } from "./HostMinigamePrimitives";
import "../styles/PlayerVotes.css";

type RevealPhase = "suspense" | "revealing" | "winner-lock";

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

type AvatarLayout = {
  rows: number;
  columns: number;
  size: number;
};

type ResolveAvatarLayoutArgs = {
  voteCount: number;
  barInnerHeight: number;
  barInnerWidth: number;
  gap: number;
  preferredMinSize: number;
  hardMinSize: number;
  maxSize: number;
};

const resolveAvatarLayout = ({
  voteCount,
  barInnerHeight,
  barInnerWidth,
  gap,
  preferredMinSize,
  hardMinSize,
  maxSize,
}: ResolveAvatarLayoutArgs): AvatarLayout => {
  if (voteCount <= 0) return { rows: 0, columns: 1, size: 0 };

  const solveWithMinimum = (minimumSize: number): AvatarLayout | null => {
    let bestLayout: AvatarLayout | null = null;

    for (let columns = 1; columns <= voteCount; columns += 1) {
      const rows = Math.ceil(voteCount / columns);
      const perAvatarHeight = Math.floor((barInnerHeight - gap * Math.max(0, rows - 1)) / rows);
      const perAvatarWidth = Math.floor((barInnerWidth - gap * Math.max(0, columns - 1)) / columns);
      const size = Math.min(maxSize, perAvatarHeight, perAvatarWidth);

      if (size < minimumSize) continue;

      if (!bestLayout || size > bestLayout.size || (size === bestLayout.size && columns < bestLayout.columns)) {
        bestLayout = { rows, columns, size };
      }
    }

    return bestLayout;
  };

  const preferredLayout = solveWithMinimum(preferredMinSize);
  if (preferredLayout) return preferredLayout;

  const hardMinimumLayout = solveWithMinimum(hardMinSize);
  if (hardMinimumLayout) return hardMinimumLayout;

  const fallbackColumns = Math.max(
    1,
    Math.ceil(voteCount / Math.max(1, Math.floor((barInnerHeight + gap) / (hardMinSize + gap))))
  );
  const fallbackRows = Math.ceil(voteCount / fallbackColumns);
  const fallbackHeight = Math.floor(
    (barInnerHeight - gap * Math.max(0, fallbackRows - 1)) / Math.max(1, fallbackRows)
  );
  const fallbackWidth = Math.floor(
    (barInnerWidth - gap * Math.max(0, fallbackColumns - 1)) / Math.max(1, fallbackColumns)
  );
  const fallbackSize = Math.max(8, Math.min(maxSize, fallbackHeight, fallbackWidth));

  return {
    rows: fallbackRows,
    columns: fallbackColumns,
    size: fallbackSize,
  };
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
  const barsContainerRef = useRef<HTMLDivElement | null>(null);
  const previousRevealMapRef = useRef<Record<string, string[]>>({});
  const [barWidthByPlayerId, setBarWidthByPlayerId] = useState<Record<string, number>>({});
  const [barImpactTickByPlayerId, setBarImpactTickByPlayerId] = useState<Record<string, number>>({});
  const [newestVoterByTargetPlayerId, setNewestVoterByTargetPlayerId] = useState<Record<string, string>>({});
  const [newestVoterPulseTickByTargetPlayerId, setNewestVoterPulseTickByTargetPlayerId] = useState<Record<string, number>>({});
  const joinClasses = (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" ");
  const revealedVoteCount = useMemo(() => {
    return Object.values(revealedVoteMap || {}).reduce(
      (sum, voterIds) => sum + voterIds.length,
      0
    );
  }, [revealedVoteMap]);
  const revealPhase: RevealPhase = useMemo(() => {
    if (revealComplete) return "winner-lock";
    if (revealedVoteCount <= 0) return "suspense";
    return "revealing";
  }, [revealedVoteCount, revealComplete]);
  const playerBySocketId = useMemo(() => {
    const bySocketId: Record<string, Player> = {};
    players.forEach((player) => {
      if (!player.playerId) return;
      bySocketId[player.playerId] = player;
    });
    return bySocketId;
  }, [players]);

  const syncBarWidths = useCallback(() => {
    const container = barsContainerRef.current;
    if (!container) return;

    const nextWidths: Record<string, number> = {};
    container
      .querySelectorAll<HTMLDivElement>(".player-votes-bar[data-player-id]")
      .forEach((barNode) => {
        const playerId = barNode.dataset.playerId;
        if (!playerId) return;
        nextWidths[playerId] = barNode.offsetWidth;
      });

    setBarWidthByPlayerId((previousWidths) => {
      const previousKeys = Object.keys(previousWidths);
      const nextKeys = Object.keys(nextWidths);
      if (previousKeys.length === nextKeys.length) {
        const unchanged = nextKeys.every(
          (playerId) => previousWidths[playerId] === nextWidths[playerId]
        );
        if (unchanged) return previousWidths;
      }
      return nextWidths;
    });
  }, []);

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

  useEffect(() => {
    if (isRevealed) return;
    previousRevealMapRef.current = {};
    setBarWidthByPlayerId({});
    setBarImpactTickByPlayerId({});
    setNewestVoterByTargetPlayerId({});
    setNewestVoterPulseTickByTargetPlayerId({});
  }, [isRevealed]);

  useEffect(() => {
    if (!isRevealed) return;
    syncBarWidths();
  }, [isRevealed, players.length, revealedVoteMap, syncBarWidths]);

  useEffect(() => {
    if (!isRevealed) return;
    if (typeof ResizeObserver === "undefined") return;
    const container = barsContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      syncBarWidths();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isRevealed, syncBarWidths]);

  useEffect(() => {
    if (!isRevealed || !revealedVoteMap) {
      previousRevealMapRef.current = revealedVoteMap || {};
      return;
    }

    const previousRevealMap = previousRevealMapRef.current;
    const impactedTargetPlayerIds: string[] = [];
    const newestByTarget: Record<string, string> = {};

    Object.entries(revealedVoteMap).forEach(([targetPlayerId, voterPlayerIds]) => {
      const previousVoters = new Set(previousRevealMap[targetPlayerId] || []);
      const newlyRevealedVoters = voterPlayerIds.filter((voterId) => !previousVoters.has(voterId));
      if (!newlyRevealedVoters.length) return;

      impactedTargetPlayerIds.push(targetPlayerId);
      newestByTarget[targetPlayerId] = newlyRevealedVoters[newlyRevealedVoters.length - 1];
    });

    if (impactedTargetPlayerIds.length) {
      setBarImpactTickByPlayerId((previousTicks) => {
        const nextTicks = { ...previousTicks };
        impactedTargetPlayerIds.forEach((targetPlayerId) => {
          nextTicks[targetPlayerId] = (nextTicks[targetPlayerId] || 0) + 1;
        });
        return nextTicks;
      });

      setNewestVoterByTargetPlayerId((previousNewestByTarget) => ({
        ...previousNewestByTarget,
        ...newestByTarget,
      }));

      setNewestVoterPulseTickByTargetPlayerId((previousTicks) => {
        const nextTicks = { ...previousTicks };
        impactedTargetPlayerIds.forEach((targetPlayerId) => {
          nextTicks[targetPlayerId] = (nextTicks[targetPlayerId] || 0) + 1;
        });
        return nextTicks;
      });
    }

    previousRevealMapRef.current = revealedVoteMap;
  }, [isRevealed, revealedVoteMap]);

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
      <div
        ref={barsContainerRef}
        className={joinClasses("player-votes-bars", `phase-${revealPhase}`)}
      >
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
          const stackedVoters = voters.slice().reverse();
          const avatarGap = 4;
          const minAvatarSize = 40;
          const hardMinAvatarSize = 30;
          const maxAvatarSize = 100;
          const barPixelHeight = voters.length
            ? Math.max(18, hardMinAvatarSize + 16, barHeight)
            : Math.max(18, barHeight);
          const barInnerHeight = Math.max(0, barPixelHeight - 16);
          const measuredBarWidth = barWidthByPlayerId[playerId] || 56;
          const barInnerWidth = Math.max(0, measuredBarWidth - 12);
          const { rows, columns: columnCount, size: avatarSize } = resolveAvatarLayout({
            voteCount: voters.length,
            barInnerHeight,
            barInnerWidth,
            gap: avatarGap,
            preferredMinSize: minAvatarSize,
            hardMinSize: hardMinAvatarSize,
            maxSize: maxAvatarSize,
          });
          const gridCapacity = Math.max(0, rows * columnCount);
          const emptySlots = Math.max(0, gridCapacity - stackedVoters.length);
          const shouldCenterTopSingleton =
            columnCount % 2 === 0 &&
            emptySlots === Math.max(0, columnCount - 1) &&
            stackedVoters.length > 0;
          const stackedVoterSlots = shouldCenterTopSingleton
            ? stackedVoters
            : emptySlots
              ? [...new Array(emptySlots).fill(null), ...stackedVoters]
              : stackedVoters;
          const actualListens = player.userId ? listenCounts?.[player.userId] || 0 : 0;
          const barImpactTick = barImpactTickByPlayerId[playerId] || 0;
          const newestVoterId = newestVoterByTargetPlayerId[playerId];
          const newestVoterPulseTick = newestVoterPulseTickByTargetPlayerId[playerId] || 0;
          const isWinnerLockedTop = revealPhase === "winner-lock" && isTop;
          const isWinnerLockedLoser = revealPhase === "winner-lock" && !isTop;

          return (
            <div
              key={playerId}
              className={joinClasses(
                "player-votes-column",
                isWinnerLockedTop && "is-winner-lock",
                isWinnerLockedLoser && "is-loser-lock"
              )}
            >
              <div className="player-votes-column-head">
                <div className="player-votes-column-name">
                  {player.displayName || player.name}
                  {isWinnerLockedTop && <span>🏆</span>}
                </div>
                {isWinnerLockedTop && (
                  <div className="player-votes-crown is-burst">
                    👑
                  </div>
                )}
                {renderAvatar(player, 50)}
                {showListenCounts && revealComplete && (
                  <div className="player-votes-listens">
                    {actualListens} listens
                  </div>
                )}
              </div>
              <div className="player-votes-bar-wrap">
                <div
                  data-player-id={playerId}
                  className={joinClasses(
                    "player-votes-bar",
                    highlightTop && "is-top",
                    barImpactTick > 0 && "is-impacted",
                    isWinnerLockedTop && "is-winner-lock",
                    isWinnerLockedLoser && "is-loser-lock"
                  )}
                  style={{
                    height: barPixelHeight,
                    gap: avatarGap,
                    animationName:
                      barImpactTick > 0
                        ? barImpactTick % 2 === 0
                          ? "player-votes-bar-impact-a"
                          : "player-votes-bar-impact-b"
                        : undefined,
                    animationDuration: barImpactTick > 0 ? "360ms" : undefined,
                    animationTimingFunction: barImpactTick > 0 ? "cubic-bezier(0.2, 0.85, 0.24, 1.2)" : undefined,
                    animationIterationCount: barImpactTick > 0 ? 1 : undefined,
                  }}
                >
                  <div
                    className="player-votes-voter-grid"
                    style={{
                      gridTemplateRows: `repeat(${Math.max(rows, 1)}, ${avatarSize}px)`,
                      gridTemplateColumns: `repeat(${Math.max(columnCount, 1)}, ${avatarSize}px)`,
                      gridAutoColumns: `${avatarSize}px`,
                      gap: avatarGap,
                    }}
                  >
                    {stackedVoterSlots.map((slot, index) => {
                      if (!slot) {
                        return (
                          <div
                            key={`${playerId}-slot-gap-${index}`}
                            className="player-votes-voter is-placeholder"
                            style={{
                              width: avatarSize,
                              height: avatarSize,
                            }}
                          />
                        );
                      }

                      const voter = playerBySocketId[slot];
                      if (!voter) return null;
                      const isNewestVoter = slot === newestVoterId;
                      return (
                        <div
                          key={`${playerId}-${slot}`}
                          className={joinClasses("player-votes-voter", isNewestVoter && "is-newest")}
                          style={{
                            width: avatarSize,
                            height: avatarSize,
                            gridColumn:
                              shouldCenterTopSingleton && index === 0
                                ? "1 / -1"
                                : undefined,
                            justifySelf:
                              shouldCenterTopSingleton && index === 0
                                ? "center"
                                : undefined,
                            animationName:
                              isNewestVoter
                                ? newestVoterPulseTick % 2 === 0
                                  ? "player-votes-avatar-pop-a"
                                  : "player-votes-avatar-pop-b"
                                : undefined,
                            animationDuration: isNewestVoter ? "280ms" : undefined,
                            animationTimingFunction: isNewestVoter
                              ? "cubic-bezier(0.19, 0.89, 0.28, 1.35)"
                              : undefined,
                            animationIterationCount: isNewestVoter ? 1 : undefined,
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
