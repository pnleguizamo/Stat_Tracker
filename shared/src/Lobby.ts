export interface Player {
  socketId?: string;
  name: string;
  userId?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  isHost?: boolean;
}

export interface RoomView {
  roomCode: string;
  players: Player[];
  hostSocketId?: string;
}

export interface CreateJoinResponse {
  ok: boolean;
  roomCode?: string;
  players?: Player[];
  error?: string;
  hostSocketId?: string;
}
