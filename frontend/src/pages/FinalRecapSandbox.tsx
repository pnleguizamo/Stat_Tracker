import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { FinalRecap } from "game/host/FinalRecap";
import {
  FinalRecap as FinalRecapType,
  MinigameId,
  Player,
  ScoreboardEntry,
  StageConfig,
  StreakEntry,
} from "types/game";

type PresetKey = "balanced" | "crowded" | "edge-cases" | "brainstorm";
type PresetOption = PresetKey | "custom";

type Controls = {
  playerCount: number;
  avatarPlayerCount: number;
  longNamePct: number;
  stageCount: number;
  voteRoundsPerStage: number;
  heardleSongsPerStage: number;
  maxTieSize: number;
  correctVoteRate: number;
};

type SandboxPayload = {
  players: Player[];
  stagePlan: StageConfig[];
  stageRoundHistory: Record<number, unknown[]>;
  scoreboard: Record<string, ScoreboardEntry>;
  streaks: Record<number, Record<string, StreakEntry & { lastRoundId?: string | null }>>;
};

const MINIGAME_ROTATION: MinigameId[] = [
  "WHO_LISTENED_MOST",
  "GUESS_SPOTIFY_WRAPPED",
  "HEARDLE",
];

const HEARDLE_SNIPPET_PLAN = [500, 1000, 3000, 7000, 12000, 17000, 30000];

const PRESETS: Record<PresetKey, Controls> = {
  balanced: {
    playerCount: 8,
    avatarPlayerCount: 6,
    longNamePct: 20,
    stageCount: 3,
    voteRoundsPerStage: 4,
    heardleSongsPerStage: 5,
    maxTieSize: 2,
    correctVoteRate: 58,
  },
  crowded: {
    playerCount: 12,
    avatarPlayerCount: 10,
    longNamePct: 35,
    stageCount: 4,
    voteRoundsPerStage: 5,
    heardleSongsPerStage: 6,
    maxTieSize: 6,
    correctVoteRate: 54,
  },
  "edge-cases": {
    playerCount: 9,
    avatarPlayerCount: 7,
    longNamePct: 25,
    stageCount: 3,
    voteRoundsPerStage: 6,
    heardleSongsPerStage: 6,
    maxTieSize: 4,
    correctVoteRate: 50,
  },
  brainstorm: {
    playerCount: 10,
    avatarPlayerCount: 7,
    longNamePct: 45,
    stageCount: 5,
    voteRoundsPerStage: 5,
    heardleSongsPerStage: 7,
    maxTieSize: 5,
    correctVoteRate: 62,
  },
};

const NAME_BANK = [
  "Nova",
  "Pixel",
  "Echo",
  "Rook",
  "Miso",
  "Luna",
  "Atlas",
  "Rex",
  "Kai",
  "Skye",
  "Blitz",
  "Nyx",
  "Orion",
  "Vibe",
  "Bard",
  "Juno",
  "Quinn",
  "Rae",
  "Sol",
  "Tess",
];

const launcherStyle = {
  position: "fixed",
  top: 16,
  right: 16,
  zIndex: 2600,
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "0.65rem 0.85rem",
  borderRadius: 999,
  background: "rgba(2, 6, 23, 0.86)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 14px 32px rgba(2, 6, 23, 0.35)",
  color: "#e2e8f0",
  backdropFilter: "blur(12px)",
} as const;

const panelStyle = {
  position: "fixed",
  top: 72,
  right: 16,
  zIndex: 2600,
  width: "min(380px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto",
  borderRadius: 18,
  padding: "1rem",
  background: "rgba(2, 6, 23, 0.9)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 18px 50px rgba(2, 6, 23, 0.45)",
  color: "#e2e8f0",
  display: "grid",
  gap: 14,
  backdropFilter: "blur(14px)",
} as const;

const buttonStyle = {
  padding: "0.45rem 0.65rem",
  cursor: "pointer",
} as const;

const payloadPreStyle = {
  margin: 0,
  padding: "0.75rem",
  borderRadius: 12,
  background: "rgba(2, 6, 23, 0.78)",
  border: "1px solid rgba(51, 65, 85, 0.8)",
  color: "#cbd5e1",
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 320,
  overflow: "auto",
} as const;

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 12,
  color: "#cbd5e1",
} as const;

