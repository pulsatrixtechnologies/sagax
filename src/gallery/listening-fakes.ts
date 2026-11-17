/** The fakes a listening gallery runs a real session on (#4100): a microphone
 * that hands frames to the page, a live transcriber, a voice detector, two
 * voices, and a server answering the session and its ended transcript. Shared
 * by listening-card.tsx and listening-chat.tsx. Not shipped in the app. */
import { t } from "../lib/i18n";
import type { ListeningDeps } from "../lib/listening/listening-session";
import type { Bot } from "../state/store";

export const ENDED_SESSION_ID = "ls_0000000000000000000b";

export function createFakeListening(bot: Bot, options: { microphone?: "denied" | "ok"; computer?: "denied" } = {}) {
  let onFrame: ((frame: Float32Array) => void) | null = null;
  let heardCount = 0;
  let probability = 0;
  const voices = [0, 1].map((at) => { const vector = new Float32Array(512); vector[at] = 1; return vector; });
  const ears: Array<{ partial: Set<(text: string) => void>; words: string }> = [];
  const deps: ListeningDeps = {
    openMicrophone: async (cb) => {
      if (options.microphone === "denied") throw new DOMException("Permission denied", "NotAllowedError");
      onFrame = cb;
      return { stop: () => {} };
    },
    ...(options.computer === "denied" ? { openComputer: async () => "denied" as const } : {}),
    transcriber: () => {
      const ear = { partial: new Set<(text: string) => void>(), words: "" };
      ears.push(ear);
      return {
        connect: async () => true,
        onPartial: (cb) => { ear.partial.add(cb); return () => ear.partial.delete(cb); },
        begin: () => { ear.words = ""; },
        push: () => {},
        probe: () => false,
        audio: () => new Float32Array(32_000),
        finishHeard: async () => ({ text: ear.words }),
        discard: () => {},
        close: () => {},
      };
    },
    // two voices, one after the other
    models: async () => ({ vad: { probability: async () => probability, reset: () => {} }, embedder: { embed: async () => voices[heardCount++ % 2]! } }),
    request: async <T,>(path: string) => (path.endsWith("/listening")
      ? { session: { sessionId: "ls_0000000000000000000a", botId: bot.id, threadId: bot.threadId, state: "listening", startedAt: Date.now(), lineCount: 0, speakers: [], sources: { microphone: true, computer: false } } }
      : {}) as T,
    now: () => Date.now(),
    setTimer: () => null,
    clearTimer: () => {},
  };
  const settle = () => new Promise((done) => setTimeout(done, 30));
  /** A person speaks: voiced frames, the words, then (when final) silence. */
  async function utter(words: string, final: boolean) {
    probability = 0.9;
    for (let i = 0; i < 12; i++) onFrame!(new Float32Array(512).fill(0.2));
    await settle();
    const ear = ears[0]!;
    ear.words = words;
    for (const cb of ear.partial) cb(words);
    if (!final) return;
    probability = 0;
    for (let i = 0; i < 40; i++) onFrame!(new Float32Array(512));
    await settle();
  }
  return { deps, utter };
}

/** The ended session's transcript, as GET /api/listening/:id answers it. */
export function answerEndedTranscript(bot: Bot, fr: boolean) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes(`/api/listening/${ENDED_SESSION_ID}`)) return realFetch(input, init);
    const said = fr
      ? ["On commence par le budget.", "D'accord, je prends les chiffres.", "Alex, tu envoies le résumé?"]
      : ["Let's start with the budget.", "Sure, I'll take the numbers.", "Alex, will you send the summary?"];
    const body = {
      session: { sessionId: ENDED_SESSION_ID, botId: bot.id, threadId: bot.threadId, state: "ended", startedAt: 0, endedAt: 24 * 60_000, lineCount: 3,
        speakers: [{ key: "s1", label: t("listening.speaker", { n: 1 }) }, { key: "s2", label: t("listening.speaker", { n: 2 }) }, { key: "s3", label: "Alex" }], sources: { microphone: true, computer: false } },
      lines: said.map((text, i) => ({ seq: i + 1, at: i * 4_000, speaker: `s${i + 1}`, text })),
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}
