import { FC, useEffect, useMemo, useRef, useState } from 'react';
import api from 'lib/api';
import { socket } from 'socket';
import { GameState, HeardleRoundState } from 'types/game';
import { useTrackPreview } from '../../hooks/useTrackPreview';
import {
  HostActionRow,
  HostCard,
  HostMinigameStack,
  HostStateMessage,
} from './components/HostMinigamePrimitives';
import './styles/Heardle.css';

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
    return <div className="heardle-pattern-empty">—</div>;
  }

  return (
    <div className="heardle-pattern">
      {Array.from(pattern).map((char, idx) => {
        if (char === ' ') {
          return <span key={`space-${idx}`} className="heardle-pattern-space" />;
        }

        return (
          <span key={`char-${idx}`} className="heardle-pattern-char">
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

  const outcomeChip = (outcome?: string | null) => {
    if (outcome === 'correct') return { text: '✓ Correct', className: 'heardle-player-outcome--correct' };
    if (outcome === 'album_match') return { text: '✕ Album only', className: 'heardle-player-outcome--album' };
    if (outcome === 'artist_match') return { text: '✕ Artist only', className: 'heardle-player-outcome--artist' };
    if (outcome === 'wrong') return { text: '✕ Wrong', className: 'heardle-player-outcome--wrong' };
    if (outcome === 'gave_up') return { text: '>> Gave up', className: 'heardle-player-outcome--gave-up' };
    return { text: 'Waiting…', className: 'heardle-player-outcome--waiting' };
  };

  if (!round) {
    return (
      <HostStateMessage>
        <p>Waiting to start Heardle…</p>
        <button className="game-shell-button" onClick={handleStart} disabled={actionBusy === 'start'}>
          {actionBusy === 'start' ? 'Starting…' : 'Start first song'}
        </button>
        {error && <div className="host-minigame-error heardle-empty-error">{error}</div>}
      </HostStateMessage>
    );
  }

  return (
    <HostMinigameStack className="heardle-host-stack">
      <HostCard padded className="heardle-main-card">
        <div className="heardle-main-content">
          <div className="heardle-round-meta">
            Heardle — Song {round.stageProgress?.songNumber || 1}
            {songsPerGame ? ` / ${songsPerGame}` : ''}
          </div>
          {round.status !== 'revealed' && (
            <div className="heardle-round-submeta">
              Current round: {(round.currentSnippetIndex || 0) + 1} / {snippetPlan.length || 0} ({formatSnippetSeconds(currentSnippetMs)})
            </div>
          )}
          <div className="heardle-prompt-shell">
            <div className="heardle-prompt-layout">
              <div className="heardle-prompt-body">
                {round.status === 'revealed' ? (
                  <>
                    <div className="heardle-revealed-row">
                      {round.song?.imageUrl ? (
                        <img
                          src={round.song.imageUrl}
                          alt={round.song.track_name || 'Song art'}
                          className="heardle-revealed-art"
                        />
                      ) : null}
                      <div className="heardle-revealed-meta">
                        <h2 className="heardle-revealed-title">{round.song?.track_name || '—'}</h2>
                        <div className="heardle-revealed-artist">
                          {round.song?.artist_names?.length ? round.song.artist_names.join(', ') : '—'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : showPatternHints ? (
                  <>
                    {renderPatternSlots(round.hints?.titlePattern)}
                    <div className="heardle-pattern-separator">by</div>
                    {renderPatternSlots(round.hints?.artistPattern)}
                  </>
                ) : (
                  <h2 className="heardle-hidden-title">Hidden until reveal</h2>
                )}
              </div>
            </div>
            {round.status !== 'revealed' && showPatternHints && (
              <div className="heardle-release-year">
                Released in: {yearDisplay}
              </div>
            )}
          </div>
          {round.status !== 'revealed' && maxSnippetMs > 0 && (
            <div className="heardle-playback-section">
              <div className="heardle-playback-title">Playback progress</div>
              <div className="heardle-timeline-track">
                <div
                  className="heardle-timeline-stage-progress"
                  style={{
                    width: `${Math.max(0, Math.min(100, timelineMetrics.stageProgressPct))}%`,
                  }}
                />
                <div
                  className="heardle-timeline-playhead"
                  style={{
                    width: `${Math.max(0, Math.min(100, timelineMetrics.playheadPct))}%`,
                    background: timelineMetrics.isInReplayGap ? 'rgba(56, 189, 248, 0.28)' : '#38bdf8',
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
              <div className="heardle-timeline-label-row">
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
              <div className="heardle-playback-caption">
                {timelineMetrics.isInReplayGap
                  ? `Replaying in ${formatSnippetSeconds(currentSnippetGapMs)}`
                  : `Playing ${formatSnippetSeconds(timelineMetrics.playbackInSnippetMs)} / ${formatSnippetSeconds(currentSnippetMs)}`}
              </div>
              <div className="heardle-playback-status">
                Playback: {playbackError ? playbackError : playbackStatus}
              </div>
            </div>
          )}
        </div>
      </HostCard>

      <div
        className="host-minigame-grid host-minigame-grid--tight"
      >
        {playerGuessStates.map(({ player, outcome, guessedThisSnippet, thisSnippetOutcome }) => {
          const chip = outcomeChip(outcome);
          return (
            <div
              key={player.playerId || player.name}
              className="heardle-player-card"
            >
              <div className="heardle-player-name">{player.displayName || player.name}</div>
              <div className="heardle-player-outcome">
                <span className={chip.className}>{chip.text}</span>
              </div>
              {round.status !== 'revealed' && guessedThisSnippet && (
                <div className="heardle-player-snippet-note">
                  {thisSnippetOutcome === 'gave_up' ? 'Gave up this snippet' : 'Guessed this snippet'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <HostCard padded subtle>
        <div className="heardle-history-title">Guess history</div>
        <div className="heardle-history-grid">
          {players.map((player) => {
            const guesses = player.playerId ? round.answers?.[player.playerId]?.guesses || [] : [];
            return (
              <div
                key={player.playerId || player.name}
                className="heardle-history-card"
              >
                <div className="heardle-history-player">{player.displayName || player.name}</div>
                {guesses.length === 0 && <div className="heardle-history-empty">No guesses yet</div>}
                {guesses.length > 0 && (
                  <div className="heardle-history-list">
                    {guesses
                      .slice()
                      .sort((a, b) => (a.at || 0) - (b.at || 0))
                      .map((g, idx) => {
                        const o = outcomeLabel(g.outcome);
                        return (
                          <div key={`${g.snippetIndex}-${idx}`} className="heardle-history-item">
                            <span className="heardle-history-round-label">Round {g.snippetIndex + 1}: </span>
                            <span className="heardle-history-track">{o.text === "Wrong" ? g.trackName : ""}</span>
                            {g.artistNames?.length ? (
                              <span className="heardle-history-artist"> {o.text === "Wrong" ? g.artistNames.join(', ') : ""}</span>
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
      </HostCard>

      <HostActionRow>
        <button
          className="game-shell-button"
          onClick={handleReveal}
          disabled={actionBusy === 'reveal' || round.status === 'revealed'}
        >
          {actionBusy === 'reveal' ? 'Revealing…' : 'Reveal Now'}
        </button>
        <button
          className="game-shell-button"
          onClick={handleStart}
          disabled={actionBusy === 'start' || round.status !== 'revealed'}
        >
          {actionBusy === 'start' ? 'Loading…' : 'Next Song'}
        </button>
        <button className="game-shell-button" onClick={onAdvance}>Next Stage</button>
      </HostActionRow>

      {error && <div className="host-minigame-error">{error}</div>}
    </HostMinigameStack>
  );
};
