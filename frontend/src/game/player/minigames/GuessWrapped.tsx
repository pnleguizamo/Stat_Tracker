import { FC, useMemo, useState } from "react";
import { socket } from "socket";
import { GameState, GuessWrappedRoundState } from "types/game";

type Props = {
  roomCode: string;
  gameState: GameState;
};

export const GuessWrappedPlayerView: FC<Props> = ({ roomCode, gameState }) => {
  const round =
    gameState.currentRoundState && gameState.currentRoundState.minigameId === "GUESS_SPOTIFY_WRAPPED"
      ? (gameState.currentRoundState as GuessWrappedRoundState)
      : null;
  const players = gameState.players || [];
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const mySocketId = socket.id;
  const myVote = mySocketId && round?.answers?.[mySocketId]?.answer?.targetSocketId
    ? round.answers[mySocketId].answer!.targetSocketId
    : null;

  const votes = round?.results?.votes || {};
  const ownerSocketId = round?.results?.ownerSocketId;
  const ownerPlayer = ownerSocketId ? players.find((p) => p.socketId === ownerSocketId) : null;

  const sortedVotes = useMemo(() => {
    return [...players].sort((a, b) => {
      const aVotes = a.socketId ? votes[a.socketId] || 0 : 0;
      const bVotes = b.socketId ? votes[b.socketId] || 0 : 0;
      return bVotes - aVotes;
    });
  }, [players, votes]);

  function handleVote(targetSocketId: string) {
    if (!roomCode || !targetSocketId) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      "minigame:GUESS_SPOTIFY_WRAPPED:submitAnswer",
      { roomCode, answer: { targetSocketId } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || "Failed to submit vote");
      }
    );
  }

  if (!round) {
    return <div>Waiting for a Spotify Wrapped summary…</div>;
  }

  const { prompt } = round;
  const isRevealed = round.status === "revealed";

  return (
    <>
      {/* <section style={{ background: "#10141c", padding: 16, borderRadius: 12, marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#ffffffff", textTransform: "uppercase", letterSpacing: 1 }}>
          {prompt.year} Spotify Wrapped
        </div>
        <h3 style={{ margin: "6px 0", color: "#ffffffff" }}>{prompt.minutesListened.toLocaleString()} minutes listened</h3>
        {prompt.topGenre && <div style={{ color: "#ffffffff" }}>Top genre: {prompt.topGenre}</div>}
      </section> */}

      {/* <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24, color : "#ffffffff" }}>
        <div style={{ background: "#0f172a", padding: 16, borderRadius: 12 }}>
          <h4>Top Artists</h4>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {prompt.topArtists.map((artist, idx) => (
              <li key={artist.name + idx} style={{ marginBottom: 6 }}>
                <div>{artist.name}</div>
                <div style={{ fontSize: 12 }}>{artist.playCount} play(s)</div>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ background: "#0f172a", padding: 16, borderRadius: 12 }}>
          <h4>Top Songs</h4>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {prompt.topSongs.map((song, idx) => (
              <li key={song.track + song.artist + idx} style={{ marginBottom: 6 }}>
                <div>{song.track}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{song.artist}</div>
              </li>
            ))}
          </ol>
        </div>
      </section> */}

      <section style={{ marginBottom: 24, color : "#ffffffff" }}>
        <div style={{ marginBottom: 8 }}>
          {myVote
            ? `You guessed ${players.find((p) => p.socketId === myVote)?.displayName || "someone"}`
            : "Whose Spotify Wrapped is this?"}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {players.map((player) => {
            const socketId = player.socketId;
            if (!socketId) return null;
            const isSelected = socketId === myVote;
            const isOwner = isRevealed && socketId === ownerSocketId;
            return (
              <button
                key={socketId}
                onClick={() => handleVote(socketId)}
                disabled={voteBusy || isRevealed}
                style={{
                  padding: "0.85rem",
                  borderRadius: 10,
                  border: isSelected ? "2px solid #38bdf8" : "1px solid #1f2933",
                  background: isOwner ? "#1a2b45" : isSelected ? "#0f172a" : "#0b0f17",
                  color: "#fff",
                }}
              >
                <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                {isOwner && <div style={{ fontSize: 12, color: "#34d399" }}>Actual owner</div>}
              </button>
            );
          })}
        </div>
        {voteError && <div style={{ marginTop: 8, color: "salmon" }}>{voteError}</div>}
        {!isRevealed && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#94a3b8" }}>
            Waiting for the host to reveal the owner{voteBusy ? "…" : "."}
          </div>
        )}
      </section>

      {isRevealed && (
        <section style={{ marginBottom: 24 }}>
          <h4>Votes</h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {sortedVotes.map((player) => {
              const socketId = player.socketId;
              if (!socketId) return null;
              const voteCount = votes[socketId] || 0;
              const isOwner = ownerSocketId === socketId;
              return (
                <div
                  key={socketId}
                  style={{
                    padding: "0.85rem",
                    borderRadius: 10,
                    border: "1px solid #1f2933",
                    background: isOwner ? "#132033" : "#0b1019",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>{voteCount} vote(s)</div>
                  {isOwner && <div style={{ fontSize: 12, color: "#34d399" }}>Actual owner</div>}
                </div>
              );
            })}
          </div>
          {ownerPlayer && (
            <div style={{ marginTop: 12, fontWeight: 600 }}>
              Spotify Wrapped belongs to {ownerPlayer.displayName || ownerPlayer.name}
            </div>
          )}
        </section>
      )}
    </>
  );
};
