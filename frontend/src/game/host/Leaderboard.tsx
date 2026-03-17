import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHostSfx } from "game/hooks/useHostSfx";
import { GameState, Player, ScoreAward, ScoreboardEntry, StreakEntry } from "types/game";
import { PlayerAvatar } from "./minigames/components/PlayerAvatar";
import "./styles/Leaderboard.css";

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type Props = {
  scoreboard?: GameState["scoreboard"];
  players: Player[];
  roundId?: string | null;
  onClose?: () => void;
  isVisible?: boolean;
  soundEnabled?: boolean;
  panelWidth?: number;
  overflowMode?: "fit" | "paged";
  pageDurationMs?: number;
  streaks?: Record<string, StreakEntry>;
};

function formatAward(award: ScoreAward) {
  const reason = award.reason || "award";
  const points = award.points;
  return `${reason}: ${points > 0 ? "+" : ""}${points}`;
}

function resolvePlayer(players: Player[], playerId: string): Player {
  return (
    players.find((p) => p.playerId === playerId) || { playerId, name: "Unknown", displayName: "Unknown" }
  );
}

export const Leaderboard: React.FC<Props> = ({
  scoreboard,
  players,
  roundId,
  onClose,
  isVisible = true,
  soundEnabled = true,
  panelWidth,
  overflowMode = "fit",
  pageDurationMs = 4000,
  streaks,
}) => {
  const entries = useMemo(
    () =>
      Object.entries(scoreboard || {}).map(([socketId, entry]) => ({
        playerId: socketId,
        entry: entry as ScoreboardEntry,
      })),
    [scoreboard]
  );

  const [animatedPoints, setAnimatedPoints] = useState<Record<string, number>>({});
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight
  );
  const [pageIndex, setPageIndex] = useState(0);
  const animationRef = useRef<number | null>(null);
  const { playScoreTick } = useHostSfx({ enabled: soundEnabled });
  const previousAnimatedByPlayerRef = useRef<Record<string, number>>({});
  const pointTickBudgetRef = useRef(0);
  const lastPointTickAtRef = useRef(0);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevPositionsRef = useRef<Map<string, DOMRect>>(new Map());

  const prevRankMapRef = useRef<Map<string, number>>(new Map());
  const lastRankMapRef = useRef<Map<string, number>>(new Map());
  const lastRoundIdRef = useRef<string | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (b.entry.points || 0) - (a.entry.points || 0)),
    [entries]
  );
  const rankMap = useMemo(
    () => new Map(sortedEntries.map((entry, index) => [entry.playerId, index])),
    [sortedEntries]
  );
  const maxVisibleRows = useMemo(() => {
    const overlayVerticalPadding = 64;
    const panelChromeHeight = 132;
    const reservedSpace = overlayVerticalPadding + panelChromeHeight;
    let remainingHeight = Math.max(0, viewportHeight - reservedSpace);
    let visibleCount = 0;

    for (let index = 0; index < sortedEntries.length; index += 1) {
      const rowHeight = index < 3 ? 98 : 68;
      const gapHeight = index > 0 ? 10 : 0;
      const neededHeight = rowHeight + gapHeight;
      if (visibleCount > 0 && remainingHeight < neededHeight) break;
      if (remainingHeight < neededHeight) return 1;
      remainingHeight -= neededHeight;
      visibleCount += 1;
    }

    return Math.max(1, visibleCount);
  }, [sortedEntries.length, viewportHeight]);
  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / maxVisibleRows));
  const currentPageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStartIndex = overflowMode === "paged" ? currentPageIndex * maxVisibleRows : 0;
  const visibleEntries = useMemo(
    () => sortedEntries.slice(pageStartIndex, pageStartIndex + maxVisibleRows),
    [maxVisibleRows, pageStartIndex, sortedEntries]
  );
  const hiddenEntryCount = Math.max(0, sortedEntries.length - visibleEntries.length);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => setViewportHeight(window.innerHeight);
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setPageIndex(0);
  }, [overflowMode, roundId, sortedEntries.length]);

  useEffect(() => {
    if (pageIndex <= totalPages - 1) return;
    setPageIndex(Math.max(0, totalPages - 1));
  }, [pageIndex, totalPages]);

  useEffect(() => {
    if (!isVisible || overflowMode !== "paged" || totalPages <= 1) return;

    const timerId = window.setInterval(() => {
      setPageIndex((current) => (current + 1) % totalPages);
    }, pageDurationMs);

    return () => window.clearInterval(timerId);
  }, [isVisible, overflowMode, pageDurationMs, totalPages]);

  useEffect(() => {
    if (!isVisible) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const deltas: Record<string, number> = {};
    const bases: Record<string, number> = {};

    entries.forEach(({ playerId, entry }) => {
      const awards = (entry.awards || []).filter((a) => (roundId ? a.meta?.roundId === roundId : false));
      const delta = awards.reduce((sum, award) => sum + (award.points || 0), 0);
      deltas[playerId] = delta;
      bases[playerId] = (entry.points || 0) - delta;
    });

    const durationMs = 1400;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next: Record<string, number> = {};
      entries.forEach(({ playerId, entry }) => {
        const base = bases[playerId] ?? entry.points ?? 0;
        const delta = deltas[playerId] ?? 0;
        next[playerId] = Math.round(base + delta * progress);
      });
      setAnimatedPoints(next);
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step);
      }
    };

    animationRef.current = requestAnimationFrame(step);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [entries, roundId, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      previousAnimatedByPlayerRef.current = {};
      pointTickBudgetRef.current = 0;
      lastPointTickAtRef.current = 0;
      return;
    }

    const previous = previousAnimatedByPlayerRef.current;
    const nextByPlayer: Record<string, number> = {};
    let totalIncrease = 0;

    entries.forEach(({ playerId, entry }) => {
      const currentPoints = animatedPoints[playerId] ?? entry.points ?? 0;
      const previousPoints = previous[playerId] ?? currentPoints;
      if (currentPoints > previousPoints) {
        totalIncrease += currentPoints - previousPoints;
      }
      nextByPlayer[playerId] = currentPoints;
    });

    previousAnimatedByPlayerRef.current = nextByPlayer;
    if (totalIncrease <= 0) return;

    pointTickBudgetRef.current += totalIncrease;
    const now = performance.now();
    const pointsPerTick = 2;
    const minTickGapMs = 45;

    if (
      pointTickBudgetRef.current >= pointsPerTick &&
      now - lastPointTickAtRef.current >= minTickGapMs
    ) {
      playScoreTick({ intensity: Math.min(1, totalIncrease / 10) });
      pointTickBudgetRef.current = Math.max(0, pointTickBudgetRef.current - pointsPerTick);
      lastPointTickAtRef.current = now;
    }
  }, [animatedPoints, entries, isVisible, playScoreTick]);

  useLayoutEffect(() => {
    if (!isVisible) return;
    const nextPositions = new Map<string, DOMRect>();
    rowRefs.current.forEach((node, playerId) => {
      if (!node) return;
      nextPositions.set(playerId, node.getBoundingClientRect());
    });

    if (prevPositionsRef.current.size === 0) {
      prevPositionsRef.current = nextPositions;
      return;
    }

    rowRefs.current.forEach((node, playerId) => {
      if (!node) return;
      const prevBox = prevPositionsRef.current.get(playerId);
      const nextBox = nextPositions.get(playerId);
      if (!prevBox || !nextBox) return;
      const deltaY = prevBox.top - nextBox.top;
      if (!deltaY) return;
      node.style.willChange = "transform";
      node.style.transition = "transform 0s";
      node.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 1500ms ease";
        node.style.transform = "translateY(0)";
      });
    });

    prevPositionsRef.current = nextPositions;
  }, [visibleEntries, isVisible]);

  useEffect(() => {
    if (!roundId) {
      lastRankMapRef.current = rankMap;
      lastRoundIdRef.current = null;
      return;
    }
    if (roundId !== lastRoundIdRef.current) {
      prevRankMapRef.current = lastRankMapRef.current;
      lastRoundIdRef.current = roundId;
    }
    lastRankMapRef.current = rankMap;
  }, [rankMap, roundId]);


  return (
    <div
      className={`leaderboard-overlay ${isVisible ? 'leaderboard-overlay--visible' : 'leaderboard-overlay--hidden'}`}
      aria-hidden={!isVisible}
    >
      <div
        className="leaderboard-panel"
        style={panelWidth ? { width: `min(${panelWidth}px, 100%)` } : undefined}
      >
        <div className="leaderboard-header">
          <h2 className="leaderboard-title">Leaderboard</h2>
          {onClose && (
            <button onClick={onClose} className="leaderboard-close-btn">
              Close
            </button>
          )}
        </div>
        <div className="leaderboard-list">
          {visibleEntries.length === 0 && <div>No scores yet.</div>}
          {visibleEntries.map(({ playerId, entry }, idx) => {
            const player = resolvePlayer(players, playerId);
            const currentOverallIndex = pageStartIndex + idx;
            const rank = currentOverallIndex + 1;
            const recentAwards = roundId
              ? (entry.awards || []).filter((a) => a.meta?.roundId === roundId)
              : [];
            const displayPoints = animatedPoints[playerId] ?? entry.points ?? 0;
            const prevRank = prevRankMapRef.current.get(playerId);
            const rankDelta =
              typeof prevRank === "number" ? prevRank - currentOverallIndex : 0;
            const roundDelta = roundId
              ? (entry.awards || [])
                  .filter((a) => a.meta?.roundId === roundId)
                  .reduce((sum, a) => sum + (a.points || 0), 0)
              : 0;

            return (
              <div
                key={playerId}
                ref={(node) => {
                  if (node) rowRefs.current.set(playerId, node);
                  else rowRefs.current.delete(playerId);
                }}
                className={joinClasses(
                  "leaderboard-row",
                  rank === 1 && "leaderboard-row--rank-1",
                  rank === 2 && "leaderboard-row--rank-2",
                  rank === 3 && "leaderboard-row--rank-3"
                )}
              >
                <div className="leaderboard-row-left">
                  <div
                    className={joinClasses(
                      "leaderboard-rank",
                      rank <= 3 && "leaderboard-rank--podium"
                    )}
                  >
                    {rank}
                  </div>
                  <PlayerAvatar player={player} size={34} className="leaderboard-avatar" />
                  <div>
                    <div className="leaderboard-name">{player.displayName}{" "}
                    {rankDelta > 0 && <span className="leaderboard-rank-delta--up">&#9650;</span>}
                    {rankDelta < 0 && <span className="leaderboard-rank-delta--down">&#9660;</span>}
                    {(streaks?.[playerId]?.current ?? 0) >= 3 && (
                      <span className="leaderboard-streak-badge">
                        🔥{streaks![playerId].current}
                      </span>
                    )}</div>
                  </div>
                </div>
                <div className="leaderboard-right">
                  {isVisible && roundDelta > 0 && (
                    <span className="leaderboard-point-delta">+{roundDelta}</span>
                  )}
                  <div className="leaderboard-points">{displayPoints} pts</div>
                  {recentAwards.length > 0 && (
                    <div className="leaderboard-awards">
                      {recentAwards.slice(-3).map((a, i) => (
                        <span key={i} className="leaderboard-award-item">
                          {formatAward(a)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {overflowMode === "paged" && totalPages > 1 ? (
          <div className="leaderboard-truncation-note">
            Page {currentPageIndex + 1} of {totalPages} · Showing ranks {pageStartIndex + 1}-
            {pageStartIndex + visibleEntries.length} of {sortedEntries.length}
          </div>
        ) : hiddenEntryCount > 0 ? (
          <div className="leaderboard-truncation-note">
            Showing top {visibleEntries.length} of {sortedEntries.length}
          </div>
        ) : null}
      </div>
    </div>
  );
};
