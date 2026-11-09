// Shiba's bark, synthesized on the spot with Web Audio like the retro
// assistant's sounds (src/components/retro-assistant/sounds.ts): no sample,
// no file, no network. A short "wuf": a falling tone under a band of noise.
// It rings only when the person turned it on (Settings > Appearance, off by
// default), at each bark of the bark move (shiba-moves.ts SHIBA_BARKS).

import { webAudioAllowed } from "./audio-gate";

/** The bark as a score: when (s), how long, the tone's start and end pitch (Hz), the noise band (Hz). */
export const BARK_SCORE = { length: 0.13, from: 620, to: 260, band: 900, gain: 0.12 } as const;

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (audio) return audio;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor || !webAudioAllowed()) return null;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
  return audio;
}

/** One bark, now. Silent where Web Audio is missing or refused. */
export function playShibaBark(make: () => AudioContext | null = context): boolean {
  const ctx = make();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.005;
    const { length, from, to, band, gain } = BARK_SCORE;
    const tone = ctx.createOscillator();
    tone.type = "sawtooth";
    tone.frequency.setValueAtTime(from, start);
    tone.frequency.exponentialRampToValueAtTime(to, start + length);
    const samples = Math.max(1, Math.floor(ctx.sampleRate * length));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = band;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length);
    tone.connect(amp);
    noise.connect(filter).connect(amp);
    amp.connect(ctx.destination);
    tone.start(start);
    noise.start(start);
    tone.stop(start + length + 0.02);
    noise.stop(start + length + 0.02);
    return true;
  } catch {
    return false;
  }
}
