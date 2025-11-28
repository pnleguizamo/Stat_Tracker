import React, { useEffect, useState } from 'react';
import { socket } from '../socket';


export const GameLobby = () => {
  const [displayName, setDisplayName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    function handleRoomUpdated(payload) {
      setRoom(payload);
    }

    socket.on('roomUpdated', handleRoomUpdated);

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
    };
  }, []);

  const handleCreateRoom = () => {
    setError(null);
    if (!displayName.trim()) {
      setError('Enter a display name first');
      return;
    }

    socket.emit(
      'createRoom',
      { displayName: displayName.trim() },
      (response) => {
        if (!response.ok) {
          setError(response.error || 'Failed to create room');
          return;
        }
        setRoom({
          roomCode: response.roomCode,
          players: response.players,
        });
      }
    );
  };

  const handleJoinRoom = () => {
    setError(null);
    if (!displayName.trim()) {
      setError('Enter a display name first');
      return;
    }
    if (!roomCodeInput.trim()) {
      setError('Enter a room code');
      return;
    }

    socket.emit(
      'joinRoom',
      {
        roomCode: roomCodeInput.trim().toUpperCase(),
        displayName: displayName.trim(),
      },
      (response) => {
        if (!response.ok) {
          if (response.error === 'ROOM_NOT_FOUND') {
            setError('Room not found');
          } else {
            setError(response.error || 'Failed to join room');
          }
          return;
        }
        setRoom({
          roomCode: response.roomCode,
          players: response.players,
        });
      }
    );
  };

  const handleLeaveRoom = () => {
    if (room) {
      socket.emit('leaveRoom', { roomCode: room.roomCode });
    }
    setRoom(null);
  };

  return (
    <div style={{ padding: '1rem', maxWidth: 500, margin: '0 auto' }}>
      <h2>Spotify Stats Game</h2>

      {!room && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <label>
              Display name:
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{ marginLeft: '0.5rem' }}
              />
            </label>
          </div>

          <div style={{ marginBottom: '0.5rem' }}>
            <button onClick={handleCreateRoom}>Create Room</button>
          </div>

          <div>
            <input
              placeholder="Room code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              style={{ marginRight: '0.5rem' }}
            />
            <button onClick={handleJoinRoom}>Join Room</button>
          </div>
        </>
      )}

      {room && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>Room: {room.roomCode}</h3>
            <button onClick={handleLeaveRoom}>Leave</button>
          </div>
          <h4>Players</h4>
          <ul>
            {room.players.map((p, idx) => (
              <li key={idx}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p style={{ marginTop: '1rem', color: 'red' }}>
          {error}
        </p>
      )}
    </div>
  );
};
