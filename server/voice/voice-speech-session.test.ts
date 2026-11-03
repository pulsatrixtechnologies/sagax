// The streaming voice's server session (voice-speech-session.ts) with a
// fake xAI socket: clauses one after the other, barge-in cleared at xAI,
// a dropped socket failing the clauses in flight and reconnecting with a
// backoff, three failed reconnects in a row ending in a fallback logged
// once, a stuck clause or clear counted as a drop.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SpeechStream, SpeechStreamHandlers } from "../tts/grok.ts";
import { speakableDelta } from "../tts/speech-text.ts";
import { createSpeechSession, SPEECH_APPEND_MAX, SPEECH_BACKOFF_MS, SPEECH_IDLE_FINISH_MS, SPEECH_MAX_REOPENS_PER_MIN, SPEECH_STABLE_MS, SPEECH_STALL_MS, type SpeechFrame } from "./voice-speech-session.ts";

class FakeUpstream implements SpeechStream {
  spoken: string[] = [];
  clears = 0;
  closed = false;
  ready: Promise<void>;
  private open!: () => void;
  private refuse!: (error: Error) => void;
  readonly handlers: SpeechStreamHandlers;
  constructor(handlers: SpeechStreamHandlers) {
    this.handlers = handlers;
    this.ready = new Promise((resolve, reject) => { this.open = resolve; this.refuse = reject; });
    this.ready.catch(() => {});
  }
  deltas: string[] = [];
  dones = 0;
  speak(text: string) { this.delta(text); this.done(); }
  delta(text: string) { this.deltas.push(text); this.spoken.push(text); }
  done() { this.dones += 1; }
  clear() { this.clears += 1; }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.refuse(new Error("closed"));
    this.handlers.onClose();
  }
  accept() { this.open(); }
  /** the connection dropped (xAI side) */
  drop() { this.close(); }
}

