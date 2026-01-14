import { FC, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
  onAdvance: () => void;
};

export const GuessWrappedHost: FC<Props> = ({ roomCode, gameState, onAdvance }) => {
  const round = (gameState.currentRoundState as GuessWrappedRoundState | null) ?? null;
  const players = gameState.players || [];
  const [busy, setBusy] = useState<"prompt" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const votes = round?.results?.votes || {};
  const sortedVotes = useMemo(() => {
    return [...players].sort((a, b) => {
      const aVotes = a.socketId ? votes[a.socketId] || 0 : 0;
      const bVotes = b.socketId ? votes[b.socketId] || 0 : 0;
      return bVotes - aVotes;
    });
  }, [players, votes]);

  const ownerSocketId = round?.results?.ownerSocketId;
  const ownerPlayer = ownerSocketId
    ? players.find((p) => p.socketId === ownerSocketId)
    : null;

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
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", color: "#ffffffff" }}>
      <section style={{ background: "#14181f", padding: "1.5rem", borderRadius: 12 }}>
        <div style={{ fontSize: 12, color: "#8091b0", textTransform: "uppercase", letterSpacing: 1 }}>
          {prompt.year} Spotify Wrapped
        </div>
        <h2 style={{ margin: "0.4rem 0 0.8rem" }}>{prompt.minutesListened.toLocaleString()} minutes listened</h2>
        {prompt.topGenre && (
          <div style={{ color: "#a0b9ff" }}>
            Top genre: <strong>{prompt.topGenre}</strong>
          </div>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 12 }}>
          <h3 style={{ marginBottom: 12 }}>Top Artists</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topArtists.map((artist, index) => (
              <li key={artist.name + index} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{artist.name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {artist.playCount} play{artist.playCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#10141c", padding: "1rem", borderRadius: 12 }}>
          <h3 style={{ marginBottom: 12 }}>Top Songs</h3>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {prompt.topSongs.map((song, index) => (
              <li key={song.track + song.artist + index} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{song.track}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{song.artist}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Status: {round.status === "revealed" ? "Revealed" : "Collecting guesses"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {sortedVotes.map((player) => {
            const socketId = player.socketId;
            if (!socketId) return null;
            const voteCount = votes[socketId] || 0;
            const isOwner = ownerSocketId && socketId === ownerSocketId;
            return (
              <div
                key={socketId}
                style={{
                  borderRadius: 10,
                  padding: "0.85rem",
                  border: "1px solid #1f2b3d",
                  background: isOwner ? "#12223a" : "#0d131f",
                }}
              >
                <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>{voteCount} vote(s)</div>
              </div>
            );
          })}
        </div>
        {ownerPlayer && round.status === "revealed" && (
          <div style={{ marginTop: 12, fontWeight: 600, background: "#102038" }}>
            Correct answer: {ownerPlayer.displayName || ownerPlayer.name}
          </div>
        )}
        {round.results?.winners?.length ? (
          <div style={{ marginTop: 12, background: "#102038", padding: "1rem", borderRadius: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Players who guessed correctly:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {round.results.winners.map((socketId) => {
                const winner = players.find((p) => p.socketId === socketId);
                return winner ? (
                  <span
                    key={socketId}
                    style={{
                      padding: "4px 10px",
                      background: "#1c3553",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    {winner.displayName || winner.name}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
      </section>

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
