import { Leaderboard } from "game/host/Leaderboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { Player, ScoreAward, ScoreboardEntry, StreakEntry } from "types/game";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = <T,>(arr: T[], random: () => number) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const toDataUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const makeAvatarDataUri = (seed: number, label: string) => {
  const hue = (seed * 61) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 88%, 60%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 34) % 360}, 76%, 42%)"/>
      </linearGradient>
    </defs>
    <rect width="96" height="96" rx="26" fill="url(#g)"/>
    <text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return toDataUri(svg);
};

const NAMES = [
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
  "Ash",
  "Ivy",
  "Zed",
  "Faye",
];

const ROUND_REASONS = [
  "correct guess",
  "speed bonus",
  "clean sweep",
  "streak bonus",
  "tie breaker",
  "crowd read",
] as const;

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#cbd5e1",
} as const;

const sectionStyle = {
  border: "1px solid rgba(148, 163, 184, 0.2)",
  borderRadius: 14,
  padding: "0.9rem",
  background: "rgba(15, 23, 42, 0.88)",
  boxShadow: "0 14px 36px rgba(2, 6, 23, 0.28)",
} as const;

type SandboxData = {
  players: Player[];
  beforeScoreboard: Record<string, ScoreboardEntry>;
  afterScoreboard: Record<string, ScoreboardEntry>;
  beforeStreaks: Record<string, StreakEntry>;
  afterStreaks: Record<string, StreakEntry>;
  changedPlayerIds: string[];
  leaderBefore: string | null;
  leaderAfter: string | null;
};

const buildRoundAwards = (
  totalPoints: number,
  random: () => number,
  roundId: string
): ScoreAward[] => {
  if (totalPoints <= 0) return [];

  const awardCount = clamp(1 + Math.floor(random() * 3), 1, Math.min(3, totalPoints));
  const awards: ScoreAward[] = [];
  let remaining = totalPoints;

  for (let index = 0; index < awardCount; index += 1) {
    const awardsLeft = awardCount - index;
    const minRemainder = awardsLeft - 1;
    const minForThis = 1;
    const maxForThis = remaining - minRemainder;
    const points =
      awardsLeft === 1
        ? remaining
        : clamp(
            minForThis + Math.floor(random() * Math.max(1, maxForThis - minForThis + 1)),
            minForThis,
            maxForThis
          );

    awards.push({
      points,
      reason: ROUND_REASONS[(Math.floor(random() * 1000) + index) % ROUND_REASONS.length],
      meta: { roundId },
      at: Date.now() + index,
    });
    remaining -= points;
  }

  return awards;
};

const getLeaderName = (
  scoreboard: Record<string, ScoreboardEntry>,
  playersById: Map<string, Player>
) => {
  const leaderId = Object.entries(scoreboard).sort(
    (a, b) => (b[1].points || 0) - (a[1].points || 0)
  )[0]?.[0];

  if (!leaderId) return null;
  return playersById.get(leaderId)?.displayName || playersById.get(leaderId)?.name || leaderId;
};

