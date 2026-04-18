import { useCallback, useEffect, useRef, useState } from 'react';
import api from 'lib/api';

type TrackPreviewOptions = {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  previewKey?: string;
  enabled?: boolean;
  volume?: number;
  kind?: 'track' | 'artist';
};

type TrackPreviewState = {
  stop: () => void;
  error: string | null;
  isPlaying: boolean;
};

export const useTrackPreview = ({
  trackName,
  artistName,
  previewUrl,
  previewKey,
  enabled = true,
  volume = 0.5,
  kind = 'track',
}: TrackPreviewOptions): TrackPreviewState => {
  const VOLUME_RAMP_MS = 220;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRampRafRef = useRef<number | null>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const stop = useCallback(() => {
    if (volumeRampRafRef.current !== null) {
      window.cancelAnimationFrame(volumeRampRafRef.current);
      volumeRampRafRef.current = null;
    }
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current = null;
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback((url: string) => {
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    audioRef.current = audio;
    audio.addEventListener('play', () => {
      setError(null);
      setIsPlaying(true);
    });
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('ended', () => setIsPlaying(false));
    audio.play().catch((err) => {
      console.warn('Preview playback failed', err);
      setError('Unable to play preview');
      setIsPlaying(false);
    });
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    const primaryName = kind === 'artist' ? artistName : trackName;

    if (!enabled || (!previewUrl && !primaryName)) {
      stop();
      return () => {
        cancelled = true;
      };
    }

    const key = previewKey || previewUrl || primaryName || null;
    if (lastPreviewKeyRef.current === key) return () => {
      cancelled = true;
    };
    lastPreviewKeyRef.current = key;

    stop();
    setError(null);
    setIsPlaying(false);

    if (previewUrl) {
      startPlayback(previewUrl);
      return () => {
        cancelled = true;
      };
    }

    const params =
      kind === 'artist'
        ? new URLSearchParams({ artistName: primaryName || '' })
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
        const resolvedPreviewUrl =
          res?.previewUrl ||
          res?.results?.find((track: any) => track?.previewUrls)?.previewUrls ||
          res?.[0]?.previewUrls ||
          null;
        if (!resolvedPreviewUrl) {
          console.warn('Preview missing for request', { trackName, artistName, kind });
          setError('Preview unavailable');
          return;
        }
        startPlayback(resolvedPreviewUrl);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('Preview fetch failed', err);
        setError('Unable to load preview');
        setIsPlaying(false);
      });

    return () => {
      cancelled = true;
    };
  }, [artistName, enabled, kind, previewKey, previewUrl, startPlayback, stop, trackName]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const startVolume = Number.isFinite(audio.volume) ? audio.volume : 0;
    const targetVolume = Math.max(0, Math.min(1, volume));
    if (Math.abs(startVolume - targetVolume) < 0.001) {
      audio.volume = targetVolume;
      return;
    }

    if (volumeRampRafRef.current !== null) {
      window.cancelAnimationFrame(volumeRampRafRef.current);
      volumeRampRafRef.current = null;
    }

    const startAt = performance.now();
    const step = (now: number) => {
      const elapsed = now - startAt;
      const progress = Math.max(0, Math.min(1, elapsed / VOLUME_RAMP_MS));
      audio.volume = startVolume + (targetVolume - startVolume) * progress;
      if (progress < 1) {
        volumeRampRafRef.current = window.requestAnimationFrame(step);
        return;
      }
      volumeRampRafRef.current = null;
      audio.volume = targetVolume;
    };

    volumeRampRafRef.current = window.requestAnimationFrame(step);
  }, [volume]);

  return { stop, error, isPlaying };
};
