import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function resolvePlayer(players: Player[], socketId: string) {
  return (
    players.find((p) => p.socketId === socketId) || { socketId, displayName: "Unknown" }
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
        socketId,
        entry: entry as ScoreboardEntry,
      })),
    [scoreboard]
  );
  
  const [animatedPoints, setAnimatedPoints] = useState<Record<string, number>>({});
  const animationRef = useRef<number | null>(null);

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
    () => new Map(sortedEntries.map((entry, index) => [entry.socketId, index])),
    [sortedEntries]
  );


  useEffect(() => {
    if (!isVisible) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const deltas: Record<string, number> = {};
    const bases: Record<string, number> = {};

    entries.forEach(({ socketId, entry }) => {
      const awards = (entry.awards || []).filter((a) => (roundId ? a.meta?.roundId === roundId : false));
      const delta = awards.reduce((sum, award) => sum + (award.points || 0), 0);
      deltas[socketId] = delta;
      bases[socketId] = (entry.points || 0) - delta;
    });

    const durationMs = 1400;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next: Record<string, number> = {};
      entries.forEach(({ socketId, entry }) => {
        const base = bases[socketId] ?? entry.points ?? 0;
        const delta = deltas[socketId] ?? 0;
        next[socketId] = Math.round(base + delta * progress);
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

  useLayoutEffect(() => {
    if (!isVisible) return;
    const nextPositions = new Map<string, DOMRect>();
    rowRefs.current.forEach((node, socketId) => {
      if (!node) return;
      nextPositions.set(socketId, node.getBoundingClientRect());
    });

    if (prevPositionsRef.current.size === 0) {
      prevPositionsRef.current = nextPositions;
      return;
    }

    rowRefs.current.forEach((node, socketId) => {
      if (!node) return;
      const prevBox = prevPositionsRef.current.get(socketId);
      const nextBox = nextPositions.get(socketId);
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
          {sortedEntries.map(({ socketId, entry }, idx) => {
            const player = resolvePlayer(players, socketId);
            const recentAwards = (entry.awards || []).filter((a) =>
              roundId ? a.meta?.roundId === roundId : true
            );
            const displayPoints = animatedPoints[socketId] ?? entry.points ?? 0;
            const prevRank = prevRankMapRef.current.get(socketId);
            const rankDelta = typeof prevRank === "number" ? prevRank - idx : 0;

            return (
              <div
                key={socketId}
                ref={(node) => {
                  if (node) rowRefs.current.set(socketId, node);
                  else rowRefs.current.delete(socketId);
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
                  <div>
                    <div style={{ fontWeight: 700 }}>{player.displayName}{" "}
                    {rankDelta > 0 && <span style={{ color: "#38a169", fontSize: 12 }}>▲</span>}
                    {rankDelta < 0 && <span style={{ color: "#e53e3e", fontSize: 12 }}>▼</span>}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{player.socketId}</div>
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
