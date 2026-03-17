import { useVoteTally } from "game/hooks/useVoteTally";
import { CSSProperties, FC, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState, GuessWrappedSummary } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useTrackPreview } from "game/hooks/useTrackPreview";
import { useAutoFitScale } from "game/hooks/useAutoFitScale";
import { useHostSfx } from "game/hooks/useHostSfx";
import {
  HostActionRow,
  HostCard,
  HostMinigameStack,
} from "./components/HostMinigamePrimitives";
import "./styles/GuessWrapped.css";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
  remainingMs: number | null;
};

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

export const GuessWrappedHost: FC<Props> = ({
  roomCode,
  gameState,
  onAdvance,
  onRevealComplete,
  remainingMs,
}) => {
  const round = (gameState.currentRoundState as GuessWrappedRoundState | null) ?? null;
  const players = gameState.players || [];
  const [busy, setBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextPromptTimeoutRef = useRef<number | null>(null);
  const busyRef = useRef<"prompt" | "reveal" | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const previousWrappedRevealCountRef = useRef<number | null>(null);
  const previousWrappedRoundIdRef = useRef<string | null>(null);
  const previousWrappedStatusRef = useRef<string | null>(null);
  const { playWrappedEntryReveal, playRevealComplete } = useHostSfx();

  const votes = round?.results?.votes || {}; 
  const ownerPlayerId = round?.results?.ownerPlayerId;
  const roundStatus = round?.status || "pending";

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    roundIdRef.current = round?.id ?? null;
  }, [round?.id]);

  const { voteEntries, finalTally, totalVotes } = useVoteTally({
    players,
    answers: round?.answers,
    totals: votes,
  });

  const { revealComplete, revealedVoteMap, revealedTally } = useVoteReveal({
    status: roundStatus,
    voteEntries,
    totalVotes,
  });

  const handleStartRound = () => {
    if (!roomCode) return;
    if (nextPromptTimeoutRef.current) {
      window.clearTimeout(nextPromptTimeoutRef.current);
      nextPromptTimeoutRef.current = null;
    }
    setBusy("prompt");
    setError(null);
    socket.emit("minigame:GUESS_SPOTIFY_WRAPPED:startRound", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setBusy(null);
      if (!resp?.ok) setError(resp?.error || "Unable to load Spotify Wrapped summary");
    });
  };

  const handleReveal = () => {
    if (!roomCode) return;
    setBusy("reveal");
    setError(null);
    socket.emit("minigame:GUESS_SPOTIFY_WRAPPED:reveal", { roomCode }, (resp?: { ok: boolean; error?: string }) => {
      setBusy(null);
      if (!resp?.ok) setError(resp?.error || "Unable to reveal results");
    });
  };

  useEffect(() => {
    if (!roomCode) return;
    if (round) return;
    if (busy === "prompt") return;
    if (error) return;
    handleStartRound();
  }, [round, roomCode, busy, error]);

  useEffect(() => {
    if (!revealComplete) return;
    const revealRoundId = roundIdRef.current;
    onRevealComplete(() => {
      if (!roomCode) return;
      if (!revealRoundId || roundIdRef.current !== revealRoundId) return;
      if (busyRef.current === "prompt") return;
      
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
      nextPromptTimeoutRef.current = window.setTimeout(() => {
        if (!revealRoundId || roundIdRef.current !== revealRoundId) return;
        if (busyRef.current === "prompt") return;
        handleStartRound();
      }, 3000);
    });

    return () => {
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
    };
  }, [revealComplete]);

  useEffect(() => {
    return () => {
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
    };
  }, []);

  const previewTrackName = round?.prompt?.topSongs?.[0]?.track;
  const promptArtistName = round?.prompt?.topSongs?.[0]?.artist;
  const safePrompt: GuessWrappedSummary = useMemo(() => {
    return (
      round?.prompt ?? {
        year: new Date().getFullYear(),
        minutesListened: 0,
        topGenres: [],
        topArtists: [],
        topSongs: [],
      }
    );
  }, [round?.prompt]);
  const totalDurationMs = useMemo(() => {
    if (round?.startedAt && round?.expiresAt) {
      return Math.max(1000, round.expiresAt - round.startedAt);
    }
    return 40000;
  }, [round?.expiresAt, round?.startedAt]);

  const revealProgress = useMemo(() => {
    if (!round) return 0;
    if (round.status === "revealed") return 1;
    if (!round.expiresAt) return 0;

    const liveRemainingMs =
      remainingMs !== null ? remainingMs : Math.max(0, round.expiresAt - Date.now());
    const elapsed = Math.min(totalDurationMs, Math.max(0, totalDurationMs - liveRemainingMs));

    return totalDurationMs ? Math.min(1, Math.max(0, elapsed / totalDurationMs)) : 0;
  }, [round, remainingMs, totalDurationMs]);

  const revealIntervalCount = 8;

  const hashString = (value: string) => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  const mulberry32 = (seed: number) => {
    let t = seed;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  const entryKeys = useMemo(() => {
    const keys: string[] = [];
    keys.push("year");
    keys.push("minutes");
    safePrompt.topArtists.forEach((_, index) => keys.push(`artist-${index}`));
    safePrompt.topSongs.forEach((_, index) => keys.push(`song-${index}`));
    safePrompt.topGenres?.forEach((_, index) => keys.push(`genre-${index}`));
    return keys;
  }, [safePrompt.topArtists, safePrompt.topSongs, safePrompt.topGenres]);

  const revealOrder = useMemo(() => {
    if (!round?.id) return entryKeys;
    const rng = mulberry32(hashString(round.id));
    const shuffled = [...entryKeys];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [entryKeys, round?.id]);

  const revealCount = useMemo(() => {
    if (round?.status === "revealed") return entryKeys.length;
    if (!entryKeys.length) return 0;
    const intervalIndex = Math.floor(revealProgress * revealIntervalCount);
    return Math.min(entryKeys.length, Math.max(1, intervalIndex + 1));
  }, [entryKeys.length, revealProgress, round?.status]);

  useEffect(() => {
    if (!round?.id) {
      previousWrappedRevealCountRef.current = null;
      previousWrappedRoundIdRef.current = null;
      previousWrappedStatusRef.current = null;
      return;
    }

    const isNewRound = previousWrappedRoundIdRef.current !== round.id;
    if (isNewRound) {
      previousWrappedRoundIdRef.current = round.id;
      previousWrappedRevealCountRef.current = revealCount;
      previousWrappedStatusRef.current = round.status;
      return;
    }

    const previousRevealCount = previousWrappedRevealCountRef.current ?? revealCount;
    if (revealCount > previousRevealCount) {
      playWrappedEntryReveal({
        progress: revealCount,
        total: entryKeys.length,
      });
    }

    previousWrappedRevealCountRef.current = revealCount;
    previousWrappedStatusRef.current = round.status;
  }, [
    round?.id,
    round?.status,
    revealCount,
    entryKeys.length,
    playWrappedEntryReveal,
  ]);

  const revealedKeySet = useMemo(() => {
    if (round?.status === "revealed") return new Set(entryKeys);
    return new Set(revealOrder.slice(0, revealCount));
  }, [entryKeys, revealCount, revealOrder, round?.status]);

  const latestPreviewKey = useMemo(() => {
    if (!revealCount) return null;
    const revealedKeys = revealOrder.slice(0, revealCount);
    for (let i = revealedKeys.length - 1; i >= 0; i -= 1) {
      const key = revealedKeys[i];
      if (key.startsWith("song-") || key.startsWith("artist-")) return key;
    }
    return null;
  }, [revealCount, revealOrder]);

  const previewTarget = useMemo(() => {
    if (!latestPreviewKey) return null;
    const [type, indexString] = latestPreviewKey.split("-");
    const index = Number(indexString);
    if (!Number.isFinite(index)) return null;
    if (type === "song") {
      const song = safePrompt.topSongs[index];
      return song ? { type: "song" as const, index, song } : null;
    }
    if (type === "artist") {
      const artist = safePrompt.topArtists[index];
      return artist ? { type: "artist" as const, index, artist } : null;
    }
    return null;
  }, [latestPreviewKey, safePrompt.topArtists, safePrompt.topSongs]);

  const allowPreview = round?.status === "revealed" || !!previewTarget;
  const { isPlaying } = useTrackPreview({
    trackName:
      previewTarget?.type === "song" ? previewTarget.song.track : previewTrackName,
    artistName:
      previewTarget?.type === "song"
        ? previewTarget.song.artist
        : previewTarget?.type === "artist"
        ? previewTarget.artist.name
        : promptArtistName,
    previewKey:
      previewTarget?.type === "song"
        ? previewTarget.song.track || previewTarget.song.artist
        : previewTarget?.type === "artist"
        ? previewTarget.artist.name
        : previewTrackName || promptArtistName,
    enabled: allowPreview,
    volume: round?.status === "revealed" ? 0.1 : 0.3,
    kind: previewTarget?.type === "artist" ? "artist" : "track",
  });

  const renderRedacted = (text: string, isRevealed: boolean): ReactNode => {
    if (isRevealed || round?.status === "revealed") return text;
    return (
      <span
        className="gw-redacted"
        style={{ "--gw-redacted-chars": Math.max(text.length, 6) } as CSSProperties}
        aria-label="Hidden until reveal"
      >
        {text || "hidden"}
      </span>
    );
  };

  const prompt = round?.prompt ?? safePrompt;
  const ownerProfile = round?.ownerProfile || round?.results?.ownerProfile;
  const isRevealed = round?.status === "revealed";
  const ownerRevealReady = isRevealed && revealComplete;
  const getEntryRevealDelay = (index: number) => {
    if (!isRevealed) return "0ms";
    return `${Math.min(index * 120, 600)}ms`;
  };
  const resolveRevealClass = (
    itemRevealed: boolean,
    revealedClass: string,
    finalRevealClass: string
  ) => {
    if (!itemRevealed) return undefined;
    return isRevealed ? finalRevealClass : revealedClass;
  };
  const isYearRevealed = isRevealed || revealedKeySet.has("year");
  const isMinutesRevealed = isRevealed || revealedKeySet.has("minutes");
  const yearRevealClass = resolveRevealClass(
    isYearRevealed,
    "gw-host-hero-key--revealed",
    "gw-host-hero-key--final-reveal"
  );
  const minutesRevealClass = resolveRevealClass(
    isMinutesRevealed,
    "gw-host-hero-key--revealed",
    "gw-host-hero-key--final-reveal"
  );
  const minutesLabel: ReactNode = isMinutesRevealed
    ? `${prompt.minutesListened.toLocaleString()} minutes listened`
    : renderRedacted(`${prompt.minutesListened.toLocaleString()} minutes listened`, false);
  const revealPercent = Math.round(revealProgress * 100);
  const { viewportRef: fitViewportRef, canvasRef: fitCanvasRef, syncScale } =
    useAutoFitScale({ allowUpscale: true });
  const currentMinigameId = round?.minigameId;

  useLayoutEffect(() => {
    if (currentMinigameId !== "GUESS_SPOTIFY_WRAPPED") return;
    syncScale({ mode: "snap" });
    const rafId = window.requestAnimationFrame(() => syncScale({ mode: "snap" }));
    const timeoutId = window.setTimeout(() => syncScale({ mode: "snap" }), 160);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [
    currentMinigameId,
    round?.id,
    round?.status,
    revealComplete,
    syncScale,
  ]);

  if (!round || round.minigameId !== "GUESS_SPOTIFY_WRAPPED") {
    return (
      <HostCard padded className="host-minigame-state">
        <p>No Spotify Wrapped summary yet.</p>
        <button className="game-shell-button" onClick={handleStartRound} disabled={busy === "prompt"}>
          {busy === "prompt" ? "Preparing..." : "Generate Wrapped"}
        </button>
        {error && <p className="host-minigame-error">{error}</p>}
      </HostCard>
    );
  }

  return (
    <div ref={fitViewportRef} className="gw-host-fit-viewport">
      <div className="gw-host-fit-center">
        <div ref={fitCanvasRef} className="gw-host-fit-canvas">
          <HostMinigameStack className="gw-host-stack">
      <HostCard padded>
        <div
          className="gw-host-hero-row"
        >
          <div>
            <div className="gw-host-hero-identity">
              <div className="gw-host-hero-avatar-slot">
                <div className={joinClasses("gw-mystery-avatar", ownerRevealReady && "gw-mystery-avatar--revealed")}>
                  {ownerRevealReady && ownerProfile?.avatar ? (
                    <img
                      src={ownerProfile.avatar}
                      alt={ownerProfile.displayName || "Owner"}
                      style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                    />
                  ) : (
                    <span>?</span>
                  )}
                </div>
              </div>
              <div className="gw-host-hero-copy">
                <div className={joinClasses("gw-host-hero-owner", ownerRevealReady && "gw-host-hero-owner--revealed")}>
                  {ownerRevealReady && ownerProfile?.displayName ? ownerProfile.displayName + "'s" : "Whose"}
                </div>
                <div className="gw-host-hero-title">
                  <span
                    className={joinClasses("gw-host-hero-key", "gw-host-hero-key--year", yearRevealClass)}
                    style={{ "--gw-key-delay": "0ms" } as CSSProperties}
                  >
                    {isYearRevealed ? prompt.year : renderRedacted(String(prompt.year), false)}
                  </span>{" "}
                  Spotify Wrapped
                </div>
                <div className="gw-host-hero-minutes">
                  <span
                    className={joinClasses("gw-host-hero-key", "gw-host-hero-key--minutes", minutesRevealClass)}
                    style={{ "--gw-key-delay": isRevealed ? "120ms" : "0ms" } as CSSProperties}
                  >
                    {minutesLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="gw-host-progress">
            <div className="host-minigame-progress-label">
              Reveal Progress
            </div>
            <div className="host-minigame-progress-track">
              <div
                className="host-minigame-progress-fill"
                style={{
                  width: `${revealPercent}%`,
                  background:
                    roundStatus === "revealed"
                      ? "linear-gradient(90deg, #4ade80, #22c55e)"
                      : "linear-gradient(90deg, #60a5fa, #3b82f6)",
                }}
              />
            </div>
            <div className="host-minigame-progress-value">{revealPercent}%</div>
          </div>
        </div>
      </HostCard>

      <section className="host-minigame-grid">
        <HostCard padded>
          <h3 className="host-minigame-section-title">Top Artists</h3>
          <ol className="host-minigame-list">
            {prompt.topArtists.map((artist, index) => {
              const entryKey = `artist-${index}`;
              const isEntryRevealed = revealedKeySet.has(entryKey);
              const entryRevealClass = resolveRevealClass(
                isEntryRevealed,
                "gw-host-entry--revealed",
                "gw-host-entry--final-reveal"
              );
              const isPreviewArtist =
                previewTarget?.type === "artist" && previewTarget.index === index && isEntryRevealed;

              return (
                <li
                  key={artist.name + index}
                  className={joinClasses(
                    "gw-host-entry",
                    "gw-host-entry--media",
                    !isEntryRevealed && "gw-host-entry--concealed",
                    entryRevealClass
                  )}
                  style={{
                    "--gw-reveal-delay": getEntryRevealDelay(index),
                  } as CSSProperties}
                >
                  <div className="gw-host-entry-body">
                    <span className="gw-host-entry-rank" style={{ width: 14 }}>
                      {index + 1}
                    </span>
                    <div className="gw-host-entry-art" aria-hidden={!isEntryRevealed}>
                      {isEntryRevealed && artist.imageUrl ? (
                        <img
                          src={artist.imageUrl}
                          alt={artist.name}
                          className="gw-host-entry-art-image"
                        />
                      ) : null}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {artist.name}
                        {isPreviewArtist && isPlaying && <span title="Preview playing">🔊</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {`${artist.playCount.toLocaleString()} play${artist.playCount === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </HostCard>
        <HostCard padded>
          <h3 className="host-minigame-section-title">Top Songs</h3>
          <ol className="host-minigame-list">
            {prompt.topSongs.map((song, index) => {
              const entryKey = `song-${index}`;
              const isEntryRevealed = revealedKeySet.has(entryKey);
              const entryRevealClass = resolveRevealClass(
                isEntryRevealed,
                "gw-host-entry--revealed",
                "gw-host-entry--final-reveal"
              );
              const isPreviewSong =
                previewTarget?.type === "song" && previewTarget.index === index && isEntryRevealed;

              return (
                <li
                  key={song.track + song.artist + index}
                  className={joinClasses(
                    "gw-host-entry",
                    "gw-host-entry--compact",
                    "gw-host-entry--media",
                    !isEntryRevealed && "gw-host-entry--concealed",
                    entryRevealClass
                  )}
                  style={{
                    "--gw-reveal-delay": getEntryRevealDelay(index),
                  } as CSSProperties}
                >
                  <div className="gw-host-entry-body">
                    <span className="gw-host-entry-rank" style={{ width: 14 }}>
                      {index + 1}
                    </span>
                    <div className="gw-host-entry-art" aria-hidden={!isEntryRevealed}>
                      {isEntryRevealed && song.imageUrl ? (
                        <img
                          src={song.imageUrl}
                          alt={song.track}
                          className="gw-host-entry-art-image"
                        />
                      ) : null}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {song.track}
                        {isPreviewSong && isPlaying && <span title="Preview playing">🔊</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {song.artist}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {`${song.playCount.toLocaleString()} play${song.playCount === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </HostCard>
        <HostCard padded>
          <h3 className="host-minigame-section-title">Top Genres</h3>
          {prompt.topGenres?.length ? (
            <ol className="host-minigame-list">
              {prompt.topGenres.map((genre, index) => {
                const entryKey = `genre-${index}`;
                const isEntryRevealed = revealedKeySet.has(entryKey);
                const entryRevealClass = resolveRevealClass(
                  isEntryRevealed,
                  "gw-host-entry--revealed",
                  "gw-host-entry--final-reveal"
                );

                return (
                  <li
                    key={genre.genre}
                    className={joinClasses(
                      "gw-host-entry",
                      "gw-host-entry--text-only",
                      !isEntryRevealed && "gw-host-entry--concealed",
                      entryRevealClass
                    )}
                    style={{
                      "--gw-reveal-delay": getEntryRevealDelay(index),
                    } as CSSProperties}
                  >
                    <div className="gw-host-entry-body">
                      <span className="gw-host-entry-rank" style={{ width: 14 }}>
                        {index + 1}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{genre.genre}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                          {`${genre.plays.toLocaleString()} play${genre.plays === 1 ? "" : "s"}`}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div style={{ fontSize: 14, color: "#a0b9ff", fontWeight: 600 }}>
              No genre data
            </div>
          )}
        </HostCard>
      </section>

      <div>
        <PlayerVotes
          status={round.status}
          players={players}
          finalTally={finalTally}
          revealedTally={revealedTally}
          revealedVoteMap={revealedVoteMap}
          revealComplete={revealComplete}
          topSocketIds={ownerPlayerId ? [ownerPlayerId] : []}
          submittedSocketIds={Object.keys(round.answers || {})}
          showSubmissionChecks
        />
      </div>

      <HostActionRow>
        <button
          className="game-shell-button"
          onClick={handleReveal}
          disabled={busy === "reveal" || round.status === "revealed"}
        >
          {busy === "reveal" ? "Revealing..." : "Reveal Owner"}
        </button>
        <button
          className="game-shell-button"
          onClick={handleStartRound}
          disabled={busy === "prompt"}
        >
          {busy === "prompt" ? "Preparing..." : "New Wrapped"}
        </button>
        <button className="game-shell-button" onClick={onAdvance}>Next Stage</button>
      </HostActionRow>

            {error && <div className="host-minigame-error">{error}</div>}
          </HostMinigameStack>
        </div>
      </div>
    </div>
  );
};
