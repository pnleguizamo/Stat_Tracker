export type MinigameId =
  | 'WHO_LISTENED_MOST'
  | 'GUESS_SPOTIFY_WRAPPED' 
  | 'FIRST_PLAY'
  | 'GENRE_GUESS'
  | 'GRAPH_GUESS'
  | 'OUTLIER_MODE';


  // export type MinigameId =
  // | 'WHO_LISTENED_MOST' // Artist, Track, Album
  // | 'GUESS_SPOTIFY_WRAPPED' 
  // | 'FIRST_PLAY'; // Who was first or last listen to song / artist / album
  // // | 'SONG_YEAR_GUESS' // Hitster
  // // | 'HEARDLE' // Guess the song, try to pull songs that everyone has heard
  // // | 'TRUTH_AND_LIES' // Two truths and a lie, pull any other stat
  // // | 'MATCHING' // Pull stat for each user, have everyone match whose is whose
  // // | 'OUTLIER' // One of these is not like the others. One song or artist with a different genre
  // // | 'CALENDAR' // Guess which day of the year the user stat bundle comes from

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
  artist: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
};

export type WhoListenedMostRoundState = {
  id: string;
  minigameId: 'WHO_LISTENED_MOST';
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
    listenCounts?: Record<string, number>;
    winners?: string[];
  };
};

export type GuessWrappedSummary = {
  year: number;
  minutesListened: number;
  topGenre?: string | null;
  topArtists: Array<{
    name: string;
    playCount: number;
    totalMsPlayed?: number;
    imageUrl?: string | null;
  }>;
  topSongs: Array<{
    track: string;
    artist: string;
    playCount: number;
    totalMsPlayed?: number;
  }>;
};

export type GuessWrappedRoundState = {
  id: string;
  minigameId: 'GUESS_SPOTIFY_WRAPPED';
  status: 'collecting' | 'pending' | 'revealed';
  prompt: GuessWrappedSummary;
  answers: Record<
    string,
    {
      answer?: WhoListenedMostAnswer;
      at: number;
    }
  >;
  ownerSocketId?: string | null;
  ownerProfile?: {
    socketId?: string;
    displayName?: string | null;
    avatar?: string | null;
  } | null;
  startedAt?: number;
  revealedAt?: number;
  results?: {
    votes: Record<string, number>;
    ownerSocketId: string;
    ownerProfile?: {
      socketId?: string;
      displayName?: string | null;
      avatar?: string | null;
    } | null;
    winners: string[];
  };
};

export type MinigameRoundState = WhoListenedMostRoundState | GuessWrappedRoundState;

export type GameState = RoomState & {
  phase: string;
  stagePlan: StageConfig[];
  currentStageIndex: number | null;
  currentStageConfig: StageConfig | null;
  currentRoundState: MinigameRoundState | null;
};
