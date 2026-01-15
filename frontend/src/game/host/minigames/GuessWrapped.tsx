import { useVoteTally } from "game/hooks/useVoteTally";
import { FC, useEffect, useRef, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState } from "types/game";
import { PlayerVotes } from "./components/PlayerVotes";
import { useVoteReveal } from "game/hooks/useVoteReveal";
import { useTrackPreview } from "game/hooks/useTrackPreview";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
  onRevealComplete: (onSequenceComplete?: () => void) => void;
};

export const GuessWrappedHost: FC<Props> = ({ roomCode, gameState, onAdvance, onRevealComplete }) => {
  const round = (gameState.currentRoundState as GuessWrappedRoundState | null) ?? null;
  const players = gameState.players || [];
  const [busy, setBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextPromptTimeoutRef = useRef<number | null>(null);

  const votes = round?.results?.votes || {}; 
  const ownerSocketId = round?.results?.ownerSocketId;
  const roundStatus = round?.status || "pending";

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
    onRevealComplete(() => {
      if (!roomCode) return;
      if (busy === "prompt") return;
      
      if (nextPromptTimeoutRef.current) {
        window.clearTimeout(nextPromptTimeoutRef.current);
        nextPromptTimeoutRef.current = null;
      }
      nextPromptTimeoutRef.current = window.setTimeout(() => {
        handleStartRound();
      }, 5000);
    });
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
  const { isPlaying } = useTrackPreview({
    trackName: previewTrackName,
    artistName: promptArtistName,
    previewKey: (previewTrackName || promptArtistName) ?? undefined,
    enabled: round?.status !== "revealed",
    volume: 0.1,
    kind: "track",
  });


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

  const { prompt } = round;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", color: "#ffffffff" }}>
      <section style={{ background: "#14181f", padding: "1.5rem", borderRadius: 12 }}>
        <div style={{ fontSize: 20, textTransform: "uppercase", letterSpacing: 1 }}>
          {prompt.year} Spotify Wrapped
        </div>
        <h3 style={{ margin: "0.4rem 0 0.8rem" }}>{prompt.minutesListened.toLocaleString()} minutes listened</h3>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 12 }}>
          <h3 style={{ marginBottom: 12 }}>Top Artists</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topArtists.map((artist, index) => (
              <li key={artist.name + index} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {artist.imageUrl ? (
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 600 }}>{artist.name}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {artist.playCount} play{artist.playCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 8 }}>
          <h3 style={{ marginBottom: 12 }}>Top Songs</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topSongs.map((song, index) => (
              <li key={song.track + song.artist + index} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {song.imageUrl ? (
                    <img
                      src={song.imageUrl}
                      alt={song.track}
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      {song.track}
                      {index === 0 && isPlaying && <span title="Preview playing">🔊</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{song.artist}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 8 }}>
          <h3 style={{ marginBottom: 12 }}>Top Genres</h3>
          {prompt.topGenres?.length ? (
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              {prompt.topGenres.map((genre) => (
                <li key={genre.genre} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, }}>{genre.genre}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    {genre.plays} play{genre.plays === 1 ? "" : "s"}
                  </div>
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
          topSocketIds={ownerSocketId ? [ownerSocketId] : []}
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
