import { FC, useEffect, useMemo, useRef, useState } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HeardleGuessOutcome, HeardleRoundState } from 'types/game';

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

function outcomeLabel(outcome: HeardleGuessOutcome | null) {
  if (outcome === 'correct') return { text: 'Correct', color: '#22c55e', icon: '✓' };
  if (outcome === 'album_match') return { text: 'Album match', color: '#fbbf24', icon: '✕' };
  if (outcome === 'artist_match') return { text: 'Artist match', color: '#f59e0b', icon: '✕' };
  if (outcome === 'wrong') return { text: 'Wrong', color: '#f87171', icon: '✕' };
  return { text: 'No guess yet', color: '#94a3b8', icon: '…' };
}

export const HeardlePlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === 'HEARDLE'
      ? (gameState.currentRoundState as HeardleRoundState)
      : null;

  const mySocketId = socket.id as string;
  const myGuesses = useMemo(() => (round && mySocketId ? round.answers?.[mySocketId]?.guesses || [] : []), [round, mySocketId]);
  const hasGuessedCurrent = round ? myGuesses.some((g) => g.snippetIndex === round.currentSnippetIndex) : false;
  const myLatestOutcome = useMemo(() => {
    const summary = round?.results?.guessSummary?.[mySocketId];
    if (summary?.outcome) return summary.outcome as HeardleGuessOutcome;
    const latest = myGuesses[myGuesses.length - 1];
    return (latest?.outcome as HeardleGuessOutcome) || null;
  }, [round?.results?.guessSummary, myGuesses, mySocketId]);
  const hasAnsweredCorrectly = useMemo(
    () => myGuesses.some((g) => g.outcome === 'correct'),
    [myGuesses]
  );
  const guessedTrackIds = useMemo(() => new Set(myGuesses.map((g) => g.trackId).filter(Boolean)), [myGuesses]);

  const players = gameState.players || [];
  const myPlayer = players.find((p) => p.socketId === mySocketId);
  const isPrivilegedUser = myPlayer?.userId === "pnleguizamo";

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TrackOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TrackOption | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // reset selection when snippet changes
    setSelected(null);
    setSubmitError(null);
    setQuery("");
  }, [round?.currentSnippetIndex, round?.id]);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setResults([]);
      setHasMore(false);
      setOffset(0);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(query, 0, true);
    }, 300);
  }, [query]);

  const performSearch = async (term: string, nextOffset = 0, reset = false) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res: any = await api.get(
        `/api/heardle/tracks/search?q=${encodeURIComponent(term)}&limit=10&offset=${nextOffset}`
      );
      const newResults = reset ? res.results || [] : [...results, ...(res.results || [])];
      setResults(newResults);
      setOffset(res.nextOffset || newResults.length);
      setHasMore(!!res.hasMore);
    } catch (err: any) {
      console.error(err);
      setSearchError('Search failed, try again');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = () => {
    if (!roomCode || !round || !selected) return;
    if (hasGuessedCurrent || round.status === 'revealed') return;
    setSubmitBusy(true);
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
        setSubmitBusy(false);
        if (!resp?.ok) {
          const msg =
            resp?.error === 'ALREADY_GUESSED_THIS_SNIPPET'
              ? 'You already guessed this snippet.'
              : resp?.error || 'Failed to submit guess';
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
      }
    });
  };

  if (!round) {
    return <div>Waiting for the host to start Heardle…</div>;
  }

  const { text: outcomeText, color: outcomeColor, icon } = outcomeLabel(myLatestOutcome || null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '1rem', borderRadius: 12, background: '#0f172a', color: '#e2e8f0' }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#94a3b8' }}>
          Song {round.stageProgress?.songNumber || 1}
          {round.stageProgress?.songsPerGame ? ` / ${round.stageProgress.songsPerGame}` : ''}
        </div>
        <div style={{ fontSize: 16, marginTop: 6, color: outcomeColor }}>
          {icon} {outcomeText}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
          Current snippet: {(round.snippetPlan?.[round.currentSnippetIndex] || 0) / 1000}s
          {remainingMs !== null ? ` — ${Math.ceil(remainingMs / 1000)}s left` : ''}
        </div>
      </div>

      {round.status !== 'revealed' && !hasAnsweredCorrectly && (
        <div style={{ padding: '1rem', borderRadius: 12, background: '#0b1220' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a song"
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #1f2937', background: '#0f172a', color: '#fff' }}
              disabled={hasAnsweredCorrectly}
            />
            <button
              onClick={handleSubmit}
              disabled={!selected || submitBusy || hasGuessedCurrent || hasAnsweredCorrectly}
              style={{ minWidth: 120}}
            >
              {submitBusy
                ? 'Submitting…'
                : hasGuessedCurrent
                ? 'Locked'
                : 'Submit guess'}
            </button>
          </div>
          {searchError && <div style={{ color: 'salmon', marginBottom: 8 }}>{searchError}</div>}
          <div style={{ display: 'grid', gap: 8 }}>
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
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: isSelected ? '2px solid #38bdf8' : '1px solid #1f2937',
                    background: isSelected ? '#0b1220' : '#0f172a',
                    color: '#e2e8f0',
                    textAlign: 'left',
                    opacity: isGuessed ? 0.5 : 1,
                  }}
                  disabled={submitBusy || hasGuessedCurrent || isGuessed}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{track.name}</div>
                    {track.artistNames?.length ? (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{track.artistNames.join(', ')}</div>
                    ) : null}
                    {track.albumName ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>{track.albumName}</div>
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
              <button onClick={() => performSearch(query, offset, false)} disabled={searching}>
                {searching ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
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

      {isPrivilegedUser && <button onClick={handleStart} disabled={round.status !== 'revealed'}>
          {'Next Song'}
      </button>}

      {submitError && <div style={{ color: 'salmon' }}>{submitError}</div>}
    </div>
  );
};
