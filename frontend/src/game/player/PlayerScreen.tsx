import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { GameState, Player } from 'types/game';

const PlayerScreen = () => {
  const params = useParams();
  const roomCode = params.roomCode || '';
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [voteBusy, setVoteBusy] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomCode) return;
    socket.emit('playerJoinGame', { roomCode }, (resp?: { ok: boolean; state?: GameState }) => {
      if (resp?.ok && resp.state) setGameState(resp.state);
    });

    const handler = (state: GameState) => {
      if (state.roomCode !== roomCode) return;
      setGameState(state);
    };
    socket.on('gameStateUpdated', handler);

    return () => {
      socket.off('gameStateUpdated', handler);
    };
  }, [roomCode]);

  const currentRound = gameState?.currentRoundState;
  const players = gameState?.players || [];
  const mySocketId = socket.id;
  const myVote = mySocketId && currentRound?.answers?.[mySocketId]?.answer?.targetSocketId
    ? currentRound?.answers?.[mySocketId]?.answer?.targetSocketId
    : null;
  const currentPhaseLabel =
    gameState?.phase === 'inGame' ? 'In Game' : gameState?.phase === 'completed' ? 'Finished' : (gameState?.phase || 'Waiting');

  const voteTotals = currentRound?.results?.tally || {};
  const sortedResults = useMemo(() => {
    return [...players].sort((a, b) => {
      const aVotes = a.socketId ? voteTotals[a.socketId] || 0 : 0;
      const bVotes = b.socketId ? voteTotals[b.socketId] || 0 : 0;
      return bVotes - aVotes;
    });
  }, [players, voteTotals]);

  function handleVote(targetSocketId: string) {
    if (!roomCode || !targetSocketId) return;
    setVoteBusy(true);
    setVoteError(null);
    socket.emit(
      'minigame:WHO_LISTENED_MOST:submitAnswer',
      { roomCode, answer: { targetSocketId } },
      (resp?: { ok: boolean; error?: string }) => {
        setVoteBusy(false);
        if (!resp?.ok) setVoteError(resp?.error || 'Failed to submit vote');
      }
    );
  }

  function handleLeave() {
    if (roomCode) socket.emit('leaveRoom', { roomCode });
    navigate('/lobby');
  }

  const prompt = currentRound?.prompt;
  const isResultsShown = currentRound?.status === 'revealed';
  const topPlayer = players.find((p: Player) => p.socketId && p.socketId === currentRound?.results?.topListenerSocketId);

  return (
    <div style={{ padding: 16 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ marginBottom: 4 }}>Room {roomCode}</h2>
        <div style={{ color: '#667085', fontSize: 14 }}>Phase: {currentPhaseLabel}</div>
      </header>

      {!prompt && (
        <div style={{ marginBottom: 16 }}>Waiting for the host to start the first prompt…</div>
      )}

      {prompt && (
        <>
          {/* <section
            style={{
              display: 'flex',
              gap: 16,
              padding: 16,
              borderRadius: 12,
              background: '#10141c',
              marginBottom: 24,
            }}
          >
            {prompt.imageUrl ? (
              <img
                src={prompt.imageUrl}
                alt={prompt.title}
                style={{ width: 110, height: 110, borderRadius: 12, objectFit: 'cover' }}
              />
            ) : null}
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                {prompt.type === 'TRACK' ? 'Track' : prompt.type === 'ARTIST' ? 'Artist' : 'Info'}
              </div>
              <h3 style={{ margin: '6px 0' }}>{prompt.title}</h3>
              {prompt.subtitle && <div style={{ color: '#b8c2dc' }}>{prompt.subtitle}</div>}
              {prompt.description && <p style={{ marginTop: 8, color: '#cbd5f5' }}>{prompt.description}</p>}
            </div>
          </section> */}

          <section style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 8 }}>
              {myVote
                ? `You picked ${players.find((p) => p.socketId === myVote)?.displayName || 'someone'}`
                : 'Pick who you think listened the most'}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12,
              }}
            >
              {players.map((player) => {
                const socketId = player.socketId;
                if (!socketId) return null;
                const isSelf = socketId === mySocketId;
                const isSelected = socketId === myVote;
                return (
                  <button
                    key={socketId}
                    onClick={() => handleVote(socketId)}
                    disabled={voteBusy || isResultsShown}
                    style={{
                      padding: '0.85rem',
                      borderRadius: 10,
                      border: isSelected ? '2px solid #38bdf8' : '1px solid #1f2933',
                      background: isSelected ? '#0f172a' : '#0b0f17',
                      color: /*{isSelf ? '#94a3b8' :}*/ '#fff',
                      cursor:  'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                    {isSelf ? <div style={{ fontSize: 12 }}>You</div> : null}
                  </button>
                );
              })}
            </div>
            {voteError && <div style={{ marginTop: 8, color: 'salmon' }}>{voteError}</div>}
            {currentRound && !isResultsShown ? (
              <div style={{ marginTop: 8, fontSize: 13, color: '#94a3b8' }}>
                Waiting for the host to reveal the results{voteBusy ? '…' : '.'}
              </div>
            ) : null}
          </section>

          {isResultsShown && (
            <section style={{ marginBottom: 24 }}>
              <h4>Votes</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                {sortedResults.map((player) => {
                  const socketId = player.socketId;
                  if (!socketId) return null;
                  const votes = voteTotals[socketId] || 0;
                  const isLeader = socketId === currentRound.results?.topListenerSocketId;
                  return (
                    <div
                      key={socketId}
                      style={{
                        padding: '0.85rem',
                        borderRadius: 10,
                        border: '1px solid #1f2933',
                        background: isLeader ? '#132033' : '#0b1019',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{player.displayName || player.name}</div>
                      <div style={{ fontSize: 13, color: '#94a3b8' }}>{votes} vote(s)</div>
                    </div>
                  );
                })}
              </div>
              {topPlayer && (
                <div style={{ marginTop: 12, fontWeight: 600 }}>
                  {topPlayer.displayName || topPlayer.name} is leading this prompt!
                </div>
              )}
            </section>
          )}
        </>
      )}

      <div style={{ marginTop: 18 }}>
        <button onClick={handleLeave}>Leave Room</button>
      </div>
    </div>
  );
};

export default PlayerScreen;
