import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from 'lib/api';
import { socket } from '../socket';

type Player = {
  socketId?: string;
  name: string;
  userId?: string | null;
  displayName?: string | null;
  avatar?: string | null;
};

type RoomState = {
  roomCode: string;
  players: Player[];
};

type CbResponse = {
  ok: boolean;
  roomCode?: string;
  players?: Player[];
  error?: string;
};

export const GameLobby: React.FC = () => {
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: true,
  });
    
  const [displayName, setDisplayName] = useState<string>('');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const isGuest = !!status.data?.spotifyUser?.is_guest;


  useEffect(() => {
    function handleRoomUpdated(payload: RoomState) {
      setRoom(payload);
    }

    socket.on('roomUpdated', handleRoomUpdated);

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
    };
  }, []);

  useEffect(() => {
    if (!room) return;
    const mySocketId = socket.id;
    const me = room.players.find((p) => p.socketId === mySocketId);
    if (me) {
      if (me.displayName) setDisplayName(me.displayName);
      if (me.avatar) setSelectedAvatar(me.avatar);
    }
  }, [room]);

  const AVATAR_BASE = "/gamerpics";
  const NUM_AVATARS = isGuest ? 21 : 20;

  const avatarOptions = Array.from({ length: NUM_AVATARS }, (_, i) => (
    `${AVATAR_BASE}/avatar-${i + 1}.png`
  ));


  const userAvatarUrl = status.data?.spotifyUser?.images?.[0]?.url || null;
  const computedAvatarOptions = userAvatarUrl && !isGuest
    ? [userAvatarUrl, ...avatarOptions]
    : avatarOptions;

  function handleSelectAvatar(url: string) {
    setSelectedAvatar(url);
    socket.emit(
      'updateProfile',
      { avatar: url, displayName: displayName.trim() || undefined },
      (resp: any) => {
        if (!resp || !resp.ok) {
          setError(resp?.error || 'Failed to update avatar');
        }
      }
    );
  }

  function handleUpdateProfile() {
    setError(null);
    const payload: any = {};
    if (displayName.trim()) payload.displayName = displayName.trim();
    if (selectedAvatar) payload.avatar = selectedAvatar;
    socket.emit('updateProfile', payload, (resp: any) => {
      if (!resp || !resp.ok) {
        setError(resp?.error || 'Failed to update profile');
      }
    });
  }

  const handleCreateRoom = () => {
    setError(null);
    if (isGuest && !displayName.trim()) {
      setError('Enter a display name first');
      return;
    }

    const createPayload: any = {};
    if (displayName.trim()) createPayload.displayName = displayName.trim();

    socket.emit('createRoom', createPayload, (response: CbResponse) => {
        if (!response.ok) {
          setError(response.error || 'Failed to create room');
          return;
        }
        setRoom({
          roomCode: response.roomCode!,
          players: response.players || [],
        });
      }
    );
  };

  const handleJoinRoom = () => {
    setError(null);
    if (isGuest && !displayName.trim()) {
      setError('Enter a display name first');
      return;
    }
    if (!roomCodeInput.trim()) {
      setError('Enter a room code');
      return;
    }

    const payload: any = { roomCode: roomCodeInput.trim().toUpperCase() };
    if (displayName.trim()) payload.displayName = displayName.trim();

    socket.emit('joinRoom', payload, (response: CbResponse) => {
        if (!response.ok) {
          if (response.error === 'ROOM_NOT_FOUND') {
            setError('Room not found');
          } else {
            setError(response.error || 'Failed to join room');
          }
          return;
        }
        setRoom({
          roomCode: response.roomCode!,
          players: response.players || [],
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
              {isGuest ? 'Display name:' : 'Change display name (Optional):'}
              <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => handleUpdateProfile()}
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
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {room.players.map((p, idx) => (
              <li key={p.socketId || idx} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt={p.displayName || p.name}
                    style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', marginRight: 12 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: '#2b6cb0',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                      fontWeight: 600,
                    }}
                  >
                    {(p.displayName || p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600 }}>{p.displayName || p.name}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{p.userId ? `ID: ${p.userId}` : 'Guest'}</div>
                </div>
              </li>
            ))}
          </ul>
          <div style={{ marginBottom: '1rem', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: 6, fontSize: 14 }}>Your name</div>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => handleUpdateProfile()}
                style={{ marginRight: '0.5rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ marginBottom: 6, fontSize: 14 }}>Change avatar</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 56px)',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                {computedAvatarOptions.map((a) => (
                  <button
                    key={a}
                    onClick={() => handleSelectAvatar(a)}
                    style={{
                      border: a === selectedAvatar ? '2px solid #2b6cb0' : '2px solid transparent',
                      padding: 0,
                      borderRadius: 6,
                      background: 'transparent',
                      width: 56,
                      height: 56,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img src={a} alt="avatar" style={{ width: 48, height: 48, borderRadius: 6 }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button>Start Game</button>
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
