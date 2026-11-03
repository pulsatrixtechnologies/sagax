// Fish Audio in the same voice-mode contract as the other providers.
// PCM is signed 16-bit mono at 24 kHz, as documented by Fish:
// https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
import type { FishTtsModel } from "../config.ts";
import type { SynthesizeOptions } from "./grok.ts";
import type { VoiceProviderAdapter } from "../voice/voice-mode.ts";
import * as fish from "./fish.ts";

export function createFishVoice(options: { api?: string; fetch?: typeof fetch; model?(): FishTtsModel } = {}): VoiceProviderAdapter {
  const api = () => (options.api ?? process.env.SAGAX_FISH_AUDIO_API ?? "https://api.fish.audio").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  async function listVoices(key: string) {
    try { return await fish.listVoices(key); }
    catch { throw new Error("Could not list your Fish Audio voices. Check the key and your connection."); }
  }
  async function request(text: string, voice: string | undefined, key: string, opts: SynthesizeOptions, format: "mp3" | "pcm", signal?: AbortSignal): Promise<Response> {
    const id = voice || (await listVoices(key))[0]?.id;
    if (!id) throw new Error("Fish Audio could not find that voice. Pick a voice in Settings > Voice.");
    let response: Response;
    try {
      response = await doFetch(`${api()}/v1/tts`, {
        method: "POST", redirect: "error",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: format === "pcm" ? "application/octet-stream" : "audio/mpeg", model: options.model?.() ?? fish.DEFAULT_FISH_MODEL },
        body: JSON.stringify({ text, reference_id: id, format, sample_rate: format === "pcm" ? 24_000 : 44_100, ...(format === "mp3" ? { mp3_bitrate: 64 } : {}), ...(opts.speed ? { prosody: { speed: opts.speed } } : {}), ...(opts.language && opts.language !== "auto" ? { language: opts.language } : {}), latency: "normal" }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("Could not reach Fish Audio voice. Check your connection.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) throw new Error("Fish Audio rejected the key or its voice permissions.");
      if (response.status === 402) throw new Error("The Fish Audio account needs credits to generate speech.");
      if (response.status === 429) throw new Error("Fish Audio is rate-limiting speech. Wait a moment and try again.");
      throw new Error(`Fish Audio voice failed (HTTP ${response.status}). Try again later.`);
    }
    const mime = response.headers.get("content-type") ?? "";
    if (!response.body || mime.includes("json") || mime.startsWith("text/")) {
      await response.body?.cancel().catch(() => {});
      throw new Error("Fish Audio returned an unexpected audio format. Try again later.");
    }
    return response;
  }
  return {
    listVoices,
    async synthesize(text, voice, key, opts) {
      const response = await request(text, voice, key, opts, "mp3");
      return { bytes: new Uint8Array(await response.arrayBuffer()), mime: "audio/mpeg" };
    },
    async synthesizeStream(text, voice, key, opts, signal) {
      const response = await request(text, voice, key, opts, "pcm", signal);
      return { body: response.body!, sampleRate: 24_000 };
    },
  };
}
