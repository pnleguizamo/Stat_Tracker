export type MinigameOptionField = {
  key: string;
  label: string;
  type: 'select' | 'number';
  options?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default: unknown;
};

export type MinigameId =
  | 'WHO_LISTENED_MOST'
  | 'GUESS_SPOTIFY_WRAPPED'
  | 'HEARDLE'
  | 'HIGHER_LOWER'
  | 'FIRST_PLAY'
  | 'GENRE_GUESS'
  | 'GRAPH_GUESS'
  | 'OUTLIER_MODE'
  | 'TWO_TRUTHS_ONE_LIE';

type CatalogEntry = {
  id: MinigameId;
  name: string;
  description: string;
  optionSchema?: MinigameOptionField[];
};

export const MINIGAME_CATALOG: CatalogEntry[] = [
  {
    id: 'WHO_LISTENED_MOST',
    name: 'Who Listened Most?',
    description: 'Guess who listened to this artist the most.',
    optionSchema: [],
  },
  {
    id: 'GUESS_SPOTIFY_WRAPPED',
    name: 'Guess the Wrapped',
    description: 'Match a Spotify Wrapped summary to its owner.',
    optionSchema: [],
  },
  {
    id: 'HEARDLE',
    name: 'Heardle',
    description: 'Identify the song from progressively longer snippets.',
    optionSchema: [
      {
        key: 'songsPerGame',
        label: 'Songs per game',
        type: 'number',
        min: 3,
        max: 20,
        step: 1,
        default: 10,
      },
      {
        key: 'guessWindowMs',
        label: 'Guess window',
        type: 'select',
        options: [
          { value: 20000, label: '20 s' },
          { value: 30000, label: '30 s' },
          { value: 40000, label: '40 s' },
          { value: 60000, label: '60 s' },
        ],
        default: 40000,
      },
    ],
  },
  {
    id: 'HIGHER_LOWER',
    name: 'Higher / Lower',
    description: 'Guess which stat is higher.',
    optionSchema: [
      {
        key: 'metric',
        label: 'Metric',
        type: 'select',
        options: [
          { value: 'plays', label: 'Plays' },
          { value: 'minutes', label: 'Minutes' },
        ],
        default: 'plays',
      },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'right_advances', label: 'Right advances' },
          { value: 'winner_stays', label: 'Winner stays' },
        ],
        default: 'right_advances',
      },
      {
        key: 'maxRounds',
        label: 'Max rounds',
        type: 'number',
        min: 5,
        max: 40,
        step: 5,
        default: 40,
      },
    ],
  },
  {
    id: 'TWO_TRUTHS_ONE_LIE',
    name: 'Two Truths & a Lie',
    description: 'Craft a lie from your Spotify stats. Can others spot it?',
    optionSchema: [
      {
        key: 'maxRounds',
        label: 'Max rounds',
        type: 'number',
        min: 3,
        max: 10,
        step: 1,
        default: 3,
      },
      {
        key: 'craftingWindowMs',
        label: 'Crafting time',
        type: 'select',
        options: [
          { value: 30000, label: '30 s' },
          { value: 45000, label: '45 s' },
          { value: 60000, label: '60 s' },
        ],
        default: 45000,
      },
      {
        key: 'guessWindowMs',
        label: 'Guess time',
        type: 'select',
        options: [
          { value: 15000, label: '15 s' },
          { value: 20000, label: '20 s' },
          { value: 30000, label: '30 s' },
        ],
        default: 20000,
      },
    ],
  },
  { id: 'FIRST_PLAY', name: 'First Play', description: 'Guess who heard this song first.' },
  { id: 'GENRE_GUESS', name: 'Genre Guess', description: 'Guess the genre from the listening pattern.' },
  { id: 'GRAPH_GUESS', name: 'Graph Guess', description: 'Guess which graph belongs to which player.' },
  { id: 'OUTLIER_MODE', name: 'Outlier Mode', description: 'Spot the outlier listening behavior.' },
];

export function getOptionDefaults(minigameId: MinigameId): Record<string, unknown> {
  const entry = MINIGAME_CATALOG.find((m) => m.id === minigameId);
  if (!entry?.optionSchema?.length) return {};
  return Object.fromEntries(entry.optionSchema.map((f) => [f.key, f.default]));
}
