import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoFitScale } from "game/hooks/useAutoFitScale";
import { useTrackPreview } from "game/hooks/useTrackPreview";
import { socket } from "socket";
import { PlayerAvatar } from "components/PlayerAvatar";
import { GameState, HigherLowerDatapoint, HigherLowerRoundState, Player } from "types/game";
import {
  HostActionRow,
  HostCard,
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

/* ── Formatting helpers ── */

const TIMEFRAME_LABELS: Record<string, string> = {
  last7: "Last 7 Days",
  last30: "Last 30 Days",
  last90: "Last 90 Days",
  last180: "Last 180 Days",
  ytd: "Year to Date",
  allTime: "All Time",
};

function formatMetricLabel(metric?: string | null) {
  return metric === "minutes" ? "Minutes" : "Plays";
}

function formatTimeframeLabel(timeframe?: string | null) {
  if (!timeframe) return "Window";
  if (TIMEFRAME_LABELS[timeframe]) return TIMEFRAME_LABELS[timeframe];
  if (/^year\d{4}$/.test(timeframe)) return timeframe.replace("year", "");
  return timeframe;
}

function formatDisplayValue(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "?";
  return new Intl.NumberFormat().format(value);
}

function formatScopeLabel(scope?: string | null) {
  return scope === "ROOM" ? "Whole Room" : "Player";
}

function humanizePlayerId(playerId: string) {
  const compact = playerId.trim();
  if (!compact) return "Guest Player";
  if (compact.length <= 12) return compact;
  return `${compact.slice(0, 8)}…`;
}

function buildFallbackPlayer(playerId: string, displayName?: string | null): Player {
  const resolvedName = displayName?.trim() || humanizePlayerId(playerId);
  return {
    playerId,
    name: resolvedName,
    displayName: resolvedName,
    avatar: null,
  };
}

function entityLabel(entityType?: string | null) {
  if (!entityType) return "Stat";
  return entityType.charAt(0) + entityType.slice(1).toLowerCase();
}

// Strip parts from the subtitle that are already shown in corner labels or avatar badges.
// The backend builds subtitles as "PlayerName · Timeframe · ArtistNames" – we keep only
// the parts that add new context (e.g. artist names for tracks/albums).
const SUBTITLE_STRIP_PATTERNS = [
  /^last \d+ days?$/i,
  /^last \d+$/i,
  /^year to date$/i,
  /^ytd$/i,
  /^all time$/i,
  /^whole room$/i,
  /^\d{4}$/, // bare year
];

function filterSubtitle(
  subtitle: string | null | undefined,
  ownerName?: string | null,
  ownerLabel?: string | null,
): string {
  if (!subtitle) return "";
  const parts = subtitle.split("·").map((p) => p.trim()).filter(Boolean);
  const filtered = parts.filter((part) => {
    if (SUBTITLE_STRIP_PATTERNS.some((re) => re.test(part))) return false;
    if (ownerName && part === ownerName) return false;
    if (ownerLabel && part === ownerLabel) return false;
    return true;
  });
  return filtered.join(" · ");
}

function artFallbackLabel(datapoint?: HigherLowerDatapoint | null) {
  if (!datapoint?.entityType) return "STAT";
  if (datapoint.entityType === "TOTAL") return "TOTAL";
  return datapoint.entityType.slice(0, 10);
}

/* ── SVG entity icons ── */

const EntityIcon: FC<{ entityType?: string | null }> = ({ entityType }) => {
  switch (entityType) {
    case "TRACK":
      return (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
        </svg>
      );
    case "ARTIST":
      return (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3Zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2Z" />
        </svg>
      );
    case "ALBUM":
      return (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5Zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
        </svg>
      );
    default: // TOTAL or unknown
      return (
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 4H6v2l4.5 6L6 18v2h12v-3h-7l4-5-4-5h7V4Z" />
        </svg>
      );
  }
};

/* ── Sub-components ── */

const LightningBoltSvg: FC<{ className?: string }> = ({ className }) => (
  <svg
    className={joinClasses("hl-vs-bolt", className)}
    width="18"
    height="36"
    viewBox="0 0 18 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M10 0L0 20h7L5 36l13-22h-7L14 0h-4Z"
      fill="url(#bolt-grad)"
    />
    <defs>
      <linearGradient id="bolt-grad" x1="9" y1="0" x2="9" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#22d3ee" />
        <stop offset="1" stopColor="#facc15" />
      </linearGradient>
    </defs>
  </svg>
);

const MAX_CONTRIBUTOR_AVATARS = 5;

const ContributorAvatars: FC<{
  datapoint: HigherLowerDatapoint;
  ownerPlayer: Player | null;
  contributors: Player[] | null;
}> = ({ datapoint, ownerPlayer, contributors }) => {
  if (ownerPlayer) {
    const name = datapoint.ownerLabel || ownerPlayer.displayName || ownerPlayer.name;
    return (
      <div className="hl-card-contributors">
        <PlayerAvatar player={ownerPlayer} size={40} />
        <span className="hl-avatar-name">{name}</span>
      </div>
    );
  }

  if (contributors?.length) {
    const caption = datapoint.ownerLabel || (datapoint.scope === "ROOM" ? formatScopeLabel(datapoint.scope) : null);
    return (
      <div className="hl-card-contributors">
        <div className="hl-avatar-stack-row">
          <div className="hl-avatar-stack">
            {contributors.slice(0, MAX_CONTRIBUTOR_AVATARS).map((p) => (
              <PlayerAvatar key={p.playerId} player={p} size={32} />
            ))}
          </div>
          {contributors.length > MAX_CONTRIBUTOR_AVATARS && (
            <span className="hl-avatar-overflow">+{contributors.length - MAX_CONTRIBUTOR_AVATARS}</span>
          )}
        </div>
        {caption && <span className="hl-avatar-name">{caption}</span>}
      </div>
    );
  }

  return null;
};

/* ── Electric card ── */

const ElectricCard: FC<{
  datapoint: HigherLowerDatapoint;
  side: "left" | "right";
  displayValue: number | null;
  metric?: string | null;
  isWinner: boolean;
  isLoser: boolean;
  isRevealing: boolean;
  isCollecting: boolean;
  showValue: boolean;
  ownerPlayer: Player | null;
  contributors: Player[] | null;
}> = ({
  datapoint,
  side,
  displayValue,
  metric,
  isWinner,
  isLoser,
  isRevealing,
  isCollecting,
  showValue,
  ownerPlayer,
  contributors,
}) => {
  const subtitle = filterSubtitle(
    datapoint.subtitle,
    ownerPlayer?.displayName ?? ownerPlayer?.name,
    datapoint.ownerLabel,
  );
  const wrapClass = joinClasses(
    "hl-card-wrap",
    `hl-card-wrap--${side}`,
    isWinner && "hl-card-wrap--winner",
    isLoser && "hl-card-wrap--loser",
    isCollecting && "hl-card-wrap--collecting",
    isRevealing && "hl-card-wrap--revealing",
  );

  const cardClass = joinClasses(
    "hl-card",
    `hl-card--${side}`,
    isRevealing && "hl-card--revealing",
  );

  return (
    <div className={wrapClass}>
      <div className={cardClass}>
        {/* Blurred album art background */}
        {datapoint.imageUrl && (
          <div className="hl-card-bg-art">
            <img src={datapoint.imageUrl} alt="" aria-hidden="true" />
          </div>
        )}

        <div className="hl-card-content">
          {/* Header: entity type + timeframe */}
          <div className="hl-card-header">
            <span className="hl-entity-badge">
              <EntityIcon entityType={datapoint.entityType} />
              {entityLabel(datapoint.entityType)}
            </span>
            <span className="hl-timeframe-tag">
              {formatTimeframeLabel(datapoint.timeframe)}
            </span>
          </div>

          {/* Hero art */}
          {datapoint.imageUrl ? (
            <div className="hl-card-hero">
              <img src={datapoint.imageUrl} alt={datapoint.title} />
              {isWinner && <span className="hl-card-crown">♛</span>}
            </div>
          ) : (
            <div className="hl-card-hero hl-card-hero--fallback">
              {artFallbackLabel(datapoint)}
              {isWinner && <span className="hl-card-crown">♛</span>}
            </div>
          )}

          {/* Identity */}
          <div className="hl-card-identity">
            <h3 className="hl-card-title">{datapoint.title}</h3>
            {subtitle ? <p className="hl-card-subtitle">{subtitle}</p> : null}
          </div>

          {/* Contributors */}
          <ContributorAvatars
            datapoint={datapoint}
            ownerPlayer={ownerPlayer}
            contributors={contributors}
          />

          {/* Value zone */}
          <div className="hl-card-value-zone">
            {showValue ? (
              <>
                <div className={joinClasses("hl-value-number", isRevealing && "hl-value-number--counting")}>
                  {formatDisplayValue(displayValue)}
                </div>
                <div className="hl-value-metric">{formatMetricLabel(metric)}</div>
              </>
            ) : (
              <div className="hl-value-mystery">?</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Main host component ── */

export const HigherLowerHost: FC<Props> = (props) => {
  const {
    roomCode,
    gameState,
    onAdvance,
    onRevealComplete,
  } = props;
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

  const animationLoopRef = useRef<number | null>(null);
  const nextRoundTimeoutRef = useRef<number | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const busyRef = useRef<"start" | "reveal" | null>(null);
  const revealHandledRoundRef = useRef<string | null>(null);
  const lastAnimatedKeyRef = useRef<string | null>(null);

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
      if (animationLoopRef.current) {
        window.cancelAnimationFrame(animationLoopRef.current);
        animationLoopRef.current = null;
      }
      if (nextRoundTimeoutRef.current) {
        window.clearTimeout(nextRoundTimeoutRef.current);
        nextRoundTimeoutRef.current = null;
      }
    };
  }, []);

  const activeDatapoint = round?.right || round?.left;
  const previewKind = activeDatapoint?.previewKind ?? null;
  const previewEnabled = previewKind === "track" || previewKind === "artist";

  useTrackPreview({
    trackName: activeDatapoint?.previewTrackName ?? undefined,
    artistName: activeDatapoint?.previewArtistName ?? undefined,
    previewKey: previewEnabled ? activeDatapoint?.id ?? undefined : undefined,
    enabled: previewEnabled,
    volume: round?.status === "revealed" ? 0.1 : 0.3,
    kind: previewKind === "artist" ? "artist" : "track",
  });

  const handleStartRound = useCallback(() => {
    if (!roomCode) return;
    if (nextRoundTimeoutRef.current) {
      window.clearTimeout(nextRoundTimeoutRef.current);
      nextRoundTimeoutRef.current = null;
    }
    setActionBusy("start");
    setError(null);
    socket.emit("minigame:HIGHER_LOWER:startRound", { roomCode },
      (resp?: { ok: boolean; error?: string }) => {
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

  // Auto-start first round
  useEffect(() => {
    if (!roomCode || round || actionBusy === "start" || error) return;
    handleStartRound();
  }, [actionBusy, error, handleStartRound, round, roomCode]);

  // Count-up animation — depends on primitives to avoid re-trigger
  const roundId = round?.id ?? null;
  const roundStatus = round?.status ?? null;
  const roundNumber = round?.roundNumber ?? null;
  const stageComplete = round?.stageComplete ?? false;
  const leftDisplayVal = round?.left?.displayValue ?? null;
  const rightDisplayVal = round?.right?.displayValue ?? null;
  const resultsLeftVal = round?.results?.leftDisplayValue ?? null;
  const resultsRightVal = round?.results?.rightDisplayValue ?? null;

  useEffect(() => {
    if (animationLoopRef.current) {
      window.cancelAnimationFrame(animationLoopRef.current);
      animationLoopRef.current = null;
    }

    if (!roundId) {
      setRevealPhase("idle");
      setAnimatedValues({ left: null, right: null });
      lastAnimatedKeyRef.current = null;
      return;
    }

    if (roundStatus !== "revealed") {
      setRevealPhase(stageComplete ? "done" : "idle");
      setAnimatedValues({
        left: roundNumber !== null && roundNumber > 1 ? leftDisplayVal : null,
        right: null,
      });
      return;
    }

    // Guard: don't re-animate the same round reveal
    const animKey = `${roundId}:revealed`;
    if (lastAnimatedKeyRef.current === animKey) return;
    lastAnimatedKeyRef.current = animKey;

    const targetLeft = resultsLeftVal ?? leftDisplayVal;
    const targetRight = resultsRightVal ?? rightDisplayVal;
    const animateLeft = roundNumber === 1;

    if (targetLeft === null && targetRight === null) {
      setRevealPhase("done");
      setAnimatedValues({ left: null, right: null });
      return;
    }

    setRevealPhase("counting");
    setAnimatedValues({
      left: animateLeft ? 0 : targetLeft,
      right: 0,
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
            : Math.round(targetRight * eased),
      });

      if (progress < 1) {
        animationLoopRef.current = window.requestAnimationFrame(step);
        return;
      }

      animationLoopRef.current = null;
      setAnimatedValues({ left: targetLeft, right: targetRight });
      setRevealPhase("done");
    };

    animationLoopRef.current = window.requestAnimationFrame(step);
  }, [roundId, roundStatus, roundNumber, stageComplete, leftDisplayVal, rightDisplayVal, resultsLeftVal, resultsRightVal]);

  // Post-reveal sequence (leaderboard, next round)
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

  // Derived state
  const winnerSide = revealPhase === "done" ? round?.results?.winnerSide : undefined;
  const isTie = winnerSide === "TIE";
  const isRevealing = revealPhase === "counting";
  const isCollecting = round?.status === "collecting";

  const leftKnownValue =
    round?.status === "revealed"
      ? animatedValues.left
      : round && round.roundNumber > 1
      ? round.left.displayValue ?? null
      : null;
  const rightKnownValue = round?.status === "revealed" ? animatedValues.right : null;

  const showLeftValue = round?.status === "revealed" || (round !== null && round.roundNumber > 1);
  const showRightValue = round?.status === "revealed";

  function resolvePlayer(playerId: string | null | undefined, displayName?: string | null): Player | null {
    if (!playerId) return null;
    return gameState.players?.find((p) => p.playerId === playerId) ?? buildFallbackPlayer(playerId, displayName);
  }

  const leftPlayer = resolvePlayer(round?.left?.ownerPlayerId, round?.left?.ownerLabel);
  const rightPlayer = resolvePlayer(round?.right?.ownerPlayerId, round?.right?.ownerLabel);

  function resolveContributors(datapoint: HigherLowerDatapoint | null | undefined): Player[] | null {
    if (!datapoint?.contributorPlayerIds?.length) return null;
    return datapoint.contributorPlayerIds
      .map((id) => resolvePlayer(id))
      .filter((p): p is Player => p != null);
  }

  const leftContributors = resolveContributors(round?.left);
  const rightContributors = resolveContributors(round?.right);

  // Round dots
  const roundDots = useMemo(() => {
    if (!round) return [];
    return Array.from({ length: round.maxRounds }, (_, i) => {
      const num = i + 1;
      if (num < round.roundNumber) return "completed";
      if (num === round.roundNumber) return "active";
      return "pending";
    });
  }, [round]);

  // Winner datapoint for summary card
  const winnerDatapoint =
    winnerSide === "RIGHT" ? round?.right : winnerSide === "LEFT" ? round?.left : null;
  const winnerValue =
    winnerSide === "RIGHT"
      ? round?.results?.rightDisplayValue ?? round?.right.displayValue
      : winnerSide === "LEFT"
      ? round?.results?.leftDisplayValue ?? round?.left?.displayValue
      : null;

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
            {/* Question header */}
            <HostCard padded className="hl-question-header">
              <h2 className="hl-question-title">
                Which has more{" "}
                <span className="hl-metric-highlight">{formatMetricLabel(round.metric)}</span>?
              </h2>
              <div className="hl-round-row">
                <div className="hl-round-dots">
                  {roundDots.map((state, i) => (
                    <span
                      key={i}
                      className={joinClasses(
                        "hl-round-dot",
                        state === "active" && "hl-round-dot--active",
                        state === "completed" && "hl-round-dot--completed",
                      )}
                    />
                  ))}
                </div>
              </div>
            </HostCard>

            {/* Versus row */}
            <div className={joinClasses("hl-versus-row", isTie && "hl-versus-row--tie")}>
              <ElectricCard
                datapoint={round.left}
                side="left"
                displayValue={leftKnownValue}
                metric={round.metric}
                isWinner={winnerSide === "LEFT"}
                isLoser={winnerSide === "RIGHT"}
                isRevealing={isRevealing}
                isCollecting={!!isCollecting}
                showValue={showLeftValue}
                ownerPlayer={leftPlayer}
                contributors={leftContributors}
              />

              <div className="hl-vs-divider">
                <LightningBoltSvg className="hl-vs-bolt--top" />
                <div className="hl-vs-badge">VS</div>
                <LightningBoltSvg className="hl-vs-bolt--bottom" />
                {isTie && <span className="hl-vs-tie-label">Tie</span>}
              </div>

              <ElectricCard
                datapoint={round.right}
                side="right"
                displayValue={rightKnownValue}
                metric={round.metric}
                isWinner={winnerSide === "RIGHT"}
                isLoser={winnerSide === "LEFT"}
                isRevealing={isRevealing}
                isCollecting={!!isCollecting}
                showValue={showRightValue}
                ownerPlayer={rightPlayer}
                contributors={rightContributors}
              />
            </div>

            {/* Summary card (stage complete) */}
            {round.stageComplete && round.status !== "collecting" && !isTie && winnerDatapoint && (
              <HostCard padded className="hl-summary-card">
                {winnerDatapoint.imageUrl && (
                  <img
                    src={winnerDatapoint.imageUrl}
                    alt=""
                    className="hl-summary-champion-art"
                  />
                )}
                <div className="hl-summary-label">Champion</div>
                <div className="hl-summary-title">{winnerDatapoint.title}</div>
                {winnerDatapoint.subtitle && (
                  <div className="hl-summary-subtitle">{winnerDatapoint.subtitle}</div>
                )}
                <div className="hl-summary-value">
                  {formatDisplayValue(winnerValue)}
                  <span>{formatMetricLabel(round.metric)}</span>
                </div>
              </HostCard>
            )}

            {/* Action buttons */}
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
