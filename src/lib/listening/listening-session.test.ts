// #4100 lot "listening-live-card": a listening session in this window with
// a fake microphone, a fake live transcriber (the socket) and a fake voice
// detector: the start reaches the server, an utterance becomes one final
// line under its speaker (the grey line before it), lines go in batches by
// seq, stop sends the last lines and then the stop, and a stop from another
// device ends the capture here.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Heard } from "@/lib/voice-mode/stt-stream";

import { currentListening, receiveListeningFrame, startListening, stopListening, type ListeningDeps } from "./listening-session";

vi.mock("@/state/store", () => ({ api: vi.fn() }));

const VOICED = 0.9;

function fakes() {
  const requests: Array<{ path: string; body?: unknown }> = [];
  const ears: Array<{ partial: Set<(text: string) => void>; words: string }> = [];
  const timers: Array<{ fn: () => void; ms: number; done?: boolean }> = [];
  let onFrame: ((frame: Float32Array) => void) | null = null;
  let micStopped = false;
  let closed = false;
  let probability = 0;
  const deps: ListeningDeps = {
    openMicrophone: async (cb) => { onFrame = cb; return { stop: () => { micStopped = true; } }; },
    transcriber: () => {
      const ear = { partial: new Set<(text: string) => void>(), words: "" };
      ears.push(ear);
      return {
        connect: async () => true,
        onPartial: (cb) => { ear.partial.add(cb); return () => ear.partial.delete(cb); },
        begin: () => { ear.words = ""; },
        push: () => {},
        probe: () => false,
        audio: () => new Float32Array(16_000),
        finishHeard: async (): Promise<Heard> => ({ text: ear.words }),
        discard: () => {},
        close: () => { closed = true; },
      };
    },
    models: async () => ({ vad: { probability: async () => probability, reset: () => {} }, embedder: null }),
    request: async <T,>(path: string, init?: RequestInit) => {
      requests.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (path.endsWith("/listening")) return { session: { sessionId: "ls_aaaaaaaaaaaaaaaaaaaa", botId: "bot-a", threadId: "t-1", state: "listening", startedAt: 5, lineCount: 0, speakers: [], sources: { microphone: true, computer: false } } } as T;
      return {} as T;
    },
    now: () => 1_000,
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer: (handle) => { (handle as { done?: boolean }).done = true; },
  };
  const frames = async (count: number, p: number, to?: Array<(frame: Float32Array) => void>) => {
    probability = p;
    const target = to?.[0] ?? onFrame!;
    for (let i = 0; i < count; i++) target(new Float32Array(512).fill(p > 0.5 ? 0.2 : 0));
    // let the channel's queue run
    for (let i = 0; i < count * 4 + 20; i++) await Promise.resolve();
  };
  const say = (text: string, ear = 0) => { const target = ears[ear]!; target.words = text; for (const cb of target.partial) cb(text); };
  const runTimers = async (ms: number) => {
    for (const timer of timers.filter((entry) => !entry.done && entry.ms === ms)) { timer.done = true; timer.fn(); }
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { deps, requests, frames, say, runTimers, state: () => ({ micStopped, closed }) };
}

afterEach(async () => { await stopListening(); });

describe("listening in a bot's chat (#4100)", () => {
  it("says on the card when the system refused the computer's sound, and listens on the microphone", async () => {
    const f = fakes();
    f.deps.openComputer = async () => "denied";
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    expect(f.requests[0]!.body).toEqual({ threadId: "t-1", sources: { microphone: true, computer: false } });
    expect(currentListening()).toMatchObject({ phase: "listening", computerDenied: true, sources: { microphone: true, computer: false } });
  });

  it("hears the computer's sound as its own channel and drops the microphone's echo of it", async () => {
    const f = fakes();
    let computerFrame: ((frame: Float32Array) => void) | null = null;
    let computerStopped = false;
    f.deps.openComputer = async (cb) => { computerFrame = cb; return { stop: () => { computerStopped = true; } }; };
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    expect(f.requests[0]!.body).toEqual({ threadId: "t-1", sources: { microphone: true, computer: true } });
    expect(computerFrame).not.toBeNull();
    // the same words on both channels: the computer's line stays, the microphone's echo goes
    await f.frames(12, VOICED, [computerFrame!]);
    f.say("We will ship the release on Friday.", 1);
    await f.frames(40, 0, [computerFrame!]);
    await f.frames(12, VOICED);
    f.say("we will ship the release on friday", 0);
    await f.frames(40, 0);
    const view = currentListening()!.view;
    expect(view.lines.map((line) => line.text)).toEqual(["We will ship the release on Friday."]);
    expect(view.speakers.map((speaker) => speaker.label)).toEqual(["Speaker 1"]);
    await stopListening();
    expect(computerStopped).toBe(true);
  });

  it("turns what is heard into lines, sends them by seq, and stops with the last ones", async () => {
    const f = fakes();
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    expect(f.requests[0]).toEqual({ path: "/api/bots/bot-a/listening", body: { threadId: "t-1", sources: { microphone: true, computer: false } } });
    expect(currentListening()).toMatchObject({ phase: "listening", sessionId: "ls_aaaaaaaaaaaaaaaaaaaa" });

    await f.frames(12, VOICED);
    f.say("Okay, I'll put that");
    expect(currentListening()!.view.partial.microphone).toBe("Okay, I'll put that");
    f.say("Okay, I'll put that in the brief.");
    await f.frames(40, 0);
    const view = currentListening()!.view;
    expect(view.partial.microphone).toBeUndefined();
    expect(view.lines).toEqual([{ seq: 1, at: expect.any(Number), speaker: "s1", text: "Okay, I'll put that in the brief." }]);
    expect(view.speakers).toEqual([{ key: "s1", label: "Speaker 1" }]);

    await f.runTimers(1_500);
    const batch = f.requests.find((request) => request.path.endsWith("/lines"));
    expect(batch?.body).toMatchObject({ lines: [{ seq: 1, speaker: "s1", text: "Okay, I'll put that in the brief." }], speakers: [{ key: "s1", label: "Speaker 1" }] });

    await stopListening();
    expect(f.requests.at(-1)).toEqual({ path: "/api/listening/ls_aaaaaaaaaaaaaaaaaaaa/stop" });
    expect(f.state()).toEqual({ micStopped: true, closed: true });
    expect(currentListening()).toBeNull();
  });

  it("sends a heartbeat when nothing was heard", async () => {
    const f = fakes();
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.runTimers(60_000);
    expect(f.requests.find((request) => request.path.endsWith("/lines"))?.body).toEqual({ lines: [], speakers: [] });
  });

  it("stops the capture when the session ended on another device, without a second stop", async () => {
    const f = fakes();
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    receiveListeningFrame({ sessionId: "ls_aaaaaaaaaaaaaaaaaaaa", state: "ended" });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(currentListening()).toBeNull();
    expect(f.state().micStopped).toBe(true);
    expect(f.requests.some((request) => request.path.endsWith("/stop"))).toBe(false);
  });

  it("goes on after the highest seq the server kept when it joins a live session, so no line is taken for a duplicate", async () => {
    const f = fakes();
    const request = f.deps.request;
    // the server kept seqs 1 and 3 (seq 2 was an empty line it skipped): two lines, highest seq 3
    f.deps.request = async <T,>(path: string, init?: RequestInit) => {
      const answer = await request<T>(path, init);
      if (!path.endsWith("/listening")) return answer;
      const { session } = answer as { session: Record<string, unknown> };
      return { session: { ...session, lineCount: 2, lastSeq: 3 } } as T;
    };
    await startListening({ botId: "bot-a", threadId: "t-1", personName: "Ada" }, f.deps);
    await f.frames(12, VOICED);
    f.say("Then we ship on Friday.");
    await f.frames(40, 0);
    expect(currentListening()!.view.lines.map((line) => line.seq)).toEqual([4]);
    await f.runTimers(1_500);
    expect(f.requests.find((entry) => entry.path.endsWith("/lines"))?.body).toMatchObject({ lines: [{ seq: 4, text: "Then we ship on Friday." }] });
  });
});
