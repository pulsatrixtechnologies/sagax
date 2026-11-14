// @vitest-environment happy-dom
// #4187: a burst of bot frames on the open thread while it shows unread (a
// bot streams; every frame the server sent before it handled the read still
// says unread) posted one POST /api/bots/:id/read per frame. Counted here:
// one read in flight per thread, at most one more for what landed meanwhile,
// never one per frame; a failed read is posted again, a line that lands
// while a read is out is never lost.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerFrame } from "../../../shared/wire";
import type { FoldLiveFrameCtx } from "./fold-live-frame";
import { initialState, type AppState, type Bot } from "./model";

const BOT = "bot-burst";
const THREAD = "thread-open";

type Answer = { resolve: (unread: boolean) => void; reject: () => void; status: (code: number) => void };

// a fresh module per test: the desktop's poster keeps its holds per thread
let foldLiveFrame: typeof import("./fold-live-frame").foldLiveFrame;
let reads: string[];
let answers: Answer[];

function botFrame(unread: boolean, activity = "working"): ServerFrame {
  return { kind: "bot", bot: { id: BOT, name: "Burst", threadId: THREAD, unread, activity,
    tasks: [{ threadId: THREAD, title: "Open", unread, activity }] } } as unknown as ServerFrame;
}

function messageFrame(index: number): ServerFrame {
  return { kind: "message", threadId: THREAD, message: { id: `line-${index}`, role: "bot", kind: "text", text: `line ${index}`, at: index } } as unknown as ServerFrame;
}

function ctx(): FoldLiveFrameCtx {
  const state: AppState = {
    ...initialState,
    bots: [{ id: BOT, name: "Burst", threadId: THREAD, messages: [], unread: true, tasks: [{ threadId: THREAD, title: "Open", unread: true }] } as unknown as Bot],
    selectedId: BOT,
    activeView: "chat",
  };
  return {
    rawDispatch: () => {}, dispatch: () => {}, stateRef: { current: state },
    clearStream: () => {}, flushDeltas: () => {}, deltaBuffer: { push: () => {} },
    withTaskWrites: (bot) => bot, botPatchQueue: { overlayFor: () => ({}), cancel: () => {} },
    showThreadsRef: { current: false }, refreshInstancesPeripheral: () => {},
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reading the open thread over a burst of bot frames (#4187)", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ foldLiveFrame } = await import("./fold-live-frame"));
    reads = [];
    answers = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (!String(url).endsWith("/read")) return Promise.resolve(new Response("{}"));
      reads.push(String(url));
      return new Promise<Response>((resolve, reject) => {
        answers.push({
          resolve: (unread) => resolve(new Response(JSON.stringify({ bot: { id: BOT, tasks: [{ threadId: THREAD, unread }] } }))),
          reject: () => reject(new Error("offline")),
          status: (code) => resolve(new Response("{}", { status: code })),
        });
      });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts one read for a burst of frames that all show the thread unread", async () => {
    const live = ctx();
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(true), live);
    expect(reads).toEqual([`/api/bots/${BOT}/read`]);
    answers[0]!.resolve(false);
    await settle();
    // the frames that landed while it was out get one more read, not 100
    expect(reads).toHaveLength(2);
    answers[1]!.resolve(false);
    await settle();
    // read now: frames that say so post nothing
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(false), live);
    expect(reads).toHaveLength(2);
    // a new line makes it unread again: one more read for that change
    foldLiveFrame(messageFrame(1), live);
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(3);
    answers[2]!.resolve(false);
    await settle();
    expect(reads).toHaveLength(4);
    answers[3]!.resolve(false);
    await settle();
    expect(reads).toHaveLength(4);
  });

  it("does not post again a read that changed nothing until a new line lands", async () => {
    const live = ctx();
    foldLiveFrame(botFrame(true), live);
    answers[0]!.resolve(true);
    await settle();
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(1);
    foldLiveFrame(messageFrame(2), live);
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(2);
    // a refusal for good (404) waits for a new line as well
    answers[1]!.status(404);
    await settle();
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(2);
    foldLiveFrame(messageFrame(3), live);
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(3);
  });

  it("posts a failed read again on the next unread frame", async () => {
    const live = ctx();
    foldLiveFrame(botFrame(true), live);
    // network error: nothing changed on the server, the next frame retries
    answers[0]!.reject();
    await settle();
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(2);
    // the proxy's 499 and a 5xx are failures too, not refusals
    answers[1]!.status(499);
    await settle();
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(3);
    answers[2]!.status(503);
    await settle();
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(4);
    // still one in flight: a burst while the retry is out adds no request
    for (let index = 0; index < 100; index += 1) foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(4);
  });

  it("posts once more for a line that lands while the read is out", async () => {
    const live = ctx();
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(1);
    // the server handled the read, then the bot's last line landed, before
    // the client got the answer
    foldLiveFrame(messageFrame(4), live);
    answers[0]!.resolve(false);
    await settle();
    expect(reads).toHaveLength(2);
    answers[1]!.resolve(false);
    await settle();
    expect(reads).toHaveLength(2);
    // the same race on a read the server answered still unread
    foldLiveFrame(messageFrame(5), live);
    foldLiveFrame(botFrame(true), live);
    expect(reads).toHaveLength(3);
    foldLiveFrame(messageFrame(6), live);
    answers[2]!.resolve(true);
    await settle();
    expect(reads).toHaveLength(4);
  });
});
