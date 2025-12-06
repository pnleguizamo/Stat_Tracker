import { ListFormat } from "typescript";

export type MinigameId =
  | 'WHO_LISTENED_MOST'
  | 'FIRST_PLAY'
  | 'GENRE_GUESS'
  | 'GRAPH_GUESS'
  | 'OUTLIER_MODE';

export type StageConfig = {
  index: number;
  minigameId: MinigameId;
  customOptions?: Record<string, unknown>;
};

export type Player = {
  socketId?: string;
  name: string;
  userId?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  isHost?: boolean;
};

export type RoomState = {
  roomCode: string;
  hostSocketId?: string;
  players: Player[];
};

export type WhoListenedMostAnswer = {
  targetSocketId: string;
};

export type WhoListenedMostPrompt = {
  id: string;
  type: 'ARTIST' | 'TRACK' | 'INFO';
  track_name: string;
  artist : string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
};

export type WhoListenedMostRoundState = {
  id: string;
  status: 'collecting' | 'pending' | 'revealed';
  prompt: WhoListenedMostPrompt;
  answers: Record<
    string,
    {
      answer?: WhoListenedMostAnswer;
      at: number;
    }
  >;
  startedAt?: number;
  revealedAt?: number;
  results?: {
    tally: Record<string, number>;
    totalVotes: number;
    topListenerSocketId: string | null;
    listenCounts : any;
    winners : any;
  };
};

export type GameState = RoomState & {
  phase: string;
  stagePlan: StageConfig[];
  currentStageIndex: number | null;
  currentStageConfig: StageConfig | null;
  currentRoundState: WhoListenedMostRoundState | null;
};
