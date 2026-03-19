import { CSSProperties, FC, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, HigherLowerDatapoint, HigherLowerRoundState, ScoreAward } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
};

const TIMEFRAME_LABELS: Record<string, string> = {
  last7: "Last 7",
  last30: "Last 30",
  last90: "Last 90",
  last180: "Last 180",
  ytd: "YTD",
  allTime: "All Time",
};

function formatMetricLabel(metric?: string | null) {
  return metric === "minutes" ? "minutes" : "plays";
}

function formatMetricTitle(metric?: string | null) {
  return metric === "minutes" ? "Minutes" : "Plays";
}

function formatTimeframeLabel(timeframe?: string | null) {
  if (!timeframe) return "Window";
  if (TIMEFRAME_LABELS[timeframe]) return TIMEFRAME_LABELS[timeframe];
  if (/^year\d{4}$/.test(timeframe)) return timeframe.replace("year", "");
  return timeframe;
}

function formatScopeLabel(scope?: string | null) {
  return scope === "ROOM" ? "Whole Room" : "Player";
}

function formatDisplayValue(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "?";
  return new Intl.NumberFormat().format(value);
}

function artFallbackLabel(datapoint?: HigherLowerDatapoint | null) {
  if (!datapoint?.entityType) return "STAT";
  if (datapoint.entityType === "TOTAL") return "Σ";
  return datapoint.entityType.slice(0, 3);
}

function cardStyle({
  selected,
  correct,
  wrong,
  disabled,
}: {
  selected: boolean;
  correct: boolean;
  wrong: boolean;
  disabled: boolean;
}): CSSProperties {
  return {
    borderRadius: 20,
    border: correct
      ? "1px solid rgba(74, 222, 128, 0.65)"
      : wrong
      ? "1px solid rgba(248, 113, 113, 0.55)"
      : selected
      ? "1px solid rgba(251, 191, 36, 0.75)"
      : "1px solid rgba(148, 163, 184, 0.18)",
    background: correct
      ? "linear-gradient(160deg, rgba(17, 94, 89, 0.92), rgba(6, 78, 59, 0.94))"
      : wrong
      ? "linear-gradient(160deg, rgba(127, 29, 29, 0.88), rgba(69, 10, 10, 0.92))"
      : selected
      ? "linear-gradient(160deg, rgba(120, 53, 15, 0.84), rgba(68, 28, 7, 0.9))"
      : "linear-gradient(160deg, rgba(15, 23, 42, 0.96), rgba(8, 15, 32, 0.98))",
    color: "#f8fafc",
    padding: "1rem",
    display: "grid",
    gap: 10,
    textAlign: "left",
    opacity: disabled && !correct && !wrong ? 0.82 : 1,
    boxShadow: selected
      ? "0 0 0 1px rgba(251, 191, 36, 0.12), 0 18px 42px rgba(15, 23, 42, 0.28)"
      : "0 12px 32px rgba(2, 6, 23, 0.24)",
    transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease",
  };
}

const DatapointArt: FC<{ datapoint: HigherLowerDatapoint }> = ({ datapoint }) => {
  if (datapoint.imageUrl) {
    return (
      <img
        src={datapoint.imageUrl}
        alt={datapoint.title}
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 16,
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(circle at 28% 22%, rgba(250, 204, 21, 0.34), rgba(15, 23, 42, 0.96))",
        border: "1px solid rgba(250, 204, 21, 0.22)",
        color: "#fde68a",
        fontWeight: 800,
        letterSpacing: 1,
      }}
    >
      {artFallbackLabel(datapoint)}
    </div>
  );
};

