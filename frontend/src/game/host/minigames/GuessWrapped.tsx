import { useVoteTally } from "game/hooks/useVoteTally";
import { CSSProperties, FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState, GuessWrappedSummary } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useTrackPreview } from "game/hooks/useTrackPreview";
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
    volume: 0.3,
    kind: previewTarget?.type === "artist" ? "artist" : "track",
  });

  const renderRedacted = (text: string, isRevealed: boolean): ReactNode => {
    if (isRevealed || round?.status === "revealed") return text;
    return (
      <span
        style={{
          display: "inline-block",
          background: "#000",
          color: "transparent",
          borderRadius: 2,
          padding: "0 2px",
        }}
      >
        {text || "redacted"}
      </span>
    );
  };

  const prompt = round?.prompt ?? safePrompt;
  const isRevealed = round?.status === "revealed";
  const isYearRevealed = isRevealed || revealedKeySet.has("year");
  const isMinutesRevealed = isRevealed || revealedKeySet.has("minutes");
  const minutesLabel: ReactNode = isMinutesRevealed
    ? `${prompt.minutesListened.toLocaleString()} minutes listened`
    : renderRedacted(`${prompt.minutesListened.toLocaleString()} minutes listened`, false);
  const revealPercent = Math.round(revealProgress * 100);

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
    <HostMinigameStack className="gw-host-stack">
      <HostCard padded>
        <div
          className="gw-host-hero-row"
        >
          <div>
            <div style={{ fontSize: 30, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
              <span
                className={`gw-host-hero-key gw-host-hero-key--year${isYearRevealed ? " gw-host-hero-key--revealed" : ""}`}
                style={{ "--gw-key-delay": "0ms" } as CSSProperties}
              >
                {isYearRevealed ? prompt.year : renderRedacted(String(prompt.year), false)}
              </span>{" "}
              Spotify Wrapped
            </div>
            <h3 style={{ margin: "0.5rem 0 0.8rem", color: "#e2e8f0", fontSize: 22 }}>
              <span
                className={`gw-host-hero-key gw-host-hero-key--minutes${isMinutesRevealed ? " gw-host-hero-key--revealed" : ""}`}
                style={{ "--gw-key-delay": "120ms" } as CSSProperties}
              >
                {minutesLabel}
              </span>
            </h3>
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
              const isPreviewArtist =
                previewTarget?.type === "artist" && previewTarget.index === index && isEntryRevealed;

              return (
                <li
                  key={artist.name + index}
                  className={`gw-host-entry${isEntryRevealed ? " gw-host-entry--revealed" : ""}`}
                  style={{
                    "--gw-reveal-delay": `${index * 70}ms`,
                    borderRadius: 10,
                    padding: "0.65rem 0.7rem",
                    background: "linear-gradient(145deg, rgba(30, 64, 175, 0.2), rgba(15, 23, 42, 0.92))",
                  } as CSSProperties}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="gw-host-entry-rank" style={{ width: 14 }}>
                      {index + 1}
                    </span>
                    {isEntryRevealed && artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt={artist.name}
                        style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                      />
                    ) : null}
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {renderRedacted(artist.name, isEntryRevealed)}
                        {isPreviewArtist && isPlaying && <span title="Preview playing">🔊</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {renderRedacted(
                          `${artist.playCount.toLocaleString()} play${artist.playCount === 1 ? "" : "s"}`,
                          isEntryRevealed
                        )}
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
              const isPreviewSong =
                previewTarget?.type === "song" && previewTarget.index === index && isEntryRevealed;

              return (
                <li
                  key={song.track + song.artist + index}
                  className={`gw-host-entry${isEntryRevealed ? " gw-host-entry--revealed" : ""}`}
                  style={{
                    "--gw-reveal-delay": `${index * 70}ms`,
                    borderRadius: 10,
                    padding: "0.1em 0.7rem",
                    background: "linear-gradient(145deg, rgba(30, 64, 175, 0.2), rgba(15, 23, 42, 0.92))",
                  } as CSSProperties}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="gw-host-entry-rank" style={{ width: 14 }}>
                      {index + 1}
                    </span>
                    {isEntryRevealed && song.imageUrl ? (
                      <img
                        src={song.imageUrl}
                        alt={song.track}
                        style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                      />
                    ) : null}
                    <div>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {renderRedacted(song.track, isEntryRevealed)}
                        {isPreviewSong && isPlaying && <span title="Preview playing">🔊</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {renderRedacted(song.artist, isEntryRevealed)}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {renderRedacted(
                          `${song.playCount.toLocaleString()} play${song.playCount === 1 ? "" : "s"}`,
                          isEntryRevealed
                        )}
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

                return (
                  <li
                    key={genre.genre}
                    className={`gw-host-entry${isEntryRevealed ? " gw-host-entry--revealed" : ""}`}
                    style={{
                      "--gw-reveal-delay": `${index * 70}ms`,
                      borderRadius: 10,
                      padding: "0.65rem 0.7rem",
                      background: "linear-gradient(145deg, rgba(30, 64, 175, 0.2), rgba(15, 23, 42, 0.92))",
                    } as CSSProperties}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span className="gw-host-entry-rank" style={{ width: 14 }}>
                        {index + 1}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{renderRedacted(genre.genre, isEntryRevealed)}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                          {renderRedacted(
                            `${genre.plays.toLocaleString()} play${genre.plays === 1 ? "" : "s"}`,
                            isEntryRevealed
                          )}
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
  );
};
