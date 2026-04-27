import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewCandidate } from 'types/game';
import api from 'lib/api';

type TrackPreviewOptions = {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  previewKey?: string;
  enabled?: boolean;
  volume?: number;
  kind?: 'track' | 'artist';
  sources?: PreviewCandidate[];
};

type TrackPreviewState = {
  stop: () => void;
  error: string | null;
  isPlaying: boolean;
  currentSourceKey: string | null;
};

function normalizePreviewText(value?: string | null): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function getPreviewSourceKey(source: PreviewCandidate): string | null {
  const explicitKey = normalizePreviewText(source.key);
  if (explicitKey) return explicitKey;
  return [
    source.kind,
    normalizePreviewText(source.trackName) || 'none',
    normalizePreviewText(source.artistName) || 'none',
  ].join('::');
}

export function normalizePreviewSource(source: PreviewCandidate | null | undefined): PreviewCandidate | null {
  if (!source?.kind) return null;

  const normalized: PreviewCandidate = {
    kind: source.kind === 'artist' ? 'artist' : 'track',
    trackName: normalizePreviewText(source.trackName),
    artistName: normalizePreviewText(source.artistName),
    key: getPreviewSourceKey(source),
    reason: normalizePreviewText(source.reason),
  };

  if (normalized.kind === 'track' && !normalized.trackName) return null;
  if (normalized.kind === 'artist' && !normalized.artistName) return null;
  return normalized;
}

export function resolveTrackPreviewSources({
  sources,
  trackName,
  artistName,
  previewKey,
  kind = 'track',
}: Pick<TrackPreviewOptions, 'sources' | 'trackName' | 'artistName' | 'previewKey' | 'kind'>): PreviewCandidate[] {
  const baseSources =
    sources && sources.length
      ? sources
      : [
          {
            kind,
            trackName,
            artistName,
            key: previewKey || undefined,
          } satisfies PreviewCandidate,
        ];

  const resolvedSources: PreviewCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const source of baseSources) {
    const normalized = normalizePreviewSource(source);
    if (!normalized?.key) continue;
    if (seenKeys.has(normalized.key)) continue;
    seenKeys.add(normalized.key);
    resolvedSources.push(normalized);
  }

  return resolvedSources;
}

