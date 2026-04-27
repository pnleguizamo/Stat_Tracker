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

const findScrollParent = (startEl: HTMLElement | null): HTMLElement | null => {
  if (!startEl || typeof window === 'undefined') return null;

  const preferredPlayerMain = startEl.closest('.player-main');
  if (preferredPlayerMain instanceof HTMLElement) {
    return preferredPlayerMain;
  }

  let node = startEl.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
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
  const myPlacement = myAnswer?.placement;
  const hasPlaced = !!myPlacement?.confirmedAt;
  const hasDraftPlacement = !!myPlacement && !myPlacement.confirmedAt;
  const isRevealed = round?.status === 'revealed';
  const placementResult = round?.results?.placements?.[myPlayerId];
  const songGuessResult = round?.results?.songGuesses?.[myPlayerId];
  const gameWinners = round?.results?.winners || [];
  const isRaceWinner = gameWinners.includes(myPlayerId);
  const stageComplete = !!round?.stageProgress?.stageComplete;

  const players = gameState.players || [];
  const myPlayer = players.find((p) => p.playerId === myPlayerId);
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
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    scrollParentRef.current = findScrollParent(timelineRef.current);
  }, [round?.id]);

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

  useEffect(() => {
    if (dragStateRef.current?.phase === 'dragging') return;
    setSelectedGap(myPlacement?.gapIndex ?? null);
  }, [myPlacement]);

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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch]);

  const displayCards = [...myTimeline].reverse();
  const canPlaceSong = !hasPlaced && !isRevealed && !actionBusy;

  const persistPlacement = useCallback((gapIndex: number, finalize = false) => {
    if (hasPlaced || isRevealed) return;
    if (finalize) {
      setActionBusy(true);
    }
    socket.emit('minigame:HITSTER:submitPlacement', {
      roomCode,
      gapIndex,
      finalize,
    }, (resp: any) => {
      if (finalize) {
        setActionBusy(false);
      }
      if (!resp?.ok) {
        console.error('Placement failed:', resp?.error);
      }
    });
  }, [hasPlaced, isRevealed, roomCode]);

  const findDropGap = useCallback((clientX: number, clientY: number): number | null => {
    const timelineEl = timelineRef.current;
    if (!timelineEl) return null;

    const timelineRect = timelineEl.getBoundingClientRect();
    const horizontalSlack = 18;
    const verticalSlack = 28;
    const stackCenterX = timelineRect.left + timelineRect.width / 2;
    const stackHalfWidth = timelineRect.width / 2;
    if (
      Math.abs(clientX - stackCenterX) > stackHalfWidth + horizontalSlack ||
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
      persistPlacement(dropGap, false);
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
  }, [persistPlacement]);

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
    const getScrollDelta = (pointerCoord: number, start: number, end: number, threshold: number) => {
      if (pointerCoord < start + threshold) {
        return -Math.min(18, Math.max(5, Math.ceil((start + threshold - pointerCoord) / 5)));
      }
      if (pointerCoord > end - threshold) {
        return Math.min(18, Math.max(5, Math.ceil((pointerCoord - (end - threshold)) / 5)));
      }
      return 0;
    };

    const autoScroll = () => {
      const pointer = dragPointerRef.current;
      const timelineEl = timelineRef.current;
      const scrollParentEl = scrollParentRef.current;
      let scrolled = false;

      if (pointer && timelineEl) {
        const rect = timelineEl.getBoundingClientRect();
        const timelineCanScroll = timelineEl.scrollHeight > timelineEl.clientHeight + 1;
        if (timelineCanScroll) {
          const timelineDelta = getScrollDelta(pointer.y, rect.top, rect.bottom, 76);
          if (timelineDelta !== 0) {
            timelineEl.scrollTop += timelineDelta;
            scrolled = true;
          }
        }
      }

      if (pointer && scrollParentEl) {
        const rect = scrollParentEl.getBoundingClientRect();
        const viewportDelta = getScrollDelta(pointer.y, rect.top, rect.bottom, 92);
        if (viewportDelta !== 0) {
          scrollParentEl.scrollTop += viewportDelta;
          scrolled = true;
        }
      }

      if (pointer && scrolled) {
        window.requestAnimationFrame(() => {
          setActiveDropGap(findDropGap(pointer.x, pointer.y));
        });
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
    persistPlacement(selectedGap, true);
  };

  const persistSongGuess = (track: TrackOption) => {
    if (guessBusy || myAnswer?.songGuess || isRevealed) return;
    setGuessBusy(true);
    socket.emit('minigame:HITSTER:submitSongGuess', {
      roomCode,
      guess: {
        trackId: track.id,
        trackName: track.name,
        artistNames: track.artistNames || [],
      },
    }, (resp: any) => {
      setGuessBusy(false);
      if (!resp?.ok) {
        console.error('Song guess failed:', resp?.error);
        return;
      }
      setGuessOutcome(resp.correct ? 'correct' : 'wrong');
    });
  };

  const handleTrackSelect = (track: TrackOption) => {
    if (myAnswer?.songGuess || isRevealed) return;
    setSelectedTrack(track);
    setGuessOutcome(null);
  };

  const handleSongGuess = () => {
    if (!selectedTrack || guessBusy || myAnswer?.songGuess || isRevealed) return;
    persistSongGuess(selectedTrack);
  };

  const handleStartRound = () => {
    socket.emit('minigame:HITSTER:startRound', { roomCode }, (resp: any) => {
      if (!resp?.ok) console.error('Start round failed:', resp?.error);
    });
  };

  const describeGap = useCallback((gapIndex: number | null) => {
    if (gapIndex === null) return 'Hold and drag the mystery record onto the release rail.';
    if (myTimeline.length === 0) return 'This starts your timeline.';

    const olderCard = gapIndex > 0 ? myTimeline[gapIndex - 1] : null;
    const newerCard = gapIndex < myTimeline.length ? myTimeline[gapIndex] : null;

    if (!olderCard && newerCard) return `Place before ${newerCard.year}.`;
    if (olderCard && !newerCard) return `Place after ${olderCard.year}.`;
    if (olderCard && newerCard) return `Place between ${olderCard.year} and ${newerCard.year}.`;
    return 'Placement ready.';
  }, [myTimeline]);

  if (!round) {
    return (
      <div className="hitster-player">
        <div className="hitster-waiting-panel">
          <div className="hitster-waiting-kicker">Hitster</div>
          <div className="hitster-waiting">Waiting for host to start...</div>
          {isPrivilegedUser && (
            <button className="gs-btn gs-btn--primary" onClick={handleStartRound}>Start Round</button>
          )}
        </div>
      </div>
    );
  }

  const isDragging = dragState?.phase === 'dragging';
  const timelinePendingGap = !isRevealed ? (isDragging ? activeDropGap : selectedGap) : null;
  const timerSeconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
  const mysteryPrompt = hasPlaced
    ? 'Placement submitted'
    : selectedGap === null
      ? 'Drop it where the year belongs'
      : 'Drag again or lock this placement';
  const showSourceCard = !isRevealed && selectedGap === null;

  const renderMysteryCard = (floating = false) => (
    <>
      <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
      <span className="hitster-timeline-card-info">
        <span className="hitster-timeline-card-title">Mystery Song</span>
        <span className="hitster-timeline-card-artist">
          {floating
            ? dragState?.originGap === null
              ? 'Drop it where the year belongs'
              : 'Move it to a new slot'
            : mysteryPrompt}
        </span>
      </span>
      <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
    </>
  );

  const renderPendingCard = (storageGapIndex: number) => {
    if (timelinePendingGap !== storageGapIndex) return null;
    const pendingSubtitle = hasPlaced && !isRevealed
      ? 'Locked in. Waiting for reveal'
      : hasDraftPlacement && !isRevealed
        ? 'Saved. Confirm to lock it in'
      : describeGap(storageGapIndex);

    return (
      <div
        key={`pending-${storageGapIndex}`}
        className="hitster-timeline-slot hitster-timeline-slot--pending"
      >
        <span className="hitster-timeline-node hitster-timeline-node--pending" />
        {isDragging ? (
          <div className="hitster-timeline-card hitster-timeline-card--pending hitster-timeline-card--preview">
            <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
            <span className="hitster-timeline-card-info">
              <span className="hitster-timeline-card-title">Mystery Song</span>
              <span className="hitster-timeline-card-artist">{pendingSubtitle}</span>
            </span>
            <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
          </div>
        ) : !canPlaceSong ? (
          <div className="hitster-timeline-card hitster-timeline-card--pending hitster-timeline-card--locked">
            <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
            <span className="hitster-timeline-card-info">
              <span className="hitster-timeline-card-title">Mystery Song</span>
              <span className="hitster-timeline-card-artist">{pendingSubtitle}</span>
            </span>
            <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
          </div>
        ) : (
          <button
            type="button"
            className="hitster-timeline-card hitster-timeline-card--pending"
            onPointerDown={handleDragStart}
            aria-label="Drag the mystery song to a new position"
          >
            <span className="hitster-timeline-card-art hitster-timeline-card-art--pending">♪</span>
            <span className="hitster-timeline-card-info">
              <span className="hitster-timeline-card-title">Mystery Song</span>
              <span className="hitster-timeline-card-artist">{pendingSubtitle}</span>
            </span>
            <span className="hitster-timeline-card-year hitster-timeline-card-year--pending">?</span>
          </button>
        )}
      </div>
    );
  };

  const renderCard = (card: HitsterTimelineCard) => (
    <div
      className={`hitster-timeline-card hitster-timeline-card--settled${
        card.addedInRound === round.id ? ' hitster-timeline-card--new' : ''
      }${
        isRevealed && placementResult && !placementResult.correct && card.addedInRound === round.id
          ? ' hitster-timeline-card--removing'
          : ''
      }`}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt="" className="hitster-timeline-card-art" />
      ) : (
        <span className="hitster-timeline-card-art hitster-timeline-card-art--fallback">♪</span>
      )}
      <div className="hitster-timeline-card-info">
        <span className="hitster-timeline-card-title">{card.track_name}</span>
        <span className="hitster-timeline-card-artist">{(card.artist_names || []).join(', ')}</span>
      </div>
      <span className="hitster-timeline-card-year">{card.year}</span>
    </div>
  );

  return (
    <div className={`hitster-player${dragState?.phase === 'dragging' ? ' hitster-player--dragging' : ''}`}>
      {guessOutcome && (
        <div className={`hitster-guess-outcome hitster-guess-outcome--${guessOutcome}`}>
          {guessOutcome === 'correct' ? 'Correct song guess! +500 bonus' : 'Wrong song guess'}
        </div>
      )}

      <section className={`hitster-mystery-stage${isRevealed ? ' hitster-mystery-stage--revealed' : ''}${!isRevealed && selectedGap !== null ? ' hitster-mystery-stage--compact' : ''}`}>
        <div className="hitster-stage-vinyl" aria-hidden="true" />
        {timerSeconds !== null && (
          <span className="hitster-timer-badge">{timerSeconds}s</span>
        )}

        {showSourceCard ? (
          <div className="hitster-drag-source-wrapper">
            <button
              type="button"
              className={`hitster-drag-source${dragState ? ' hitster-drag-source--hidden' : ''}`}
              onPointerDown={handleDragStart}
              aria-label="Drag the mystery song into your timeline"
            >
              {renderMysteryCard()}
            </button>
          </div>
        ) : !isRevealed ? (
          <div className={`hitster-stage-placed${hasPlaced ? ' hitster-stage-placed--locked' : ''}`}>
            <span className="hitster-stage-placed-icon" aria-hidden="true">♪</span>
            <span className="hitster-stage-placed-text">
              {hasPlaced
                ? 'Song locked in · waiting for reveal'
                : hasDraftPlacement
                  ? 'Placement saved · timer will count this'
                  : 'Song placed ↓'}
            </span>
          </div>
        ) : null}

        {isRevealed && round.results && (
          <div className={`hitster-reveal-banner ${placementResult?.correct ? 'hitster-reveal-banner--correct' : 'hitster-reveal-banner--wrong'}`}>
            <div className="hitster-reveal-song">
              {round.results.song.imageUrl ? (
                <img src={round.results.song.imageUrl} alt="" className="hitster-reveal-art" />
              ) : (
                <div className="hitster-reveal-art hitster-reveal-art--fallback">♪</div>
              )}
              <div>
                <div className="hitster-reveal-title">{round.results.song.track_name}</div>
                <div className="hitster-reveal-artist">{(round.results.song.artist_names || []).join(', ')}</div>
                <div className="hitster-reveal-year">{round.results.year}</div>
              </div>
            </div>
            <div className="hitster-reveal-result">
              {placementResult?.correct ? '✓ Correct placement' : placementResult ? '✗ Wrong placement' : 'No placement'}
            </div>
            {songGuessResult && (
              <div className={`hitster-guess-result ${songGuessResult.correct ? 'hitster-guess-result--correct' : ''}`}>
                Song guess: {songGuessResult.correct ? '✓ +500 bonus' : '✗ Wrong'}
              </div>
            )}
            {gameWinners.length > 0 && (
              <div className="hitster-game-winner">
                {isRaceWinner ? 'You won this race!' : stageComplete ? 'Stage complete' : 'Race complete'}
              </div>
            )}
          </div>
        )}
      </section>

      {!isRevealed && round.status === 'placing' && (!hasPlaced || !myAnswer?.songGuess) && (
        <div className="hitster-bottom-tray">
          {selectedGap !== null && !hasPlaced && (
            <button
              className="hitster-tray-confirm gs-btn gs-btn--primary"
              onClick={handlePlace}
              disabled={actionBusy}
            >
              {actionBusy ? 'Locking...' : 'Confirm Placement'}
            </button>
          )}
          {!myAnswer?.songGuess && (
            <div className={`hitster-guess-section${guessExpanded ? ' hitster-guess-section--expanded' : ''}`}>
              <button
                type="button"
                className="hitster-guess-toggle"
                onClick={() => setGuessExpanded(!guessExpanded)}
              >
                <span className="hitster-guess-toggle-copy">
                  <span className="hitster-guess-toggle-kicker">Bonus</span>
                  <span className="hitster-guess-toggle-label">Guess the song name</span>
                </span>
                <span className={`hitster-guess-toggle-icon${guessExpanded ? ' is-open' : ''}`}>⌄</span>
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
                        type="button"
                        key={track.id}
                        className={`hitster-guess-result-item${selectedTrack?.id === track.id ? ' hitster-guess-result-item--selected' : ''}`}
                        onClick={() => handleTrackSelect(track)}
                      >
                        {track.imageUrl ? (
                          <img src={track.imageUrl} alt="" className="hitster-guess-result-art" />
                        ) : (
                          <span className="hitster-guess-result-art hitster-guess-result-art--fallback">♪</span>
                        )}
                        <div>
                          <div className="hitster-guess-result-name">{track.name}</div>
                          <div className="hitster-guess-result-artist">{(track.artistNames || []).join(', ')}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedTrack && (
                    <button
                      type="button"
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
        </div>
      )}

      <section className={`hitster-timeline-shell${dragState?.phase === 'dragging' ? ' hitster-timeline-shell--dragging' : ''}`}>
        <div className="hitster-timeline-shell__label">Your Timeline</div>
        <div className={`hitster-timeline${dragState?.phase === 'dragging' ? ' hitster-timeline--drag-active' : ''}`} ref={timelineRef}>
          {!displayCards.length && timelinePendingGap === null && (
            <div className="hitster-timeline-empty">
              Drag the mystery record onto the glowing rail to start your timeline.
            </div>
          )}

          {!isRevealed && renderPendingCard(myTimeline.length)}

          {displayCards.map((card, displayIdx) => {
            const cardKey = `${card.songId}-${card.addedInRound}`;
            const storageGapAfter = myTimeline.length - 1 - displayIdx;

            return (
              <div key={cardKey} className="hitster-timeline-item">
                <div className="hitster-timeline-slot">
                  <span className="hitster-timeline-node" />
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
                </div>
                {!isRevealed && storageGapAfter >= 0 && renderPendingCard(storageGapAfter)}
              </div>
            );
          })}
        </div>
      </section>

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
          {renderMysteryCard(true)}
        </div>
      )}

      {isRevealed && isPrivilegedUser && (gameWinners.length === 0 || !stageComplete) && (
        <button className="gs-btn gs-btn--primary" onClick={handleStartRound}>
          {gameWinners.length > 0 ? 'Next Race' : 'Next Round'}
        </button>
      )}
    </div>
  );
};
