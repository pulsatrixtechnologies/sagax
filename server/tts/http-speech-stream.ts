// A live call's streaming voice over a provider that speaks by HTTP only
// (OpenAI /v1/audio/speech, ElevenLabs /text-to-speech/<voice>/stream):
// the same SpeechStream the xAI socket gives (server/tts/grok.ts
// openSpeechStream), so server/voice/voice-speech-session.ts drives either alike.
//
// Words arrive in pieces (`delta`). They are held until a sentence ends,
// the bot pauses (HOLD_IDLE_MS), the piece grows long (HOLD_MAX_CHARS, cut at
// a space) or the utterance ends (`done`), then that segment is one HTTP
// request whose raw PCM is forwarded as it arrives: the first words of an
// answer play while the rest is still being written. Segments of one
// utterance are spoken in order, one request at a time. `clear` aborts the
// request speaking and drops the rest (barge-in). A failed request is a
// dropped socket (onError then onClose): the session fails what was in
// flight and the page says it over POST /voice/stream, where another
// provider takes over when this one keeps failing.
import type { SpeechStream, SpeechStreamHandlers } from "./grok.ts";

/** Held words are spoken once the bot paused this long. */
export const HOLD_IDLE_MS = 300;
/** Held words longer than this are cut at their last space. */
export const HOLD_MAX_CHARS = 220;
const SENTENCE_END = /[.!?…;:](?=\s)|\n/g;

export type HttpSynthesizer = (text: string, signal: AbortSignal) => Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }>;

export interface HttpSpeechOptions {
  synthesize: HttpSynthesizer;
  /** checked before the stream says ready (the key, cheaply): a refused key
   * gives way to the next one before the call's first sentence */
  verify?: () => Promise<void>;
  idleMs?: number;
}

type Item = { text: string } | { done: true };

export function openHttpSpeechStream(options: HttpSpeechOptions, handlers: SpeechStreamHandlers): SpeechStream {
  const idleMs = options.idleMs ?? HOLD_IDLE_MS;
  let closed = false;
  let held = "";
  let idle: ReturnType<typeof setTimeout> | null = null;
  const queue: Item[] = [];
  let speaking: AbortController | null = null;
  /** bumped by clear(): a request of an older generation says nothing more */
  let generation = 0;
  /** an odd byte left from a chunk, so every frame holds whole samples */
  let carry: Uint8Array | null = null;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});

  const end = () => {
    if (closed) return;
    closed = true;
    if (idle) clearTimeout(idle);
    idle = null;
    speaking?.abort();
    speaking = null;
    queue.length = 0;
    rejectReady(new Error("closed"));
    handlers.onClose();
  };
  const fail = (message: string) => {
    if (closed) return;
    handlers.onError(message);
    end();
  };

  const emit = (chunk: Uint8Array) => {
    let bytes = chunk;
    if (carry) {
      const joined = new Uint8Array(carry.byteLength + chunk.byteLength);
      joined.set(carry, 0);
      joined.set(chunk, carry.byteLength);
      bytes = joined;
      carry = null;
    }
    if (bytes.byteLength % 2 === 1) {
      carry = bytes.slice(bytes.byteLength - 1);
      bytes = bytes.subarray(0, bytes.byteLength - 1);
    }
    if (bytes.byteLength) handlers.onAudio(bytes);
  };

  const pump = () => {
    if (closed || speaking) return;
    const item = queue.shift();
    if (!item) return;
    if ("done" in item) {
      carry = null;
      handlers.onDone();
      pump();
      return;
    }
    const controller = new AbortController();
    speaking = controller;
    const mine = generation;
    void (async () => {
      try {
        const audio = await options.synthesize(item.text, controller.signal);
        const reader = audio.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || controller.signal.aborted || closed || mine !== generation) break;
            if (value?.byteLength) emit(value);
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
      } catch (error) {
        if (controller.signal.aborted || closed || mine !== generation) return;
        fail(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        if (speaking === controller) speaking = null;
      }
      if (closed || mine !== generation) return;
      pump();
    })().catch(() => {});
  };

  const push = (text: string) => {
    const clean = text.trim();
    if (clean) queue.push({ text: clean });
  };
  /** Speak what is held up to its last sentence end, or all of it. */
  const flush = (all: boolean) => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (!held) return;
    if (all) {
      push(held);
      held = "";
    } else {
      let cut = -1;
      for (const match of held.matchAll(SENTENCE_END)) cut = match.index! + 1;
      if (cut < 0 && held.length > HOLD_MAX_CHARS) cut = held.lastIndexOf(" ", HOLD_MAX_CHARS);
      if (cut > 0) {
        push(held.slice(0, cut));
        held = held.slice(cut);
      }
    }
    pump();
  };

  if (options.verify) {
    options.verify().then(() => { if (!closed) resolveReady(); }, (error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  } else queueMicrotask(() => { if (!closed) resolveReady(); });

  const delta = (text: string) => {
    if (closed || !text) return;
    held += text;
    flush(false);
    if (held) {
      idle = setTimeout(() => flush(true), idleMs);
      idle.unref?.();
    }
  };
  const done = () => {
    if (closed) return;
    flush(true);
    queue.push({ done: true });
    pump();
  };

  return {
    ready,
    delta,
    done,
    speak(text) {
      delta(text);
      done();
    },
    clear() {
      if (closed) return;
      generation += 1;
      if (idle) clearTimeout(idle);
      idle = null;
      held = "";
      carry = null;
      queue.length = 0;
      speaking?.abort();
      speaking = null;
      queueMicrotask(() => { if (!closed) handlers.onCleared(); });
    },
    close: end,
  };
}
