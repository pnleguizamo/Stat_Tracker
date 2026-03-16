import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FinalRecap as FinalRecapType, GameState, Player, RecapAward, RecapFeaturedPlayer } from "types/game";
import { useHostSfx } from "game/hooks/useHostSfx";
import { useAutoFitScale } from "game/hooks/useAutoFitScale";
import { Leaderboard } from "./Leaderboard";
import "./styles/FinalRecap.css";

const MINIGAME_LABELS: Record<string, string> = {
  WHO_LISTENED_MOST: "Who Listened Most",
  GUESS_SPOTIFY_WRAPPED: "Guess the Wrapped",
  HEARDLE: "Heardle",
};

const STAGGER_MS = 200;
const LINGER_MS = 20_000;

type Props = {
  recap: FinalRecapType;
  players: Player[];
  scoreboard?: GameState["scoreboard"];
  revealAllAtOnce?: boolean;
  showLeaderboardAtEnd?: boolean;
  maxPlayersPerAward?: number;
};

export function FinalRecap({
  recap,
  players,
  scoreboard,
  revealAllAtOnce = false,
  showLeaderboardAtEnd,
  maxPlayersPerAward,
}: Props) {
  const { playScoreTick } = useHostSfx();

  const stages = recap.stages;
  const globalIndexMap: number[][] = stages.map(() => []);
  let counter = 0;
  stages.forEach((stage, stageIdx) => {
    stage.awards.forEach((_, awardIdx) => {
      globalIndexMap[stageIdx][awardIdx] = counter++;
    });
  });
  const totalCards = counter;
  const fitContentVersion = stages
    .map((stage) => `${stage.stageIndex}:${stage.awards.map((award) => award.id).join(",")}`)
    .join("|");
  const { viewportRef: fitViewportRef, canvasRef: fitCanvasRef, syncScale } =
    useAutoFitScale({ allowUpscale: false, contentVersion: fitContentVersion });
  const shouldShowLeaderboardAtEnd =
    showLeaderboardAtEnd ?? Boolean(scoreboard && Object.keys(scoreboard).length > 0);

  const [visibleCount, setVisibleCount] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const timerRef = useRef<number | null>(null);
  const prevVisibleRef = useRef(0);

  useLayoutEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    prevVisibleRef.current = 0;
    setShowLeaderboard(false);
    setVisibleCount(revealAllAtOnce ? totalCards : 0);
  }, [fitContentVersion, revealAllAtOnce, totalCards]);

  useEffect(() => {
    if (revealAllAtOnce) {
      return;
    }

    if (visibleCount >= totalCards) {
      if (!shouldShowLeaderboardAtEnd || totalCards === 0) {
        return;
      }
      timerRef.current = window.setTimeout(() => {
        setShowLeaderboard(true);
      }, LINGER_MS);
      return () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      };
    }

    timerRef.current = window.setTimeout(() => {
      setVisibleCount((v) => v + 1);
    }, STAGGER_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [visibleCount, totalCards, revealAllAtOnce, shouldShowLeaderboardAtEnd]);

  useEffect(() => {
    if (revealAllAtOnce) return;
    if (visibleCount > 0 && visibleCount !== prevVisibleRef.current) {
      prevVisibleRef.current = visibleCount;
      const progress = totalCards > 0 ? visibleCount / totalCards : 0;
      const intensity = 0.28 + progress * 0.62;
      playScoreTick({ intensity });
    }
  }, [visibleCount, totalCards, revealAllAtOnce, playScoreTick]);

  useLayoutEffect(() => {
    syncScale({ mode: "snap" });
    const rafId = window.requestAnimationFrame(() => syncScale({ mode: "snap" }));
    const timeoutId = window.setTimeout(() => syncScale({ mode: "snap" }), 160);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [fitContentVersion, syncScale]);

  return (
    <div ref={fitViewportRef} className="final-recap-fit-viewport">
      <div className="final-recap-fit-center">
        <div ref={fitCanvasRef} className="final-recap-fit-canvas">
          <div className="final-recap">
            <div className="final-recap__header">
              <div className="final-recap__eyebrow">Game Over</div>
              <h1 className="final-recap__heading">All Awards</h1>
            </div>

            <div className="final-recap__stages">
              {stages.map((stage, stageIdx) => (
                <div key={stage.stageIndex} className="final-recap__stage-row">
                  <div className="final-recap__stage-header">
                    <div className="final-recap__stage-number">Stage {stage.stageIndex + 1}</div>
                    <div className="final-recap__stage-minigame">
                      {MINIGAME_LABELS[stage.minigameId] ?? stage.minigameId}
                    </div>
                  </div>

                  <div className="final-recap__stage-awards">
                    {stage.awards.length === 0 && (
                      <div className="final-recap__no-awards">No awards this stage</div>
                    )}

                    {stage.awards.map((award, awardIdx) => {
                      const globalIdx = globalIndexMap[stageIdx][awardIdx];
                      const isVisible = visibleCount > globalIdx;
                      return (
                        <AwardCard
                          key={award.id}
                          award={award}
                          isVisible={isVisible}
                          animationDelay={0}
                          maxPlayersPerAward={maxPlayersPerAward}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Leaderboard
            scoreboard={scoreboard}
            players={players}
            isVisible={showLeaderboard}
            onClose={() => setShowLeaderboard(false)}
          />
        </div>
      </div>
    </div>
  );
}

function AwardCard({
  award,
  isVisible,
  maxPlayersPerAward,
}: {
  award: RecapAward;
  isVisible: boolean;
  animationDelay: number;
  maxPlayersPerAward?: number;
}) {
  const visiblePlayers =
    typeof maxPlayersPerAward === "number" && maxPlayersPerAward >= 0
      ? award.featuredPlayers.slice(0, maxPlayersPerAward)
      : award.featuredPlayers;
  const hiddenCount = Math.max(0, award.featuredPlayers.length - visiblePlayers.length);

  return (
    <div className={`final-recap__award${isVisible ? " final-recap__award--visible" : ""}`}>
      <div className="final-recap__award-title">{award.title}</div>
      <div className="final-recap__award-players">
        {visiblePlayers.map((fp) => (
          <PlayerChip key={fp.playerId} player={fp} />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <div className="final-recap__award-more">+{hiddenCount} more tied</div>
      ) : null}
      <div className="final-recap__award-stat">{award.description}</div>
    </div>
  );
}

function PlayerChip({ player }: { player: RecapFeaturedPlayer }) {
  return (
    <div className="final-recap__award-player">
      {player.avatar ? (
        <img
          className="final-recap__award-avatar"
          src={player.avatar}
          alt={player.displayName}
        />
      ) : (
        <div className="final-recap__award-avatar--placeholder">
          {player.displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="final-recap__award-player-name">{player.displayName}</span>
    </div>
  );
}
