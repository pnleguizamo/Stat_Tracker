import { FC, useEffect, useMemo, useRef, useState } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HeardleRoundState } from 'types/game';
import { useTrackPreview } from '../../hooks/useTrackPreview';

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

function renderPatternSlots(pattern: string | null | undefined) {
  if (!pattern) {
    return <div style={{ fontFamily: 'monospace', fontSize: 17 }}>—</div>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 4, rowGap: 8 }}>
      {Array.from(pattern).map((char, idx) => {
        if (char === ' ') {
          return <span key={`space-${idx}`} style={{ width: 14, display: 'inline-block' }} />;
        }

        return (
          <span
            key={`char-${idx}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 10,
              // height: 24,
              padding: '0 3px',
              // borderRadius: 4,
              // border: '1px solid #334155',
              // background: '#0b1220',
              color: '#e2e8f0',
              // fontFamily: 'monospace',
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {char}
          </span>
        );
      })}
    </div>
  );
}

function formatSnippetSeconds(ms: number) {
  if (!Number.isFinite(ms)) return '0s';
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}

function getReleaseYear(song?: { releaseDate?: string | null; release_date?: string | null }) {
  const releaseDate = song?.releaseDate || song?.release_date;
  if (!releaseDate || typeof releaseDate !== 'string') return null;
  const match = releaseDate.match(/^(\d{4})/);
  return match?.[1] || null;
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
  const [timelineNowMs, setTimelineNowMs] = useState(Date.now());

  const playerRef = useRef<any>(null);
  const loopInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTrackRef = useRef<string | null>(null);
  const playbackSessionRef = useRef(0);

  const snippetPlan = round?.snippetPlan || [];
  const currentSnippetMs = snippetPlan[round?.currentSnippetIndex || 0] || 0;
  const currentSnippetGapMs = round?.snippetReplayGapPlanMs?.[round.currentSnippetIndex || 0] ?? 2000;
  const maxSnippetMs = snippetPlan.length ? Math.max(...snippetPlan) : 0;
  const songsPerGame =
    round?.stageProgress?.songsPerGame;
  const showPatternHints = round?.status !== 'revealed' && !!round?.hints?.showPattern;
  const displayYear =
    round?.status === 'revealed'
      ? getReleaseYear(round?.song)
      : round?.hints?.showYear
      ? round?.hints?.year || null
      : null;
  const yearDisplay = displayYear || '_ _ _ _';

  const timelineMetrics = useMemo(() => {
    if (!round || round.status === 'revealed' || !currentSnippetMs || !maxSnippetMs) {
      return {
        stageProgressPct: maxSnippetMs > 0 ? (currentSnippetMs / maxSnippetMs) * 100 : 0,
        playheadPct: 0,
        playbackInSnippetMs: 0,
        isInReplayGap: false,
      };
    }
    const stageProgressPct = (currentSnippetMs / maxSnippetMs) * 100;
    const snippetStartedAt = round.snippetStartedAt || round.startedAt || timelineNowMs;
    const elapsedSinceSnippetStart = Math.max(0, timelineNowMs - snippetStartedAt);
    const loopCycleMs = Math.max(1, currentSnippetMs + currentSnippetGapMs);
    const loopPositionMs = elapsedSinceSnippetStart % loopCycleMs;
    const isInReplayGap = loopPositionMs >= currentSnippetMs;
    const playbackInSnippetMs = Math.min(currentSnippetMs, loopPositionMs);
    const playheadPct = (playbackInSnippetMs / maxSnippetMs) * 100;
    return {
      stageProgressPct,
      playheadPct,
      playbackInSnippetMs,
      isInReplayGap,
    };
  }, [round, timelineNowMs, currentSnippetMs, currentSnippetGapMs, maxSnippetMs]);

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
    if (!round || round.status === 'revealed') return;
    const id = setInterval(() => setTimelineNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [round?.id, round?.status, round?.currentSnippetIndex]);

  useEffect(() => {
    // restart snippet loop on song or snippet change
    if (!round || !round.song?.uri || !deviceId || !token) return;
    if (round.status === 'revealed') {
      stopSnippetLoop();
      return;
    }
    const durationMs = currentSnippetMs || 1000;
    startSnippetLoop(durationMs, round.song.uri, currentSnippetGapMs);
    return () => {
      stopSnippetLoop();
    };
  }, [round?.song?.id, round?.currentSnippetIndex, deviceId, token, round?.status, currentSnippetMs, currentSnippetGapMs]);

  useTrackPreview({
    trackName: round?.song?.track_name ?? undefined,
    artistName: round?.song?.artist_names?.[0] ?? undefined,
    previewKey: (round?.song?.id || round?.song?.track_name) ?? undefined,
    enabled: round?.status === 'revealed',
    volume: 0.4,
  });

  useEffect(() => {
    return () => {
      stopSnippetLoop();
    };
  }, []);

  const startSnippetLoop = async (durationMs: number, uri: string, replayGapMs: number) => {
    if (!playerRef.current || !deviceId || !token || !uri) return;
    try {
      stopSnippetLoop();
      const sessionId = playbackSessionRef.current;
      if (currentTrackRef.current !== uri) {
        await transferAndPlay(token, deviceId, uri);
        currentTrackRef.current = uri;
      } else {
        await playerRef.current.seek(0);
        await playerRef.current.resume();
      }
      await waitForPlaybackStart(sessionId);
      if (sessionId !== playbackSessionRef.current) return;
      pauseTimeout.current = setTimeout(() => {
        playerRef.current?.pause?.().catch(() => {});
      }, durationMs);

      loopInterval.current = setInterval(async () => {
        try {
          await playerRef.current?.seek?.(0);
          await playerRef.current?.resume?.();
          await waitForPlaybackStart(sessionId);
          if (sessionId !== playbackSessionRef.current) return;
          if (pauseTimeout.current) clearTimeout(pauseTimeout.current);
          pauseTimeout.current = setTimeout(() => {
            playerRef.current?.pause?.().catch(() => {});
          }, durationMs);
        } catch (err) {
          console.warn('snippet loop failed', err);
        }
      }, Math.max(durationMs + replayGapMs, durationMs + 500));
    } catch (err: any) {
      console.error(err);
      setPlaybackError(err.message || 'Unable to play snippet');
    }
  };

  const stopSnippetLoop = () => {
    playbackSessionRef.current += 1;
    if (pauseTimeout.current) clearTimeout(pauseTimeout.current);
    if (loopInterval.current) clearInterval(loopInterval.current);
    pauseTimeout.current = null;
    loopInterval.current = null;
    playerRef.current?.pause?.().catch(() => { });
  };

  const waitForPlaybackStart = (sessionId: number, timeoutMs = 3000) =>
    new Promise<void>((resolve) => {
      const start = Date.now();
      const check = async () => {
        if (sessionId !== playbackSessionRef.current) return resolve();
        const player = playerRef.current;
        if (!player) return resolve();
        try {
          const state = await player.getCurrentState();
          const started = !!state && !state.paused && state.position > 0 && !state.loading;
          if (started) {
            return resolve();
          }
        } catch (err) {
          console.warn('Playback start check failed', err);
        }
        if (Date.now() - start >= timeoutMs) return resolve();
        setTimeout(check, 100);
      };
      check();
    });

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
      const g = p.playerId ? round.answers?.[p.playerId]?.guesses || [] : [];
      return g.some((guess) => guess.snippetIndex === round.currentSnippetIndex) ? count + 1 : count;
    }, 0);
  }, [players, round]);

  const playerGuessStates = useMemo(() => {
    if (!round) return [];
    return players.map((p) => {
      const guesses = p.playerId ? round.answers?.[p.playerId]?.guesses || [] : [];
      const latest = guesses[guesses.length - 1] || null;
      const currentSnippetEntry = [...guesses].reverse().find((g) => g.snippetIndex === round.currentSnippetIndex) || null;
      const summary = p.playerId ? round.results?.guessSummary?.[p.playerId] : null;
      const outcome = summary?.outcome || latest?.outcome || null;
      return {
        player: p,
        outcome,
        guessedThisSnippet: guesses.some((g) => g.snippetIndex === round.currentSnippetIndex),
        thisSnippetOutcome: currentSnippetEntry?.outcome || null,
      };
    });
  }, [players, round]);

   const outcomeLabel = (outcome?: string | null) => {
    if (outcome === 'correct') return { text: 'Correct', color: '#22c55e' };
    if (outcome === 'album_match') return { text: 'Album match', color: '#fbbf24' };
    if (outcome === 'artist_match') return { text: 'Artist match', color: '#f59e0b' };
    if (outcome === 'wrong') return { text: 'Wrong', color: '#f87171' };
    if (outcome === 'gave_up') return { text: 'Gave up', color: '#60a5fa' };
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
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          padding: '1.25rem',
          background: '#0f172a',
          borderRadius: 12,
          width: '100%',
        }}
      >
        <div style={{ color: '#e2e8f0', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 1 }}>
            Heardle — Song {round.stageProgress?.songNumber || 1}
            {songsPerGame ? ` / ${songsPerGame}` : ''}
          </div>
          {round.status !== 'revealed' && <div style={{ marginTop: 5, fontSize: 13, color: '#94a3b8', width: '100%', maxWidth: 960 }}>
            Current round: {(round.currentSnippetIndex || 0) + 1} / {snippetPlan.length || 0} ({formatSnippetSeconds(currentSnippetMs)})
          </div>}
          <div
            style={{
              marginTop: 10,
              // width: '100%',
              // maxWidth: 960,
              padding: '0.75rem',
              // borderRadius: 10,
              // border: '1px solid #1f2937',
              // background: '#0f172a',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ display: 'grid', gap: 8, minWidth: 0, justifyItems: 'center' }}>
                {round.status === 'revealed' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, width: '100%' }}>
                      {round.song?.imageUrl ? (
                        <img
                          src={round.song.imageUrl}
                          alt={round.song.track_name || 'Song art'}
                          style={{ width: 200, height: 200, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : null}
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'start', textAlign: 'left' }}>
                        {/* <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.8 }}>Title</div> */}
                        <h2 style={{ margin: 0, color: '#fff' }}>{round.song?.track_name || '—'}</h2>
                        {/* <div style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.8 }}>Artist</div> */}
                        <div style={{ fontSize: 14, color: '#cbd5e1' }}>
                          {round.song?.artist_names?.length ? round.song.artist_names.join(', ') : '—'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : showPatternHints ? (
                  <>
                    {renderPatternSlots(round.hints?.titlePattern)}
                    <div style={{ fontSize: 18, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: 0.8 }}>by</div>
                    {renderPatternSlots(round.hints?.artistPattern)}
                  </>
                ) : (
                  <h2 style={{ margin: 0, color: '#fff' }}>Hidden until reveal</h2>
                )}
              </div>
            </div>
            {round.status !== 'revealed' && showPatternHints && <div
              style={{
                marginTop: 12,
                minWidth: 56,
                fontSize: 12, textTransform: 'uppercase',
                color: '#94a3b8',
                letterSpacing: 0.8,
              }}
            >
              Released in: {yearDisplay}
            </div>}
          </div>
          {round.status !== 'revealed' && maxSnippetMs > 0 && (
            <div style={{ marginTop: 12, width: '100%', maxWidth: 960 }}>
              <div style={{ fontSize: 14, color: '#cbd5e1', marginBottom: 8, fontWeight: 700 }}>Playback progress</div>
              <div
                style={{
                  position: 'relative',
                  height: 40,
                  borderRadius: 999,
                  border: '1px solid #334155',
                  background: '#0b1220',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.max(0, Math.min(100, timelineMetrics.stageProgressPct))}%`,
                    background: 'rgba(56, 189, 248, 0.18)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.max(0, Math.min(100, timelineMetrics.playheadPct))}%`,
                    background: timelineMetrics.isInReplayGap ? 'rgba(56, 189, 248, 0.28)' : '#38bdf8',
                    transition: 'width 90ms linear',
                  }}
                />
                {snippetPlan.map((ms, idx) => {
                  const leftPct = (ms / maxSnippetMs) * 100;
                  return (
                    <div
                      key={`marker-${ms}-${idx}`}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        top: 0,
                        bottom: 0,
                        width: idx === round.currentSnippetIndex ? 3 : 2,
                        background: idx === round.currentSnippetIndex ? '#ffffff' : '#475569',
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ position: 'relative', height: 24, marginTop: 8 }}>
                {snippetPlan.map((ms, idx) => {
                  const hideFirstLabel = round.currentSnippetIndex > 0 && idx === 0;
                  const hideSecondLabel = round.currentSnippetIndex === 0 && idx === 1;
                  if (hideFirstLabel || hideSecondLabel) return null;

                  const leftPct = (ms / maxSnippetMs) * 100;
                  return (
                    <div
                      key={`marker-label-${ms}-${idx}`}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        transform: 'translateX(-50%)',
                        fontSize: 13,
                        fontWeight: idx === round.currentSnippetIndex ? 700 : 500,
                        color: idx === round.currentSnippetIndex ? '#e2e8f0' : '#94a3b8',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatSnippetSeconds(ms)}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, fontSize: 14, color: '#94a3b8' }}>
                {timelineMetrics.isInReplayGap
                  ? `Replaying in ${formatSnippetSeconds(currentSnippetGapMs)}`
                  : `Playing ${formatSnippetSeconds(timelineMetrics.playbackInSnippetMs)} / ${formatSnippetSeconds(currentSnippetMs)}`}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1' }}>
                Playback: {playbackError ? playbackError : playbackStatus}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {playerGuessStates.map(({ player, outcome, guessedThisSnippet, thisSnippetOutcome }) => (
          <div
            key={player.playerId || player.name}
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
              ) : outcome === 'gave_up' ? (
                <span style={{ color: '#60a5fa' }}>{'>>'} Gave up</span>
              ) : (
                <span style={{ color: '#94a3b8' }}>Waiting…</span>
              )}
            </div>
            {round.status !== 'revealed' && guessedThisSnippet && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#38bdf8' }}>
                {thisSnippetOutcome === 'gave_up' ? 'Gave up this snippet' : 'Guessed this snippet'}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '1rem', borderRadius: 12, background: '#0f172a', color: '#e2e8f0' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Guess history</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {players.map((player) => {
            const guesses = player.playerId ? round.answers?.[player.playerId]?.guesses || [] : [];
            return (
              <div
                key={player.playerId || player.name}
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