export const HigherLowerPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "HIGHER_LOWER"
      ? (gameState.currentRoundState as HigherLowerRoundState)
      : null;
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myChoice = round?.answers?.[myPlayerId]?.answer?.choice ?? null;
  const myAwards = useMemo(
    () => (gameState.scoreboard?.[myPlayerId]?.awards || []) as ScoreAward[],
    [gameState.scoreboard, myPlayerId]
  );

  const roundPoints = useMemo(
    () =>
      myAwards
        .filter((award) => award.meta?.roundId === round?.id)
        .reduce((sum, award) => sum + (award.points || 0), 0),
    [myAwards, round?.id]
  );

  if (!round) {
    return <div>Waiting for the host to start Higher / Lower…</div>;
  }

  const isRevealed = round.status === "revealed";
  const winnerSide = round.results?.winnerSide;
  const isTie = winnerSide === "TIE";
  const isCorrect =
    isRevealed &&
    !!myChoice &&
    (winnerSide === "TIE" || myChoice === winnerSide);
  const leftCorrect = isRevealed && (winnerSide === "LEFT" || winnerSide === "TIE");
  const rightCorrect = isRevealed && (winnerSide === "RIGHT" || winnerSide === "TIE");

  const leftDisplayValue =
    isRevealed
      ? round.results?.leftDisplayValue ?? round.left.displayValue
      : round.roundNumber > 1
      ? round.left.displayValue
      : null;
  const rightDisplayValue = isRevealed ? round.results?.rightDisplayValue ?? round.right.displayValue : null;

  const handleVote = (choice: "LEFT" | "RIGHT") => {
    if (!roomCode || isRevealed) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:HIGHER_LOWER:submitAnswer",
      { roomCode, answer: { choice } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) {
          setVoteError(resp?.error || "Failed to submit answer");
        }
      }
    );
  };

  const statusText = (() => {
    if (!isRevealed) {
      if (!myChoice) return `Which has more ${formatMetricLabel(round.metric)}?`;
      return "Answer saved. You can still switch before reveal.";
    }
    if (!myChoice) return "Reveal is in.";
    if (isCorrect) return roundPoints > 0 ? `Correct! +${roundPoints}` : "Correct!";
    return "Wrong!";
  })();

  const containerStyle = {
    "--card": "rgba(15, 21, 39, 0.92)",
    "--card-border": "rgba(148, 163, 184, 0.18)",
    "--accent": "#f59e0b",
    "--text": "#e2e8f0",
    "--muted": "#94a3b8",
    fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif',
    color: "var(--text)",
    display: "grid",
    gap: 12,
  } as CSSProperties;

  return (
    <div style={containerStyle}>
      <section
        style={{
          padding: "0.9rem 1rem",
          borderRadius: 18,
          background: "linear-gradient(160deg, rgba(15, 23, 42, 0.96), rgba(7, 13, 28, 0.98))",
          border: "1px solid var(--card-border)",
        }}
      >
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)" }}>
          {formatMetricTitle(round.metric)} · Round {round.roundNumber} of {round.maxRounds}
        </div>
        <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700 }}>
          {statusText}
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          gap: 10,
          alignItems: "stretch",
        }}
      >
        <button
          onClick={() => handleVote("LEFT")}
          disabled={voteBusy || isRevealed}
          style={cardStyle({
            selected: myChoice === "LEFT",
            correct: leftCorrect,
            wrong: isRevealed && myChoice === "LEFT" && !leftCorrect,
            disabled: voteBusy || isRevealed,
          })}
        >
          <DatapointArt datapoint={round.left} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(148, 163, 184, 0.14)" }}>
              {round.left.entityType}
            </span>
            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(148, 163, 184, 0.14)" }}>
              {formatTimeframeLabel(round.left.timeframe)}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.08 }}>{round.left.title}</div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>{round.left.subtitle || "Stat"}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{round.left.ownerLabel || formatScopeLabel(round.left.scope)}</div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
            {formatDisplayValue(leftDisplayValue)}
          </div>
          {isRevealed && myChoice === "LEFT" && (
            <div style={{ fontSize: 12, fontWeight: 700, color: leftCorrect ? "#86efac" : "#fca5a5" }}>
              {leftCorrect ? "Your pick ✓" : "Your pick ✕"}
            </div>
          )}
        </button>

        <div
          style={{
            display: "grid",
            placeItems: "center",
            alignSelf: "center",
            color: "#f8fafc",
            fontWeight: 800,
            letterSpacing: 1,
            padding: "0 2px",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "radial-gradient(circle, rgba(250, 204, 21, 0.36), rgba(15, 23, 42, 0.05) 72%)",
              border: "1px solid rgba(250, 204, 21, 0.2)",
            }}
          >
            VS
          </div>
          {isTie && <div style={{ marginTop: 8, fontSize: 11, color: "#fde68a" }}>Tie</div>}
        </div>

        <button
          onClick={() => handleVote("RIGHT")}
          disabled={voteBusy || isRevealed}
          style={cardStyle({
            selected: myChoice === "RIGHT",
            correct: rightCorrect,
            wrong: isRevealed && myChoice === "RIGHT" && !rightCorrect,
            disabled: voteBusy || isRevealed,
          })}
        >
          <DatapointArt datapoint={round.right} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(148, 163, 184, 0.14)" }}>
              {round.right.entityType}
            </span>
            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "rgba(148, 163, 184, 0.14)" }}>
              {formatTimeframeLabel(round.right.timeframe)}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.08 }}>{round.right.title}</div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>{round.right.subtitle || "Stat"}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{round.right.ownerLabel || formatScopeLabel(round.right.scope)}</div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>
            {formatDisplayValue(rightDisplayValue)}
          </div>
          {isRevealed && myChoice === "RIGHT" && (
            <div style={{ fontSize: 12, fontWeight: 700, color: rightCorrect ? "#86efac" : "#fca5a5" }}>
              {rightCorrect ? "Your pick ✓" : "Your pick ✕"}
            </div>
          )}
        </button>
      </div>

      {round.stageComplete && isRevealed && (
        <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
          Stage complete. Waiting for the host to move on.
        </div>
      )}

      {voteError && <div style={{ color: "#fda4af", fontSize: 13 }}>{voteError}</div>}
    </div>
  );
};