const sectionStyle = {
  display: "grid",
  gap: 10,
  padding: "0.8rem",
  borderRadius: 14,
  background: "rgba(15, 23, 42, 0.86)",
  border: "1px solid rgba(51, 65, 85, 0.8)",
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toDataUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const makeAvatarDataUri = (seed: number, label: string) => {
  const hue = (seed * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 82%, 58%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 36) % 360}, 76%, 42%)"/>
      </linearGradient>
    </defs>
    <rect width="80" height="80" rx="20" fill="url(#g)"/>
    <text x="40" y="49" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return toDataUri(svg);
};

const extractPercentages = (text: string) =>
  Array.from(text.matchAll(/(\d+(?:\.\d+)?)%/g), (match) => Number(match[1]));

function addScoreAward(
  scoreboard: Record<string, ScoreboardEntry>,
  playerId: string,
  points: number,
  reason: string,
  meta: Record<string, unknown>
) {
  const current = scoreboard[playerId] || { points: 0, stats: {}, awards: [] };
  current.points = (current.points || 0) + points;
  current.stats = current.stats || {};
  current.stats.totalAwards = ((current.stats.totalAwards as number) || 0) + 1;
  if (reason === "correct") {
    current.stats.correctAnswers = ((current.stats.correctAnswers as number) || 0) + 1;
  }
  current.awards = Array.isArray(current.awards) ? current.awards : [];
  current.awards.push({
    points,
    reason,
    meta,
    at: Date.now(),
  });
  scoreboard[playerId] = current;
}

function pickPlayerSubset(players: Player[], start: number, count: number, exclude = new Set<string>()) {
  const available = players.filter((player) => !exclude.has(player.playerId));
  if (!available.length || count <= 0) return [];

  const max = Math.min(count, available.length);
  return Array.from({ length: max }, (_, offset) => available[(start + offset) % available.length]);
}

function chooseWrongTarget(players: Player[], start: number, forbidden = new Set<string>()) {
  const available = players.filter((player) => !forbidden.has(player.playerId));
  if (!available.length) {
    return players[start % players.length];
  }
  return available[start % available.length];
}

function createScoreboard(players: Player[]) {
  return Object.fromEntries(
    players.map((player) => [
      player.playerId,
      {
        points: 0,
        stats: {},
        awards: [],
      },
    ])
  ) as Record<string, ScoreboardEntry>;
}

function createStageStreaks(
  players: Player[],
  history: unknown[],
  stageIndex: number,
  seed: number
) {
  const stage = Object.fromEntries(
    players.map((player) => [
      player.playerId,
      { current: 0, best: 0, lastRoundId: null as string | null },
    ])
  ) as Record<string, StreakEntry & { lastRoundId?: string | null }>;

  (history as Array<{ id?: string; results?: { winners?: string[] } }>).forEach((round) => {
    const winnerSet = new Set(round?.results?.winners || []);

    players.forEach((player) => {
      const entry = stage[player.playerId];
      entry.lastRoundId = round?.id || null;
      if (winnerSet.has(player.playerId)) {
        entry.current += 1;
        entry.best = Math.max(entry.best, entry.current);
      } else {
        entry.current = 0;
      }
    });
  });

  const best = Math.max(0, ...Object.values(stage).map((entry) => entry.best || 0));
  if (best >= 3 || history.length < 3 || players.length === 0) {
    return stage;
  }

  const spotlightPlayer = players[(seed + stageIndex * 3) % players.length];
  const boostedBest = Math.min(Math.max(3, history.length), 5);
  stage[spotlightPlayer.playerId] = {
    current: boostedBest,
    best: boostedBest,
    lastRoundId:
      ((history[history.length - 1] as { id?: string } | undefined)?.id) || null,
  };

  return stage;
}

