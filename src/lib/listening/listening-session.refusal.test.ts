// #5377: Listening hears through the same speech to text as the call and
// the dictation (LiveTranscriber: the `/voice/listen` socket, else the whole
// utterance to `POST /voice/transcribe`). When the voice service refuses
// (503 `out_of_credits`), the card said "nobody has spoken yet" while the
// person spoke. It now says the reason, in the person's language, with the
// sentences the call and the dictation already use (voice-mode/failure.ts).
// The voice service here is a stand-in: no socket, a refused upload.
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { LiveTranscriber } from "@/lib/voice-mode/stt-stream";

import { currentListening, startListening, stopListening, type ListeningDeps } from "./listening-session";

vi.mock("@/state/store", () => ({ api: vi.fn(async () => ({})) }));

const VOICED = 0.9;

/** A socket the voice service never opens: every utterance is uploaded. */
const deadSocket = () => ({ binaryType: "", readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }) as unknown as WebSocket;

function fakes(answer: () => Response) {
  let onFrame: ((frame: Float32Array) => void) | null = null;
  let probability = 0;
  const uploads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    uploads.push(String(url));
    return answer();
  }));
  const deps: ListeningDeps = {
    openMicrophone: async (cb) => { onFrame = cb; return { stop: () => {} }; },
    transcriber: (botId, threadId) => new LiveTranscriber({ botId, language: () => "auto", threadId: () => threadId, purpose: "listening", socket: deadSocket, backoffMs: [3_600_000], reconnectEveryMs: 3_600_000 }),
    models: async () => ({ vad: { probability: async () => probability, reset: () => {} }, embedder: null }),
    request: async <T,>(path: string) => (path.endsWith("/listening")
      ? { session: { sessionId: "ls_aaaaaaaaaaaaaaaaaaaa", botId: "bot-a", threadId: "t-1", state: "listening", startedAt: 5, lineCount: 0, speakers: [], sources: { microphone: true, computer: false } } }
      : {}) as T,
    now: () => 1_000,
    setTimer: (fn, ms) => ({ fn, ms }),
    clearTimer: () => {},
  };
  const frames = async (count: number, p: number) => {
    probability = p;
    for (let i = 0; i < count; i++) onFrame!(new Float32Array(512).fill(p > 0.5 ? 0.2 : 0));
    for (let i = 0; i < count * 4 + 20; i++) await Promise.resolve();
  };
  /** Someone speaks, then stops. */
  const utterance = async () => { await frames(12, VOICED); await frames(40, 0); };
  return { deps, utterance, uploads };
}

const outOfCredits = () => new Response(JSON.stringify({
  error: "xAI has no credits left.", code: "out_of_credits", failure: "quota", out_of_credits: true,
  key: { source: "org-key", last4: "c0Je", provider: "xai" },
}), { status: 503, headers: { "content-type": "application/json" } });

/** The organization's xAI key and the person's OpenAI key, both without credits. */
const everyKeyOutOfCredits = () => new Response(JSON.stringify({
  error: "The OpenAI account needs credits to generate speech.", code: "out_of_credits", failure: "quota", out_of_credits: true,
  key: { source: "perspicax-key", last4: "n8Qq", provider: "openai" },
  tried: [{ source: "org-key", last4: "c0Je", failure: "quota" }, { source: "perspicax-key", last4: "n8Qq", provider: "openai", failure: "quota" }],
}), { status: 502, headers: { "content-type": "application/json" } });

afterEach(async () => {
  await stopListening();
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Listening says why nothing is transcribed (#5377)", () => {
  it("names the key without credits, with the call's own sentence, instead of only waiting", async () => {
    const f = fakes(outOfCredits);
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    // the other provider that can hear (shared/voice-providers.ts) is named too: its key takes over by itself
    await vi.waitFor(() => expect(currentListening()!.error).toBe(
      "xAI has no credits left for the organization's xAI key ···c0Je. Ask an admin, or add your own xAI key in Settings > Providers. The answers stay in the chat. An OpenAI key also transcribes: add one in Settings > Providers and Listening goes on with it by itself.",
    ));
    expect(f.uploads.every((url) => url.includes("/voice/transcribe"))).toBe(true);
    expect(currentListening()!.view.lines).toEqual([]);
  });

  it("says it in French to a person who reads French", async () => {
    setLocale("fr");
    const f = fakes(outOfCredits);
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.error).toMatch(/^xAI n'a plus de crédits pour /));
    expect(currentListening()!.error).not.toMatch(/has no credits|Ask an admin/);
  });

  it("names the provider of the key refused last, and offers no other provider once each one was tried", async () => {
    const f = fakes(everyKeyOutOfCredits);
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.error).toBe(
      "OpenAI has no credits left for your OpenAI key ···n8Qq. Add credits to that OpenAI account, or change the key in Settings > Providers. The answers stay in the chat.",
    ));
  });

  it("says in French that another provider's key also transcribes, and where to add it", async () => {
    setLocale("fr");
    const f = fakes(outOfCredits);
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.error).toMatch(/Une clé OpenAI transcrit aussi : ajoutes-en une dans Réglages > Fournisseurs et l'écoute continue avec elle d'elle-même\.$/));
  });

  it("says the voice service does not answer when it is down, never a raw status line", async () => {
    const f = fakes(() => new Response("{}", { status: 502, headers: { "content-type": "application/json" } }));
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.error).toBe("xAI voice is not answering right now. The answers stay in the chat."));
  });

  it("keeps the reason while a heartbeat reaches the server, and drops it once words are heard again", async () => {
    let refuse = true;
    const f = fakes(() => (refuse ? outOfCredits() : new Response(JSON.stringify({ text: "Back again." }), { status: 200, headers: { "content-type": "application/json" } })));
    const timers: Array<{ fn: () => void; ms: number }> = [];
    f.deps.setTimer = (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; };
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.error).toMatch(/no credits left/));
    // the 60 s heartbeat is taken by the server: the refusal is still true
    timers.find((timer) => timer.ms === 60_000)!.fn();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(currentListening()!.error).toMatch(/no credits left/);
    refuse = false;
    await f.utterance();
    await vi.waitFor(() => expect(currentListening()!.view.lines.map((line) => line.text)).toEqual(["Back again."]));
    expect(currentListening()!.error).toBeNull();
  });
});
