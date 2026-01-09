import { FC, useEffect, useMemo, useRef, useState } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HeardleRoundState } from 'types/game';

declare global {
  interface Window {
    Spotify?: any;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';
let sdkLoading: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (sdkLoading) return sdkLoading;

  sdkLoading = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Spotify Web Playback SDK failed to load'));
    document.body.appendChild(script);
  });

  return sdkLoading;
}

async function transferAndPlay(token: string, deviceId: string, uri: string) {
  const url = new URL('https://api.spotify.com/v1/me/player/play');
  url.searchParams.set('device_id', deviceId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: [uri], position_ms: 0 }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Playback start failed ${response.status}: ${text}`);
  }
}

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
};

export const HeardleHost: FC<Props> = ({ roomCode, gameState, onAdvance }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === 'HEARDLE'
      ? (gameState.currentRoundState as HeardleRoundState)
      : null;
  const players = gameState.players || [];

  const [actionBusy, setActionBusy] = useState<'start' | 'reveal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<string>('player not ready');
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const playerRef = useRef<any>(null);
  const loopInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTrackRef = useRef<string | null>(null);

  const currentSnippetMs = round?.snippetPlan?.[round.currentSnippetIndex || 0] || 0;
  const songsPerGame =
    round?.stageProgress?.songsPerGame;

  useEffect(() => {
    let cancelled = false;
    loadSdk()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch((err) => {
        console.error(err);
        setPlaybackError(err.message || 'Failed to load Spotify SDK');
      });
    api
      .get('/api/heardle/playback/token')
      .then((res: any) => {
        if (cancelled) return;
        if (res?.accessToken) setToken(res.accessToken);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('playback token fetch failed', err);
        setPlaybackError('Unable to fetch Spotify playback token');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdkReady || !token) return;

    const player = new window.Spotify.Player({
      name: 'Stat Tracker — Heardle Host',
      getOAuthToken: (cb: (token: string) => void) => cb(token),
      volume: 0.8,
    });

    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      setDeviceId(device_id);
      setPlaybackStatus('ready');
    });
    player.addListener('not_ready', () => setPlaybackStatus('device not ready'));
    player.addListener('initialization_error', ({ message }: { message: string }) => setPlaybackError(message));
    player.addListener('authentication_error', ({ message }: { message: string }) => setPlaybackError(message));
    player.addListener('account_error', ({ message }: { message: string }) => setPlaybackError(message));
    player.addListener('player_state_changed', (state: any) => {
      if (!state) return;
      const isPaused = state.paused;
      setPlaybackStatus(isPaused ? 'paused' : 'playing');
    });

    player.connect();
    playerRef.current = player;

    return () => {
      if (pauseTimeout.current) clearTimeout(pauseTimeout.current);
      if (loopInterval.current) clearInterval(loopInterval.current);
      player.disconnect();
      playerRef.current = null;
      currentTrackRef.current = null;
    };
  }, [sdkReady, token]);

  useEffect(() => {
    if (round) return;
    if (!roomCode) return;
    if (actionBusy === 'start') return;
    if (error) return;
    handleStart();
  }, [round, roomCode, actionBusy, error]);

  useEffect(() => {
    // restart snippet loop on song or snippet change
    if (!round || !round.song?.uri || !deviceId || !token) return;
    if (round.status === 'revealed') {
      stopSnippetLoop();
      return;
    }
    const durationMs = currentSnippetMs || 1000;
    startSnippetLoop(durationMs, round.song.uri);
    return () => {
      stopSnippetLoop();
    };
  }, [round?.song?.id, round?.currentSnippetIndex, deviceId, token, round?.status, currentSnippetMs]);

  const startSnippetLoop = async (durationMs: number, uri: string) => {
    if (!playerRef.current || !deviceId || !token || !uri) return;
    try {
      stopSnippetLoop();
      if (currentTrackRef.current !== uri) {
        await transferAndPlay(token, deviceId, uri);
        currentTrackRef.current = uri;
      } else {
        await playerRef.current.seek(0);
        await playerRef.current.resume();
      }
      pauseTimeout.current = setTimeout(() => {
        playerRef.current?.pause?.().catch(() => {});
      }, durationMs);

      loopInterval.current = setInterval(async () => {
        try {
          await playerRef.current?.seek?.(0);
          await playerRef.current?.resume?.();
          if (pauseTimeout.current) clearTimeout(pauseTimeout.current);
          pauseTimeout.current = setTimeout(() => {
            playerRef.current?.pause?.().catch(() => {});
          }, durationMs);
        } catch (err) {
          console.warn('snippet loop failed', err);
        }
      }, Math.max(durationMs + 2000));
    } catch (err: any) {
      console.error(err);
      setPlaybackError(err.message || 'Unable to play snippet');
    }
  };

  const stopSnippetLoop = () => {
    if (pauseTimeout.current) clearTimeout(pauseTimeout.current);
    if (loopInterval.current) clearInterval(loopInterval.current);
    pauseTimeout.current = null;
    loopInterval.current = null;
  };

  const handleStart = () => {
    if (!roomCode) return;
    setActionBusy('start');
    setError(null);
    socket.emit('minigame:HEARDLE:startRound', { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) {
        const message =
          resp?.error === 'NO_SONGS_REMAINING'
            ? 'No songs left in this stage — advance or adjust the plan.'
            : resp?.error || 'Failed to start Heardle round';
        setError(message);
      }
    });
  };

  const handleReveal = () => {
    if (!roomCode) return;
    setActionBusy('reveal');
    setError(null);
    socket.emit('minigame:HEARDLE:forceReveal', { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setActionBusy(null);
      if (!resp?.ok) setError(resp?.error || 'Failed to reveal');
    });
  };

  const guessesThisSnippet = useMemo(() => {
    if (!round) return 0;
    return players.reduce((count, p) => {
      const g = p.socketId ? round.answers?.[p.socketId]?.guesses || [] : [];
      return g.some((guess) => guess.snippetIndex === round.currentSnippetIndex) ? count + 1 : count;
    }, 0);
  }, [players, round]);

  const playerGuessStates = useMemo(() => {
    if (!round) return [];
    return players.map((p) => {
      const guesses = p.socketId ? round.answers?.[p.socketId]?.guesses || [] : [];
      const latest = guesses[guesses.length - 1] || null;
      const summary = p.socketId ? round.results?.guessSummary?.[p.socketId] : null;
      const outcome = summary?.outcome || latest?.outcome || null;
      return {
        player: p,
        outcome,
        guessedThisSnippet: guesses.some((g) => g.snippetIndex === round.currentSnippetIndex),
      };
    });
  }, [players, round]);

   const outcomeLabel = (outcome?: string | null) => {
    if (outcome === 'correct') return { text: 'Correct', color: '#22c55e' };
    if (outcome === 'album_match') return { text: 'Album match', color: '#fbbf24' };
    if (outcome === 'artist_match') return { text: 'Artist match', color: '#f59e0b' };
    if (outcome === 'wrong') return { text: 'Wrong', color: '#f87171' };
    return { text: '—', color: '#94a3b8' };
  };

  if (!round) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Waiting to start Heardle…</p>
        <button onClick={handleStart} disabled={actionBusy === 'start'}>
          {actionBusy === 'start' ? 'Starting…' : 'Start first song'}
        </button>
        {error && <div style={{ color: 'salmon', marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          padding: '1.25rem',
          background: '#0f172a',
          borderRadius: 12,
        }}
      >
        {round.song?.imageUrl && round.status === 'revealed' ? (
          <img
            src={round.song.imageUrl}
            alt={round.song.track_name || 'Song art'}
            style={{ width: 120, height: 120, borderRadius: 10, objectFit: 'cover' }}
          />
        ) : null}
        <div style={{ color: '#e2e8f0' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 1 }}>
            Heardle — Song {round.stageProgress?.songNumber || 1}
            {songsPerGame ? ` / ${songsPerGame}` : ''}
          </div>
          <h2 style={{ margin: '4px 0 8px', color: '#fff' }}>
            {!!(round.status === 'revealed') ? round.song?.track_name : 'Hidden until reveal'}
          </h2>
          {round.song?.artist_names?.length && round.status === 'revealed' ? (
            <div style={{ fontSize: 14, color: '#cbd5e1' }}>{round.song.artist_names.join(', ')}</div>
          ) : null}
          <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8' }}>
            Current snippet: {currentSnippetMs / 1000}s — guesses this snippet: {guessesThisSnippet} / {players.length}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1' }}>
            Playback: {playbackError ? playbackError : playbackStatus}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {playerGuessStates.map(({ player, outcome, guessedThisSnippet }) => (
          <div
            key={player.socketId || player.name}
            style={{
              padding: '0.85rem',
              borderRadius: 10,
              border: '1px solid #1f2937',
              background: '#0b1220',
            }}
          >
            <div style={{ fontWeight: 700, color: '#fff' }}>{player.displayName || player.name}</div>
            <div style={{ marginTop: 4, fontSize: 13, color: '#94a3b8' }}>
              {outcome === 'correct' ? (
                <span style={{ color: '#22c55e' }}>✓ Correct</span>
              ) : outcome === 'album_match' ? (
                <span style={{ color: '#fbbf24' }}>✕ Album only</span>
              ) : outcome === 'artist_match' ? (
                <span style={{ color: '#f59e0b' }}>✕ Artist only</span>
              ) : outcome === 'wrong' ? (
                <span style={{ color: '#f87171' }}>✕ Wrong</span>
              ) : (
                <span style={{ color: '#94a3b8' }}>Waiting…</span>
              )}
            </div>
            {round.status !== 'revealed' && guessedThisSnippet && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#38bdf8' }}>Guessed this snippet</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '1rem', borderRadius: 12, background: '#0f172a', color: '#e2e8f0' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Guess history</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {players.map((player) => {
            const guesses = player.socketId ? round.answers?.[player.socketId]?.guesses || [] : [];
            return (
              <div
                key={player.socketId || player.name}
                style={{ padding: '0.75rem', borderRadius: 10, border: '1px solid #1f2937', background: '#0b1220' }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{player.displayName || player.name}</div>
                {guesses.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>No guesses yet</div>}
                {guesses.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {guesses
                      .slice()
                      .sort((a, b) => (a.at || 0) - (b.at || 0))
                      .map((g, idx) => {
                        const o = outcomeLabel(g.outcome);
                        return (
                          <div key={`${g.snippetIndex}-${idx}`} style={{ fontSize: 13, color: '#cbd5e1' }}>
                            <span style={{ color: '#94a3b8' }}>Round {g.snippetIndex + 1}: </span>
                            <span style={{ color: '#e2e8f0' }}>{o.text === "Wrong" ? g.trackName : ""}</span>
                            {g.artistNames?.length ? (
                              <span style={{ color: '#94a3b8' }}> {o.text === "Wrong" ? g.artistNames.join(', ') : ""}</span>
                            ) : null}
                            <span style={{ marginLeft: 6, color: o.color }}>({o.text})</span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={handleReveal} disabled={actionBusy === 'reveal' || round.status === 'revealed'}>
          {actionBusy === 'reveal' ? 'Revealing…' : 'Reveal Now'}
        </button>
        <button onClick={handleStart} disabled={actionBusy === 'start' || round.status !== 'revealed'}>
          {actionBusy === 'start' ? 'Loading…' : 'Next Song'}
        </button>
        <button onClick={onAdvance}>Next Stage</button>
      </div>

      {error && <div style={{ color: 'salmon' }}>{error}</div>}
    </div>
  );
};