function buildWlmHistory(
  players: Player[],
  scoreboard: Record<string, ScoreboardEntry>,
  stageIndex: number,
  roundCount: number,
  maxTieSize: number,
  correctVoteRate: number,
  seed: number
) {
  const history = [];
  const baseNow = Date.now() - 600000;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const roundId = `sandbox-wlm-${stageIndex}-${roundIndex}-${seed}`;
    const startedAt = baseNow + stageIndex * 120000 + roundIndex * 24000;
    const tieSize = Math.min(
      players.length,
      1 + ((seed + stageIndex * 5 + roundIndex * 7) % Math.max(1, maxTieSize))
    );
    const topPlayers = pickPlayerSubset(
      players,
      seed + stageIndex * 3 + roundIndex * 2,
      tieSize
    );
    const topPlayerIds = new Set(topPlayers.map((player) => player.playerId));
    const peakListens = 160 + ((seed * 17 + stageIndex * 19 + roundIndex * 23) % 240);
    const listenCounts: Record<string, number> = {};

    players.forEach((player, playerIndex) => {
      const isTop = topPlayerIds.has(player.playerId);
      const drop = 18 + ((playerIndex * 11 + seed + roundIndex * 7) % 80);
      const listens = isTop ? peakListens : Math.max(6, peakListens - drop);
      if (player.userId) listenCounts[player.userId] = listens;
    });

    const tally: Record<string, number> = {};
    const winners: string[] = [];
    const answers: Record<string, { answer: { targetPlayerId: string }; at: number }> = {};

    players.forEach((voter, voterIndex) => {
      const voteAccuracy = clamp(
        correctVoteRate + (((seed + stageIndex * 13 + roundIndex * 17 + voterIndex * 5) % 41) - 20),
        0,
        100
      );
      const votesCorrect =
        ((seed * 29 + stageIndex * 31 + roundIndex * 17 + voterIndex * 11) % 100) < voteAccuracy;

      const target = votesCorrect
        ? topPlayers[(voterIndex + roundIndex) % topPlayers.length]
        : chooseWrongTarget(players, seed + voterIndex + roundIndex, topPlayerIds);
      const answerAt =
        startedAt +
        900 +
        ((seed * 41 + stageIndex * 61 + roundIndex * 47 + voterIndex * 131) % 9500);

      tally[target.playerId] = (tally[target.playerId] || 0) + 1;
      answers[voter.playerId] = {
        answer: { targetPlayerId: target.playerId },
        at: answerAt,
      };

      if (topPlayerIds.has(target.playerId)) {
        winners.push(voter.playerId);
        addScoreAward(scoreboard, voter.playerId, 420 - roundIndex * 20, "correct", {
          minigameId: "WHO_LISTENED_MOST",
          roundId,
          stageIndex,
        });
      }
    });

    history.push({
      id: roundId,
      startedAt,
      answers,
      prompt: {
        type: roundIndex % 2 === 0 ? "TRACK" : "ARTIST",
        description:
          roundIndex % 2 === 0
            ? `Who listened to Deep Cut ${roundIndex + 1} most?`
            : `Who listened to The Archive ${roundIndex + 1} most?`,
        artist_name: `The Archive ${roundIndex + 1}`,
        track_name: `Deep Cut ${roundIndex + 1}`,
        listenCounts,
      },
      results: {
        tally,
        totalVotes: players.length,
        topListenerSocketIds: Array.from(topPlayerIds),
        listenCounts,
        winners,
      },
    });
  }

  return history;
}

