import { useEffect, useMemo, useRef, useState } from "react";
import { VoteEntry } from "game/hooks/useVoteTally";

type UseVoteRevealArgs = {
  status?: string;
  voteEntries: VoteEntry[];
  totalVotes?: number;
  delayMs?: number;
  durationMs?: number;
  maxIntervalMs?: number;
  completionDelayMs?: number;
};

export const useVoteReveal = ({
  status,
  voteEntries,
  totalVotes,
  delayMs = 400,
  durationMs = 2500,
  maxIntervalMs = 750,
  completionDelayMs = 1000,
}: UseVoteRevealArgs) => {
  const [revealProgress, setRevealProgress] = useState(0);
  const [revealComplete, setRevealComplete] = useState(false);
  const revealIntervalRef = useRef<number | null>(null);
  const revealDelayRef = useRef<number | null>(null);
  const revealCompleteDelayRef = useRef<number | null>(null);

  const totalVoteCount = totalVotes ?? voteEntries.length;

  useEffect(() => {
    if (status !== "revealed") {
      setRevealProgress(0);
      setRevealComplete(false);
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

    if (totalVoteCount <= 0) {
      return;
    }

    const intervalMs = Math.min(durationMs / Math.max(1, totalVoteCount), maxIntervalMs);
    revealDelayRef.current = window.setTimeout(() => {
      revealIntervalRef.current = window.setInterval(() => {
        setRevealProgress((prev) => {
          if (prev >= totalVoteCount) {
            if (revealIntervalRef.current) {
              window.clearInterval(revealIntervalRef.current);
              revealIntervalRef.current = null;
            }
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }, delayMs);

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
  }, [status, voteEntries.length, totalVoteCount, delayMs, durationMs, maxIntervalMs]);

  useEffect(() => {
    if (status === "revealed" && revealProgress >= totalVoteCount) {
      revealCompleteDelayRef.current = window.setTimeout(() => {
        setRevealComplete(status === "revealed" && revealProgress >= totalVoteCount);
      }, completionDelayMs);
    } else {
      setRevealComplete(status === "revealed" && revealProgress >= totalVoteCount);
    }
    return () => {
      if (revealCompleteDelayRef.current) {
        window.clearTimeout(revealCompleteDelayRef.current);
        revealCompleteDelayRef.current = null;
      }
    };
  }, [status, revealProgress, totalVoteCount, completionDelayMs]);

  const revealedVoteMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    const activeVotes = voteEntries.slice(0, revealProgress);
    activeVotes.forEach((entry) => {
      map[entry.targetPlayerId] = map[entry.targetPlayerId] || [];
      map[entry.targetPlayerId].push(entry.voterPlayerId);
    });
    return map;
  }, [voteEntries, revealProgress]);

  const revealedTally = useMemo(() => {
    const tally: Record<string, number> = {};
    Object.entries(revealedVoteMap).forEach(([targetPlayerId, voters]) => {
      tally[targetPlayerId] = voters.length;
    });
    return tally;
  }, [revealedVoteMap]);

  return {
    revealProgress,
    revealComplete,
    revealedVoteMap,
    revealedTally,
  };
};
