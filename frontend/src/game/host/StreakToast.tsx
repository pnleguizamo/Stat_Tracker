import React, { useEffect, useMemo, useRef, useState } from "react";
import { Player, StreakEntry } from "types/game";
import "./styles/StreakToast.css";

const STREAK_MILESTONES = new Set([3, 5, 7, 10]);
const STREAK_LOST_THRESHOLD = 3;

type ToastType = "milestone" | "lost";

type ToastItem = {
  id: number;
  playerId: string;
  streak: number;
  type: ToastType;
};

type Props = {
  players: Player[];
  streaks?: Record<string, StreakEntry>;
  roundId?: string | null;
  stageIndex?: number | null;
};

export const StreakToast: React.FC<Props> = ({ players, streaks, roundId, stageIndex }) => {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const prevStreaksRef = useRef<Record<string, number>>({});
  const counterRef = useRef(0);
  const previousStageIndexRef = useRef<number | null | undefined>(undefined);
  const playerNamesById = useMemo(
    () =>
      players.reduce<Record<string, string>>((acc, player) => {
        acc[player.playerId] = player.displayName ?? "Someone";
        return acc;
      }, {}),
    [players]
  );

  useEffect(() => {
    if (previousStageIndexRef.current === undefined) {
      previousStageIndexRef.current = stageIndex;
      return;
    }

    if (previousStageIndexRef.current === stageIndex) return;

    previousStageIndexRef.current = stageIndex;
    prevStreaksRef.current = Object.fromEntries(
      Object.entries(streaks || {}).map(([playerId, entry]) => [playerId, entry.current])
    );
  }, [stageIndex, streaks]);

  useEffect(() => {
    if (!streaks || !roundId) return;

    const newToasts: ToastItem[] = [];
    for (const [playerId, entry] of Object.entries(streaks)) {
      const prev = prevStreaksRef.current[playerId] ?? 0;
      const curr = entry.current;
      if (curr > prev && STREAK_MILESTONES.has(curr)) {
        newToasts.push({
          id: ++counterRef.current,
          playerId,
          streak: curr,
          type: "milestone",
        });
      } else if (prev >= STREAK_LOST_THRESHOLD && curr === 0) {
        newToasts.push({
          id: ++counterRef.current,
          playerId,
          streak: prev,
          type: "lost",
        });
      }
      prevStreaksRef.current[playerId] = curr;
    }

    if (newToasts.length > 0) {
      setQueue((q) => [...q, ...newToasts]);
    }
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
  const playerName = playerNamesById[toast.playerId] ?? "Someone";
  const isLostToast = toast.type === "lost";

  return (
    <div className={`streak-toast${isLostToast ? " streak-toast--lost" : ""}`} key={toast.id}>
      <span className="streak-toast-icon" aria-hidden="true">
        {isLostToast ? "🥀" : "🔥"}
      </span>
      <span className="streak-toast-text">
        <strong>{playerName}</strong>{" "}
        {isLostToast ? `lost a ${toast.streak}-streak.` : `is on a ${toast.streak}-streak!`}
      </span>
    </div>
  );
};