function buildWrappedHistory(
  players: Player[],
  scoreboard: Record<string, ScoreboardEntry>,
  stageIndex: number,
  roundCount: number,
  correctVoteRate: number,
  seed: number
) {
  const history = [];
  const baseNow = Date.now() - 500000;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const roundId = `sandbox-wrapped-${stageIndex}-${roundIndex}-${seed}`;
    const startedAt = baseNow + stageIndex * 150000 + roundIndex * 42000;
    const owner = players[(seed + stageIndex * 7 + roundIndex * 5) % players.length];
    const ownerIndex = players.findIndex((player) => player.playerId === owner.playerId);
    const correctRate = clamp(
      correctVoteRate + (((seed * 9 + stageIndex * 21 + roundIndex * 29) % 121) - 60),
      0,
      100
    );

    const tally: Record<string, number> = {};
    const winners: string[] = [];
    const answers: Record<string, { answer: { targetPlayerId: string }; at: number }> = {};

    players.forEach((voter, voterIndex) => {
      const answerAt =
        startedAt +
        1200 +
        ((seed * 53 + stageIndex * 59 + roundIndex * 43 + voterIndex * 149) % 16000);
      if (voter.playerId === owner.playerId) {
        const decoy = chooseWrongTarget(
          players,
          ownerIndex + voterIndex + 1,
          new Set([owner.playerId])
        );
        tally[decoy.playerId] = (tally[decoy.playerId] || 0) + 1;
        answers[voter.playerId] = {
          answer: { targetPlayerId: decoy.playerId },
          at: answerAt,
        };
        return;
      }

      const guessesCorrect =
        ((seed * 37 + stageIndex * 23 + roundIndex * 17 + voterIndex * 13) % 100) < correctRate;
      const target = guessesCorrect
        ? owner
        : chooseWrongTarget(
            players,
            seed + ownerIndex + voterIndex + roundIndex,
            new Set([owner.playerId])
          );

      tally[target.playerId] = (tally[target.playerId] || 0) + 1;
      answers[voter.playerId] = {
        answer: { targetPlayerId: target.playerId },
        at: answerAt,
      };

      if (target.playerId === owner.playerId) {
        winners.push(voter.playerId);
        addScoreAward(scoreboard, voter.playerId, 560 - roundIndex * 30, "correct", {
          minigameId: "GUESS_SPOTIFY_WRAPPED",
          roundId,
          stageIndex,
        });
      }
    });

    history.push({
      id: roundId,
      startedAt,
      answers,
      ownerPlayerId: owner.playerId,
      ownerProfile: {
        playerId: owner.playerId,
        displayName: owner.displayName || owner.name || "Player",
        avatar: owner.avatar || null,
      },
      prompt: {
        year: 2020 + ((stageIndex + roundIndex) % 5),
        minutesListened: 42000 + ((seed * 311 + stageIndex * 7200 + roundIndex * 5400) % 98000),
        topGenres: [
          { genre: "indie sleaze", plays: 210 + roundIndex * 11 },
          { genre: "drum and bass", plays: 170 + stageIndex * 9 },
        ],
        topArtists: [
          {
            name: `Artist ${roundIndex + 1}`,
            playCount: 90 + roundIndex * 8,
          },
        ],
      },
      results: {
        votes: tally,
        ownerPlayerId: owner.playerId,
        ownerProfile: {
          playerId: owner.playerId,
          displayName: owner.displayName || owner.name || "Player",
          avatar: owner.avatar || null,
        },
        winners,
      },
    });
  }

  return history;
}

function buildHeardleHistory(
  players: Player[],
  scoreboard: Record<string, ScoreboardEntry>,
  stageIndex: number,
  songCount: number,
  correctVoteRate: number,
  seed: number
) {
  const history = [];

  for (let roundIndex = 0; roundIndex < songCount; roundIndex += 1) {
    const roundId = `sandbox-heardle-${stageIndex}-${roundIndex}-${seed}`;
    const guessSummary: Record<string, Record<string, unknown>> = {};
    let winners: string[] = [];

    players.forEach((player, playerIndex) => {
      const correctRate = clamp(
        correctVoteRate + (((seed + stageIndex * 17 + roundIndex * 19 + playerIndex * 7) % 51) - 25),
        5,
        95
      );
      const solved =
        ((seed * 41 + stageIndex * 29 + roundIndex * 23 + playerIndex * 17) % 100) < correctRate;

      if (solved) {
        const snippetIndex =
          (seed + stageIndex * 13 + roundIndex * 11 + playerIndex * 5) % HEARDLE_SNIPPET_PLAN.length;
        winners.push(player.playerId);
        guessSummary[player.playerId] = {
          outcome: "correct",
          snippetIndex,
          at: Date.now(),
        };
        addScoreAward(scoreboard, player.playerId, 1200 - snippetIndex * 120, "correct", {
          minigameId: "HEARDLE",
          roundId,
          stageIndex,
          snippetIndex,
        });
      } else {
        const outcomeCycle = ["wrong", "artist_match", "album_match", "gave_up"] as const;
        guessSummary[player.playerId] = {
          outcome: outcomeCycle[(playerIndex + roundIndex + stageIndex) % outcomeCycle.length],
          at: Date.now(),
        };
      }
    });

    if (winners.length === 0) {
      const fallbackWinner = players[(seed + roundIndex + stageIndex) % players.length];
      const fallbackSnippet = (seed + roundIndex) % HEARDLE_SNIPPET_PLAN.length;
      winners = [fallbackWinner.playerId];
      guessSummary[fallbackWinner.playerId] = {
        outcome: "correct",
        snippetIndex: fallbackSnippet,
        at: Date.now(),
      };
      addScoreAward(scoreboard, fallbackWinner.playerId, 1200 - fallbackSnippet * 120, "correct", {
        minigameId: "HEARDLE",
        roundId,
        stageIndex,
        snippetIndex: fallbackSnippet,
      });
    }

    history.push({
      id: roundId,
      song: {
        track_name: `Heardle Track ${roundIndex + 1}`,
        artist_names: [`Artist ${stageIndex + 1}`, `Feature ${roundIndex + 1}`],
      },
      results: {
        winners,
        guessSummary,
        song: {
          track_name: `Heardle Track ${roundIndex + 1}`,
          artist_names: [`Artist ${stageIndex + 1}`, `Feature ${roundIndex + 1}`],
        },
        snippetPlan: HEARDLE_SNIPPET_PLAN,
        stageProgress: {
          songNumber: roundIndex + 1,
          songsPerGame: songCount,
        },
      },
    });
  }

  return history;
}

