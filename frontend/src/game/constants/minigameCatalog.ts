type MinigameId =
  | 'WHO_LISTENED_MOST'
  | 'GUESS_SPOTIFY_WRAPPED'
  | 'HEARDLE'
  | 'FIRST_PLAY'
  | 'GENRE_GUESS'
  | 'GRAPH_GUESS'
  | 'OUTLIER_MODE';

export const MINIGAME_CATALOG: { id: MinigameId; name: string; description: string }[] = [
  { id: 'WHO_LISTENED_MOST', name: 'Who Listened Most?', description: 'Guess who listened to this artist the most.' },
  { id: 'GUESS_SPOTIFY_WRAPPED', name: 'Guess the Wrapped', description: 'Match a Spotify Wrapped summary to its owner.' },
  { id: 'HEARDLE', name: 'Heardle', description: 'Identify the song from progressively longer snippets.' },
  { id: 'FIRST_PLAY', name: 'First Play', description: 'Guess who heard this song first.' },
  { id: 'GENRE_GUESS', name: 'Genre Guess', description: 'Guess the genre from the listening pattern.' },
  { id: 'GRAPH_GUESS', name: 'Graph Guess', description: 'Guess which graph belongs to which player.' },
  { id: 'OUTLIER_MODE', name: 'Outlier Mode', description: 'Spot the outlier listening behavior.' },
];
