import React, { useEffect, useRef, useState } from "react";
import { Player, StreakEntry } from "types/game";
import "./styles/StreakToast.css";

const STREAK_MILESTONES = new Set([3, 5, 7, 10]);

type ToastItem = {
  id: number;
  playerName: string;
  streak: number;
};

type Props = {
  players: Player[];
  streaks?: Record<string, StreakEntry>;
  roundId?: string | null;
};

export const StreakToast: React.FC<Props> = ({ players, streaks, roundId }) => {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const prevStreaksRef = useRef<Record<string, number>>({});
  const counterRef = useRef(0);

  useEffect(() => {
    if (!streaks || !roundId) return;

    const newToasts: ToastItem[] = [];
    for (const [playerId, entry] of Object.entries(streaks)) {
      const prev = prevStreaksRef.current[playerId] ?? 0;
      const curr = entry.current;
      if (curr > prev && STREAK_MILESTONES.has(curr)) {
        const player = players.find((p) => p.playerId === playerId);
        newToasts.push({
          id: ++counterRef.current,
          playerName: player?.displayName ?? "Someone",
          streak: curr,
        });
      }
      prevStreaksRef.current[playerId] = curr;
    }

    if (newToasts.length > 0) {
      setQueue((q) => [...q, ...newToasts]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, streaks]);

  useEffect(() => {
    if (queue.length === 0) return;
    const timer = window.setTimeout(() => {
      setQueue((q) => q.slice(1));
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [queue]);

  if (queue.length === 0) return null;
  // TODOo multiple toasts at a time?
  const toast = queue[0];

  return (
    <div className="streak-toast" key={toast.id}>
      <span className="streak-toast-fire">🔥</span>
      <span className="streak-toast-text">
        <strong>{toast.playerName}</strong> is on a {toast.streak}-streak!
      </span>
    </div>
  );
};