export default function LeaderboardSandbox() {
  const [controlsOpen, setControlsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [playerCount, setPlayerCount] = useState(8);
  const [playersWithAvatars, setPlayersWithAvatars] = useState(6);
  const [longNamePct, setLongNamePct] = useState(35);
  const [panelWidth, setPanelWidth] = useState(720);
  const [baseGap, setBaseGap] = useState(11);
  const [maxRoundBonus, setMaxRoundBonus] = useState(34);
  const [movers, setMovers] = useState(3);
  const [streakPlayers, setStreakPlayers] = useState(3);
  const [maxStreak, setMaxStreak] = useState(6);
  const [seed, setSeed] = useState(1);
  const [roundVersion, setRoundVersion] = useState(1);
  const [showResolvedRound, setShowResolvedRound] = useState(true);
  const revealTimeoutRef = useRef<number | null>(null);

  const safePlayerCount = clamp(playerCount, 2, 14);
  const safePlayersWithAvatars = clamp(playersWithAvatars, 0, safePlayerCount);
  const safeLongNamePct = clamp(longNamePct, 0, 100);
  const safePanelWidth = clamp(panelWidth, 320, 980);
  const safeBaseGap = clamp(baseGap, 2, 22);
  const safeMaxRoundBonus = clamp(maxRoundBonus, 2, 80);
  const safeMovers = clamp(movers, 1, safePlayerCount);
  const safeStreakPlayers = clamp(streakPlayers, 0, safePlayerCount);
  const safeMaxStreak = clamp(maxStreak, 3, 10);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  const sandboxData = useMemo<SandboxData>(() => {
    const random = mulberry32(
      seed * 1187 +
        safePlayerCount * 73 +
        safeBaseGap * 41 +
        safeMaxRoundBonus * 17 +
        safeMovers * 13
    );
    const roundId = `sandbox-round-${seed}-${roundVersion}`;

    const players = Array.from({ length: safePlayerCount }, (_, index) => {
      const playerNumber = index + 1;
      const baseName = NAMES[(index + seed) % NAMES.length];
      const shouldUseLongName =
        ((index * 31 + seed * 19) % 100) < safeLongNamePct;
      const displayName = shouldUseLongName
        ? `${baseName} Super Groove ${playerNumber}`
        : `${baseName} ${playerNumber}`;
      const initials = displayName
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();

      return {
        playerId: `player-${playerNumber}`,
        userId: `user-${playerNumber}`,
        name: displayName,
        displayName,
        avatar:
          index < safePlayersWithAvatars
            ? makeAvatarDataUri(seed * 97 + playerNumber * 13, initials || "P")
            : null,
      } satisfies Player;
    });

    const playersById = new Map(players.map((player) => [player.playerId, player]));
    const initialOrder = shuffle(
      players.map((player) => player.playerId),
      random
    );

    let runningPoints = 160 + safePlayerCount * 6;
    const basePointsByPlayer: Record<string, number> = {};

    initialOrder.forEach((playerId, index) => {
      if (index > 0) {
        runningPoints -= safeBaseGap + Math.floor(random() * (safeBaseGap + 3));
      }
      basePointsByPlayer[playerId] = Math.max(
        0,
        runningPoints + Math.floor(random() * 5)
      );
    });

    const deltasByPlayer: Record<string, number> = {};
    players.forEach((player) => {
      deltasByPlayer[player.playerId] = Math.floor(random() * 4);
    });

    const moverPool = shuffle(
      initialOrder.slice(Math.floor(initialOrder.length / 2)),
      random
    ).slice(0, safeMovers);

    moverPool.forEach((playerId, index) => {
      const bonusFloor = Math.max(6, safeMaxRoundBonus - index * 6);
      const bonusRange = Math.max(1, Math.floor(safeMaxRoundBonus / 3));
      deltasByPlayer[playerId] += bonusFloor + Math.floor(random() * bonusRange);
    });

    const beforeScoreboard: Record<string, ScoreboardEntry> = {};
    const afterScoreboard: Record<string, ScoreboardEntry> = {};
    const beforeStreaks: Record<string, StreakEntry> = {};
    const afterStreaks: Record<string, StreakEntry> = {};
    const changedPlayerIds: string[] = [];

    players.forEach((player) => {
      const basePoints = basePointsByPlayer[player.playerId] || 0;
      const roundDelta = deltasByPlayer[player.playerId] || 0;

      beforeScoreboard[player.playerId] = {
        points: basePoints,
        awards: [],
      };

      afterScoreboard[player.playerId] = {
        points: basePoints + roundDelta,
        awards: buildRoundAwards(roundDelta, random, roundId),
      };

      if (roundDelta > 0) {
        changedPlayerIds.push(player.playerId);
      }
    });

    const streakCandidates = shuffle(
      [
        ...changedPlayerIds,
        ...players
          .map((player) => player.playerId)
          .filter((playerId) => !changedPlayerIds.includes(playerId)),
      ],
      random
    ).slice(0, safeStreakPlayers);

    players.forEach((player) => {
      const isCandidate = streakCandidates.includes(player.playerId);
      if (!isCandidate) {
        beforeStreaks[player.playerId] = { current: 0, best: Math.floor(random() * 3) };
        afterStreaks[player.playerId] = { current: 0, best: beforeStreaks[player.playerId].best };
        return;
      }

      const current = clamp(
        3 + Math.floor(random() * Math.max(1, safeMaxStreak - 2)),
        3,
        safeMaxStreak
      );
      const beforeCurrent = Math.max(0, current - 1);
      const best = Math.max(current, beforeCurrent + Math.floor(random() * 3));

      beforeStreaks[player.playerId] = {
        current: beforeCurrent,
        best,
      };
      afterStreaks[player.playerId] = {
        current,
        best,
      };
    });

    return {
      players,
      beforeScoreboard,
      afterScoreboard,
      beforeStreaks,
      afterStreaks,
      changedPlayerIds,
      leaderBefore: getLeaderName(beforeScoreboard, playersById),
      leaderAfter: getLeaderName(afterScoreboard, playersById),
    };
  }, [
    roundVersion,
    safeBaseGap,
    safeLongNamePct,
    safeMaxRoundBonus,
    safeMaxStreak,
    safeMovers,
    safePlayerCount,
    safePlayersWithAvatars,
    safeStreakPlayers,
    seed,
  ]);

  const roundId = showResolvedRound ? `sandbox-round-${seed}-${roundVersion}` : null;
  const activeScoreboard = showResolvedRound
    ? sandboxData.afterScoreboard
    : sandboxData.beforeScoreboard;
  const activeStreaks = showResolvedRound
    ? sandboxData.afterStreaks
    : sandboxData.beforeStreaks;

  const replayRound = () => {
    if (revealTimeoutRef.current) {
      window.clearTimeout(revealTimeoutRef.current);
    }

    setIsVisible(true);
    setShowResolvedRound(false);
    setRoundVersion((current) => current + 1);

    revealTimeoutRef.current = window.setTimeout(() => {
      setShowResolvedRound(true);
    }, 80);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 30%), #020617",
        color: "#e2e8f0",
      }}
    >
      <button
        type="button"
        onClick={() => setControlsOpen((current) => !current)}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 3200,
          padding: "0.7rem 0.95rem",
          borderRadius: 999,
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background: "rgba(15, 23, 42, 0.92)",
          color: "#e2e8f0",
          cursor: "pointer",
          boxShadow: "0 14px 36px rgba(2, 6, 23, 0.32)",
        }}
      >
        {controlsOpen ? "Hide Controls" : "Show Controls"}
      </button>

      <div
        style={{
          position: "fixed",
          top: 72,
          right: 16,
          width: "min(360px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflow: "auto",
          display: "grid",
          gap: 12,
          zIndex: 3100,
          opacity: controlsOpen ? 1 : 0,
          pointerEvents: controlsOpen ? "auto" : "none",
          transform: controlsOpen ? "translateX(0)" : "translateX(calc(100% + 24px))",
          transition: "opacity 180ms ease, transform 180ms ease",
        }}
      >
        <div style={sectionStyle}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Leaderboard Sandbox</h1>
          <p style={{ margin: "0.4rem 0 0", color: "#94a3b8", fontSize: 14 }}>
            Workshop ranking motion, score deltas, and copy without running a full host game.
          </p>
        </div>

        <div
          style={{
            ...sectionStyle,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(event) => setIsVisible(event.target.checked)}
            />
            Overlay visible
          </label>

          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(event) => setSoundEnabled(event.target.checked)}
            />
            Sound enabled
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowResolvedRound(false)}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Show Before
            </button>
            <button
              type="button"
              onClick={() => {
                setIsVisible(true);
                setShowResolvedRound(true);
              }}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Show After
            </button>
            <button
              type="button"
              onClick={replayRound}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Replay Round
            </button>
            <button
              type="button"
              onClick={() => {
                setSeed((current) => current + 1);
                setShowResolvedRound(true);
              }}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Randomize
            </button>
          </div>
        </div>

        <div
          style={{
            ...sectionStyle,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <label style={labelStyle}>
            Players: {safePlayerCount}
            <input
              type="range"
              min={2}
              max={14}
              value={safePlayerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Players with avatars: {safePlayersWithAvatars}
            <input
              type="range"
              min={0}
              max={safePlayerCount}
              value={safePlayersWithAvatars}
              onChange={(event) => setPlayersWithAvatars(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Long name frequency: {safeLongNamePct}%
            <input
              type="range"
              min={0}
              max={100}
              value={safeLongNamePct}
              onChange={(event) => setLongNamePct(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Panel width: {safePanelWidth}px
            <input
              type="range"
              min={320}
              max={980}
              step={10}
              value={safePanelWidth}
              onChange={(event) => setPanelWidth(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Base score gap: {safeBaseGap}
            <input
              type="range"
              min={2}
              max={22}
              value={safeBaseGap}
              onChange={(event) => setBaseGap(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Max round bonus: {safeMaxRoundBonus}
            <input
              type="range"
              min={2}
              max={80}
              value={safeMaxRoundBonus}
              onChange={(event) => setMaxRoundBonus(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Movers: {safeMovers}
            <input
              type="range"
              min={1}
              max={safePlayerCount}
              value={safeMovers}
              onChange={(event) => setMovers(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Players on streaks: {safeStreakPlayers}
            <input
              type="range"
              min={0}
              max={safePlayerCount}
              value={safeStreakPlayers}
              onChange={(event) => setStreakPlayers(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Max streak length: {safeMaxStreak}
            <input
              type="range"
              min={3}
              max={10}
              value={safeMaxStreak}
              onChange={(event) => setMaxStreak(Number(event.target.value))}
            />
          </label>
        </div>

        <div
          style={{
            ...sectionStyle,
            display: "grid",
            gap: 6,
            color: "#93c5fd",
            fontSize: 13,
          }}
        >
          <div>State: {showResolvedRound ? "post-round" : "pre-round"}</div>
          <div>Players with score changes: {sandboxData.changedPlayerIds.length}</div>
          <div>
            Active streaks:{" "}
            {
              Object.values(activeStreaks).filter((entry) => (entry.current || 0) >= 3).length
            }
          </div>
          <div>Leader before: {sandboxData.leaderBefore || "n/a"}</div>
          <div>Leader after: {sandboxData.leaderAfter || "n/a"}</div>
        </div>
      </div>

      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            color: "#94a3b8",
            maxWidth: 520,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 18, color: "#e2e8f0", marginBottom: 10 }}>
            Host Overlay Preview
          </div>
          <div>
            Use the floating control panel to swap between pre-round and post-round states,
            replay the animation, and stress the leaderboard with long names or tight score gaps.
          </div>
        </div>
      </div>

      <Leaderboard
        scoreboard={activeScoreboard}
        players={sandboxData.players}
        roundId={roundId}
        isVisible={isVisible}
        onClose={() => setIsVisible(false)}
        soundEnabled={soundEnabled}
        panelWidth={safePanelWidth}
        streaks={activeStreaks}
      />
    </div>
  );
}
