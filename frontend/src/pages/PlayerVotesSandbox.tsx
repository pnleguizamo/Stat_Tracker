import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useVoteTally } from "game/hooks/useVoteTally";
import { PlayerVotes } from "game/host/minigames/components/PlayerVotes";
import { useMemo, useState } from "react";
import { Player } from "types/game";

type RoundStatus = "collecting" | "revealed";

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
  const hue = (seed * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 80%, 56%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 35) % 360}, 75%, 42%)"/>
      </linearGradient>
    </defs>
    <rect width="80" height="80" rx="20" fill="url(#g)"/>
    <text x="40" y="49" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return toDataUri(svg);
};

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#cbd5e1",
} as const;

const sectionStyle = {
  border: "1px solid #334155",
  borderRadius: 12,
  padding: "0.85rem",
  background: "#111827",
} as const;

export default function PlayerVotesSandbox() {
  const [status, setStatus] = useState<RoundStatus>("revealed");
  const [playerCount, setPlayerCount] = useState(6);
  const [avatarPlayerCount, setAvatarPlayerCount] = useState(6);
  const [targetPoolSize, setTargetPoolSize] = useState(3);
  const [concentrationPct, setConcentrationPct] = useState(55);
  const [delayMs, setDelayMs] = useState(400);
  const [durationMs, setDurationMs] = useState(2500);
  const [maxIntervalMs, setMaxIntervalMs] = useState(750);
  const [completionDelayMs, setCompletionDelayMs] = useState(1000);
  const [showListenCounts, setShowListenCounts] = useState(true);
  const [showSubmissionChecks, setShowSubmissionChecks] = useState(true);
  const [seed, setSeed] = useState(1);

  const safePlayerCount = clamp(playerCount, 2, 16);
  const safeAvatarPlayerCount = clamp(avatarPlayerCount, 0, safePlayerCount);
  const safeTargetPoolSize = clamp(targetPoolSize, 1, safePlayerCount);
  const safeConcentration = clamp(concentrationPct, 0, 100);
  const safeDelayMs = clamp(delayMs, 0, 2000);
  const safeDurationMs = clamp(durationMs, 250, 8000);
  const safeMaxIntervalMs = clamp(maxIntervalMs, 40, 2000);
  const safeCompletionDelayMs = clamp(completionDelayMs, 0, 2000);

  const players = useMemo<Player[]>(() => {
    return Array.from({ length: safePlayerCount }, (_, idx) => {
      const playerNumber = idx + 1;
      const label = `P${playerNumber}`;
      const initials = label.slice(0, 2).toUpperCase();
      return {
        playerId: `player-${playerNumber}`,
        userId: `user-${playerNumber}`,
        name: label,
        displayName: label,
        avatar:
          idx < safeAvatarPlayerCount
            ? makeAvatarDataUri(playerNumber + seed * 31, initials)
            : null,
      };
    });
  }, [safeAvatarPlayerCount, safePlayerCount, seed]);

  const answers = useMemo(() => {
    const random = mulberry32(seed * 3181 + safePlayerCount * 17 + safeTargetPoolSize * 13);
    const playerIds = players.map((player) => player.playerId);
    const votingOrder = shuffle(playerIds, random);
    const eligibleTargets = shuffle(playerIds, random).slice(0, safeTargetPoolSize);
    const answerMap: Record<string, { answer: { targetPlayerId: string }; at: number }> = {};
    const now = Date.now();

    // Game-like constraint: every player casts exactly one vote.
    votingOrder.forEach((voterPlayerId, index) => {
      const shouldFocusTop =
        eligibleTargets.length > 1 && random() < safeConcentration / 100;
      const targetPlayerId = shouldFocusTop
        ? eligibleTargets[0]
        : eligibleTargets[Math.floor(random() * eligibleTargets.length)];

      answerMap[voterPlayerId] = {
        answer: { targetPlayerId },
        at: now + index * 100 + Math.floor(random() * 30),
      };
    });

    return answerMap;
  }, [players, safeConcentration, safePlayerCount, safeTargetPoolSize, seed]);

  const { voteEntries, finalTally, totalVotes } = useVoteTally({
    players,
    answers,
  });

  const { revealProgress, revealComplete, revealedVoteMap, revealedTally } = useVoteReveal({
    status,
    voteEntries,
    totalVotes,
    delayMs: safeDelayMs,
    durationMs: safeDurationMs,
    maxIntervalMs: safeMaxIntervalMs,
    completionDelayMs: safeCompletionDelayMs,
  });

  const listenCounts = useMemo(() => {
    const random = mulberry32(seed * 353 + 11);
    const counts: Record<string, number> = {};
    players.forEach((player) => {
      if (!player.userId) return;
      counts[player.userId] = Math.floor(random() * 1200);
    });
    return counts;
  }, [players, seed]);

  const topSocketIds = useMemo(() => {
    if (status !== "revealed") return undefined;
    const maxListen = players.reduce((max, player) => {
      if (!player.userId) return max;
      return Math.max(max, listenCounts[player.userId] || 0);
    }, 0);
    return players
      .filter((player) => player.userId && (listenCounts[player.userId] || 0) === maxListen)
      .map((player) => player.playerId);
  }, [listenCounts, players, status]);

  const submittedSocketIds = useMemo(
    () => players.map((player) => player.playerId),
    [players]
  );

  const replayReveal = () => {
    setStatus("collecting");
    window.setTimeout(() => setStatus("revealed"), 40);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e2e8f0",
        padding: "1rem",
      }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Player Votes Sandbox</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Uses WLM-style reveal flow with one vote per player. Adjust distribution
          and timing to tune bar/avatar animation.
        </p>

        <div
          style={{
            ...sectionStyle,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: 12,
          }}
        >
          <label style={labelStyle}>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as RoundStatus)}
            >
              <option value="collecting">collecting</option>
              <option value="revealed">revealed</option>
            </select>
          </label>

          <label style={labelStyle}>
            Players: {safePlayerCount}
            <input
              type="range"
              min={2}
              max={16}
              value={safePlayerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Players with avatars: {safeAvatarPlayerCount}
            <input
              type="range"
              min={0}
              max={safePlayerCount}
              value={safeAvatarPlayerCount}
              onChange={(event) => setAvatarPlayerCount(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Eligible vote targets: {safeTargetPoolSize}
            <input
              type="range"
              min={1}
              max={safePlayerCount}
              value={safeTargetPoolSize}
              onChange={(event) => setTargetPoolSize(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Concentration on top target: {safeConcentration}%
            <input
              type="range"
              min={0}
              max={100}
              value={safeConcentration}
              onChange={(event) => setConcentrationPct(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Reveal start delay: {safeDelayMs}ms
            <input
              type="range"
              min={0}
              max={2000}
              value={safeDelayMs}
              onChange={(event) => setDelayMs(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Reveal duration: {safeDurationMs}ms
            <input
              type="range"
              min={250}
              max={8000}
              value={safeDurationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Max interval per vote: {safeMaxIntervalMs}ms
            <input
              type="range"
              min={40}
              max={2000}
              value={safeMaxIntervalMs}
              onChange={(event) => setMaxIntervalMs(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Completion delay: {safeCompletionDelayMs}ms
            <input
              type="range"
              min={0}
              max={2000}
              value={safeCompletionDelayMs}
              onChange={(event) =>
                setCompletionDelayMs(Number(event.target.value))
              }
            />
          </label>

          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showListenCounts}
              onChange={(event) => setShowListenCounts(event.target.checked)}
            />
            Show listen counts
          </label>

          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={showSubmissionChecks}
              onChange={(event) => setShowSubmissionChecks(event.target.checked)}
            />
            Show submission checks
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setSeed((prev) => prev + 1)}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Randomize Votes
            </button>
            <button
              type="button"
              onClick={replayReveal}
              style={{ padding: "0.5rem 0.8rem", cursor: "pointer" }}
            >
              Replay Reveal
            </button>
          </div>
        </div>

        <div
          style={{
            ...sectionStyle,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            color: "#93c5fd",
            fontSize: 13,
          }}
        >
          <div>Total players: {safePlayerCount}</div>
          <div>Total votes (1 each): {totalVotes}</div>
          <div>
            Reveal progress: {revealProgress} / {totalVotes}
          </div>
          <div>Reveal complete: {String(revealComplete)}</div>
        </div>

        <div style={sectionStyle}>
          <PlayerVotes
            status={status}
            players={players}
            finalTally={finalTally}
            revealedTally={revealedTally}
            revealedVoteMap={revealedVoteMap}
            revealComplete={revealComplete}
            topSocketIds={topSocketIds}
            listenCounts={listenCounts}
            showListenCounts={showListenCounts}
            submittedSocketIds={submittedSocketIds}
            showSubmissionChecks={showSubmissionChecks}
          />
        </div>
      </div>
    </div>
  );
}
