// Original retro bleeps and boops, synthesized on the spot with Web Audio: no
// samples, no files, no network. Nothing is created until the person has
// interacted with the page once (browsers refuse autoplay anyway), and every
// sound is a no-op while the "play sounds" option is off.

import { webAudioAllowed } from "@/lib/audio-gate";

export type RetroSound = "hello" | "bye" | "pop" | "tap" | "chime" | "whoosh" | "click" | "bulb";

type Note = { at: number; freq: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number };

/** Each sound as a short score: seconds from now, pitch in Hz. */
export const RETRO_SCORES: Record<Exclude<RetroSound, "whoosh">, Note[]> = {
  hello: [
    { at: 0, freq: 523, dur: 0.07, type: "square" },
    { at: 0.08, freq: 659, dur: 0.07, type: "square" },
    { at: 0.16, freq: 988, dur: 0.12, type: "square" },
  ],
  bye: [
    { at: 0, freq: 880, dur: 0.07, type: "square" },
    { at: 0.08, freq: 587, dur: 0.07, type: "square" },
    { at: 0.16, freq: 392, dur: 0.14, type: "square", slideTo: 260 },
  ],
  pop: [{ at: 0, freq: 740, dur: 0.06, type: "triangle", slideTo: 1180 }],
  tap: [
    { at: 0, freq: 1800, dur: 0.018, type: "square", gain: 0.05 },
    { at: 0.14, freq: 1700, dur: 0.018, type: "square", gain: 0.05 },
    { at: 0.28, freq: 1800, dur: 0.018, type: "square", gain: 0.05 },
  ],
  chime: [
    { at: 0, freq: 784, dur: 0.09, type: "triangle" },
    { at: 0.09, freq: 1047, dur: 0.09, type: "triangle" },
    { at: 0.18, freq: 1319, dur: 0.18, type: "triangle" },
  ],
  click: [{ at: 0, freq: 1200, dur: 0.012, type: "square", gain: 0.04 }],
  bulb: [
    { at: 0, freq: 1319, dur: 0.05, type: "sine" },
    { at: 0.06, freq: 1760, dur: 0.1, type: "sine" },
  ],
};

export interface RetroSoundPlayer {
  /** Call from a user gesture; creates the audio context on first call. */
  unlock: () => void;
  play: (sound: RetroSound) => void;
  unlocked: () => boolean;
  close: () => void;
}

export function createRetroSounds(
  enabled: () => boolean,
  factory: () => AudioContext | null = () => {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    return Ctor && webAudioAllowed() ? new Ctor() : null;
  },
): RetroSoundPlayer {
  let ctx: AudioContext | null = null;

  const tone = (audio: AudioContext, note: Note, start: number) => {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = note.type ?? "square";
    osc.frequency.setValueAtTime(note.freq, start + note.at);
    if (note.slideTo) osc.frequency.exponentialRampToValueAtTime(note.slideTo, start + note.at + note.dur);
    const peak = note.gain ?? 0.07;
    amp.gain.setValueAtTime(0.0001, start + note.at);
    amp.gain.exponentialRampToValueAtTime(peak, start + note.at + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
    osc.connect(amp).connect(audio.destination);
    osc.start(start + note.at);
    osc.stop(start + note.at + note.dur + 0.02);
  };

  const whoosh = (audio: AudioContext, start: number) => {
    const length = Math.floor(audio.sampleRate * 0.45);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2.5;
    filter.frequency.setValueAtTime(400, start);
    filter.frequency.exponentialRampToValueAtTime(3200, start + 0.4);
    const amp = audio.createGain();
    amp.gain.setValueAtTime(0.09, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    source.connect(filter).connect(amp).connect(audio.destination);
    source.start(start);
  };

  return {
    unlock() {
      if (ctx) {
        if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
        return;
      }
      try {
        ctx = factory();
      } catch {
        ctx = null;
      }
    },
    unlocked: () => ctx !== null,
    play(sound) {
      if (!ctx || !enabled()) return;
      try {
        const start = ctx.currentTime + 0.01;
        if (sound === "whoosh") whoosh(ctx, start);
        else for (const note of RETRO_SCORES[sound]) tone(ctx, note, start);
      } catch {
        /* an audio hiccup never breaks the owl */
      }
    },
    close() {
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
