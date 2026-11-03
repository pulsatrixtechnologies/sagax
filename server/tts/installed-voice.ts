// Keep installed voices on the voice-mode path too. Buffered WAV from a
// local engine becomes the same 24 kHz PCM that live calls already read.
import type { AppConfig } from "../config.ts";
import type { VoiceProviderAdapter } from "../voice/voice-mode.ts";
import * as system from "./system-voices.ts";
import * as chatterbox from "./chatterbox.ts";
import type { Audio } from "./elevenlabs.ts";

export function wavPcm24(audio: Uint8Array): Uint8Array {
  const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("The local voice did not return WAV audio.");
  let channels = 0, rate = 0, bits = 0, format = 0;
  let data: Buffer | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const tag = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const start = at + 8;
    if (tag === "fmt " && size >= 16 && start + 16 <= bytes.length) {
      format = bytes.readUInt16LE(start); channels = bytes.readUInt16LE(start + 2);
      rate = bytes.readUInt32LE(start + 4); bits = bytes.readUInt16LE(start + 14);
    }
    if (tag === "data") data = bytes.subarray(start, Math.min(bytes.length, start + size));
    at = start + size + (size % 2);
  }
  if (format !== 1 || bits !== 16 || !channels || !rate || !data) throw new Error("The local voice needs to return 16-bit PCM WAV audio.");
  const frames = Math.floor(data.length / (channels * 2));
  const count = Math.floor(frames * 24_000 / rate);
  const out = Buffer.alloc(count * 2);
  const sample = (frame: number): number => {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) sum += data!.readInt16LE(Math.min(frames - 1, frame) * channels * 2 + channel * 2);
    return sum / channels;
  };
  for (let i = 0; i < count; i++) {
    const source = i * rate / 24_000, left = Math.floor(source), fraction = source - left;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample(left) * (1 - fraction) + sample(left + 1) * fraction))), i * 2);
  }
  return out;
}

function installed(synthesize: (text: string, voice?: string) => Promise<Audio>, listVoices: NonNullable<VoiceProviderAdapter["listVoices"]>): VoiceProviderAdapter {
  return {
    listVoices,
    synthesize: (text, voice) => synthesize(text, voice),
    async synthesizeStream(text, voice, _key, _opts, signal) {
      signal?.throwIfAborted();
      const audio = await synthesize(text, voice);
      signal?.throwIfAborted();
      const bytes = wavPcm24(audio.bytes);
      return { body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), sampleRate: 24_000 };
    },
  };
}

export function createInstalledVoices(config: () => AppConfig) {
  return {
    system: installed((text, voice) => system.synthesizeSystem(text, voice), () => system.listSystemVoices()),
    chatterbox: installed((text, voice) => {
      const cfg = config().tts;
      return chatterbox.synthesizeChatterbox(text, voice || cfg?.voice || "default", cfg?.baseUrl ?? "", cfg?.model);
    }, () => chatterbox.listChatterboxVoices(config().tts?.baseUrl ?? "")),
  };
}
