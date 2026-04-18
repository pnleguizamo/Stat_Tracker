import { CSSProperties, FC, useState } from "react";
import { socket } from "socket";
import { GameState, HigherLowerRoundState } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
};

const SIDE_ACCENT = {
  LEFT:  { color: "#22d3ee", dimBg: "rgba(34, 211, 238, 0.08)",  dimBorder: "rgba(34, 211, 238, 0.28)",  selBg: "rgba(6,  78,  90,  0.92)", selBorder: "rgba(34, 211, 238, 0.75)" },
  RIGHT: { color: "#facc15", dimBg: "rgba(250, 204, 21, 0.08)", dimBorder: "rgba(250, 204, 21, 0.28)", selBg: "rgba(78, 40,  6,   0.92)", selBorder: "rgba(250, 204, 21, 0.75)" },
} as const;

export const HigherLowerPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState?.minigameId === "HIGHER_LOWER"
      ? (gameState.currentRoundState as HigherLowerRoundState)
      : null;

  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myChoice = round?.answers?.[myPlayerId]?.answer?.choice ?? null;
  const totalPoints = gameState.scoreboard?.[myPlayerId]?.points ?? 0;

  if (!round) {
    return <div style={{ color: "#94a3b8", fontSize: 14 }}>Waiting for the host to start Higher / Lower…</div>;
  }

  const isRevealed = round.status === "revealed";
  const isResultsShown = isRevealed && gameState.revealPhase === "postReveal";
  const winnerSide = round.results?.winnerSide;
  const isCorrect = isResultsShown && !!myChoice && (winnerSide === "TIE" || myChoice === winnerSide);
  const isWrong = isResultsShown && !!myChoice && !isCorrect;

  const handleVote = (choice: "LEFT" | "RIGHT") => {
    if (!roomCode || isRevealed) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:HIGHER_LOWER:submitAnswer",
      { roomCode, answer: { choice } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || "Failed to submit answer");
      }
    );
  };

  const disabled = voteBusy || isRevealed;

  return (
    <div style={{ display: "grid", gap: 16, fontFamily: '"Space Grotesk", "IBM Plex Sans", sans-serif', color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#475569", padding: "0 2px" }}>
        <span>Round {round.roundNumber} / {round.maxRounds}</span>
        <span style={{ fontWeight: 700, color: "#64748b" }}>{totalPoints} pts</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {(["LEFT", "RIGHT"] as const).map((side) => {
          const isSelected = myChoice === side;
          const isThisCorrect = isResultsShown && isSelected && isCorrect;
          const isThisWrong = isResultsShown && isSelected && isWrong;
          const ac = SIDE_ACCENT[side];
          return (
            <button
              key={side}
              onClick={() => handleVote(side)}
              disabled={disabled}
              style={btnStyle({ side, selected: isSelected, correct: isThisCorrect, wrong: isThisWrong, disabled })}
            >
              <span style={{
                fontSize: 38,
                lineHeight: 1,
                color: isThisCorrect ? "#86efac" : isThisWrong ? "#fca5a5" : isSelected ? "#f8fafc" : ac.color,
                transition: "color 180ms",
              }}>
                {isThisCorrect ? "✓" : isThisWrong ? "✕" : side === "LEFT" ? "←" : "→"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85 }}>
                {side === "LEFT" ? "Left" : "Right"}
              </span>
              {isSelected && !isResultsShown && (
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: ac.color, opacity: 0.9 }}>
                  your pick
                </span>
              )}
            </button>
          );
        })}
      </div>

      {voteError && <div style={{ color: "#fda4af", fontSize: 13, textAlign: "center" }}>{voteError}</div>}
    </div>
  );
};

function btnStyle({ side, selected, correct, wrong, disabled }: {
  side: "LEFT" | "RIGHT";
  selected: boolean;
  correct: boolean;
  wrong: boolean;
  disabled: boolean;
}): CSSProperties {
  const ac = SIDE_ACCENT[side];
  return {
    background: correct
      ? "linear-gradient(160deg, rgba(17,94,89,0.95), rgba(6,60,48,0.97))"
      : wrong
      ? "linear-gradient(160deg, rgba(127,29,29,0.92), rgba(69,10,10,0.95))"
      : selected
      ? ac.selBg
      : ac.dimBg,
    border: correct
      ? "1.5px solid rgba(74,222,128,0.55)"
      : wrong
      ? "1.5px solid rgba(248,113,113,0.45)"
      : selected
      ? `1.5px solid ${ac.selBorder}`
      : `1.5px solid ${ac.dimBorder}`,
    borderRadius: 24,
    color: "#f8fafc",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled && !selected && !correct && !wrong ? 0.45 : 1,
    transition: "all 180ms ease",
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "0",
    minHeight: "clamp(140px, 42vw, 200px)",
    boxShadow: selected && !correct && !wrong
      ? `0 0 0 1px ${ac.selBorder}, 0 8px 28px rgba(0,0,0,0.35)`
      : correct
      ? "0 0 0 1px rgba(74,222,128,0.2), 0 8px 28px rgba(0,0,0,0.35)"
      : wrong
      ? "0 0 0 1px rgba(248,113,113,0.2), 0 8px 28px rgba(0,0,0,0.35)"
      : "0 4px 16px rgba(0,0,0,0.2)",
    WebkitTapHighlightColor: "transparent",
  };
}
