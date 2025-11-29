import { io } from 'socket.io-client';

export const socket = io(process.env.REACT_APP_API_BASE_URL, {
  withCredentials: true,
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
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
