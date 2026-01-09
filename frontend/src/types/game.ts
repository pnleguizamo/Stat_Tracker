export type MinigameId =
  | 'WHO_LISTENED_MOST'
  | 'GUESS_SPOTIFY_WRAPPED' 
  | 'HEARDLE'
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

// TODOo ensure types are right
export type WhoListenedMostPrompt = {
  id: string;
  type: 'ARTIST' | 'TRACK' | 'INFO';
  track_name: string;
  artist_name: string;
  artist_names: string[];
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
  expiresAt?: number;
  revealedAt?: number;
  results?: {
    tally: Record<string, number>;
    totalVotes: number;
    topListenerSocketIds: string[] | null;
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
  expiresAt?: number;
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

export type HeardleGuessOutcome = 'wrong' | 'artist_match' | 'album_match' | 'correct';

export type HeardleGuess = {
  snippetIndex: number;
  trackId?: string | null;
  trackName?: string | null;
  artistNames?: string[];
  albumName?: string | null;
  outcome: HeardleGuessOutcome;
  at: number;
};

export type HeardleSong = {
  id: string;
  track_name?: string | null;
  artist_names?: string[];
  album_name?: string | null;
  imageUrl?: string | null;
  uri?: string | null;
};

export type HeardleRoundState = {
  id: string;
  minigameId: 'HEARDLE';
  status: 'guessing' | 'pending' | 'revealed';
  song: HeardleSong;
  answers: Record<
    string,
    {
      guesses: HeardleGuess[];
    }
  >;
  startedAt?: number;
  snippetStartedAt?: number;
  snippetPlan: number[];
  snippetHistory?: Array<{
    index?: number;
    startedAt?: number | null;
    endedAt?: number | null;
    durationMs?: number | null;
  }>;
  currentSnippetIndex: number;
  guessWindowMs?: number;
  maxPointsPerSnippet?: number[];
  expiresAt?: number;
  stageProgress?: { songNumber?: number; songsPerGame?: number };
  results?: {
    winners: string[];
    guessSummary: Record<
      string,
      {
        outcome: HeardleGuessOutcome;
        snippetIndex?: number | null;
        at?: number;
      }
    >;
    song: HeardleSong;
    snippetPlan: number[];
    stageProgress?: { songNumber?: number; songsPerGame?: number };
  };
};

export type MinigameRoundState = WhoListenedMostRoundState | GuessWrappedRoundState | HeardleRoundState;

export type ScoreAward = {
  points: number;
  reason?: string;
  meta?: Record<string, unknown> | null;
  at?: number;
};

export type ScoreboardEntry = {
  points: number;
  stats?: Record<string, unknown>;
  awards?: ScoreAward[];
};

export type GameState = RoomState & {
  phase: string;
  stagePlan: StageConfig[];
  currentStageIndex: number | null;
  currentStageConfig: StageConfig | null;
  currentRoundState: MinigameRoundState | null;
  scoreboard?: Record<string, ScoreboardEntry>;
};
