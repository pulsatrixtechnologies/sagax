// OpenAI as the ears of voice mode (2026-10-29): a live call's and the
// dictation's streaming speech to text (Realtime transcription,
// wss://api.openai.com/v1/realtime?intent=transcription, gpt-live-transcribe)
// and a whole recording (POST /v1/audio/transcriptions, gpt-transcribe).
// The same TranscriptionStream xAI's socket gives (server/tts/grok.ts), so
// server/voice/voice-listen-session.ts drives either alike. The page sends 16 kHz
// PCM; OpenAI takes 24 kHz, so the frames are resampled here. The page's
// own detector ends a turn (`finalize`, a commit here): OpenAI's turn
// detection stays off. Never a key or OpenAI's words in a message.
// https://developers.openai.com/api/docs/guides/realtime-transcription
// https://developers.openai.com/api/docs/guides/speech-to-text
import { WebSocket as WsWebSocket } from "ws";

import type { HeaderWebSocket, TranscriptionHandlers, TranscriptionStream } from "./grok.ts";
import { openAiRefusal, openAiVoiceApi } from "./openai-voice.ts";

export const OPENAI_STT_RATE = 24_000;
const PAGE_RATE = 16_000;
/** session.created without session.updated this long: ready all the same. */
const READY_GRACE_MS = 1_500;

/** 16 kHz 16-bit PCM to 24 kHz, linear, its phase kept from one frame to the next. */
export function createUpsampler(): (pcm: Uint8Array) => Uint8Array {
  let last = 0;
  let phase = 0;
  const step = PAGE_RATE / OPENAI_STT_RATE;
  return (pcm) => {
    const count = Math.floor(pcm.byteLength / 2);
    if (!count) return new Uint8Array(0);
    const input = new DataView(pcm.buffer, pcm.byteOffset, count * 2);
    const sample = (index: number) => (index < 0 ? last : input.getInt16(index * 2, true));
    const out: number[] = [];
    // positions are in input samples, -1 being the previous frame's last one
    let position = phase - 1;
    while (position <= count - 1) {
      const base = Math.floor(position);
      const fraction = position - base;
      const a = sample(base);
      const b = base + 1 <= count - 1 ? sample(base + 1) : a;
      out.push(Math.round(a + (b - a) * fraction));
      position += step;
    }
    phase = position - (count - 1);
    last = sample(count - 1);
    const bytes = new Uint8Array(out.length * 2);
    const view = new DataView(bytes.buffer);
    out.forEach((value, index) => view.setInt16(index * 2, Math.max(-32768, Math.min(32767, value)), true));
    return bytes;
  };
}

/** An OpenAI error event in this side's words. */
function errorMessage(frame: Record<string, unknown>): string {
  const error = (frame.error ?? {}) as Record<string, unknown>;
  const code = `${error.code ?? ""} ${error.type ?? ""}`;
  if (/invalid_api_key|authentication|permission/i.test(code)) return openAiRefusal(401);
  if (/insufficient_quota|billing/i.test(code)) return "The OpenAI account needs credits to transcribe speech.";
  if (/rate_limit/i.test(code)) return "OpenAI is rate-limiting speech. Wait a moment and try again.";
  return "OpenAI speech to text reported an error. Try again.";
}

export interface OpenAiSttOptions {
  api?: string;
  streamModel?: string;
  fileModel?: string;
  fetch?: typeof fetch;
  Socket?: HeaderWebSocket;
}

