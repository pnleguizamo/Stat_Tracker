import { io } from 'socket.io-client';

const PLAYER_ID_STORAGE_KEY = 'stat_tracker_player_id';

export const socket = io(process.env.REACT_APP_API_BASE_URL, {
  withCredentials: true,
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

try {
  if (typeof window !== 'undefined') {
    const cached = window.localStorage.getItem(PLAYER_ID_STORAGE_KEY);
    if (cached) socket.playerId = cached;
  }
} catch (err) {
  // ignore localStorage errors in restricted contexts
}

socket.on('sessionIdentity', (payload = {}) => {
  if (payload?.playerId) {
    socket.playerId = payload.playerId;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, payload.playerId);
      }
    } catch (err) {
      // ignore localStorage errors in restricted contexts
    }
  }
});

export function connectSocket() {
  try {
    if (!socket.connected) socket.connect();
  } catch (e) {
    console.warn('socket connect error', e?.message || e);
  }
}

export function disconnectSocket() {
  try {
    if (socket.connected) socket.disconnect();
  } catch (e) {
    console.warn('socket disconnect error', e?.message || e);
  }
}
