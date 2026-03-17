import { useCallback, useEffect, useRef } from "react";

type PlayVoteRevealArgs = {
  progress?: number;
  total?: number;
  burstCount?: number;
};

type PlayWrappedEntryRevealArgs = {
  progress?: number;
  total?: number;
};

type PlayScoreTickArgs = {
  intensity?: number;
};

type HeardleGuessOutcome =
  | "correct"
  | "wrong"
  | "artist_match"
  | "album_match"
  | "gave_up";

type PlayHeardleGuessOutcomeArgs = {
  outcome: HeardleGuessOutcome;
  whenOffsetMs?: number;
  intensity?: number;
};

type UseHostSfxOptions = {
  enabled?: boolean;
  masterVolume?: number;
};

type PlaySampleOptions = {
  path: string;
  volume?: number;
  whenOffsetMs?: number;
  playbackRate?: number;
  startOffsetSec?: number;
  durationSec?: number;
};

type ToneOptions = {
  fromHz: number;
  toHz?: number;
  durationMs?: number;
  volume?: number;
  attackMs?: number;
  releaseMs?: number;
  whenOffsetMs?: number;
  type?: OscillatorType;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedAudioContext: AudioContext | null = null;
const sharedBufferByPath = new Map<string, Promise<AudioBuffer | null>>();

const SFX_PATHS = {
  roundTransition: "/sfx/mixkit-fast-small-sweep-transition-166.wav",
  stageTransition: "/sfx/mixkit-arcade-retro-game-over-213.wav",
  stageTransitionVinylStop: "/sfx/11325622-vinyl-stop-sound-effect-241388.mp3",
  stageRecapScratch: "/sfx/submission/scratch.m4a",
  voteReveal: "/sfx/mixkit-electric-guitar-distorted-slide-2340.wav",
  wrappedEntrySparkle: "/sfx/sparkle.m4a",
  heardleSuccessBell: "/sfx/freesound_community-success_bell-6776.mp3",
  heardleWrongBuzzer: "/sfx/wrong_buzzer.m4a",
  heardleMatchError: "/sfx/universfield-error-08-206492.mp3",
} as const;

const SUBMISSION_STAMP_PATHS = [
  "/sfx/submission/freesound_community-electro-flanged-snare-84432.mp3",
  "/sfx/submission/freesound_community-hard-snare-clap-89494.mp3",
  "/sfx/submission/freesound_community-snare-made-from-clap-101249.mp3",
  "/sfx/submission/khemrajdotin-drum-one-shot-kick-383868.mp3",
  "/sfx/submission/mrstokes302-kick-drum-2-427877.mp3",
  "/sfx/submission/mrstokes302-snare-drum-2-427922.mp3",
  "/sfx/submission/poker_chip.m4a",
] as const;

const getSharedAudioContext = () => {
  if (typeof window === "undefined") return null;
  if (sharedAudioContext) return sharedAudioContext;

  const AudioContextCtor =
    window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioContextCtor) return null;

  sharedAudioContext = new AudioContextCtor();
  return sharedAudioContext;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19] as const;
const semitoneOffsetToHz = (offsetFromA4: number) => 440 * Math.pow(2, offsetFromA4 / 12);

const ratioToScaleStep = (ratio: number, maxStep: number) =>
  Math.round(clamp01(ratio) * Math.max(0, maxStep));

const getScaleSemitone = (step: number, rootSemitoneOffset = 0) => {
  const clampedStep = Math.max(0, Math.min(MAJOR_SCALE_STEPS.length - 1, step));
  return rootSemitoneOffset + MAJOR_SCALE_STEPS[clampedStep];
};

