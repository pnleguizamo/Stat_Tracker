import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);

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
  }, [round?.id]);

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

  // Display timeline reversed (newest at top)
  // Array is stored oldest (index 0) to newest (last). Reverse for display.
  const displayCards = [...myTimeline].reverse();
  // Gap indices: in the stored array, gap 0 = before index 0 (oldest), gap N = after last (newest)
  // In display (reversed), gap for "top" = gap N (newest position), gap for "bottom" = gap 0 (oldest position)

  const renderGap = (storageGapIndex: number) => {
    const isSelected = selectedGap === storageGapIndex;
    const disabled = hasPlaced || isRevealed || actionBusy;
    return (
      <button
        key={`gap-${storageGapIndex}`}
        className={`hitster-timeline-gap${isSelected ? ' hitster-timeline-gap--selected' : ''}${disabled ? ' hitster-timeline-gap--disabled' : ''}`}
        onClick={() => !disabled && setSelectedGap(storageGapIndex)}
        disabled={disabled}
        aria-label={`Place song at position ${storageGapIndex}`}
      >
        <span className="hitster-timeline-gap-icon">+</span>
      </button>
    );
  };

  const renderCard = (card: HitsterTimelineCard) => (
    <div
      key={card.songId + '-' + card.addedInRound}
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
    <div className="hitster-player">
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

      {/* Timeline */}
      <div className="hitster-timeline">
        {/* Top gap = newest position = storage gap index myTimeline.length */}
        {!isRevealed && renderGap(myTimeline.length)}
        {displayCards.map((card, displayIdx) => {
          // Storage gap index between this card and the next (older) card
          const storageGapAfter = myTimeline.length - 1 - displayIdx;
          return (
            <div key={card.songId + '-' + card.addedInRound}>
              {renderCard(card)}
              {!isRevealed && storageGapAfter >= 0 && renderGap(storageGapAfter)}
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

      {/* Privileged: start next round */}
      {isRevealed && isPrivilegedUser && gameWinners.length === 0 && (
        <button className="gs-btn gs-btn--primary" onClick={handleStartRound} style={{ marginTop: 12 }}>
          Next Round
        </button>
      )}
    </div>
  );
};
