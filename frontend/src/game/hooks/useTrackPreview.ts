import { useCallback, useEffect, useRef, useState } from 'react';
import api from 'lib/api';

type TrackPreviewOptions = {
  trackName?: string;
  artistName?: string;
  previewKey?: string;
  enabled?: boolean;
  volume?: number;
  kind?: 'track' | 'artist';
};

type TrackPreviewState = {
  stop: () => void;
  error: string | null;
};

export const useTrackPreview = ({
  trackName,
  artistName,
  previewKey,
  enabled = true,
  volume = 0.5,
  kind = 'track',
}: TrackPreviewOptions): TrackPreviewState => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const primaryName = kind === 'artist' ? artistName : trackName;

    if (!enabled || !primaryName) {
      stop();
      return () => {
        cancelled = true;
      };
    }

    const key = previewKey || primaryName;
    if (lastPreviewKeyRef.current === key) return () => {
      cancelled = true;
    };
    lastPreviewKeyRef.current = key;

    stop();
    setError(null);

    const params =
      kind === 'artist'
        ? new URLSearchParams({ artistName: primaryName })
        : new URLSearchParams({
            trackName: trackName || '',
            artistName: artistName || '',
          });

    api
      .get(
        `${kind === 'artist' ? '/api/spotify/artist_preview' : '/api/spotify/track_preview'}?${params.toString()}`
      )
      .then((res: any) => {
        if (cancelled) return;
        const previewUrl = res?.previewUrl || res?.[0]?.previewUrls || null;
        if (!previewUrl) return;
        const audio = new Audio(previewUrl);
        audio.volume = volume;
        audioRef.current = audio;
        audio.play().catch((err) => {
          console.warn('Preview playback failed', err);
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('Preview fetch failed', err);
        setError('Unable to load preview');
      });

    return () => {
      cancelled = true;
    };
  }, [artistName, enabled, kind, previewKey, stop, trackName, volume]);

  useEffect(() => stop, [stop]);

  return { stop, error };
};
