import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from 'lib/api';
import { socket } from '../socket';
import { useNavigate } from 'react-router-dom';
import '../styles/gameShell.css';
import '../styles/lobby.css';

type Player = {
  playerId: string;
  name: string;
  userId?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  isHost?: boolean;
};

type RoomState = {
  roomCode: string;
  hostSocketId?: string;
  players: Player[];
};

type CbResponse = {
  ok: boolean;
  roomCode?: string;
  players?: Player[];
  hostSocketId: string;
  error?: string;
};

type HostLobbyProps = {
  room: RoomState;
  onLeave: () => void;
  onStartGame: () => void;
};

function HostLobby({ room, onLeave, onStartGame }: HostLobbyProps) {
  const joinPath = '/lobby';
  const joinUrl = `${window.location.origin}${joinPath}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(
    joinUrl
  )}`;
  const actualPlayers = room.players.filter((p) => !p.isHost);

  return (
    <div className="game-shell-layout lobby-host-layout">
      {/* ── Top bar ── */}
      <div className="lobby-host-topbar">
        <div className="lobby-host-topbar-left">
          <span className="lobby-brand">Spotify Stats Game</span>
          <button className="game-shell-button lobby-small-btn" onClick={onLeave}>
            Leave
          </button>
        </div>

        <div className="lobby-code-block">
          <div className="lobby-code-eyebrow">Room Code</div>
          <div className="lobby-code">{room.roomCode}</div>
        </div>

        <div className="lobby-host-topbar-right">
          <div className="lobby-player-count">
            {actualPlayers.length}{' '}
            {actualPlayers.length === 1 ? 'player' : 'players'} joined
          </div>
          <button
            className="game-shell-button lobby-start-btn"
            onClick={onStartGame}
            disabled={actualPlayers.length === 0}
          >
            Start Game →
          </button>
        </div>
      </div>

      {/* ── Player grid ── */}
      <div className="lobby-host-body">
        <div className="lobby-host-join-row">
          <div className="lobby-join-url">Scan to join faster</div>
          <div className="lobby-qr-wrap lobby-qr-wrap--large">
            <img
              src={qrSrc}
              alt={`QR code to join room ${room.roomCode}`}
              className="lobby-qr"
            />
            <div className="lobby-qr-label">{joinUrl}</div>
          </div>
        </div>
        {actualPlayers.length === 0 ? (
          <div className="lobby-empty">
            <div className="lobby-empty-text">Waiting for players to join…</div>
            <div className="lobby-empty-hint">Share the code above!</div>
          </div>
        ) : (
          <div className="lobby-player-grid">
            {actualPlayers.map((p) => (
              <div key={p.playerId} className="lobby-player-card">
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt={p.displayName || p.name}
                    className="lobby-player-avatar"
                  />
                ) : (
                  <div className="lobby-player-avatar lobby-player-avatar--initials">
                    {(p.displayName || p.name || '')
                      .split(' ')
                      .map((s) => s[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                )}
                <div className="lobby-player-name">{p.displayName || p.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type PlayerLobbyProps = {
  room: RoomState;
  displayName: string;
  setDisplayName: (v: string) => void;
  selectedAvatar: string | null;
  handleSelectAvatar: (url: string) => void;
  handleUpdateProfile: () => void;
  computedAvatarOptions: string[];
  onLeave: () => void;
};

function PlayerLobby({
  room,
  displayName,
  setDisplayName,
  selectedAvatar,
  handleSelectAvatar,
  handleUpdateProfile,
  computedAvatarOptions,
  onLeave,
}: PlayerLobbyProps) {
  return (
    <div className="player-layout">
      <header className="player-header">
        <div>
          <h2 className="player-title">
            Room <span className="lobby-inline-code">{room.roomCode}</span>
          </h2>
          <div className="game-shell-muted player-meta">
            Waiting for host to start…
          </div>
        </div>
        <button className="game-shell-button" onClick={onLeave}>
          Leave
        </button>
      </header>

      <main className="player-main lobby-player-main">
        {/* Avatar + name preview */}
        <div className="lobby-player-preview">
          {selectedAvatar ? (
            <img
              src={selectedAvatar}
              alt="Your avatar"
              className="lobby-preview-avatar"
            />
          ) : (
            <div className="lobby-preview-avatar lobby-preview-avatar--initials">
              {(displayName || '?')
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
          )}
          <div className="lobby-preview-info">
            <div className="lobby-preview-name">
              {displayName || (
                <span className="game-shell-muted">Set your name below</span>
              )}
            </div>
            <div className="game-shell-muted" style={{ fontSize: '0.8rem' }}>
              Ready to play
            </div>
          </div>
        </div>

        {/* Name input */}
        <div className="lobby-field">
          <label className="lobby-field-label">Your name</label>
          <input
            className="game-shell-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => handleUpdateProfile()}
            placeholder="Enter your name"
          />
        </div>

        {/* Avatar picker */}
        <div className="lobby-field">
          <div className="lobby-field-label">Choose avatar</div>
          <div className="lobby-avatar-grid">
            {computedAvatarOptions.map((a) => (
              <button
                key={a}
                onClick={() => handleSelectAvatar(a)}
                className={`lobby-avatar-btn${
                  a === selectedAvatar ? ' lobby-avatar-btn--selected' : ''
                }`}
              >
                <img src={a} alt="avatar" />
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

type PreLobbyProps = {
  isGuest: boolean;
  displayName: string;
  setDisplayName: (v: string) => void;
  roomCodeInput: string;
  setRoomCodeInput: (v: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onUpdateProfile: () => void;
  error: string | null;
};

function PreLobby({
  isGuest,
  displayName,
  setDisplayName,
  roomCodeInput,
  setRoomCodeInput,
  onCreateRoom,
  onJoinRoom,
  onUpdateProfile,
  error,
}: PreLobbyProps) {
  return (
    <div className="game-shell-layout">
      <div className="game-shell-content game-shell-content--narrow">
        <div className="game-shell-surface lobby-prejoin">
          <h2 className="lobby-prejoin-title">Spotify Stats Game</h2>

          <div className="lobby-field">
            <label className="lobby-field-label">
              {isGuest ? 'Display name' : 'Display name (optional)'}
            </label>
            <input
              className="game-shell-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={onUpdateProfile}
              placeholder={isGuest ? 'Your name' : 'Override display name'}
            />
          </div>

          <div className="lobby-prejoin-actions">
            <button
              className="game-shell-button lobby-create-btn"
              onClick={onCreateRoom}
            >
              Host a Game
            </button>

            <div className="lobby-prejoin-divider">or join a room</div>

            <div className="lobby-prejoin-join">
              <input
                className="game-shell-input"
                placeholder="Room code"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && onJoinRoom()}
                maxLength={6}
                style={{ textTransform: 'uppercase', letterSpacing: '0.12em' }}
              />
              <button className="game-shell-button" onClick={onJoinRoom}>
                Join
              </button>
            </div>
          </div>

          {error && (
            <p className="game-shell-error" style={{ marginTop: '0.5rem' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const GameLobby: React.FC = () => {
  const status = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: true,
  });

  const [displayName, setDisplayName] = useState<string>('');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const isGuest = !!status.data?.spotifyUser?.is_guest;
  const navigate = useNavigate();

  useEffect(() => {
    if (room) return;
    const query = new URLSearchParams(window.location.search);
    const roomFromQuery = (query.get('room') || query.get('code') || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    if (!roomFromQuery) return;
    setRoomCodeInput((previous) => previous || roomFromQuery);
  }, [room]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Sync local display name + avatar from server state (player only)
  useEffect(() => {
    if (!room) return;
    const myPlayerId = ((socket as any).playerId || socket.id) as string;
    const me = room.players.find((p) => p.playerId === myPlayerId);
    if (me) {
      if (me.displayName) setDisplayName(me.displayName);
      if (me.avatar) setSelectedAvatar(me.avatar);
    }
  }, [room]);

  useEffect(() => {
    function handleRoomUpdated(payload: RoomState) {
      setRoom(payload);
    }

    function handleGameStateUpdated(payload: any) {
      const currentRoom = roomRef.current;
      if (!payload || payload.phase !== 'inGame') return;
      if (!currentRoom) return;
      if (payload.roomCode && payload.roomCode !== currentRoom.roomCode) return;
      if (currentRoom.hostSocketId === socket.id) return; // host stays with host flow
      navigate(`/game/${currentRoom.roomCode}`);
    }

    socket.on('roomUpdated', handleRoomUpdated);
    socket.on('gameStateUpdated', handleGameStateUpdated);

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('gameStateUpdated', handleGameStateUpdated);
    };
  }, []);

  const AVATAR_BASE = '/gamerpics';
  const userAvatarUrl = status.data?.spotifyUser?.images?.[0]?.url || null;
  const NUM_AVATARS = !isGuest && userAvatarUrl ? 20 : 21;
  const avatarOptions = Array.from(
    { length: NUM_AVATARS },
    (_, i) => `${AVATAR_BASE}/avatar-${i + 1}.png`,
  );
  const computedAvatarOptions =
    userAvatarUrl && !isGuest ? [userAvatarUrl, ...avatarOptions] : avatarOptions;

  function handleSelectAvatar(url: string) {
    setSelectedAvatar(url);
    socket.emit(
      'updateProfile',
      { avatar: url, displayName: displayName.trim() || undefined },
      (resp: any) => {
        if (!resp || !resp.ok) setError(resp?.error || 'Failed to update avatar');
      },
    );
  }

  function handleUpdateProfile() {
    setError(null);
    const payload: any = {};
    if (displayName.trim()) payload.displayName = displayName.trim();
    if (selectedAvatar) payload.avatar = selectedAvatar;
    socket.emit('updateProfile', payload, (resp: any) => {
      if (!resp || !resp.ok) setError(resp?.error || 'Failed to update profile');
    });
  }

  function handleCreateRoom() {
    setError(null);
    if (isGuest && !displayName.trim()) {
      setError('Enter a display name first');
      return;
    }
    const payload: any = {};
    if (displayName.trim()) payload.displayName = displayName.trim();
    socket.emit('createRoom', payload, (response: CbResponse) => {
      if (!response.ok) {
        setError(response.error || 'Failed to create room');
        return;
      }
      setRoom({
        roomCode: response.roomCode!,
        hostSocketId: response.hostSocketId,
        players: response.players || [],
      });
    });
  }

  function handleJoinRoom() {
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
        setError(
          response.error === 'ROOM_NOT_FOUND'
            ? 'Room not found'
            : response.error || 'Failed to join room',
        );
        return;
      }
      setRoom({
        roomCode: response.roomCode!,
        hostSocketId: response.hostSocketId,
        players: response.players || [],
      });
    });
  }

  function handleLeaveRoom() {
    if (room) socket.emit('leaveRoom', { roomCode: room.roomCode });
    setRoom(null);
  }

  const isHost = room?.hostSocketId === socket.id;

  if (room && isHost) {
    return (
      <HostLobby
        room={room}
        onLeave={handleLeaveRoom}
        onStartGame={() => navigate(`/game/host/${room.roomCode}/setup`)}
      />
    );
  }

  if (room && !isHost) {
    return (
      <PlayerLobby
        room={room}
        displayName={displayName}
        setDisplayName={setDisplayName}
        selectedAvatar={selectedAvatar}
        handleSelectAvatar={handleSelectAvatar}
        handleUpdateProfile={handleUpdateProfile}
        computedAvatarOptions={computedAvatarOptions}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return (
    <PreLobby
      isGuest={isGuest}
      displayName={displayName}
      setDisplayName={setDisplayName}
      roomCodeInput={roomCodeInput}
      setRoomCodeInput={setRoomCodeInput}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
      onUpdateProfile={handleUpdateProfile}
      error={error}
    />
  );
};

export default GameLobby;
