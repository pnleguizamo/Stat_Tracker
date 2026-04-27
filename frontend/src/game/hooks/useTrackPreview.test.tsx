import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import api from 'lib/api';
import type { PreviewCandidate } from 'types/game';
import { resolveTrackPreviewSources, useTrackPreview } from './useTrackPreview';

jest.mock('lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

const mockedApiGet = api.get as jest.MockedFunction<typeof api.get>;

class MockAudio {
  public volume = 1;
  private listeners = new Map<string, Array<() => void>>();

  constructor(public readonly src: string) {}

  addEventListener(type: string, listener: () => void) {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: () => void) {
    const current = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      current.filter((candidate) => candidate !== listener)
    );
  }

  async play() {
    for (const listener of this.listeners.get('play') || []) listener();
  }

  pause() {
    for (const listener of this.listeners.get('pause') || []) listener();
  }
}

type HookProbeProps = {
  sources?: PreviewCandidate[];
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  previewKey?: string;
  kind?: 'track' | 'artist';
  enabled?: boolean;
  onState?: (state: ReturnType<typeof useTrackPreview>) => void;
};

function HookProbe({ onState, ...props }: HookProbeProps) {
  const state = useTrackPreview(props);

  useEffect(() => {
    onState?.(state);
  }, [onState, state]);

  return null;
}

describe('useTrackPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.Audio = jest.fn((src: string) => new MockAudio(src)) as unknown as typeof Audio;
  });

  it('falls back to the next source when the first preview request returns no preview', async () => {
    mockedApiGet
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404, body: { error: 'no_preview' } }))
      .mockResolvedValueOnce({ previewUrl: 'https://preview.test/fallback.mp3' } as never);

    const states: Array<{ isPlaying: boolean; currentSourceKey: string | null }> = [];
    render(
      <HookProbe
        sources={[
          { kind: 'track', trackName: 'Silent Song', artistName: 'No One', key: 'track::silent' },
          { kind: 'artist', artistName: 'Working Artist', key: 'artist::working' },
        ]}
        onState={(state) => {
          states.push({
            isPlaying: state.isPlaying,
            currentSourceKey: state.currentSourceKey,
          });
        }}
      />
    );

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(states.some((state) => state.currentSourceKey === 'artist::working' && state.isPlaying)).toBe(true)
    );

    expect(mockedApiGet.mock.calls[0][0]).toContain('/api/spotify/track_preview');
    expect(mockedApiGet.mock.calls[1][0]).toContain('/api/spotify/artist_preview');
  });

  it('falls back when a source resolves without a preview url', async () => {
    mockedApiGet
      .mockResolvedValueOnce({ previewUrl: null } as never)
      .mockResolvedValueOnce({ previewUrl: 'https://preview.test/backup.mp3' } as never);

    const states: Array<{ isPlaying: boolean; currentSourceKey: string | null }> = [];
    render(
      <HookProbe
        sources={[
          { kind: 'track', trackName: 'No Clip', artistName: 'Quiet Artist', key: 'track::no-clip' },
          { kind: 'track', trackName: 'Has Clip', artistName: 'Loud Artist', key: 'track::has-clip' },
        ]}
        onState={(state) => {
          states.push({
            isPlaying: state.isPlaying,
            currentSourceKey: state.currentSourceKey,
          });
        }}
      />
    );

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(states.some((state) => state.currentSourceKey === 'track::has-clip' && state.isPlaying)).toBe(true)
    );
  });

  it('clears failed-source memory when the source set changes', async () => {
    mockedApiGet
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404 }))
      .mockResolvedValueOnce({ previewUrl: 'https://preview.test/retried.mp3' } as never);

    const { rerender } = render(
      <HookProbe
        sources={[{ kind: 'track', trackName: 'Retry Me', artistName: 'Artist', key: 'track::retry-me' }]}
      />
    );

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(1));

    rerender(
      <HookProbe
        sources={[
          { kind: 'track', trackName: 'Retry Me', artistName: 'Artist', key: 'track::retry-me' },
          { kind: 'artist', artistName: 'Fresh Artist', key: 'artist::fresh-artist' },
        ]}
      />
    );

    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(2));
    expect(mockedApiGet.mock.calls[1][0]).toContain('/api/spotify/track_preview');
  });

  it('plays a direct previewUrl without requesting a fetched preview', async () => {
    const states: Array<{ isPlaying: boolean; currentSourceKey: string | null }> = [];
    render(
      <HookProbe
        previewUrl="https://preview.test/direct.mp3"
        previewKey="hitster::direct"
        onState={(state) => {
          states.push({
            isPlaying: state.isPlaying,
            currentSourceKey: state.currentSourceKey,
          });
        }}
      />
    );

    await waitFor(() =>
      expect(states.some((state) => state.currentSourceKey === 'hitster::direct' && state.isPlaying)).toBe(true)
    );

    expect(mockedApiGet).not.toHaveBeenCalled();
    expect(global.Audio).toHaveBeenCalledWith('https://preview.test/direct.mp3');
  });

  it('preserves legacy single-source behavior and dedupes provided sources', () => {
    expect(
      resolveTrackPreviewSources({
        trackName: 'Legacy Song',
        artistName: 'Legacy Artist',
        previewKey: 'legacy-track',
        kind: 'track',
      })
    ).toEqual([
      {
        kind: 'track',
        trackName: 'Legacy Song',
        artistName: 'Legacy Artist',
        key: 'legacy-track',
        reason: null,
      },
    ]);

    expect(
      resolveTrackPreviewSources({
        sources: [
          { kind: 'track', trackName: 'Song A', artistName: 'Artist A', key: 'dup-key' },
          { kind: 'track', trackName: 'Song A', artistName: 'Artist A', key: 'dup-key' },
          { kind: 'artist', artistName: 'Artist B', key: 'artist-b' },
        ],
      })
    ).toEqual([
      {
        kind: 'track',
        trackName: 'Song A',
        artistName: 'Artist A',
        key: 'dup-key',
        reason: null,
      },
      {
        kind: 'artist',
        trackName: null,
        artistName: 'Artist B',
        key: 'artist-b',
        reason: null,
      },
    ]);
  });
});
