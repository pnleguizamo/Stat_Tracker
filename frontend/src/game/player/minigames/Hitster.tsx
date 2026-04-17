import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HitsterRoundState, HitsterTimelineCard } from 'types/game';
import './styles/Hitster.css';
import '../../../styles/gameShell.css';

type Props = {
  roomCode: string;
  gameState: GameState;
};

type TrackOption = {
  id: string;
  name: string;
  artistNames?: string[];
  albumName?: string | null;
  imageUrl?: string | null;
};

type DragState = {
  pointerId: number;
  originGap: number | null;
  width: number;
  height: number;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  offsetX: number;
  offsetY: number;
  phase: 'dragging' | 'snapback' | 'snaptarget';
};

export const HitsterPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round = gameState.currentRoundState?.minigameId === 'HITSTER'
    ? (gameState.currentRoundState as HitsterRoundState)
    : null;

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myTimeline: HitsterTimelineCard[] = useMemo(() => {
    return (round as any)?.timelines?.[myPlayerId]?.cards || round?.myTimeline || [];
  }, [round, myPlayerId]);

  const myAnswer = round?.answers?.[myPlayerId];
  const hasPlaced = !!myAnswer?.placement;
  const isRevealed = round?.status === 'revealed';
  const placementResult = round?.results?.placements?.[myPlayerId];
  const songGuessResult = round?.results?.songGuesses?.[myPlayerId];
  const stageProgress = round?.stageProgress;
  const gameWinners = round?.results?.winners || [];
  const isGameWinner = gameWinners.includes(myPlayerId);

  const players = gameState.players || [];
  const myPlayer = players.find(p => p.playerId === myPlayerId);
  const isPrivilegedUser = myPlayer?.userId === 'pnleguizamo';

  const [selectedGap, setSelectedGap] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [guessExpanded, setGuessExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TrackOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<TrackOption | null>(null);
  const [guessBusy, setGuessBusy] = useState(false);
  const [guessOutcome, setGuessOutcome] = useState<'correct' | 'wrong' | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [activeDropGap, setActiveDropGap] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragTimeoutRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Reset state on new round
  useEffect(() => {
    setSelectedGap(null);
    setActionBusy(false);
    setGuessExpanded(false);
    setQuery('');
    setSearchResults([]);
    setSelectedTrack(null);
    setGuessBusy(false);
    setGuessOutcome(null);
    setDragState(null);
    setActiveDropGap(null);
  }, [round?.id]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        window.clearTimeout(dragTimeoutRef.current);
        dragTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!dragState?.pointerId || dragState.phase !== 'dragging') return;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragState?.pointerId, dragState?.phase]);

  // Countdown timer
  useEffect(() => {
    if (!round?.expiresAt || round.status === 'revealed') {
      setRemainingMs(null);
      return;
    }
    const tick = () => {
      const ms = Math.max(0, (round.expiresAt || 0) - Date.now());
      setRemainingMs(ms);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [round?.expiresAt, round?.status]);

  // Search
  const performSearch = useCallback(async (term: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);
    try {
      const res: any = await api.get(
        `/api/heardle/tracks/search?q=${encodeURIComponent(term)}&limit=8&offset=0`
      );
      if (id !== searchIdRef.current) return;
      setSearchResults(res.results || []);
    } catch {
      if (id !== searchIdRef.current) return;
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => performSearch(query.trim()), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, performSearch]);

  // Array is stored oldest (index 0) to newest (last). Reverse for display.
  const displayCards = [...myTimeline].reverse();
  const canPlaceSong = !hasPlaced && !isRevealed && !actionBusy;

  const findDropGap = useCallback((clientX: number, clientY: number): number | null => {
    const timelineEl = timelineRef.current;
    if (!timelineEl) return null;

    const timelineRect = timelineEl.getBoundingClientRect();
    const horizontalSlack = 40;
    const verticalSlack = 28;
    if (
      clientX < timelineRect.left - horizontalSlack ||
      clientX > timelineRect.right + horizontalSlack ||
      clientY < timelineRect.top - verticalSlack ||
      clientY > timelineRect.bottom + verticalSlack
    ) {
      return null;
    }

    if (myTimeline.length === 0) {
      return 0;
    }

    for (let displayIdx = 0; displayIdx < displayCards.length; displayIdx += 1) {
      const card = displayCards[displayIdx];
      const key = `${card.songId}-${card.addedInRound}`;
      const el = cardRefs.current[key];
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      if (clientY <= centerY) {
        return myTimeline.length - displayIdx;
      }
    }

    return 0;
  }, [displayCards, myTimeline.length]);

  const finishDrag = useCallback((dropGap: number | null) => {
    const currentDrag = dragStateRef.current;
    dragPointerRef.current = null;

    if (!currentDrag) {
      setActiveDropGap(null);
      return;
    }

    if (dragTimeoutRef.current) {
      window.clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }

    if (dropGap !== null) {
      setSelectedGap(dropGap);
      setDragState(null);
      setActiveDropGap(null);
      return;
    }

    setActiveDropGap(null);
    setDragState({
      ...currentDrag,
      x: currentDrag.sourceX,
      y: currentDrag.sourceY,
      phase: 'snapback',
    });
    dragTimeoutRef.current = window.setTimeout(() => {
      setDragState(null);
      dragTimeoutRef.current = null;
    }, 220);
  }, []);

  const handleDragStart = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canPlaceSong) return;
    if (e.pointerType !== 'touch' && e.button !== 0) return;

    e.preventDefault();

    if (dragTimeoutRef.current) {
      window.clearTimeout(dragTimeoutRef.current);
      dragTimeoutRef.current = null;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const nextDrag: DragState = {
      pointerId: e.pointerId,
      originGap: selectedGap,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      sourceX: rect.left,
      sourceY: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      phase: 'dragging',
    };

    dragPointerRef.current = { x: e.clientX, y: e.clientY };
    setDragState(nextDrag);
    setActiveDropGap(findDropGap(e.clientX, e.clientY));
  };

  useEffect(() => {
    if (!dragState?.pointerId || dragState.phase !== 'dragging') return;

    const handlePointerMove = (e: PointerEvent) => {
      const currentDrag = dragStateRef.current;
      if (!currentDrag || currentDrag.pointerId !== e.pointerId || currentDrag.phase !== 'dragging') return;

      e.preventDefault();
      dragPointerRef.current = { x: e.clientX, y: e.clientY };
      setDragState({
        ...currentDrag,
        x: e.clientX - currentDrag.offsetX,
        y: e.clientY - currentDrag.offsetY,
      });
      setActiveDropGap(findDropGap(e.clientX, e.clientY));
    };

    const handlePointerUp = (e: PointerEvent) => {
      const currentDrag = dragStateRef.current;
      if (!currentDrag || currentDrag.pointerId !== e.pointerId || currentDrag.phase !== 'dragging') return;
      finishDrag(findDropGap(e.clientX, e.clientY));
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState?.pointerId, dragState?.phase, findDropGap, finishDrag]);

  useEffect(() => {
    if (!dragState?.pointerId || dragState.phase !== 'dragging') return;

    let frameId = 0;
    const autoScroll = () => {
      const pointer = dragPointerRef.current;
      const timelineEl = timelineRef.current;

      if (pointer && timelineEl) {
        const rect = timelineEl.getBoundingClientRect();
        const threshold = 64;
        let delta = 0;

        if (pointer.y < rect.top + threshold) {
          delta = -Math.min(16, Math.ceil((rect.top + threshold - pointer.y) / 6));
        } else if (pointer.y > rect.bottom - threshold) {
          delta = Math.min(16, Math.ceil((pointer.y - (rect.bottom - threshold)) / 6));
        }

        if (delta !== 0) {
          timelineEl.scrollTop += delta;
          setActiveDropGap(findDropGap(pointer.x, pointer.y));
        }
      }

      frameId = window.requestAnimationFrame(autoScroll);
    };

    frameId = window.requestAnimationFrame(autoScroll);
    return () => window.cancelAnimationFrame(frameId);
  }, [dragState?.pointerId, dragState?.phase, findDropGap]);

  useEffect(() => {
    if (canPlaceSong || !dragStateRef.current) return;
    finishDrag(null);
  }, [canPlaceSong, finishDrag]);

  const handlePlace = () => {
    if (selectedGap === null || actionBusy || hasPlaced || isRevealed) return;
    setActionBusy(true);
    socket.emit('minigame:HITSTER:submitPlacement', { roomCode, gapIndex: selectedGap }, (resp: any) => {
      setActionBusy(false);
      if (!resp?.ok) console.error('Placement failed:', resp?.error);
    });
  };

  const handleSongGuess = () => {
    if (!selectedTrack || guessBusy || myAnswer?.songGuess || isRevealed) return;
    setGuessBusy(true);
    socket.emit('minigame:HITSTER:submitSongGuess', {
      roomCode,
      guess: {
        trackId: selectedTrack.id,
        trackName: selectedTrack.name,
        artistNames: selectedTrack.artistNames || [],
      },
    }, (resp: any) => {
      setGuessBusy(false);
      if (resp?.ok) {
        setGuessOutcome(resp.correct ? 'correct' : 'wrong');
      }
    });
  };

  const handleStartRound = () => {
    socket.emit('minigame:HITSTER:startRound', { roomCode }, (resp: any) => {
      if (!resp?.ok) console.error('Start round failed:', resp?.error);
    });
  };

  if (!round) {
    return (
      <div className="hitster-player">
        <div className="hitster-waiting">Waiting for host to start...</div>
        {isPrivilegedUser && (
          <button className="gs-btn gs-btn--primary" onClick={handleStartRound}>Start Round</button>
        )}
      </div>
    );
  }

  // Gap indices: in the stored array, gap 0 = before index 0 (oldest), gap N = after last (newest)
  // In display (reversed), gap for "top" = gap N (newest position), gap for "bottom" = gap 0 (oldest position)

  const isDragging = dragState?.phase === 'dragging';
  const timelinePendingGap = canPlaceSong ? (isDragging ? activeDropGap : selectedGap) : null;

  const renderPendingCard = (storageGapIndex: number) => {
    if (timelinePendingGap !== storageGapIndex) return null;

    if (isDragging) {
      return (
        <div key={`pending-${storageGapIndex}`} className="hitster-timeline-card hitster-timeline-card--pending hitster-timeline-card--preview">
          <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
          <span className="hitster-timeline-card-info">
            <span className="hitster-timeline-card-title">Mystery Song</span>
            <span className="hitster-timeline-card-artist">Release to place it here</span>
          </span>
          <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
        </div>
      );
    }

    return (
      <button
        key={`pending-${storageGapIndex}`}
        type="button"
        className="hitster-timeline-card hitster-timeline-card--pending"
        onPointerDown={handleDragStart}
        aria-label="Drag the mystery song to a new position"
      >
        <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
        <span className="hitster-timeline-card-info">
          <span className="hitster-timeline-card-title">Mystery Song</span>
          <span className="hitster-timeline-card-artist">Drag to reposition before you confirm</span>
        </span>
        <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
      </button>
    );
  };

  const renderCard = (card: HitsterTimelineCard) => (
    <div
      className={`hitster-timeline-card${card.addedInRound === round.id ? ' hitster-timeline-card--new' : ''}${
        isRevealed && placementResult && !placementResult.correct && card.addedInRound === round.id ? ' hitster-timeline-card--removing' : ''
      }`}
    >
      {card.imageUrl && (
        <img src={card.imageUrl} alt="" className="hitster-timeline-card-art" />
      )}
      <div className="hitster-timeline-card-info">
        <span className="hitster-timeline-card-title">{card.track_name}</span>
        <span className="hitster-timeline-card-artist">{(card.artist_names || []).join(', ')}</span>
      </div>
      <span className="hitster-timeline-card-year">{card.year}</span>
    </div>
  );

  const timerText = remainingMs !== null ? `${Math.ceil(remainingMs / 1000)}s` : null;

  return (
    <div className={`hitster-player${dragState?.phase === 'dragging' ? ' hitster-player--dragging' : ''}`}>
      {/* Round info */}
      <div className="hitster-round-info">
        <span className="hitster-round-number">
          Round {stageProgress?.roundNumber || '?'} &middot; Target: {stageProgress?.targetCards || 7} cards
        </span>
        {timerText && <span className="hitster-timer">{timerText}</span>}
      </div>

      {/* Status messages */}
      {isRevealed && round.results && (
        <div className={`hitster-reveal-banner ${placementResult?.correct ? 'hitster-reveal-banner--correct' : 'hitster-reveal-banner--wrong'}`}>
          <div className="hitster-reveal-song">
            {round.results.song.imageUrl && (
              <img src={round.results.song.imageUrl} alt="" className="hitster-reveal-art" />
            )}
            <div>
              <div className="hitster-reveal-title">{round.results.song.track_name}</div>
              <div className="hitster-reveal-artist">{(round.results.song.artist_names || []).join(', ')}</div>
              <div className="hitster-reveal-year">{round.results.year}</div>
            </div>
          </div>
          <div className="hitster-reveal-result">
            {placementResult?.correct ? '\u2713 Correct placement' : placementResult ? '\u2717 Wrong placement' : 'No placement'}
          </div>
          {songGuessResult && (
            <div className={`hitster-guess-result ${songGuessResult.correct ? 'hitster-guess-result--correct' : ''}`}>
              Song guess: {songGuessResult.correct ? '\u2713 +500 bonus' : '\u2717 Wrong'}
            </div>
          )}
          {gameWinners.length > 0 && (
            <div className="hitster-game-winner">
              {isGameWinner ? 'You win!' : 'Game over!'}
            </div>
          )}
        </div>
      )}

      {hasPlaced && !isRevealed && (
        <div className="hitster-placed-banner">Placed! Waiting for reveal...</div>
      )}

      {canPlaceSong && selectedGap === null && (
        <>
          <div className="hitster-drag-hint">Drag the mystery song through the stack to choose its year.</div>
          <button
            type="button"
            className={`hitster-drag-source${dragState ? ' hitster-drag-source--hidden' : ''}`}
            onPointerDown={handleDragStart}
            aria-label="Drag the mystery song into your timeline"
          >
            <span className="hitster-drag-source-icon">♪</span>
            <span className="hitster-drag-source-copy">
              <span className="hitster-drag-source-label">Mystery Song</span>
              <span className="hitster-drag-source-subtitle">Drop it where the year belongs</span>
            </span>
            <span className="hitster-drag-source-grab">Drag</span>
          </button>
        </>
      )}

      {/* Timeline */}
      <div className={`hitster-timeline${dragState?.phase === 'dragging' ? ' hitster-timeline--drag-active' : ''}`} ref={timelineRef}>
        {!isRevealed && renderPendingCard(myTimeline.length)}
        {displayCards.map((card, displayIdx) => {
          const cardKey = `${card.songId}-${card.addedInRound}`;
          const storageGapAfter = myTimeline.length - 1 - displayIdx;
          return (
            <div key={cardKey} className="hitster-timeline-item">
              <div
                ref={(el) => {
                  cardRefs.current[cardKey] = el;
                }}
                className={`hitster-timeline-card-anchor${
                  isDragging && activeDropGap === myTimeline.length - displayIdx ? ' hitster-timeline-card-anchor--below-drop' : ''
                }`}
              >
                {renderCard(card)}
              </div>
              {!isRevealed && storageGapAfter >= 0 && renderPendingCard(storageGapAfter)}
            </div>
          );
        })}
      </div>

      {/* Confirm button */}
      {selectedGap !== null && !hasPlaced && !isRevealed && (
        <button
          className="hitster-confirm-btn gs-btn gs-btn--primary"
          onClick={handlePlace}
          disabled={actionBusy}
        >
          {actionBusy ? 'Placing...' : 'Confirm Placement'}
        </button>
      )}

      {/* Song guess section */}
      {round.status === 'placing' && !myAnswer?.songGuess && (
        <div className="hitster-guess-section">
          <button
            className="hitster-guess-toggle"
            onClick={() => setGuessExpanded(!guessExpanded)}
          >
            {guessExpanded ? '\u25BE' : '\u25B8'} Bonus: Guess the song name
          </button>
          {guessExpanded && (
            <div className="hitster-guess-body">
              <input
                type="text"
                className="hitster-guess-input"
                placeholder="Search for a song..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && <div className="hitster-guess-searching">Searching...</div>}
              <div className="hitster-guess-results">
                {searchResults.map((track) => (
                  <button
                    key={track.id}
                    className={`hitster-guess-result-item${selectedTrack?.id === track.id ? ' hitster-guess-result-item--selected' : ''}`}
                    onClick={() => setSelectedTrack(track)}
                  >
                    {track.imageUrl && <img src={track.imageUrl} alt="" className="hitster-guess-result-art" />}
                    <div>
                      <div className="hitster-guess-result-name">{track.name}</div>
                      <div className="hitster-guess-result-artist">{(track.artistNames || []).join(', ')}</div>
                    </div>
                  </button>
                ))}
              </div>
              {selectedTrack && (
                <button
                  className="hitster-guess-submit gs-btn gs-btn--accent"
                  onClick={handleSongGuess}
                  disabled={guessBusy}
                >
                  {guessBusy ? 'Guessing...' : 'Submit Guess'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {guessOutcome && (
        <div className={`hitster-guess-outcome hitster-guess-outcome--${guessOutcome}`}>
          {guessOutcome === 'correct' ? 'Correct song guess! +500 bonus' : 'Wrong song guess'}
        </div>
      )}

      {dragState && (
        <div
          className={`hitster-drag-float${dragState.phase === 'snapback' ? ' is-snapback' : ''}${
            dragState.phase === 'snaptarget' ? ' is-snaptarget' : ''
          }`}
          style={{
            width: dragState.width,
            height: dragState.height,
            transform: `translate3d(${dragState.x}px, ${dragState.y}px, 0)`,
          }}
        >
          <span className="hitster-drag-source-icon">♪</span>
          <span className="hitster-drag-source-copy">
            <span className="hitster-drag-source-label">Mystery Song</span>
            <span className="hitster-drag-source-subtitle">
              {dragState.originGap === null ? 'Drop it where the year belongs' : 'Move it to a new spot'}
            </span>
          </span>
          <span className="hitster-drag-source-grab">Drag</span>
        </div>
      )}

      {/* Privileged: start next round */}
      {isRevealed && isPrivilegedUser && gameWinners.length === 0 && (
        <button className="gs-btn gs-btn--primary" onClick={handleStartRound} style={{ marginTop: 12 }}>
          Next Round
        </button>
      )}
    </div>
  );
};
