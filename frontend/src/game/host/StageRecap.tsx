import { useEffect, useMemo, useRef, useState } from "react";
import { Player, RecapAward, StageRecap as StageRecapType } from "types/game";
import { useHostSfx } from "game/hooks/useHostSfx";
import "./styles/StageRecap.css";

const MINIGAME_LABELS: Record<string, string> = {
  WHO_LISTENED_MOST: "Who Listened Most",
  GUESS_SPOTIFY_WRAPPED: "Guess the Wrapped",
  HEARDLE: "Heardle",
};

type Step =
  | { kind: "title" }
  | { kind: "suspense"; awardIndex: number }
  | { kind: "reveal"; awardIndex: number }
  | { kind: "outro" };

function buildSteps(awards: RecapAward[]): Step[] {
  const steps: Step[] = [{ kind: "title" }];
  for (let i = 0; i < awards.length; i++) {
    steps.push({ kind: "suspense", awardIndex: i });
    steps.push({ kind: "reveal", awardIndex: i });
  }
  steps.push({ kind: "outro" });
  return steps;
}

const STEP_DURATION: Record<Step["kind"], number> = {
  title: 2200,
  suspense: 1600,
  reveal: 3400,
  outro: 1600,
};

type Props = {
  recap: StageRecapType;
  players: Player[];
  onComplete: () => void;
};

export function StageRecap({ recap, players, onComplete }: Props) {
  const {
    playStageRecapTransition,
    playRoundTransition,
    playRevealComplete,
    playWrappedEntryReveal,
    playVoteRevealGuitar,
    playScratch,
  } = useHostSfx();
  const revealSfxOptions = useMemo(
    () => [playRevealComplete, playWrappedEntryReveal, playVoteRevealGuitar, playScratch],
    [playRevealComplete, playWrappedEntryReveal, playVoteRevealGuitar, playScratch]
  );
  const revealOrderKey = `${recap.stageIndex}:${recap.minigameId}:${recap.awards.length}`;
  const [revealSfxOrder, setRevealSfxOrder] = useState(revealSfxOptions);
  useEffect(() => {
    const ordered = [...revealSfxOptions];
    for (let i = ordered.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
    setRevealSfxOrder(ordered);
  }, [revealOrderKey, revealSfxOptions]);
  const steps = buildSteps(recap.awards);
  const [stepIndex, setStepIndex] = useState(0);
  const timerRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const currentStep = steps[stepIndex];
  const revealAwardIndex =
    currentStep.kind === "reveal" ? currentStep.awardIndex : undefined;

  // Play SFX when a step starts
  const prevStepIndexRef = useRef(-1);
  useEffect(() => {
    if (stepIndex === prevStepIndexRef.current) return;
    prevStepIndexRef.current = stepIndex;

    if (currentStep.kind === "title") playStageRecapTransition();
    else if (currentStep.kind === "suspense") playRoundTransition();
    else if (currentStep.kind === "reveal" && typeof revealAwardIndex === "number") {
      revealSfxOrder[revealAwardIndex]?.();
    }
  }, [
    stepIndex,
    currentStep.kind,
    revealAwardIndex,
    revealSfxOrder,
    playStageRecapTransition,
    playRoundTransition,
    playRevealComplete,
    playWrappedEntryReveal,
    playVoteRevealGuitar,
  ]);

  // Auto-advance timer
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);

    const duration = STEP_DURATION[currentStep.kind];
    timerRef.current = window.setTimeout(() => {
      const next = stepIndex + 1;
      if (next >= steps.length) {
        onCompleteRef.current();
      } else {
        setStepIndex(next);
      }
    }, duration);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [stepIndex, currentStep.kind, steps.length]);

  const awardCount = recap.awards.length;
  // Dot indices: title=0, then pairs (suspense+reveal) per award, outro=last
  // Show one dot per award + one for title card
  const dotCount = awardCount;
  const activeDotIndex =
    currentStep.kind === "suspense" || currentStep.kind === "reveal"
      ? currentStep.awardIndex
      : currentStep.kind === "outro"
      ? awardCount
      : -1;

  const stageLabel = `Stage ${recap.stageIndex + 1}`;
  const minigameName = MINIGAME_LABELS[recap.minigameId] ?? recap.minigameId;

  return (
    <div className="stage-recap">
      {currentStep.kind === "title" && (
        <TitleCard key="title" stageLabel={stageLabel} minigameName={minigameName} />
      )}

      {(currentStep.kind === "suspense" || currentStep.kind === "reveal") && (
        <AwardCard
          key={`award-${currentStep.awardIndex}-${currentStep.kind}`}
          award={recap.awards[currentStep.awardIndex]}
          phase={currentStep.kind}
        />
      )}

      {currentStep.kind === "outro" && (
        <OutroCard
          key="outro"
          isFinal={recap.isFinal}
          nextStageIndex={recap.isFinal ? null : recap.stageIndex + 2}
        />
      )}

      {dotCount > 0 && (
        <div className="stage-recap__dots">
          {Array.from({ length: dotCount }).map((_, i) => (
            <div
              key={i}
              className={[
                "stage-recap__dot",
                i === activeDotIndex ? "stage-recap__dot--active" : "",
                i < activeDotIndex ? "stage-recap__dot--done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TitleCard({ stageLabel, minigameName }: { stageLabel: string; minigameName: string }) {
  return (
    <div className="stage-recap__card">
      <div className="stage-recap__stage-label">{stageLabel} Complete</div>
      <h1 className="stage-recap__title-heading">Awards Ceremony</h1>
      <div className="stage-recap__minigame-name">{minigameName}</div>
    </div>
  );
}

function AwardCard({ award, phase }: { award: RecapAward; phase: "suspense" | "reveal" }) {
  return (
    <div className="stage-recap__card">
      <div className="stage-recap__award-eyebrow">Award</div>
      <h2 className="stage-recap__award-title">{award.title}</h2>

      {phase === "reveal" && (
        <>
          <div className="stage-recap__goes-to">goes to…</div>
          <div className="stage-recap__players">
            {award.featuredPlayers.map((fp, i) => (
              <PlayerBadge
                key={fp.playerId}
                displayName={fp.displayName}
                avatar={fp.avatar}
                statLabel={fp.statLabel}
                delayMs={i * 160}
              />
            ))}
          </div>
          <div className="stage-recap__description">{award.description}</div>
        </>
      )}
    </div>
  );
}

function PlayerBadge({
  displayName,
  avatar,
  statLabel,
  delayMs,
}: {
  displayName: string;
  avatar: string | null;
  statLabel: string;
  delayMs: number;
}) {
  return (
    <div className="stage-recap__player" style={{ animationDelay: `${delayMs}ms` }}>
      {avatar ? (
        <img className="stage-recap__avatar" src={avatar} alt={displayName} />
      ) : (
        <div className="stage-recap__avatar--placeholder">
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="stage-recap__player-name">{displayName}</div>
      <div className="stage-recap__stat-label">{statLabel}</div>
    </div>
  );
}

function OutroCard({
  isFinal,
  nextStageIndex,
}: {
  isFinal: boolean;
  nextStageIndex: number | null;
}) {
  return (
    <div className="stage-recap__card">
      <div className="stage-recap__outro-label">{isFinal ? "Game Over" : "Up Next"}</div>
      <h2 className="stage-recap__outro-heading">
        {isFinal ? "Final results incoming…" : `Stage ${nextStageIndex}`}
      </h2>
    </div>
  );
}
