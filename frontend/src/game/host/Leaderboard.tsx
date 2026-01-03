import React from "react";
import { GameState, Player, ScoreAward, ScoreboardEntry } from "types/game";

type Props = {
  scoreboard?: GameState["scoreboard"];
  players: Player[];
  roundId?: string | null;
  onClose?: () => void;
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

export const Leaderboard: React.FC<Props> = ({ scoreboard, players, roundId, onClose }) => {
  const entries = Object.entries(scoreboard || {}).map(([socketId, entry]) => ({
    socketId,
    entry: entry as ScoreboardEntry,
  }));

  entries.sort((a, b) => (b.entry.points || 0) - (a.entry.points || 0));

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
      }}
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
          {entries.length === 0 && <div>No scores yet.</div>}
          {entries.map(({ socketId, entry }, idx) => {
            const player = resolvePlayer(players, socketId);
            const recentAwards = (entry.awards || []).filter((a) =>
              roundId ? a.meta?.roundId === roundId : true
            );
            return (
              <div
                key={socketId}
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
                    <div style={{ fontWeight: 700 }}>{player.displayName}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{player.socketId}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{entry.points || 0} pts</div>
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
