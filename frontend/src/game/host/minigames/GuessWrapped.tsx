import { useVoteTally } from "game/hooks/useVoteTally";
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState, GuessWrappedSummary } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useTrackPreview } from "game/hooks/useTrackPreview";

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
      }, 3500);
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
    if (!round || round.status === "revealed") return 1;
    if (!round.expiresAt || remainingMs === null) return 1;
    const elapsed = Math.min(totalDurationMs, Math.max(0, totalDurationMs - remainingMs));
    return totalDurationMs ? Math.min(1, Math.max(0, elapsed / totalDurationMs)) : 1;
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

  if (!round || round.minigameId !== "GUESS_SPOTIFY_WRAPPED") {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p>No Spotify Wrapped summary yet.</p>
        <button onClick={handleStartRound} disabled={busy === "prompt"}>
          {busy === "prompt" ? "Preparing..." : "Generate Wrapped"}
        </button>
        {error && <p style={{ color: "salmon" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", color: "#ffffffff" }}>
      <section style={{ background: "#14181f", padding: "1.5rem", borderRadius: 12 }}>
        <div style={{ fontSize: 20, textTransform: "uppercase", letterSpacing: 1 }}>
          {isYearRevealed ? prompt.year : renderRedacted(String(prompt.year), false)} Spotify Wrapped
        </div>
        <h3 style={{ margin: "0.4rem 0 0.8rem" }}>{minutesLabel}</h3>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 12 }}>
          <h3 style={{ marginBottom: 12 }}>Top Artists</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topArtists.map((artist, index) => (
              <li key={artist.name + index} style={{ marginBottom: 8 }}>
                {(() => {
                  const entryKey = `artist-${index}`;
                  const isRevealed = revealedKeySet.has(entryKey);
                  const isPreviewArtist =
                    previewTarget?.type === "artist" && previewTarget.index === index && isRevealed;
                  return (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {isRevealed && artist.imageUrl ? (
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {renderRedacted(artist.name, isRevealed)}
                      {isPreviewArtist && isPlaying && <span title="Preview playing">🔊</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {renderRedacted(
                        `${artist.playCount.toLocaleString()} play${artist.playCount === 1 ? "" : "s"}`,
                        isRevealed
                      )}
                    </div>
                  </div>
                </div>
                  );
                })()}
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 8 }}>
          <h3 style={{ marginBottom: 12 }}>Top Songs</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topSongs.map((song, index) => (
              <li key={song.track + song.artist + index} style={{ marginBottom: 8 }}>
                {(() => {
                  const entryKey = `song-${index}`;
                  const isRevealed = revealedKeySet.has(entryKey);
                  const isPreviewSong =
                    previewTarget?.type === "song" && previewTarget.index === index && isRevealed;
                  return (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {isRevealed && song.imageUrl ? (
                    <img
                      src={song.imageUrl}
                      alt={song.track}
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {renderRedacted(song.track, isRevealed)}
                      {isPreviewSong && isPlaying && <span title="Preview playing">🔊</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {renderRedacted(song.artist, isRevealed)}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {renderRedacted(
                        `${song.playCount.toLocaleString()} play${song.playCount === 1 ? "" : "s"}`,
                        isRevealed
                      )}
                    </div>
                  </div>
                </div>
                  );
                })()}
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 8 }}>
          <h3 style={{ marginBottom: 12 }}>Top Genres</h3>
          {prompt.topGenres?.length ? (
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              {prompt.topGenres.map((genre, index) => (
                <li key={genre.genre} style={{ marginBottom: 8 }}>
                  {(() => {
                    const entryKey = `genre-${index}`;
                    const isRevealed = revealedKeySet.has(entryKey);
                    return (
                      <>
                        <div style={{ fontWeight: 600 }}>{renderRedacted(genre.genre, isRevealed)}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                          {renderRedacted(
                            `${genre.plays.toLocaleString()} play${genre.plays === 1 ? "" : "s"}`,
                            isRevealed
                          )}
                        </div>
                      </>
                    );
                  })()}
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ fontSize: 14, color: "#a0b9ff", fontWeight: 600 }}>
              No genre data
            </div>
          )}
        </div>
      </section>

      <div >
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

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={handleReveal} disabled={busy === "reveal" || round.status === "revealed"}>
          {busy === "reveal" ? "Revealing..." : "Reveal Owner"}
        </button>
        <button onClick={handleStartRound} disabled={busy === "prompt"}>
          {busy === "prompt" ? "Preparing..." : "New Wrapped"}
        </button>
        <button onClick={onAdvance}>Next Stage</button>
      </div>

      {error && <div style={{ color: "salmon" }}>{error}</div>}
    </div>
  );
};
