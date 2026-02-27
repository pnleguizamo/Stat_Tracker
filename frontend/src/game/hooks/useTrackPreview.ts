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
  isPlaying: boolean;
};

export const useTrackPreview = ({
  trackName,
  artistName,
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
    setIsPlaying(false);

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
        audio.volume = Math.max(0, Math.min(1, volume));
        audioRef.current = audio;
        audio.addEventListener('play', () => setIsPlaying(true));
        audio.addEventListener('pause', () => setIsPlaying(false));
        audio.addEventListener('ended', () => setIsPlaying(false));
        audio.play().catch((err) => {
          console.warn('Preview playback failed', err);
          setIsPlaying(false);
        });
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
  }, [artistName, enabled, kind, previewKey, stop, trackName, volume]);

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
