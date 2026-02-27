import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHostSfx } from "game/hooks/useHostSfx";
import { GameState, Player, ScoreAward, ScoreboardEntry } from "types/game";

type Props = {
  scoreboard?: GameState["scoreboard"];
  players: Player[];
  roundId?: string | null;
  onClose?: () => void;
  isVisible?: boolean;
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

function getInitials(name?: string | null) {
  return (name || "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function renderAvatar(player: Player) {
  const label = player.displayName || player.name || "Player";
  if (player.avatar) {
    return (
      <img
        src={player.avatar}
        alt={label}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.14)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, rgba(59, 130, 246, 0.42), rgba(15, 23, 42, 0.92))",
        border: "1px solid rgba(96, 165, 250, 0.35)",
        color: "#dbeafe",
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {getInitials(label)}
    </div>
  );
}

export const Leaderboard: React.FC<Props> = ({
  scoreboard,
  players,
  roundId,
  onClose,
  isVisible = true,
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
  const animationRef = useRef<number | null>(null);
  const { playScoreTick } = useHostSfx();
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
  }, [sortedEntries, isVisible]);

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        zIndex: 2000,
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? "auto" : "none",
        visibility: isVisible ? "visible" : "hidden",
        transition: "opacity 200ms ease, visibility 200ms ease",
      }}
      aria-hidden={!isVisible}
    >
      <div
        style={{
          background: "#0f172a",
          color: "white",
          borderRadius: 16,
          padding: "24px 32px",
          width: "min(720px, 100%)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Leaderboard</h2>
          {onClose && (
            <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 8 }}>
              Close
            </button>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          {sortedEntries.length === 0 && <div>No scores yet.</div>}
          {sortedEntries.map(({ playerId, entry }, idx) => {
            const player = resolvePlayer(players, playerId);
            const recentAwards = roundId
              ? (entry.awards || []).filter((a) => a.meta?.roundId === roundId)
              : [];
            const displayPoints = animatedPoints[playerId] ?? entry.points ?? 0;
            const prevRank = prevRankMapRef.current.get(playerId);
            const rankDelta = typeof prevRank === "number" ? prevRank - idx : 0;

            return (
              <div
                key={playerId}
                ref={(node) => {
                  if (node) rowRefs.current.set(playerId, node);
                  else rowRefs.current.delete(playerId);
                }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 24, textAlign: "right", opacity: 0.8 }}>{idx + 1}</div>
                  {renderAvatar(player)}
                  <div>
                    <div style={{ fontWeight: 700 }}>{player.displayName}{" "}
                    {rankDelta > 0 && <span style={{ color: "#38a169", fontSize: 12 }}>▲</span>}
                    {rankDelta < 0 && <span style={{ color: "#e53e3e", fontSize: 12 }}>▼</span>}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{displayPoints} pts</div>
                  {recentAwards.length > 0 && (
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {recentAwards.slice(-3).map((a, i) => (
                        <span key={i} style={{ marginLeft: i ? 8 : 0 }}>
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
      </div>
    </div>
  );
};
