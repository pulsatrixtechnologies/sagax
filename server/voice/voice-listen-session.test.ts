// The live call's ears on the server (voice-listen-session.ts) with a fake
// xAI socket: a dropped xAI socket is reopened behind the same page socket
// (the page is told `reconnected`), the page closes only after the backoff
// fails, and the socket is rotated before xAI's session limit while no
// utterance is open, the audio of the gap going to the new one.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionHandlers, TranscriptionStream } from "../tts/grok.ts";
import { createListenSession, LISTEN_BACKOFF_MS, LISTEN_IDLE_MS, LISTEN_MAX_REOPENS_PER_MIN, LISTEN_SOCKET_AGE_MS, LISTEN_STABLE_MS, type ListenFrame } from "./voice-listen-session.ts";

class FakeUpstream implements TranscriptionStream {
  ready: Promise<void>;
  audio: number[] = [];
  finalizes = 0;
  requestIds: Array<string | undefined> = [];
  closed = false;
  private accept!: () => void;
  private refuse!: (error: Error) => void;
  readonly handlers: TranscriptionHandlers;
  constructor(handlers: TranscriptionHandlers) {
    this.handlers = handlers;
    this.ready = new Promise((resolve, reject) => { this.accept = resolve; this.refuse = reject; });
    this.ready.catch(() => {});
  }
  send(pcm: Uint8Array) { this.audio.push(pcm.byteLength); }
  finalize(requestId?: string) { this.finalizes += 1; this.requestIds.push(requestId); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.refuse(new Error("closed"));
    this.handlers.onClose();
  }
  open() { this.accept(); }
  /** xAI ended the socket (its session limit, a network drop) */
  drop() { this.close(); }
  words(text: string, requestId?: string) { this.handlers.onTranscript({ text, final: true, speechFinal: true, ...(requestId ? { requestId } : {}) }); }
}