export function createOpenAiStt(options: OpenAiSttOptions = {}) {
  const api = () => (options.api ?? openAiVoiceApi()).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const streamModel = () => options.streamModel ?? (process.env.SAGAX_OPENAI_STT_STREAM_MODEL?.trim() || "gpt-live-transcribe");
  const fileModel = () => options.fileModel ?? (process.env.SAGAX_OPENAI_STT_MODEL?.trim() || "gpt-transcribe");

  return {
    /** One recorded turn (WAV or WebM; OpenAI takes no Ogg, which then
     * goes to another provider). `keyterms` go in the prompt. */
    async transcribe(audio: Uint8Array, mime: string, key: string, language?: string, keyterms: readonly string[] = []): Promise<{ text: string }> {
      if (mime !== "audio/wav" && mime !== "audio/webm") throw new Error("OpenAI speech to text failed (HTTP 415). Try again later.");
      const form = new FormData();
      form.append("model", fileModel());
      if (language) form.append("languages[]", language);
      if (keyterms.length) form.append("prompt", `Names and terms: ${keyterms.slice(0, 50).join(", ")}`);
      form.append("response_format", "json");
      form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), mime === "audio/wav" ? "turn.wav" : "turn.webm");
      let response: Response;
      try {
        response = await doFetch(`${api()}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, accept: "application/json" },
          body: form,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") throw new Error("OpenAI voice timed out. Try again.");
        throw new Error("Could not reach OpenAI voice. Check your connection.");
      }
      if (!response.ok) throw new Error(openAiRefusal(response.status, await response.text().catch(() => "")));
      const body = (await response.json().catch(() => null)) as { text?: unknown } | null;
      if (!body || typeof body.text !== "string") throw new Error("OpenAI returned an invalid transcript. Try again later.");
      return { text: body.text };
    },

    /** A live call's streaming speech to text: one socket per call, a
     * commit per turn (the page's finalize). */
    openTranscription(key: string, opts: { language?: string; keyterms?: readonly string[] }, handlers: TranscriptionHandlers): TranscriptionStream {
      const Socket = options.Socket ?? (WsWebSocket as unknown as HeaderWebSocket);
      const url = `${api().replace(/^http/, "ws")}/realtime?intent=transcription`;
      const upsample = createUpsampler();
      const texts = new Map<string, string>();
      const completedItems = new Set<string>();
      // Commit acknowledgements name items in input order; transcription
      // completions need not arrive in that order. Keep that identity all
      // the way to the page, including probes inside one local utterance.
      const commits: Array<{ requestId?: string }> = [];
      const items = new Map<string, { requestId?: string }>();
      let appended = false;
      let closed = false;
      let isReady = false;
      let grace: ReturnType<typeof setTimeout> | null = null;
      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      ready.catch(() => {});
      const becomeReady = () => {
        if (isReady || closed) return;
        isReady = true;
        if (grace) clearTimeout(grace);
        resolveReady();
      };
      let socket: WebSocket;
      const fail = (message: string) => {
        if (closed) return;
        closed = true;
        if (grace) clearTimeout(grace);
        rejectReady(new Error(message));
        handlers.onError(message);
        try { socket?.close(); } catch { /* already closed */ }
        handlers.onClose();
      };
      try {
        socket = new Socket(url, { headers: { authorization: `Bearer ${key}` } });
      } catch {
        queueMicrotask(() => fail("Could not reach OpenAI voice. Check your connection."));
        return { ready, send() {}, finalize() {}, close() {} };
      }
      const node = socket as unknown as { on?: (event: string, cb: (req: unknown, res: { statusCode?: number; on(event: string, cb: (chunk?: unknown) => void): unknown }) => void) => void };
      if (typeof node.on === "function") {
        node.on("unexpected-response", (_req, res) => {
          let body = "";
          res.on("data", (chunk) => { if (body.length < 2048) body += String(chunk); });
          const done = () => fail(openAiRefusal(res.statusCode ?? 0, body));
          res.on("end", done);
          res.on("error", done);
        });
      }
      const sendJson = (message: Record<string, unknown>) => {
        if (!closed && socket.readyState === 1) socket.send(JSON.stringify(message));
      };
      socket.addEventListener("open", () => {
        const transcription: Record<string, unknown> = { model: streamModel() };
        if (opts.language) transcription.languages = [opts.language];
        if (opts.keyterms?.length) transcription.keywords = opts.keyterms.slice(0, 50);
        sendJson({
          type: "session.update",
          session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: OPENAI_STT_RATE }, transcription, turn_detection: null } } },
        });
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        if (closed || typeof event.data !== "string") return;
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
        const type = String(frame.type ?? "");
        if (type === "session.updated" || type === "transcription_session.updated") becomeReady();
        else if (type === "session.created" || type === "transcription_session.created") {
          grace = setTimeout(becomeReady, READY_GRACE_MS);
          grace.unref?.();
        } else if (type === "input_audio_buffer.committed") {
          if (typeof frame.item_id === "string" && commits.length) {
            const commit = commits.shift()!;
            items.set(frame.item_id, commit);
            // Live transcription may start before the client commits.
            // Keep those deltas by provider item id, then identify their
            // full cumulative partial as soon as the ack names its owner.
            const text = texts.get(frame.item_id);
            if (text) handlers.onTranscript({ text, final: false, speechFinal: false, ...(commit.requestId ? { requestId: commit.requestId } : {}) });
          }
        } else if (type === "conversation.item.input_audio_transcription.delta") {
          const id = String(frame.item_id ?? "");
          if (!id || completedItems.has(id)) return;
          const text = (texts.get(id) ?? "") + (typeof frame.delta === "string" ? frame.delta : "");
          texts.set(id, text);
          if (!items.has(id)) return;
          const requestId = items.get(id)?.requestId;
          handlers.onTranscript({ text, final: false, speechFinal: false, ...(requestId ? { requestId } : {}) });
        } else if (type === "conversation.item.input_audio_transcription.completed") {
          const id = String(frame.item_id ?? "");
          // Unknown and already-completed items are never an untagged
          // transcript for the next turn (duplicates can arrive late).
          if (!items.has(id)) return;
          texts.delete(id);
          const requestId = items.get(id)?.requestId;
          items.delete(id);
          completedItems.add(id);
          handlers.onTranscript({ text: typeof frame.transcript === "string" ? frame.transcript : "", final: true, speechFinal: true, ...(requestId ? { requestId } : {}) });
        } else if (type === "conversation.item.input_audio_transcription.failed") {
          fail("OpenAI could not transcribe the audio. Try again.");
        } else if (type === "error") {
          const code = String(((frame.error ?? {}) as Record<string, unknown>).code ?? "");
          // a finalize with nothing heard: an empty turn, not a failure
          if (code === "input_audio_buffer_commit_empty") {
            const eventId = ((frame.error ?? {}) as Record<string, unknown>).event_id;
            const index = typeof eventId === "string" ? commits.findIndex((commit) => commit.requestId === eventId) : 0;
            if (index < 0 || !commits.length) return;
            const requestId = commits.splice(index, 1)[0]!.requestId;
            handlers.onTranscript({ text: "", final: true, speechFinal: true, ...(requestId ? { requestId } : {}) });
          }
          else fail(errorMessage(frame));
        }
      });
      socket.addEventListener("error", () => fail("Could not reach OpenAI voice. Check your connection."));
      socket.addEventListener("close", () => {
        if (closed) return;
        closed = true;
        if (grace) clearTimeout(grace);
        rejectReady(new Error("closed"));
        handlers.onClose();
      });
      return {
        ready,
        send(pcm) {
          const up = upsample(pcm);
          if (!up.byteLength) return;
          appended = true;
          sendJson({ type: "input_audio_buffer.append", audio: Buffer.from(up).toString("base64") });
        },
        finalize(requestId) {
          if (!appended) {
            handlers.onTranscript({ text: "", final: true, speechFinal: true, ...(requestId ? { requestId } : {}) });
            return;
          }
          appended = false;
          commits.push({ requestId });
          sendJson({ type: "input_audio_buffer.commit", ...(requestId ? { event_id: requestId } : {}) });
        },
        close() {
          if (closed) return;
          closed = true;
          if (grace) clearTimeout(grace);
          try { socket.close(); } catch { /* already closed */ }
          handlers.onClose();
        },
      };
    },
  };
}