function make(maxAgeMs?: number, delta?: (text: string, before: string) => string) {
  const upstreams: FakeUpstream[] = [];
  const frames: SpeechFrame[] = [];
  const audio: number[] = [];
  const usage: number[] = [];
  const log = vi.fn();
  const closePage = vi.fn();
  const session = createSpeechSession({
    open: (handlers) => {
      const upstream = new FakeUpstream(handlers);
      upstreams.push(upstream);
      return upstream;
    },
    speakable: (text) => text.replace(/```[\s\S]*?```/g, "").trim(),
    usage: (n) => usage.push(n),
    sendText: (frame) => frames.push(frame),
    sendBinary: (pcm) => audio.push(pcm.byteLength),
    closePage,
    log,
    sampleRate: 24_000,
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(delta ? { speakableDelta: delta } : {}),
  });
  const say = (id: string, text: string) => session.message(JSON.stringify({ type: "say", id, text }));
  const sayMore = (id: string, text: string) => session.message(JSON.stringify({ type: "say", id, text, more: true }));
  const append = (id: string, text: string) => session.message(JSON.stringify({ type: "append", id, text }));
  const finish = (id: string) => session.message(JSON.stringify({ type: "finish", id }));
  const cancel = (id: string) => session.message(JSON.stringify({ type: "cancel", id }));
  return { session, upstreams, up: () => upstreams.at(-1)!, frames, audio, usage, log, closePage, say, sayMore, append, finish, cancel };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("streaming voice session (server side)", () => {
  it("opens xAI's socket, then speaks each clause in turn, its audio between start and done", async () => {
    const t = make();
    t.up().accept();
    expect(await t.session.ready).toBe(true);
    t.say("c1", "Bonjour,");
    t.say("c2", "voici la suite.");
    await flush();
    // one utterance at a time
    expect(t.up().spoken).toEqual(["Bonjour,"]);
    t.up().handlers.onAudio(new Uint8Array(4800));
    t.up().handlers.onDone();
    expect(t.up().spoken).toEqual(["Bonjour,", "voici la suite."]);
    t.up().handlers.onAudio(new Uint8Array(2400));
    t.up().handlers.onDone();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }, { type: "start", id: "c2" }, { type: "done", id: "c2" }]);
    expect(t.audio).toEqual([4800, 2400]);
    expect(t.usage).toEqual([8, 15]);
  });

  it("a lead clause sends text.delta without text.done until finish", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Four");
    await flush();
    expect(t.up().deltas).toEqual(["Four"]);
    expect(t.up().dones).toBe(0);
    expect(t.frames).toEqual([{ type: "start", id: "c1" }]);
    t.up().handlers.onAudio(new Uint8Array(400));
    t.append("c1", " is");
    t.finish("c1");
    await flush();
    expect(t.up().deltas).toEqual(["Four", " is"]);
    expect(t.up().dones).toBe(1);
    t.up().handlers.onAudio(new Uint8Array(400));
    t.up().handlers.onDone();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }]);
    expect(t.audio).toEqual([400, 400]);
  });

  it("an answer is one utterance: every append goes to xAI at once, text.done only at finish", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Bonjour,");
    t.append("c1", " il fait beau.");
    t.up().handlers.onAudio(new Uint8Array(48_000));
    t.append("c1", " Autre chose?");
    await flush();
    // no wait for audio.done between clauses: one utterance, one intonation
    expect(t.up().deltas).toEqual(["Bonjour,", " il fait beau.", " Autre chose?"]);
    expect(t.up().dones).toBe(0);
    t.finish("c1");
    expect(t.up().dones).toBe(1);
    t.up().handlers.onDone();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }]);
    expect(t.usage).toEqual([8, 14, 13]);
  });

  it("appended text is made speakable without losing the space before it, and cut at 500 characters", async () => {
    const t = make(undefined, speakableDelta);
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Je");
    t.append("c1", " pense **vraiment**");
    t.append("c1", " 👍");
    t.append("c1", ".");
    t.append("c1", ` ${"a".repeat(SPEECH_APPEND_MAX + 100)}`);
    await flush();
    // the last word waits for the space after it (splitHeldDelta)
    expect(t.up().deltas.slice(0, 4)).toEqual(["Je", " pense", " vraiment", " ."]);
    expect(t.up().deltas[4]!.length).toBeLessThanOrEqual(SPEECH_APPEND_MAX);
  });

  it("an identifier cut between two appends is never said: the unfinished word waits until it is whole", async () => {
    const t = make(undefined, speakableDelta);
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Le commit");
    t.append("c1", " 3f9a2c7");
    t.append("c1", "e1b04d est");
    t.append("c1", " poussé, ticket #12");
    t.append("c1", "34, id:");
    t.append("c1", " 9876 réglé");
    await flush();
    const said = t.up().deltas.join("");
    expect(said).not.toMatch(/3f9a|e1b0|#12|34|9876/);
    expect(said).toContain("Le commit");
    expect(said).toContain("poussé, ticket");
    // the last word is held until the utterance finishes, then said
    expect(said).not.toContain("réglé");
    t.finish("c1");
    expect(t.up().deltas.join("")).toMatch(/réglé$/);
    expect(t.up().dones).toBe(1);
  });

  it("a held word of a queued utterance is kept for it, and a cancelled one is never said", async () => {
    const t = make(undefined, speakableDelta);
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Un.");
    t.sayMore("c2", "Deux");
    t.append("c2", " trois");
    t.finish("c2");
    await flush();
    expect(t.up().deltas).toEqual(["Un."]);
    t.up().handlers.onDone();
    expect(t.up().deltas).toEqual(["Un.", "Deux trois"]);
    t.sayMore("c3", "Quatre");
    t.append("c3", " cinq");
    t.cancel("c3");
    t.finish("c3");
    expect(t.up().deltas.join("")).not.toContain("cinq");
  });

  it("an open utterance with nothing speakable yet stays open for its words; one never given any just ends", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "```js\nx()\n```");
    await flush();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }]);
    expect(t.up().deltas).toEqual([]);
    t.append("c1", "Oui, c'est réglé.");
    expect(t.up().deltas).toEqual(["Oui, c'est réglé."]);
    t.finish("c1");
    t.up().handlers.onDone();
    t.sayMore("c2", "```js\nx()\n```");
    t.finish("c2");
    await flush();
    expect(t.up().dones).toBe(1);
    expect(t.frames.slice(-2)).toEqual([{ type: "start", id: "c2" }, { type: "done", id: "c2" }]);
  });

  it("the stall watchdog runs only while audio is owed, not while the bot thinks mid-answer", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Un instant,");
    // 0.5 s of audio covers the 11 characters sent: caught up
    t.up().handlers.onAudio(new Uint8Array(24_000));
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS * 3);
    expect(t.upstreams[0]!.closed).toBe(false);
    // more text, and no audio for it: stuck
    t.append("c1", " je regarde le billet tout de suite.");
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS);
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1"] });
  });

  it("an open utterance idle for 20 s ends at xAI; later words open a new xAI utterance, the page's goes on", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Un instant,");
    t.up().handlers.onAudio(new Uint8Array(24_000));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_FINISH_MS - 100);
    expect(t.up().dones).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    // nothing left open at xAI
    expect(t.up().dones).toBe(1);
    // words that come while that end is spoken wait for it
    t.append("c1", " voici.");
    expect(t.up().deltas).toEqual(["Un instant,"]);
    t.up().handlers.onDone();
    // the page was not told done: its utterance goes on
    expect(t.frames).toEqual([{ type: "start", id: "c1" }]);
    expect(t.up().deltas).toEqual(["Un instant,", "voici."]);
    t.append("c1", " Autre chose?");
    expect(t.up().deltas.at(-1)).toBe(" Autre chose?");
    t.finish("c1");
    expect(t.up().dones).toBe(2);
    t.up().handlers.onDone();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }]);
    expect(t.upstreams[0]!.closed).toBe(false);
  });

  it("an utterance ended for idleness gives way to the next one, and its cancel clears nothing at xAI", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Bon.");
    t.up().handlers.onAudio(new Uint8Array(24_000));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_FINISH_MS + 10);
    t.up().handlers.onDone();
    t.say("c2", "Autre réponse.");
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }, { type: "start", id: "c2" }]);
    expect(t.up().deltas.at(-1)).toBe("Autre réponse.");
    // a cancel of an idle-ended one: no text.clear
    t.up().handlers.onDone();
    t.sayMore("c3", "Encore.");
    t.up().handlers.onAudio(new Uint8Array(24_000));
    await vi.advanceTimersByTimeAsync(SPEECH_IDLE_FINISH_MS + 10);
    t.up().handlers.onDone();
    t.cancel("c3");
    expect(t.up().clears).toBe(0);
    expect(t.frames.at(-1)).toEqual({ type: "done", id: "c3" });
  });

  it("after text.done, audio is owed until audio.done", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.sayMore("c1", "Fin.");
    t.up().handlers.onAudio(new Uint8Array(24_000));
    t.finish("c1");
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS);
    expect(t.upstreams[0]!.closed).toBe(true);
  });

  it("answers the page's ping", async () => {
    const t = make();
    t.session.message(JSON.stringify({ type: "ping" }));
    expect(t.frames).toEqual([{ type: "pong" }]);
  });

  it("a clause with nothing speakable is skipped, never sent to xAI; a bad frame is ignored", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "```js\nx()\n```");
    t.session.message("not json");
    t.session.message(JSON.stringify({ type: "say", id: "bad id!", text: "x" }));
    expect(t.frames).toEqual([{ type: "skip", id: "c1" }]);
    expect(t.up().spoken).toEqual([]);
  });

  it("barge-in: the clause speaking is cleared at xAI, queued ones dropped, no audio after", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Une longue phrase.");
    t.say("c2", "Une autre.");
    t.up().handlers.onAudio(new Uint8Array(100));
    t.cancel("c2");
    t.cancel("c1");
    expect(t.up().clears).toBe(1);
    // xAI's last frames of it, and its own done, before audio.clear
    t.up().handlers.onAudio(new Uint8Array(100));
    t.up().handlers.onDone();
    expect(t.audio).toEqual([100]);
    t.up().handlers.onCleared();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c2" }, { type: "done", id: "c1" }]);
    // the next answer goes on the same socket
    t.say("c3", "Nouvelle réponse.");
    expect(t.up().spoken).toEqual(["Une longue phrase.", "Nouvelle réponse."]);
    expect(t.upstreams).toHaveLength(1);
  });

  it("a dropped socket fails the clauses in flight and reconnects with a backoff", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Un.");
    t.say("c2", "Deux.");
    t.up().drop();
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1", "c2"] });
    await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0] - 1);
    expect(t.upstreams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.upstreams).toHaveLength(2);
    // said while it reconnects: waits for it
    t.say("c3", "Trois.");
    expect(t.up().spoken).toEqual([]);
    t.up().accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.up().spoken).toEqual(["Trois."]);
    expect(t.log).not.toHaveBeenCalled();
  });

  it("three failed reconnects in a row: fallback to POST, logged once, the page closed", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.up().drop();
    for (const wait of SPEECH_BACKOFF_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      t.up().drop();
    }
    expect(t.upstreams).toHaveLength(1 + SPEECH_BACKOFF_MS.length);
    expect(t.frames.at(-1)).toEqual({ type: "fallback" });
    expect(t.log).toHaveBeenCalledTimes(1);
    expect(t.closePage).toHaveBeenCalledWith(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.upstreams).toHaveLength(1 + SPEECH_BACKOFF_MS.length);
  });

  it("a reconnect that works (its audio came) resets the count", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    for (let i = 0; i < 5; i++) {
      t.up().drop();
      await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0]);
      t.up().accept();
      await vi.advanceTimersByTimeAsync(0);
      t.say(`c${i}`, "Oui.");
      t.up().handlers.onAudio(new Uint8Array(480));
      t.up().handlers.onDone();
      // a minute between drops: the reopens a minute allows are not reached
      await vi.advanceTimersByTimeAsync(SPEECH_STABLE_MS);
    }
    expect(t.frames.some((f) => f.type === "fallback")).toBe(false);
  });

  it("xAI accepting then closing at once is still failing: fallback after the reconnects, never reopening forever", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    for (const wait of SPEECH_BACKOFF_MS) {
      t.up().drop();
      await vi.advanceTimersByTimeAsync(wait);
      t.up().accept();
      await vi.advanceTimersByTimeAsync(0);
    }
    t.up().drop();
    expect(t.frames.at(-1)).toEqual({ type: "fallback" });
    expect(t.upstreams).toHaveLength(1 + SPEECH_BACKOFF_MS.length);
  });

  it("more reopens in a minute than allowed falls back, even when each one worked", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    for (let i = 0; i < SPEECH_MAX_REOPENS_PER_MIN; i++) {
      t.up().drop();
      await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0]);
      t.up().accept();
      await vi.advanceTimersByTimeAsync(0);
      t.say(`c${i}`, "Oui.");
      t.up().handlers.onAudio(new Uint8Array(480));
      t.up().handlers.onDone();
    }
    expect(t.frames.some((f) => f.type === "fallback")).toBe(false);
    t.up().drop();
    expect(t.frames.at(-1)).toEqual({ type: "fallback" });
  });

  it("an xAI error frame closes that socket (a drop), the clause is failed", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Un.");
    t.up().handlers.onError("Grok text to speech reported an error.");
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1"] });
  });

  it("a clause stuck without audio, or a clear never confirmed, counts as a drop", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Bloquée.");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1"] });
    await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0]);
    t.up().accept();
    await vi.advanceTimersByTimeAsync(0);
    t.say("c2", "Coupée.");
    t.cancel("c2");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.upstreams[1]!.closed).toBe(true);
  });

  it("an xAI socket that never opens: ready says false (the route answers 502)", async () => {
    const t = make();
    t.up().drop();
    expect(await t.session.ready).toBe(false);
    t.session.close();
  });

  it("an idle socket past the age limit reconnects without a failure, and the next clause still speaks", async () => {
    vi.useFakeTimers();
    const t = make(50);
    t.up().accept();
    await t.session.ready;
    await vi.advanceTimersByTimeAsync(49);
    expect(t.upstreams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.upstreams).toHaveLength(2);
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.filter((frame) => frame.type === "error" || frame.type === "fallback")).toEqual([]);
    expect(t.log).not.toHaveBeenCalled();
    t.up().accept();
    await vi.advanceTimersByTimeAsync(0);
    t.say("c9", "Encore.");
    expect(t.up().spoken).toEqual(["Encore."]);
    t.session.close();
  });

  it("a clause in flight is not cut at the age limit; the socket rotates once it is idle", async () => {
    vi.useFakeTimers();
    const t = make(50);
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Longue.");
    expect(t.up().spoken).toEqual(["Longue."]);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.up().closed).toBe(false);
    expect(t.upstreams).toHaveLength(1);
    t.up().handlers.onAudio(new Uint8Array(10));
    t.up().handlers.onDone();
    expect(t.frames).toContainEqual({ type: "done", id: "c1" });
    expect(t.upstreams).toHaveLength(2);
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.filter((frame) => frame.type === "error" || frame.type === "fallback")).toEqual([]);
    t.session.close();
  });

  it("closing the session (hang-up) closes xAI's socket and stops reconnecting", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.session.close();
    expect(t.up().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.upstreams).toHaveLength(1);
    expect(t.frames).toEqual([]);
  });
});
