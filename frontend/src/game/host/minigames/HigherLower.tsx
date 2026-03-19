import { CSSProperties, FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoFitScale } from "game/hooks/useAutoFitScale";
import { socket } from "socket";
import { GameState, HigherLowerDatapoint, HigherLowerRoundState } from "types/game";
import {
  HostActionRow,
  HostCard,
  HostChip,
  HostMinigameStack,
  HostStateMessage,
} from "./components/HostMinigamePrimitives";
import "./styles/HigherLower.css";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
  remainingMs: number | null;
};

type RevealAnimationPhase = "idle" | "counting" | "done";

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const TIMEFRAME_LABELS: Record<string, string> = {
  last7: "Last 7",
  last30: "Last 30",
  last90: "Last 90",
  last180: "Last 180",
  ytd: "YTD",
  allTime: "All Time",
};

function formatMetricLabel(metric?: string | null) {
  return metric === "minutes" ? "Minutes" : "Plays";
}

function formatScopeLabel(scope?: string | null) {
  return scope === "ROOM" ? "Whole Room" : "Player";
}

function formatTimeframeLabel(timeframe?: string | null) {
  if (!timeframe) return "Window";
  if (TIMEFRAME_LABELS[timeframe]) return TIMEFRAME_LABELS[timeframe];
  if (/^year\d{4}$/.test(timeframe)) return timeframe.replace("year", "");
  return timeframe;
}