export default function FinalRecapSandbox() {
  const [preset, setPreset] = useState<PresetOption>("balanced");
  const [controls, setControls] = useState<Controls>(PRESETS.balanced);
  const [seed, setSeed] = useState(1);
  const [recap, setRecap] = useState<FinalRecapType>({ stages: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const setControl = <K extends keyof Controls,>(key: K, value: Controls[K]) => {
    setPreset("custom");
    setControls((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (nextPreset: PresetKey) => {
    setPreset(nextPreset);
    setControls(PRESETS[nextPreset]);
  };

  const safePlayerCount = clamp(controls.playerCount, 2, 20);
  const safeAvatarPlayerCount = clamp(controls.avatarPlayerCount, 0, safePlayerCount);
  const safeLongNamePct = clamp(controls.longNamePct, 0, 100);
  const safeStageCount = clamp(controls.stageCount, 1, 6);
  const safeVoteRoundsPerStage = clamp(controls.voteRoundsPerStage, 1, 8);
  const safeHeardleSongsPerStage = clamp(controls.heardleSongsPerStage, 1, 10);
  const safeMaxTieSize = clamp(controls.maxTieSize, 1, safePlayerCount);
  const safeCorrectVoteRate = clamp(controls.correctVoteRate, 0, 100);

  const players = useMemo<Player[]>(() => {
    return Array.from({ length: safePlayerCount }, (_, index) => {
      const baseName = NAME_BANK[(index + seed) % NAME_BANK.length];
      const shouldUseLongName =
        ((index * 37 + seed * 19) % 100) < safeLongNamePct;
      const displayName = shouldUseLongName
        ? `${baseName} Deep Cut Archivist ${index + 1}`
        : `${baseName} ${index + 1}`;
      const initials = displayName
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();

      return {
        playerId: `player-${index + 1}`,
        userId: `user-${index + 1}`,
        name: displayName,
        displayName,
        avatar:
          index < safeAvatarPlayerCount
            ? makeAvatarDataUri(seed * 41 + index * 17 + 1, initials || "P")
            : null,
      };
    });
  }, [safeAvatarPlayerCount, safeLongNamePct, safePlayerCount, seed]);

  const sandboxPayload = useMemo<SandboxPayload>(() => {
    const scoreboard = createScoreboard(players);
    const stagePlan = Array.from({ length: safeStageCount }, (_, stageIndex) => ({
      index: stageIndex,
      minigameId: MINIGAME_ROTATION[stageIndex % MINIGAME_ROTATION.length],
    }));
    const stageRoundHistory: Record<number, unknown[]> = {};
    const streaks: Record<number, Record<string, StreakEntry & { lastRoundId?: string | null }>> =
      {};

    stagePlan.forEach((stage) => {
      if (stage.minigameId === "WHO_LISTENED_MOST") {
        stageRoundHistory[stage.index] = buildWlmHistory(
          players,
          scoreboard,
          stage.index,
          safeVoteRoundsPerStage,
          safeMaxTieSize,
          safeCorrectVoteRate,
          seed
        );
        streaks[stage.index] = createStageStreaks(
          players,
          stageRoundHistory[stage.index],
          stage.index,
          seed
        );
        return;
      }

      if (stage.minigameId === "GUESS_SPOTIFY_WRAPPED") {
        stageRoundHistory[stage.index] = buildWrappedHistory(
          players,
          scoreboard,
          stage.index,
          safeVoteRoundsPerStage,
          safeCorrectVoteRate,
          seed
        );
        streaks[stage.index] = createStageStreaks(
          players,
          stageRoundHistory[stage.index],
          stage.index,
          seed
        );
        return;
      }

      if (stage.minigameId === "HEARDLE") {
        stageRoundHistory[stage.index] = buildHeardleHistory(
          players,
          scoreboard,
          stage.index,
          safeHeardleSongsPerStage,
          safeCorrectVoteRate,
          seed
        );
        streaks[stage.index] = createStageStreaks(
          players,
          stageRoundHistory[stage.index],
          stage.index,
          seed
        );
        return;
      }

      stageRoundHistory[stage.index] = [];
      streaks[stage.index] = createStageStreaks(players, [], stage.index, seed);
    });

    return {
      players,
      stagePlan,
      stageRoundHistory,
      scoreboard,
      streaks,
    };
  }, [
    players,
    safeCorrectVoteRate,
    safeHeardleSongsPerStage,
    safeMaxTieSize,
    safeStageCount,
    safeVoteRoundsPerStage,
    seed,
  ]);

  useEffect(() => {
    let cancelled = false;

    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.post("/api/dev/final-recap-sandbox", sandboxPayload, {
          timeout: 15000,
        });

        if (cancelled) return;
        setRecap(response?.finalRecap || { stages: [] });
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.body?.error || err?.message || "Failed to build recap from backend");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sandboxPayload]);

  const metrics = useMemo(() => {
    const awards = recap.stages.flatMap((stage) => stage.awards);
    const percentages = awards.flatMap((award) => extractPercentages(award.description));
    const crowdedAwards = awards.filter((award) => award.featuredPlayers.length > 4);
    const over100Awards = awards.filter((award) =>
      extractPercentages(award.description).some((value) => value > 100)
    );

    return {
      totalAwards: awards.length,
      stageCount: recap.stages.length,
      crowdedAwards: crowdedAwards.length,
      over100Awards: over100Awards.length,
      maxFeaturedPlayers: awards.reduce(
        (max, award) => Math.max(max, award.featuredPlayers.length),
        0
      ),
      highestPercent: percentages.length ? Math.max(...percentages) : null,
    };
  }, [recap]);

  const inputStats = useMemo(() => {
    const counts = {
      WHO_LISTENED_MOST: 0,
      GUESS_SPOTIFY_WRAPPED: 0,
      HEARDLE: 0,
    };

    sandboxPayload.stagePlan.forEach((stage) => {
      const rounds = sandboxPayload.stageRoundHistory[stage.index]?.length || 0;
      if (stage.minigameId === "WHO_LISTENED_MOST") counts.WHO_LISTENED_MOST += rounds;
      if (stage.minigameId === "GUESS_SPOTIFY_WRAPPED") counts.GUESS_SPOTIFY_WRAPPED += rounds;
      if (stage.minigameId === "HEARDLE") counts.HEARDLE += rounds;
    });

    const totalCorrectAwards = Object.values(sandboxPayload.scoreboard).reduce(
      (sum, entry) =>
        sum +
        (entry.awards || []).filter((award) => award.reason === "correct").length,
      0
    );

    return {
      counts,
      totalCorrectAwards,
    };
  }, [sandboxPayload]);

  const payloadPreview = useMemo(
    () => JSON.stringify(sandboxPayload, null, 2),
    [sandboxPayload]
  );

  return (
    <>
      <FinalRecap
        recap={recap}
        players={players}
        scoreboard={sandboxPayload.scoreboard}
        // revealAllAtOnce
        showLeaderboardAtEnd
        leaderboardDelayMs={1500}
        maxPlayersPerAward={2}
      />

      <div style={launcherStyle}>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {loading ? "building..." : error ? "error" : `${metrics.totalAwards} awards`}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((current) => !current)}
          style={buttonStyle}
        >
          {panelOpen ? "Hide Sandbox" : "Show Sandbox"}
        </button>
      </div>

      {panelOpen ? (
        <div style={panelStyle}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>Final Recap Sandbox</h1>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                style={buttonStyle}
              >
                Close
              </button>
            </div>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, lineHeight: 1.45 }}>
              Generates fake round history and scoreboard data, then posts it to the backend so
              the awards come from the real `computeStageRecap` path.
            </p>
          </div>

          <div style={sectionStyle}>
            <label style={labelStyle}>
              Preset
              <select
                value={preset}
                onChange={(event) => {
                  const value = event.target.value as PresetOption;
                  if (value === "custom") {
                    setPreset("custom");
                    return;
                  }
                  applyPreset(value);
                }}
              >
                <option value="balanced">balanced</option>
                <option value="crowded">crowded</option>
                <option value="edge-cases">edge-cases</option>
                <option value="brainstorm">brainstorm</option>
                <option value="custom">custom</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["balanced", "crowded", "edge-cases", "brainstorm"] as PresetKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  style={buttonStyle}
                >
                  {key}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSeed((current) => current + 1)}
                style={buttonStyle}
              >
                Randomize
              </button>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#93c5fd" }}>Population</div>

            <label style={labelStyle}>
              Players: {safePlayerCount}
              <input
                type="range"
                min={2}
                max={20}
                value={safePlayerCount}
                onChange={(event) => setControl("playerCount", Number(event.target.value))}
              />
            </label>

            <label style={labelStyle}>
              Players with avatars: {safeAvatarPlayerCount}
              <input
                type="range"
                min={0}
                max={safePlayerCount}
                value={safeAvatarPlayerCount}
                onChange={(event) =>
                  setControl("avatarPlayerCount", Number(event.target.value))
                }
              />
            </label>

            <label style={labelStyle}>
              Long names: {safeLongNamePct}%
              <input
                type="range"
                min={0}
                max={100}
                value={safeLongNamePct}
                onChange={(event) => setControl("longNamePct", Number(event.target.value))}
              />
            </label>

            <label style={labelStyle}>
              Stages: {safeStageCount}
              <input
                type="range"
                min={1}
                max={6}
                value={safeStageCount}
                onChange={(event) => setControl("stageCount", Number(event.target.value))}
              />
            </label>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fca5a5" }}>Sample Data</div>

            <label style={labelStyle}>
              Vote rounds per WLM/Wrapped stage: {safeVoteRoundsPerStage}
              <input
                type="range"
                min={1}
                max={8}
                value={safeVoteRoundsPerStage}
                onChange={(event) =>
                  setControl("voteRoundsPerStage", Number(event.target.value))
                }
              />
            </label>

            <label style={labelStyle}>
              Heardle songs per stage: {safeHeardleSongsPerStage}
              <input
                type="range"
                min={1}
                max={10}
                value={safeHeardleSongsPerStage}
                onChange={(event) =>
                  setControl("heardleSongsPerStage", Number(event.target.value))
                }
              />
            </label>

            <label style={labelStyle}>
              Max top-listener tie size: {safeMaxTieSize}
              <input
                type="range"
                min={1}
                max={safePlayerCount}
                value={safeMaxTieSize}
                onChange={(event) => setControl("maxTieSize", Number(event.target.value))}
              />
            </label>

            <label style={labelStyle}>
              Base correct vote rate: {safeCorrectVoteRate}%
              <input
                type="range"
                min={0}
                max={100}
                value={safeCorrectVoteRate}
                onChange={(event) =>
                  setControl("correctVoteRate", Number(event.target.value))
                }
              />
            </label>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#86efac" }}>Generated Input</div>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div>WLM rounds: {inputStats.counts.WHO_LISTENED_MOST}</div>
              <div>Wrapped rounds: {inputStats.counts.GUESS_SPOTIFY_WRAPPED}</div>
              <div>Heardle songs: {inputStats.counts.HEARDLE}</div>
              <div>Scoreboard correct awards: {inputStats.totalCorrectAwards}</div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fde68a" }}>Backend Output</div>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div>Status: {loading ? "building..." : error ? "error" : "ready"}</div>
              <div>Stages returned: {metrics.stageCount}</div>
              <div>Total awards: {metrics.totalAwards}</div>
              <div>Max people on one award: {metrics.maxFeaturedPlayers}</div>
              <div>Awards with more than 4 people: {metrics.crowdedAwards}</div>
              <div>Awards with over-100% copy: {metrics.over100Awards}</div>
              <div>
                Highest percentage seen:{" "}
                {metrics.highestPercent === null ? "none" : `${metrics.highestPercent}%`}
              </div>
              {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : null}
            </div>
          </div>

          <div style={sectionStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd" }}>
                Raw Payload
              </div>
              <button
                type="button"
                onClick={() => setShowPayload((current) => !current)}
                style={buttonStyle}
              >
                {showPayload ? "Hide JSON" : "Show JSON"}
              </button>
            </div>
            {showPayload ? <pre style={payloadPreStyle}>{payloadPreview}</pre> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