export const useTrackPreview = ({
  trackName,
  artistName,
  previewUrl,
  previewKey,
  enabled = true,
  volume = 0.5,
  kind = 'track',
  sources,
}: TrackPreviewOptions): TrackPreviewState => {
  const VOLUME_RAMP_MS = 220;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioDetachRef = useRef<(() => void) | null>(null);
  const volumeRampRafRef = useRef<number | null>(null);
  const playbackTokenRef = useRef(0);
  const cancelledRef = useRef(false);
  const failedSourceKeysRef = useRef(new Set<string>());
  const lastSourceSetSignatureRef = useRef<string | null>(null);
  const lastPreviewSignatureRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSourceKey, setCurrentSourceKey] = useState<string | null>(null);

  const resolvedSources = useMemo(
    () =>
      resolveTrackPreviewSources({
        sources,
        trackName,
        artistName,
        previewKey,
        kind,
      }),
    [artistName, kind, previewKey, sources, trackName]
  );
  const sourceSetSignature = useMemo(
    () => resolvedSources.map((source) => source.key).filter(Boolean).join('|'),
    [resolvedSources]
  );
  const resolvedSourcesRef = useRef(resolvedSources);
  resolvedSourcesRef.current = resolvedSources;

  const cleanupAudio = useCallback(() => {
    if (volumeRampRafRef.current !== null) {
      window.cancelAnimationFrame(volumeRampRafRef.current);
      volumeRampRafRef.current = null;
    }
    audioDetachRef.current?.();
    audioDetachRef.current = null;
    audioRef.current = null;
    setIsPlaying(false);
    setCurrentSourceKey(null);
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    playbackTokenRef.current += 1;
    cleanupAudio();
  }, [cleanupAudio]);

  const startPlayback = useCallback(
    async (url: string, sourceKey: string | null, runToken: number): Promise<boolean> => {
      setCurrentSourceKey(sourceKey);

      const audio = new Audio(url);
      const handlePlay = () => {
        setError(null);
        setIsPlaying(true);
      };
      const handlePause = () => setIsPlaying(false);
      const handleEnded = () => setIsPlaying(false);

      audio.volume = Math.max(0, Math.min(1, volume));
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('ended', handleEnded);
      audioDetachRef.current = () => {
        audio.removeEventListener('play', handlePlay);
        audio.removeEventListener('pause', handlePause);
        audio.removeEventListener('ended', handleEnded);
        audio.pause();
      };
      audioRef.current = audio;

      try {
        await audio.play();
        if (cancelledRef.current || playbackTokenRef.current !== runToken) {
          cleanupAudio();
          return false;
        }
        return true;
      } catch (err) {
        console.warn('Preview playback failed', err);
        cleanupAudio();
        return false;
      }
    },
    [cleanupAudio, volume]
  );

  useEffect(() => {
    const currentResolvedSources = resolvedSourcesRef.current;
    const directPreviewUrl = normalizePreviewText(previewUrl);
    const directPreviewKey = directPreviewUrl ? previewKey || directPreviewUrl : null;

    if (!enabled || (!directPreviewUrl && !currentResolvedSources.length)) {
      stop();
      lastPreviewSignatureRef.current = null;
      setError(null);
      return () => {
        cancelledRef.current = true;
      };
    }

    if (lastSourceSetSignatureRef.current !== sourceSetSignature) {
      failedSourceKeysRef.current.clear();
      lastSourceSetSignatureRef.current = sourceSetSignature;
      lastPreviewSignatureRef.current = null;
    }

    const playableSources = currentResolvedSources.filter(
      (source) => source.key && !failedSourceKeysRef.current.has(source.key)
    );
    const previewSignature = [
      directPreviewKey ? `direct::${directPreviewKey}` : null,
      ...playableSources.map((source) => source.key),
    ]
      .filter(Boolean)
      .join('|');

    if (!directPreviewUrl && !playableSources.length) {
      cleanupAudio();
      lastPreviewSignatureRef.current = previewSignature || null;
      setError('Unable to load preview');
      return () => {
        cancelledRef.current = true;
      };
    }

    if (lastPreviewSignatureRef.current === previewSignature) {
      return () => {
        cancelledRef.current = true;
      };
    }
    lastPreviewSignatureRef.current = previewSignature;

    const runToken = playbackTokenRef.current + 1;
    playbackTokenRef.current = runToken;
    cancelledRef.current = false;
    cleanupAudio();
    setError(null);
    setIsPlaying(false);

    const attemptPlayback = async () => {
      if (directPreviewUrl) {
        const playedDirectPreview = await startPlayback(directPreviewUrl, directPreviewKey, runToken);
        if (playedDirectPreview) return;
      }

      for (const source of playableSources) {
        if (cancelledRef.current || playbackTokenRef.current !== runToken || !source.key) return;

        const primaryName = source.kind === 'artist' ? source.artistName : source.trackName;
        if (!primaryName) {
          failedSourceKeysRef.current.add(source.key);
          continue;
        }

        setCurrentSourceKey(source.key);

        const params =
          source.kind === 'artist'
            ? new URLSearchParams({ artistName: primaryName })
            : new URLSearchParams({
                trackName: source.trackName || '',
                artistName: source.artistName || '',
              });

        try {
          const res: any = await api.get(
            `${source.kind === 'artist' ? '/api/spotify/artist_preview' : '/api/spotify/track_preview'}?${params.toString()}`
          );
          if (cancelledRef.current || playbackTokenRef.current !== runToken) return;

          const resolvedPreviewUrl =
            res?.previewUrl ||
            res?.results?.find((track: any) => track?.previewUrls)?.previewUrls ||
            res?.[0]?.previewUrls ||
            null;
          if (!resolvedPreviewUrl) {
            failedSourceKeysRef.current.add(source.key);
            continue;
          }

          const played = await startPlayback(resolvedPreviewUrl, source.key, runToken);
          if (played) {
            return;
          }
          failedSourceKeysRef.current.add(source.key);
        } catch (err: any) {
          if (cancelledRef.current || playbackTokenRef.current !== runToken) return;
          console.warn('Preview fetch failed', err);
          failedSourceKeysRef.current.add(source.key);
          setIsPlaying(false);
        }
      }

      if (cancelledRef.current || playbackTokenRef.current !== runToken) return;
      setCurrentSourceKey(null);
      setError('Unable to load preview');
      setIsPlaying(false);
    };

    attemptPlayback();

    return () => {
      if (playbackTokenRef.current === runToken) {
        cancelledRef.current = true;
      }
    };
  }, [cleanupAudio, enabled, previewKey, previewUrl, sourceSetSignature, startPlayback, stop]);

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

  return { stop, error, isPlaying, currentSourceKey };
};