function formatEntityType(entityType?: string | null) {
  if (!entityType) return "Stat";
  return entityType.charAt(0) + entityType.slice(1).toLowerCase();
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

const DatapointArt: FC<{ datapoint: HigherLowerDatapoint; side: "left" | "right" }> = ({
  datapoint,
  side,
}) => {
  if (datapoint.imageUrl) {
    return (
      <img
        src={datapoint.imageUrl}
        alt={datapoint.title}
        className="hl-card-art"
      />
    );
  }

  return (
    <div className={joinClasses("hl-card-art", "hl-card-art--fallback", `hl-card-art--${side}`)}>
      {artFallbackLabel(datapoint)}
    </div>
  );
};

const EqualizerBars: FC<{ urgent?: boolean }> = ({ urgent = false }) => (
  <span className={joinClasses("hl-eq-bars", urgent && "hl-eq-bars--urgent")}>
    {[0.58, 0.96, 0.68, 1, 0.52].map((height, index) => (
      <span
        key={index}
        className="hl-eq-bar"
        style={
          {
            "--hl-eq-max-h": `${Math.round(height * 14)}px`,
            "--hl-eq-speed": `${0.42 + index * 0.11}s`,
            animationDelay: `${index * 0.08}s`,
          } as CSSProperties
        }
      />
    ))}
  </span>
);

export const HigherLowerHost: FC<Props> = ({
  roomCode,
  gameState,
  onAdvance,
  onRevealComplete,
  remainingMs,
}) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "HIGHER_LOWER"
      ? (gameState.currentRoundState as HigherLowerRoundState)
      : null;

  const [actionBusy, setActionBusy] = useState<"start" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealPhase, setRevealPhase] = useState<RevealAnimationPhase>("idle");
  const [animatedValues, setAnimatedValues] = useState<{ left: number | null; right: number | null }>({
    left: null,
    right: null,
  });

  const animationFrameRef = useRef<number | null>(null);
  const nextRoundTimeoutRef = useRef<number | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const busyRef = useRef<"start" | "reveal" | null>(null);
  const revealHandledRoundRef = useRef<string | null>(null);

  const { viewportRef: fitViewportRef, canvasRef: fitCanvasRef } =
    useAutoFitScale({ allowUpscale: false });

  useEffect(() => {
    busyRef.current = actionBusy;
  }, [actionBusy]);

  useEffect(() => {
    roundIdRef.current = round?.id ?? null;
  }, [round?.id]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (nextRoundTimeoutRef.current) {
        window.clearTimeout(nextRoundTimeoutRef.current);
        nextRoundTimeoutRef.current = null;
      }
    };
  }, []);

  const handleStartRound = useCallback(() => {
    if (!roomCode) return;
    if (nextRoundTimeoutRef.current) {
      window.clearTimeout(nextRoundTimeoutRef.current);
      nextRoundTimeoutRef.current = null;
    }
    setActionBusy("start");
    setError(null);
    socket.emit("minigame:HIGHER_LOWER:startRound", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) {
        setError(resp?.error || "Failed to start Higher / Lower");
      }
    });
  }, [roomCode]);

  const handleReveal = useCallback(() => {
    if (!roomCode) return;
    setActionBusy("reveal");
    setError(null);
    socket.emit("minigame:HIGHER_LOWER:reveal", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) {
        setError(resp?.error || "Failed to reveal Higher / Lower");
      }
    });
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode || round || actionBusy === "start" || error) return;
    handleStartRound();
  }, [actionBusy, error, handleStartRound, round, roomCode]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!round) {
      setRevealPhase("idle");
      setAnimatedValues({ left: null, right: null });
      return;
    }

    if (round.status !== "revealed") {
      setRevealPhase(round.stageComplete ? "done" : "idle");
      setAnimatedValues({
        left: round.roundNumber > 1 ? round.left.displayValue ?? null : null,
        right: null,
      });
      return;
    }

    const targetLeft = round.results?.leftDisplayValue ?? round.left.displayValue ?? null;
    const targetRight = round.results?.rightDisplayValue ?? round.right.displayValue ?? null;
    const animateLeft = round.roundNumber === 1;
    const animateRight = true;

    if (targetLeft === null && targetRight === null) {
      setRevealPhase("done");
      setAnimatedValues({ left: null, right: null });
      return;
    }

    setRevealPhase("counting");
    setAnimatedValues({
      left: animateLeft ? 0 : targetLeft,
      right: animateRight ? 0 : targetRight,
    });

    const durationMs = 1500;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);

      setAnimatedValues({
        left:
          targetLeft === null
            ? null
            : animateLeft
            ? Math.round(targetLeft * eased)
            : targetLeft,
        right:
          targetRight === null
            ? null
            : animateRight
            ? Math.round(targetRight * eased)
            : targetRight,
      });

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
        return;
      }

      animationFrameRef.current = null;
      setAnimatedValues({ left: targetLeft, right: targetRight });
      setRevealPhase("done");
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [round]);

  useEffect(() => {
    if (!round || round.status !== "revealed" || revealPhase !== "done") return;
    if (revealHandledRoundRef.current === round.id) return;

    revealHandledRoundRef.current = round.id;
    onRevealComplete(() => {
      if (!roomCode || round.stageComplete) return;
      if (busyRef.current === "start") return;

      if (nextRoundTimeoutRef.current) {
        window.clearTimeout(nextRoundTimeoutRef.current);
        nextRoundTimeoutRef.current = null;
      }

      const revealRoundId = round.id;
      nextRoundTimeoutRef.current = window.setTimeout(() => {
        if (roundIdRef.current !== revealRoundId) return;
        if (busyRef.current === "start") return;
        handleStartRound();
      }, 2500);
    });
  }, [handleStartRound, onRevealComplete, revealPhase, round, roomCode]);

  const liveRemainingMs =
    remainingMs ?? (round?.expiresAt ? Math.max(0, round.expiresAt - Date.now()) : null);
  const timerCritical =
    round?.status === "collecting" &&
    liveRemainingMs !== null &&
    liveRemainingMs > 0 &&
    liveRemainingMs < 5000;

  const statusLabel = useMemo(() => {
    if (!round) return "Pending";
    if (round.stageComplete && round.status !== "collecting") return "Stage Complete";
    if (round.status === "revealed") return "Revealed";
    if (round.status === "collecting") {
      if (liveRemainingMs === null) return "Collecting";
      return `Collecting · ${Math.ceil(liveRemainingMs / 1000)}s`;
    }
    return "Pending";
  }, [liveRemainingMs, round]);

  const winnerSide = round?.results?.winnerSide;
  const isTie = winnerSide === "TIE";
  const leftKnownValue =
    round?.status === "revealed"
      ? animatedValues.left
      : round && round.roundNumber > 1
      ? round.left.displayValue ?? null
      : null;
  const rightKnownValue = round?.status === "revealed" ? animatedValues.right : null;

  if (!round) {
    return (
      <HostStateMessage>
        <p>Loading the first matchup</p>
        {error && <p className="host-minigame-error">{error}</p>}
      </HostStateMessage>
    );
  }

  return (
    <div ref={fitViewportRef} className="hl-fit-viewport">
      <div className="hl-fit-center">
        <div ref={fitCanvasRef} className="hl-fit-canvas">
          <HostMinigameStack className="hl-stack">
            <HostCard padded className="hl-top-card">
              <div className="host-minigame-chip-row">
                <HostChip>{formatMetricLabel(round.metric)}</HostChip>
                <HostChip>Round {Math.max(1, round.roundNumber)} of {round.maxRounds}</HostChip>
                <HostChip
                  className={joinClasses(
                    "hl-status-chip",
                    round.status === "revealed" && "hl-status-chip--revealed",
                    round.status === "collecting" && "hl-status-chip--collecting",
                    timerCritical && "hl-status-chip--urgent",
                    round.stageComplete && round.status !== "collecting" && "hl-status-chip--complete"
                  )}
                >
                  {statusLabel}
                  {round.status === "collecting" && <EqualizerBars urgent={timerCritical} />}
                </HostChip>
              </div>
            </HostCard>

            <div className={joinClasses("hl-versus-row", isTie && "hl-versus-row--tie")}>
              <HostCard
                padded
                className={joinClasses(
                  "hl-card",
                  "hl-card--left",
                  winnerSide === "LEFT" && "hl-card--winner",
                  winnerSide === "RIGHT" && "hl-card--loser"
                )}
              >
                <div className="hl-card-media">
                  <DatapointArt datapoint={round.left} side="left" />
                  {winnerSide === "LEFT" && <span className="hl-card-crown">♛</span>}
                </div>
                <div className="hl-card-badges">
                  <span className="hl-mini-badge">{formatEntityType(round.left.entityType)}</span>
                  <span className="hl-mini-badge">{formatTimeframeLabel(round.left.timeframe)}</span>
                  <span className="hl-mini-badge">{formatScopeLabel(round.left.scope)}</span>
                </div>
                <h3 className="hl-card-title">{round.left.title}</h3>
                <p className="hl-card-subtitle">{round.left.subtitle || round.left.ownerLabel || "Stat"}</p>
                <div className="hl-value">{formatDisplayValue(leftKnownValue)}</div>
              </HostCard>

              <div className="hl-vs-divider">
                <span className="hl-vs-text">VS</span>
                {isTie && <span className="hl-vs-tie">Tie</span>}
              </div>

              <HostCard
                padded
                className={joinClasses(
                  "hl-card",
                  "hl-card--right",
                  winnerSide === "RIGHT" && "hl-card--winner",
                  winnerSide === "LEFT" && "hl-card--loser"
                )}
              >
                <div className="hl-card-media">
                  <DatapointArt datapoint={round.right} side="right" />
                  {winnerSide === "RIGHT" && <span className="hl-card-crown">♛</span>}
                </div>
                <div className="hl-card-badges">
                  <span className="hl-mini-badge">{formatEntityType(round.right.entityType)}</span>
                  <span className="hl-mini-badge">{formatTimeframeLabel(round.right.timeframe)}</span>
                  <span className="hl-mini-badge">{formatScopeLabel(round.right.scope)}</span>
                </div>
                <h3 className="hl-card-title">{round.right.title}</h3>
                <p className="hl-card-subtitle">{round.right.subtitle || round.right.ownerLabel || "Stat"}</p>
                <div className="hl-value">{formatDisplayValue(rightKnownValue)}</div>
              </HostCard>
            </div>

            {round.stageComplete && round.status !== "collecting" && (
              <HostCard padded className="hl-summary-card">
                <div className="hl-summary-label">Final Champion</div>
                <div className="hl-summary-title">{round.results?.winnerSide === "RIGHT" ? round.right.title : round.left.title}</div>
                <div className="hl-summary-copy">
                  {round.results?.winnerSide === "RIGHT" ? round.right.subtitle : round.left.subtitle}
                </div>
                <div className="hl-summary-value">
                  {formatDisplayValue(
                    round.results?.winnerSide === "RIGHT"
                      ? round.results?.rightDisplayValue ?? round.right.displayValue
                      : round.results?.leftDisplayValue ?? round.left.displayValue
                  )}
                  <span>{formatMetricLabel(round.metric)}</span>
                </div>
              </HostCard>
            )}

            {!round.stageComplete && round.status !== "revealed" && (
              <HostActionRow>
                <button
                  className="game-shell-button"
                  onClick={handleReveal}
                  disabled={actionBusy === "reveal"}
                >
                  {actionBusy === "reveal" ? "Revealing…" : "Reveal"}
                </button>
              </HostActionRow>
            )}

            {round.stageComplete && (
              <HostActionRow>
                <button className="game-shell-button" onClick={onAdvance}>
                  Next Stage
                </button>
                {!isTie && round.results?.winnerSide && (
                  <div className="hl-host-note">
                    {round.results.winnerSide === "LEFT"
                      ? "Champion defended."
                      : "Challenger stole the crown."}
                  </div>
                )}
              </HostActionRow>
            )}

            {error && <div className="host-minigame-error">{error}</div>}
          </HostMinigameStack>
        </div>
      </div>
    </div>
  );
};