function make() {
  let clock = 0;
  const upstreams: FakeUpstream[] = [];
  const frames: ListenFrame[] = [];
  const closePage = vi.fn();
  const booked = vi.fn();
  const session = createListenSession({
    open: (handlers) => {
      const upstream = new FakeUpstream(handlers);
      upstreams.push(upstream);
      return upstream;
    },
    sendText: (frame) => frames.push(frame),
    closePage,
    log: () => {},
    onUpstreamClosed: booked,
    now: () => clock,
  });
  const tick = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  return { session, upstreams, frames, closePage, booked, tick };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the listen session", () => {
  it("carries finalize identities to the provider and back to the page", async () => {
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    t.session.finalize("stt-1");
    expect(t.upstreams[0]!.requestIds).toEqual(["stt-1"]);
    t.upstreams[0]!.words("Julie", "stt-1");
    expect(t.frames.at(-1)).toEqual({ type: "transcript", text: "Julie", final: true, speechFinal: true, requestId: "stt-1" });
    t.session.close();
  });
  it("an xAI socket that drops is reopened behind the page's socket, which survives", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    expect(await t.session.ready).toBe(true);
    t.upstreams[0]!.drop();
    expect(t.booked).toHaveBeenCalled();
    await t.tick(LISTEN_BACKOFF_MS[0]);
    expect(t.upstreams).toHaveLength(2);
    // audio while xAI is away is not sent anywhere (the page resends it)
    t.session.audio(new Uint8Array(640));
    t.upstreams[1]!.open();
    await t.tick(0);
    expect(t.frames).toContainEqual({ type: "reconnected" });
    expect(t.closePage).not.toHaveBeenCalled();
    t.session.audio(new Uint8Array(640));
    t.session.finalize();
    expect(t.upstreams[1]!.audio).toEqual([640]);
    expect(t.upstreams[1]!.finalizes).toBe(1);
    t.upstreams[1]!.words("hello again");
    expect(t.frames.at(-1)).toEqual({ type: "transcript", text: "hello again", final: true, speechFinal: true });
    // the old socket's late words are not this call's any more
    t.upstreams[0]!.words("stale");
    expect(t.frames.some((frame) => frame.type === "transcript" && frame.text === "stale")).toBe(false);
  });

  it("closes the page (1011) only after every reopen in a row failed; a success resets the count", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    t.upstreams[0]!.drop();
    for (const wait of LISTEN_BACKOFF_MS) {
      await t.tick(wait);
      t.upstreams.at(-1)!.drop();
    }
    expect(t.upstreams).toHaveLength(1 + LISTEN_BACKOFF_MS.length);
    expect(t.closePage).toHaveBeenCalledWith(1011);
  });

  it("xAI accepting then closing at once is still failing: the page closes after the backoff, never reopening forever", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    t.upstreams[0]!.drop();
    for (const wait of LISTEN_BACKOFF_MS) {
      await t.tick(wait);
      t.upstreams.at(-1)!.open();
      await t.tick(0);
      t.upstreams.at(-1)!.drop();
    }
    expect(t.upstreams).toHaveLength(1 + LISTEN_BACKOFF_MS.length);
    expect(t.closePage).toHaveBeenCalledWith(1011);
  });

  it("a socket that lived 10 s or heard words resets the count, but not past the reopens a minute allows", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    for (let i = 0; i < LISTEN_MAX_REOPENS_PER_MIN; i++) {
      t.upstreams.at(-1)!.drop();
      await t.tick(LISTEN_BACKOFF_MS[0]);
      t.upstreams.at(-1)!.open();
      await t.tick(0);
      // words heard: it works
      t.upstreams.at(-1)!.words("ok");
    }
    expect(t.closePage).not.toHaveBeenCalled();
    t.upstreams.at(-1)!.drop();
    expect(t.closePage).toHaveBeenCalledWith(1011);
    // a minute later, a socket that lived 10 s may drop and come back
    const u = make();
    u.upstreams[0]!.open();
    await u.session.ready;
    await u.tick(LISTEN_STABLE_MS);
    u.upstreams[0]!.drop();
    await u.tick(LISTEN_BACKOFF_MS[0]);
    expect(u.upstreams).toHaveLength(2);
    expect(u.closePage).not.toHaveBeenCalled();
  });

  it("a first socket that never opens answers false (the route sends 502)", async () => {
    const t = make();
    t.upstreams[0]!.drop();
    expect(await t.session.ready).toBe(false);
    expect(t.upstreams).toHaveLength(1);
  });

  it("rotates xAI's socket at 540 s once no utterance is open; audio of the gap goes to the new one", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    // someone is speaking when the age is reached: not now
    await t.tick(LISTEN_SOCKET_AGE_MS - 1_000);
    t.session.audio(new Uint8Array(640));
    await t.tick(1_000);
    expect(t.upstreams).toHaveLength(1);
    await t.tick(LISTEN_IDLE_MS);
    expect(t.upstreams).toHaveLength(2);
    expect(t.upstreams[0]!.closed).toBe(true);
    // the person starts talking while the next socket opens
    t.session.audio(new Uint8Array(320));
    t.session.finalize("stt-rotated");
    t.upstreams[1]!.open();
    await t.tick(0);
    expect(t.upstreams[1]!.audio).toEqual([320]);
    expect(t.upstreams[1]!.requestIds).toEqual(["stt-rotated"]);
    expect(t.upstreams[1]!.finalizes).toBe(1);
    // a rotation is not a reconnect: the page has nothing to resend
    expect(t.frames).not.toContainEqual({ type: "reconnected" });
    expect(t.closePage).not.toHaveBeenCalled();
  });

  it("the page leaving closes xAI's socket and stops any reopen", async () => {
    vi.useFakeTimers();
    const t = make();
    t.upstreams[0]!.open();
    await t.session.ready;
    t.upstreams[0]!.drop();
    t.session.close();
    await t.tick(5_000);
    expect(t.upstreams).toHaveLength(1);
  });
});
