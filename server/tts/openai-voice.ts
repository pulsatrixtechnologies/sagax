// OpenAI as a voice of voice mode (2026-10-29): text to speech
// (POST /v1/audio/speech, gpt-4o-mini-tts, raw 24 kHz PCM for a live call,
// MP3 for a reply read aloud). Runs on the server with the person's OpenAI
// key, which never reaches a page. The bot stays the brain: this file only
// turns the bot's own words into audio.
// https://developers.openai.com/api/docs/guides/text-to-speech
//
// Messages are this file's own words, sorted like xAI's
// (server/tts/grok.ts grokVoiceFailure: key, quota, busy, down, voice),
// never OpenAI's body: a remote error can echo the request.
import { OPENAI_DEFAULT_VOICE, OPENAI_TTS_VOICES } from "../../shared/voice-providers.ts";
import type { Audio, Voice } from "./elevenlabs.ts";
import type { SynthesizeOptions } from "./grok.ts";

export const OPENAI_VOICE_API = "https://api.openai.com/v1";
/** The PCM rate OpenAI answers with `response_format: "pcm"`. */
export const OPENAI_PCM_RATE = 24_000;
const BODY_MAX = 2_048;

export interface OpenAiVoiceOptions {
  /** the API base (tests: a fake server on loopback) */
  api?: string;
  ttsModel?: string;
  fetch?: typeof fetch;
}

export function openAiVoiceApi(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SAGAX_OPENAI_VOICE_API?.trim() || OPENAI_VOICE_API).replace(/\/+$/, "");
}

/** OpenAI's reason, read only to sort the refusal. */
function detail(body: string): { code?: string; type?: string; param?: string } {
  try {
    const parsed = JSON.parse(body.slice(0, BODY_MAX)) as { error?: Record<string, unknown> };
    const error = parsed.error ?? {};
    return {
      ...(typeof error.code === "string" ? { code: error.code } : {}),
      ...(typeof error.type === "string" ? { type: error.type } : {}),
      ...(typeof error.param === "string" ? { param: error.param } : {}),
    };
  } catch {
    return {};
  }
}

/** A refusal in this side's words (see grokVoiceFailure for the sorting). */
export function openAiRefusal(status: number, body = ""): string {
  const said = detail(body);
  const tag = `${said.code ?? ""} ${said.type ?? ""}`;
  if (/insufficient_quota|billing|credit/i.test(tag) || status === 402) return "The OpenAI account needs credits to generate speech.";
  if (status === 401 || status === 403 || /invalid_api_key|permission/i.test(tag)) return "OpenAI rejected the key or its permissions. Check the OpenAI key in Settings > Providers > Voice.";
  if (status === 429) return "OpenAI is rate-limiting speech. Wait a moment and try again.";
  if (status === 404 || (status === 400 && said.param === "voice")) return "OpenAI could not find that voice. Pick another voice in Settings > Providers > Voice.";
  return `OpenAI voice failed (HTTP ${status}). Try again later.`;
}

async function readLimited(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, BODY_MAX);
  } catch {
    return "";
  }
}

export function createOpenAiVoice(options: OpenAiVoiceOptions = {}) {
  const api = () => (options.api ?? openAiVoiceApi()).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const ttsModel = () => options.ttsModel ?? (process.env.SAGAX_OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts");

  async function request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${api()}${path}`, { ...init, redirect: "error" });
    } catch (error) {
      const reason = (init.signal as AbortSignal | undefined)?.reason as { name?: string } | undefined;
      if (error instanceof Error && (error.name === "TimeoutError" || (error.name === "AbortError" && reason?.name === "TimeoutError"))) {
        throw new Error("OpenAI voice timed out. Try again.");
      }
      // the person interrupted: the caller's own abort
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error("Could not reach OpenAI voice. Check your connection.");
    }
    if (!response.ok) throw new Error(openAiRefusal(response.status, await readLimited(response)));
    return response;
  }

  function speechBody(text: string, voice: string | undefined, format: "mp3" | "pcm", speed?: number): string {
    return JSON.stringify({
      model: ttsModel(),
      input: text,
      voice: voice || OPENAI_DEFAULT_VOICE,
      response_format: format,
      ...(typeof speed === "number" && speed !== 1 ? { speed } : {}),
    });
  }

  return {
    /** OpenAI's built-in voices: a fixed list, no request. */
    async listVoices(_key: string): Promise<Voice[]> {
      return OPENAI_TTS_VOICES.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));
    },

    /** The key works (GET /v1/models/<tts model>): a cheap check before a
     * live call's voice says ready. */
    async verify(key: string): Promise<void> {
      await request(`/models/${encodeURIComponent(ttsModel())}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8_000),
      }).then((response) => response.body?.cancel().catch(() => {}));
    },

    async synthesize(text: string, voice: string | undefined, key: string, opts: SynthesizeOptions = {}): Promise<Audio> {
      const response = await request("/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "audio/mpeg" },
        body: speechBody(text, voice, "mp3", opts.speed),
        signal: AbortSignal.timeout(60_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!bytes.byteLength) throw new Error("OpenAI returned empty audio. Try again.");
      return { bytes, mime: "audio/mpeg" };
    },

    /** Raw 16-bit PCM at 24 kHz, streamed as OpenAI makes it. */
    async synthesizeStream(text: string, voice: string | undefined, key: string, opts: SynthesizeOptions = {}, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }> {
      const timeout = AbortSignal.timeout(60_000);
      const response = await request("/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/octet-stream" },
        body: speechBody(text, voice, "pcm", opts.speed),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!response.body || mime === "application/json" || mime.startsWith("text/")) {
        await response.body?.cancel().catch(() => {});
        throw new Error("OpenAI returned an unexpected audio format. Try again later.");
      }
      return { body: response.body, sampleRate: OPENAI_PCM_RATE };
    },
  };
}

export type OpenAiVoice = ReturnType<typeof createOpenAiVoice>;