const loadBuffer = async (audioContext: AudioContext, path: string) => {
  const existing = sharedBufferByPath.get(path);
  if (existing) return existing;

  const bufferPromise = fetch(path)
    .then((response) => {
      if (!response.ok) throw new Error(`SFX fetch failed: ${path}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer.slice(0)))
    .catch((error) => {
      console.warn("SFX load failed", path, error);
      return null;
    });

  sharedBufferByPath.set(path, bufferPromise);
  return bufferPromise;
};

export const useHostSfx = ({
  enabled = true,
  masterVolume = 1,
}: UseHostSfxOptions = {}) => {
  const scoreTickIndexRef = useRef(0);

  const playSample = useCallback(
    ({
      path,
      volume = 0.3,
      whenOffsetMs = 0,
      playbackRate = 1,
      startOffsetSec = 0,
      durationSec,
    }: PlaySampleOptions) => {
      if (!enabled) return;
      const audioContext = getSharedAudioContext();
      if (!audioContext) return;

      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => {});
      }

      void loadBuffer(audioContext, path).then((buffer) => {
        if (!buffer) return;

        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();

        source.buffer = buffer;
        source.playbackRate.setValueAtTime(
          Math.max(0.25, Math.min(4, playbackRate)),
          audioContext.currentTime
        );
        gainNode.gain.setValueAtTime(
          Math.max(0, Math.min(1, volume * masterVolume)),
          audioContext.currentTime
        );

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        const startAt = audioContext.currentTime + Math.max(0, whenOffsetMs) / 1000;
        const clampedOffset = Math.max(0, Math.min(startOffsetSec, Math.max(0, buffer.duration - 0.02)));

        if (durationSec && durationSec > 0) {
          source.start(startAt, clampedOffset, Math.min(durationSec, buffer.duration - clampedOffset));
        } else {
          source.start(startAt, clampedOffset);
        }
      });
    },
    [enabled, masterVolume]
  );

  const playTone = useCallback(
    ({
      fromHz,
      toHz,
      durationMs = 120,
      volume = 0.14,
      attackMs = 8,
      releaseMs = 90,
      whenOffsetMs = 0,
      type = "triangle",
    }: ToneOptions) => {
      if (!enabled) return;
      const audioContext = getSharedAudioContext();
      if (!audioContext) return;

      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => {});
      }

      const now = audioContext.currentTime + Math.max(0, whenOffsetMs) / 1000;
      const durationSec = Math.max(0.02, durationMs / 1000);
      const attackSec = Math.max(0.001, attackMs / 1000);
      const releaseSec = Math.max(0.001, releaseMs / 1000);
      const endTime = now + durationSec;
      const sustainStart = Math.min(endTime - releaseSec, now + attackSec);
      const peak = Math.min(1, Math.max(0, volume * masterVolume));

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(1, fromHz), now);
      if (toHz && Math.abs(toHz - fromHz) > 0.5) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), endTime);
      }

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(peak, Math.min(endTime, now + attackSec));
      gainNode.gain.setValueAtTime(peak, sustainStart);
      gainNode.gain.linearRampToValueAtTime(0.0001, endTime);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(now);
      oscillator.stop(endTime);
    },
    [enabled, masterVolume]
  );

  useEffect(() => {
    if (!enabled) return;
    const audioContext = getSharedAudioContext();
    if (!audioContext) return;

    [...Object.values(SFX_PATHS), ...SUBMISSION_STAMP_PATHS].forEach((path) => {
      void loadBuffer(audioContext, path);
    });
  }, [enabled]);

  const playVoteReveal = useCallback(
    ({ progress = 0, total = 0, burstCount = 1 }: PlayVoteRevealArgs = {}) => {
      const ratio = total > 0 ? clamp01(progress / total) : 0;
      const bursts = Math.min(3, Math.max(1, burstCount));
      const maxStartStep = Math.max(0, MAJOR_SCALE_STEPS.length - bursts);
      const startStep = ratioToScaleStep(ratio, maxStartStep);
      const rootSemitoneOffset = -15;

      for (let i = 0; i < bursts; i += 1) {
        const semitone = getScaleSemitone(startStep + i, rootSemitoneOffset);
        const fromHz = semitoneOffsetToHz(semitone);
        const toHz = semitoneOffsetToHz(semitone + 3);
        playTone({
          fromHz,
          toHz,
          durationMs: 96,
          volume: 0.3,
          whenOffsetMs: i * 52,
          attackMs: 6,
          releaseMs: 82,
          type: "triangle",
        });
      }
    },
    [playTone]
  );

  const playWrappedEntryReveal = useCallback(
    ({ progress = 0, total = 0 }: PlayWrappedEntryRevealArgs = {}) => {
      const ratio = total > 0 ? clamp01(progress / total) : 0;
      playSample({
        path: SFX_PATHS.wrappedEntrySparkle,
        volume: 0.3,
        playbackRate: 0.92 + ratio * 0.2,
      });
    },
    [playSample]
  );

  const playVoteRevealGuitar = useCallback(() => {
    playSample({
      path: SFX_PATHS.voteReveal,
      volume: 0.34,
    });
  }, [playSample]);

  const playScratch = useCallback(() => {
    playSample({
      path: SFX_PATHS.stageRecapScratch,
      volume: 0.34,
      playbackRate: 1.02,
    });
  }, [playSample]);

  const playRoundTransition = useCallback(() => {
    playSample({
      path: SFX_PATHS.roundTransition,
      volume: 0.35,
    });
  }, [playSample]);

  const playScoreTick = useCallback(
    ({ intensity = 0.5 }: PlayScoreTickArgs = {}) => {
      const clampedIntensity = clamp01(intensity);
      const melodicPattern = [0, 2, 4, 7, 9];
      const tickIndex = scoreTickIndexRef.current;
      scoreTickIndexRef.current += 1;
      const semitone =
        -17 +
        melodicPattern[tickIndex % melodicPattern.length] +
        Math.round(clampedIntensity * 4);
      const fromHz = semitoneOffsetToHz(semitone);
      const toHz = semitoneOffsetToHz(semitone + 2);

      playTone({
        fromHz,
        toHz,
        durationMs: 86,
        volume: 0.09 + clampedIntensity * 0.05,
        attackMs: 4,
        releaseMs: 72,
        type: "triangle",
      });
    },
    [playTone]
  );

  const playStageTransition = useCallback(() => {
    playSample({
      path: SFX_PATHS.stageTransition,
      volume: 0.4,
    });
  }, [playSample]);

  const playStageRecapTransition = useCallback(() => {
    playSample({
      path: SFX_PATHS.stageTransitionVinylStop,
      volume: 0.4,
    });
  }, [playSample]);

  const playSubmissionStamp = useCallback(
    ({ intensity = 0.55 }: PlayScoreTickArgs = {}) => {
      const level = clamp01(intensity);
      const nextIndex = Math.floor(Math.random() * SUBMISSION_STAMP_PATHS.length);

      playSample({
        path: SUBMISSION_STAMP_PATHS[nextIndex],
        volume: 0.5 + level * 0.08,
        playbackRate: 0.96 + level * 0.06,
      });
    },
    [playSample]
  );

  const playHeardleGuessOutcome = useCallback(
    ({
      outcome,
      whenOffsetMs = 0,
      intensity = 0.6,
    }: PlayHeardleGuessOutcomeArgs) => {
      const level = clamp01(intensity);

      if (outcome === "correct") {
        playSample({
          path: SFX_PATHS.heardleSuccessBell,
          volume: 1 + level * 0.1,
          whenOffsetMs,
        });
        return;
      }

      if (outcome === "album_match" || outcome === "artist_match") {
        playSample({
          path: SFX_PATHS.heardleMatchError,
          volume: 0.2 + level * 0.08,
          whenOffsetMs,
          playbackRate: outcome === "album_match" ? 1.02 : 0.96,
        });
        return;
      }

      if (outcome === "gave_up") {
        playTone({
          fromHz: semitoneOffsetToHz(-14),
          toHz: semitoneOffsetToHz(-17),
          durationMs: 140,
          volume: 0.3,
          whenOffsetMs,
          attackMs: 4,
          releaseMs: 112,
          type: "triangle",
        });
        return;
      }

      playSample({
        path: SFX_PATHS.heardleWrongBuzzer,
        volume: 0.05 + level * 0.5,
        whenOffsetMs
      });
    },
    [playSample, playTone]
  );

  const playRevealComplete = useCallback(() => {
    const playFanfareHit = (
      semitoneOffset: number,
      whenOffsetMs: number,
      durationMs: number,
      leadVolume: number
    ) => {
      const fundamental = semitoneOffsetToHz(semitoneOffset);

      // Bright attack layer.
      playTone({
        fromHz: fundamental,
        toHz: fundamental * 1.06,
        durationMs,
        volume: leadVolume,
        whenOffsetMs,
        attackMs: 4,
        releaseMs: Math.max(70, Math.floor(durationMs * 0.62)),
        type: "sawtooth",
      });

      // Lower support layer.
      playTone({
        fromHz: Math.max(90, fundamental / 2),
        toHz: Math.max(95, (fundamental / 2) * 1.03),
        durationMs: Math.max(80, durationMs - 10),
        volume: leadVolume * 0.6,
        whenOffsetMs: whenOffsetMs + 6,
        attackMs: 6,
        releaseMs: Math.max(65, Math.floor(durationMs * 0.56)),
        type: "triangle",
      });
    };

    playFanfareHit(-9, 0, 230, 0.2); // C4
    playFanfareHit(-9, 240, 110, 0.11); // C4
    playFanfareHit(-5, 350, 120, 0.115); // G4
    playFanfareHit(3, 500, 310, 0.2); // C5
  }, [playTone]);

  return {
    playVoteReveal,
    playVoteRevealGuitar,
    playWrappedEntryReveal,
    playRevealComplete,
    playScratch,
    playSubmissionStamp,
    playRoundTransition,
    playStageRecapTransition,
    playStageTransition,
    playScoreTick,
    playHeardleGuessOutcome,
  };
};
