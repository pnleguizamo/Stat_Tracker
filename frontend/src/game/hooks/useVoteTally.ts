import { useMemo } from "react";
import { Player } from "types/game";

export type VoteEntry = {
  voterPlayerId: string;
  targetPlayerId: string;
  at: number;
};

type VoteAnswer = {
  answer?: { targetPlayerId?: string | null } | null;
  at?: number | null;
};

type UseVoteTallyArgs = {
  players: Player[];
  answers?: Record<string, VoteAnswer>;
  totals?: Record<string, number>;
};

export const useVoteTally = ({ players, answers, totals }: UseVoteTallyArgs) => {
  const voteEntries = useMemo(() => {
    if (!answers) return [];
    return Object.entries(answers)
      .map(([voterPlayerId, submission]) => ({
        voterPlayerId,
        targetPlayerId: submission?.answer?.targetPlayerId || "",
        at: submission?.at || 0,
      }))
      .filter((entry) => entry.targetPlayerId)
      .sort((a, b) => a.at - b.at);
  }, [answers]);

  const finalTally = useMemo(() => {
    if (totals && Object.keys(totals).length) return totals;
    const tally: Record<string, number> = {};
    voteEntries.forEach((entry) => {
      tally[entry.targetPlayerId] = (tally[entry.targetPlayerId] || 0) + 1;
    });
    return tally;
  }, [totals, voteEntries]);

  const totalVotes = useMemo(() => {
    if (voteEntries.length) return voteEntries.length;
    return Object.values(finalTally).reduce((sum, count) => sum + count, 0);
  }, [finalTally, voteEntries.length]);

  const maxVotes = useMemo(() => {
    const values = Object.values(finalTally);
    return values.length ? Math.max(1, ...values) : 1;
  }, [finalTally]);

  return {
    voteEntries,
    finalTally,
    totalVotes,
    maxVotes,
  };
};
