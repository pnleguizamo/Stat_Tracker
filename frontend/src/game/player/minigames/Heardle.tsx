import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HeardleGuessOutcome, HeardleRoundState } from 'types/game';
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

type PendingGiveUp = {
  expectedRoundId: string;
  expectedSnippetIndex: number;
};

function outcomeLabel(outcome: HeardleGuessOutcome | null) {
  if (outcome === 'correct') return { text: 'Correct', color: '#22c55e', icon: '✓' };
  if (outcome === 'album_match') return { text: 'Album match', color: '#fbbf24', icon: '✕' };
  if (outcome === 'artist_match') return { text: 'Artist match', color: '#f59e0b', icon: '✕' };
  if (outcome === 'wrong') return { text: 'Wrong', color: '#f87171', icon: '✕' };
  if (outcome === 'gave_up') return { text: 'Gave up', color: '#60a5fa', icon: '>>' };
  return { text: 'No guess yet', color: '#94a3b8', icon: '…' };
}

const LOAD_MORE_SCROLL_NUDGE_PX = 72;

export const HeardlePlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === 'HEARDLE'
      ? (gameState.currentRoundState as HeardleRoundState)
      : null;

  const myPlayerId = ((socket as any).playerId || socket.id) as string;
  const myGuesses = useMemo(() => (round && myPlayerId ? round.answers?.[myPlayerId]?.guesses || [] : []), [round, myPlayerId]);
  const hasGuessedCurrent = round ? myGuesses.some((g) => g.snippetIndex === round.currentSnippetIndex) : false;
  const myLatestOutcome = useMemo(() => {
    const summary = round?.results?.guessSummary?.[myPlayerId];
    if (summary?.outcome) return summary.outcome as HeardleGuessOutcome;
    const latest = myGuesses[myGuesses.length - 1];
    return (latest?.outcome as HeardleGuessOutcome) || null;
  }, [round?.results?.guessSummary, myGuesses, myPlayerId]);
  const hasAnsweredCorrectly = useMemo(
    () => myGuesses.some((g) => g.outcome === 'correct'),
    [myGuesses]
  );
  const guessedTrackIds = useMemo(() => new Set(myGuesses.map((g) => g.trackId).filter(Boolean)), [myGuesses]);

  const players = gameState.players || [];
  const myPlayer = players.find((p) => p.playerId === myPlayerId);
  const isPrivilegedUser = myPlayer?.userId === "pnleguizamo";

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TrackOption | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [actionBusy, setActionBusy] = useState<'submit' | 'giveup' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [pendingGiveUp, setPendingGiveUp] = useState<PendingGiveUp | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    // reset selection when snippet changes
    setSelected(null);
    setSubmitError(null);
    setQuery("");
  }, [round?.currentSnippetIndex, round?.id]);

  const performSearch = useCallback(async (term: string, nextOffset = 0, reset = false) => {
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearching(true);
    setSearchError(null);
    try {
      const res: any = await api.get(
        `/api/heardle/tracks/search?q=${encodeURIComponent(term)}&limit=10&offset=${nextOffset}`
      );
      if (requestId !== searchRequestIdRef.current) return;

      const incomingResults = res.results || [];
      setResults((prev) => (reset ? incomingResults : [...prev, ...incomingResults]));
      setOffset((prevOffset) => {
        if (typeof res.nextOffset === 'number') return res.nextOffset;
        if (reset) return incomingResults.length;
        return Math.max(prevOffset, nextOffset + incomingResults.length);
      });
      setHasMore(!!res.hasMore);

      if (reset) {
        resultsContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      } else if (incomingResults.length) {
        requestAnimationFrame(() => {
          // Roughly one row so newly appended items visibly move into view.
          resultsContainerRef.current?.scrollBy({ top: LOAD_MORE_SCROLL_NUDGE_PX, behavior: 'smooth' });
        });
      }
    } catch (err: any) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error(err);
      setSearchError('Search failed, try again');
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchRequestIdRef.current += 1;
      setResults([]);
      setHasMore(false);
      setOffset(0);
      setSearching(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(query, 0, true);
    }, 300);
  }, [performSearch, query]);

  useEffect(() => {
    if (!round?.expiresAt || round.status === 'revealed') {
      setRemainingMs(null);
      return;
    }
    const interval = setInterval(() => {
      const delta = round.expiresAt! - Date.now();
      setRemainingMs(delta > 0 ? delta : 0);
    }, 200);
    return () => clearInterval(interval);
  }, [round?.expiresAt, round?.status]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchRequestIdRef.current += 1;
    };
  }, []);

  const handleSubmit = () => {
    if (!roomCode || !round || !selected) return;
    if (hasGuessedCurrent || round.status === 'revealed') return;
    setActionBusy('submit');
    setSubmitError(null);
    socket.emit(
      'minigame:HEARDLE:submitGuess',
      {
        roomCode,
        guess: {
          trackId: selected.id,
          trackName: selected.name,
          artistNames: selected.artistNames || [],
          albumName: selected.albumName || null,
          imageUrl: selected.imageUrl || null,
        },
      },
      (resp?: { ok: boolean; error?: string; outcome?: HeardleGuessOutcome }) => {
        setActionBusy(null);
        if (!resp?.ok) {
          const msg =
            resp?.error === 'ALREADY_GUESSED_THIS_SNIPPET'
              ? 'You already responded for this snippet.'
              : resp?.error || 'Failed to submit guess';
          setSubmitError(msg);
        }
      }
    );
  };

  const handleGiveUp = () => {
    if (!roomCode || !round) return;
    if (hasGuessedCurrent || round.status === 'revealed') return;
    setSubmitError(null);
    setPendingGiveUp({
      expectedRoundId: round.id,
      expectedSnippetIndex: round.currentSnippetIndex,
    });
  };

  const handleCancelGiveUp = () => {
    if (actionBusy === 'giveup') return;
    setPendingGiveUp(null);
  };

  const handleConfirmGiveUp = () => {
    if (!roomCode || !round || !pendingGiveUp) return;
    if (round.status === 'revealed' || hasGuessedCurrent) {
      setPendingGiveUp(null);
      return;
    }
    if (
      round.id !== pendingGiveUp.expectedRoundId ||
      round.currentSnippetIndex !== pendingGiveUp.expectedSnippetIndex
    ) {
      setPendingGiveUp(null);
      setSubmitError('Snippet changed before confirmation. Please try again.');
      return;
    }

    setActionBusy('giveup');
    setSubmitError(null);
    socket.emit(
      'minigame:HEARDLE:giveUp',
      {
        roomCode,
        expectedRoundId: pendingGiveUp.expectedRoundId,
        expectedSnippetIndex: pendingGiveUp.expectedSnippetIndex,
      },
      (resp?: { ok: boolean; error?: string; outcome?: HeardleGuessOutcome }) => {
        setActionBusy(null);
        setPendingGiveUp(null);
        if (!resp?.ok) {
          const msg =
            resp?.error === 'ROUND_CHANGED'
              ? 'Snippet changed before confirmation. Please try again.'
              : resp?.error === 'ALREADY_GUESSED_THIS_SNIPPET'
              ? 'You already responded for this snippet.'
              : resp?.error || 'Failed to give up';
          setSubmitError(msg);
        }
      }
    );
  };
  const handleStart = () => {
    if (!roomCode) return;
    socket.emit('minigame:HEARDLE:startRound', { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      if (!resp?.ok) {
        const message =
          resp?.error === 'NO_SONGS_REMAINING'
            ? 'No songs left in this stage — advance or adjust the plan.'
            : resp?.error || 'Failed to start Heardle round';
        setSubmitError(message);
      }
    });
  };

  if (!round) {
    return <div>Waiting for the host to start Heardle…</div>;
  }

  const { text: outcomeText, color: outcomeColor, icon } = outcomeLabel(myLatestOutcome || null);
  const isBusy = actionBusy !== null || !!pendingGiveUp;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '0.65rem 0.85rem', borderRadius: 12, background: '#0f172a', color: '#e2e8f0' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8' }}>
          Song {round.stageProgress?.songNumber || 1}
          {round.stageProgress?.songsPerGame ? ` / ${round.stageProgress.songsPerGame}` : ''}
        </div>
        <div style={{ fontSize: 15, marginTop: 3, color: outcomeColor }}>
          {icon} {outcomeText}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
          Snippet: {(round.snippetPlan?.[round.currentSnippetIndex] || 0) / 1000}s
          {remainingMs !== null ? ` — ${Math.ceil(remainingMs / 1000)}s left` : ''}
        </div>
      </div>

      {round.status !== 'revealed' && !hasAnsweredCorrectly && !hasGuessedCurrent && (
        <div style={{ padding: '0.75rem', borderRadius: 12, background: '#0b1220' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a song…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #1f2937', background: '#0f172a', color: '#fff' }}
              disabled={hasAnsweredCorrectly || hasGuessedCurrent || isBusy}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSubmit}
                disabled={!selected || isBusy || hasGuessedCurrent || hasAnsweredCorrectly}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  background: 'rgba(14, 116, 144, 0.35)',
                  color: '#e2e8f0',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: (!selected || isBusy || hasGuessedCurrent || hasAnsweredCorrectly) ? 0.45 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {actionBusy === 'submit' ? 'Submitting…' : 'Submit guess'}
              </button>
              <button
                onClick={handleGiveUp}
                disabled={isBusy || hasGuessedCurrent || hasAnsweredCorrectly}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(248, 113, 113, 0.35)',
                  background: 'rgba(127, 29, 29, 0.2)',
                  color: '#fca5a5',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: (isBusy || hasGuessedCurrent || hasAnsweredCorrectly) ? 0.45 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {actionBusy === 'giveup' ? 'Giving up…' : 'Give up'}
              </button>
            </div>
          </div>
          {searchError && <div style={{ color: 'salmon', marginBottom: 8 }}>{searchError}</div>}
          <div ref={resultsContainerRef} className="heardle-results">
            {results.map((track) => {
              const isSelected = selected?.id === track.id;
              const isGuessed = guessedTrackIds.has(track.id);
              return (
                <button
                  key={track.id}
                  onClick={() => setSelected(track)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: isSelected ? '2px solid #38bdf8' : '1px solid #1f2937',
                    background: isSelected ? '#0b1220' : '#0f172a',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    opacity: isGuessed ? 0.5 : 1,
                  }}
                  disabled={isBusy || hasGuessedCurrent || isGuessed}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{track.name}</div>
                    {track.artistNames?.length ? (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{track.artistNames.join(', ')}</div>
                    ) : null}
                    {track.albumName ? (
                      <div style={{ fontSize: 11, color: '#64748b' }}>{track.albumName}</div>
                    ) : null}
                  </div>
                  {isGuessed ? (
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>Guessed</span>
                  ) : isSelected ? (
                    <span style={{ color: '#38bdf8', fontSize: 18 }}>✓</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {hasMore && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => performSearch(query, offset, false)}
                disabled={searching || isBusy || hasGuessedCurrent}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: 8,
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  background: 'rgba(15, 23, 42, 0.5)',
                  color: '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                  opacity: (searching || isBusy || hasGuessedCurrent) ? 0.45 : 1,
                }}
              >
                {searching ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </div>
      )}

      {round.status !== 'revealed' && !hasAnsweredCorrectly && hasGuessedCurrent && (
        <div style={{ padding: '1rem', borderRadius: 12, background: '#0b1220', color: '#cbd5e1' }}>
          Waiting for the next snippet...
        </div>
      )}

      {round.status === 'revealed' && round.results?.song && (
        <div style={{ padding: '1rem', borderRadius: 12, background: '#0f172a', color: '#e2e8f0' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Answer</div>
          <div>{round.results.song.track_name}</div>
          {round.results.song.artist_names?.length ? (
            <div style={{ fontSize: 13, color: '#cbd5e1' }}>{round.results.song.artist_names.join(', ')}</div>
          ) : null}
        </div>
      )}

      {isPrivilegedUser && (
        <button
          onClick={handleStart}
          disabled={round.status !== 'revealed'}
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid rgba(56, 189, 248, 0.35)',
            background: 'rgba(14, 116, 144, 0.25)',
            color: '#7dd3fc',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: round.status !== 'revealed' ? 0.45 : 1,
          }}
        >
          Next Song
        </button>
      )}

      {submitError && <div style={{ color: 'salmon' }}>{submitError}</div>}

      {pendingGiveUp && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem',
          }}
        >
          <div
            style={{
              width: 'min(420px, 100%)',
              background: '#0b1220',
              border: '1px solid #1f2937',
              borderRadius: 12,
              padding: '1rem',
              color: '#e2e8f0',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Give up this snippet?</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 12 }}>
              This action is final for the current snippet.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelGiveUp}
                disabled={actionBusy === 'giveup'}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(15, 23, 42, 0.5)',
                  color: '#94a3b8',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: actionBusy === 'giveup' ? 0.45 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmGiveUp}
                disabled={actionBusy === 'giveup'}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: '1px solid rgba(248, 113, 113, 0.5)',
                  background: 'rgba(127, 29, 29, 0.35)',
                  color: '#fca5a5',
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: actionBusy === 'giveup' ? 0.45 : 1,
                }}
              >
                {actionBusy === 'giveup' ? 'Giving up…' : 'Confirm give up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
