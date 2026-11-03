// @vitest-environment happy-dom
// A routine runs while the person watches the bot's chat (threads hidden,
// the default). The real store, its live fold and the real ChatView get the
// frame sequence a routine run sends (recorded from a fixture server): the
// run's own thread is created, tagged as the run's, then works and streams.
// Nothing in the chat may follow that thread: the chat stays on the person's
// conversation, its column is never remounted and its rows never come and go.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ServerFrame } from "../../shared/wire";
import type { AppState, BotAnnouncement, Message, Task } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id?: string) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const BOT = "clive";
const MAIN = "main-thread";
const RUN = "run-thread";
const RUN_ID = "run-1";
const at = Date.UTC(2026, 10, 2, 14, 0);
const model = { instanceId: "fake", model: "m" };
const mainTask: Task = { threadId: MAIN, title: "Clive", createdAt: at - 60_000, busy: false, activity: "idle", unread: false, modelSelection: model, approvalMode: "ask" };
const transcript: Message[] = [
  { id: "ask", at: at - 50_000, role: "user", kind: "text", text: "Hello" },
  { id: "answer", parentId: "ask", at: at - 49_000, role: "bot", kind: "text", text: "Hi, how can I help?" },
];
const receipt = (status: string): Message => ({
  id: "receipt", parentId: "answer", at, role: "bot", kind: "routine.run", text: "",
  routineRun: { runId: RUN_ID, routineId: "routine-1", routineName: "Brief", status, threadId: RUN } as never,
});
const announce = (tasks: Task[], extra: Partial<BotAnnouncement> = {}): BotAnnouncement => ({
  id: BOT, threadId: MAIN, mainThreadId: MAIN, name: "Clive", title: "", description: "", notifications: true, unread: false,
  color: "green", modelSelection: model, busy: false, activity: "idle", tasks, ...extra,
} as BotAnnouncement);
const runTask = (patch: Partial<Task> = {}): Task => ({ threadId: RUN, title: "Brief", createdAt: at, busy: false, activity: "idle", unread: false, modelSelection: model, approvalMode: "ask", ...patch });

/** The frames a routine run sends, in order (shape recorded from the
 * fixture server, server/index.ts createTask then patchTask): the run's task
 * appears for one frame before it is tagged, the newest plain thread, which
 * the server names as the main thread (WireBot.mainThreadId). */
function routineRunFrames(steps: number): ServerFrame[] {
  const frames: ServerFrame[] = [];
  const bot = (tasks: Task[], extra: Partial<BotAnnouncement> = {}) => frames.push({ kind: "bot", bot: announce(tasks, extra) } as ServerFrame);
  frames.push({ kind: "message", threadId: MAIN, message: receipt("queued") } as ServerFrame);
  bot([runTask(), mainTask], { mainThreadId: RUN });
  bot([runTask({ routineRunId: RUN_ID }), mainTask]);
  frames.push({ kind: "message.patch", threadId: MAIN, message: receipt("running") } as ServerFrame);
  frames.push({ kind: "message", threadId: RUN, message: { id: "brief", at: at + 10, role: "user", kind: "text", text: "Run the brief" } } as ServerFrame);
  const working = runTask({ routineRunId: RUN_ID, busy: true, activity: "working", turnStartedAt: at + 20 });
  bot([working, mainTask]);
  frames.push({ kind: "runtime", event: { type: "turn.started", eventId: "t0", provider: "claudeAgent", threadId: RUN, createdAt: new Date(at + 20).toISOString(), turnId: "turn-1" } } as ServerFrame);
  for (let step = 0; step < steps; step++) {
    const id = `step-${step}`;
    frames.push({ kind: "message", threadId: RUN, message: { id, at: at + 100 + step, role: "bot", kind: "activity", text: `Step ${step}`, tool: { name: "Bash", ok: true } } } as ServerFrame);
    frames.push({ kind: "runtime", event: { type: "content.delta", eventId: `d${step}`, provider: "claudeAgent", threadId: RUN, createdAt: new Date(at + 100 + step).toISOString(), streamKind: "assistant_text", delta: `word${step} ` } } as ServerFrame);
    frames.push({ kind: "message.patch", threadId: RUN, message: { id, at: at + 100 + step, role: "bot", kind: "activity", text: `Step ${step} done`, tool: { name: "Bash", ok: true } } } as ServerFrame);
    // every store change of the run's thread announces the bot again
    bot([working, mainTask]);
    if (step % 5 === 0) frames.push({ kind: "message.patch", threadId: MAIN, message: receipt("running") } as ServerFrame);
  }
  frames.push({ kind: "message", threadId: RUN, message: { id: "final", at: at + 9_000, role: "bot", kind: "text", text: "Brief done" } } as ServerFrame);
  frames.push({ kind: "runtime", event: { type: "turn.completed", eventId: "tc", provider: "claudeAgent", threadId: RUN, createdAt: new Date(at + 9_000).toISOString(), turnId: "turn-1", ok: true } } as ServerFrame);
  frames.push({ kind: "message.patch", threadId: MAIN, message: receipt("completed") } as ServerFrame);
  bot([runTask({ routineRunId: RUN_ID }), mainTask]);
  return frames;
}

const switches: string[] = [];
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
  if (path.startsWith("/api/bots?")) return json({ bots: [{ ...announce([mainTask]), messages: transcript, activeLeafId: "answer" }], groups: [] });
  const switched = new RegExp(`^/api/bots/${BOT}/tasks/([^/?]+)`).exec(path);
  if (switched && init?.method === "POST") {
    switches.push(switched[1]!);
    return json({ bot: { ...announce([runTask({ routineRunId: RUN_ID }), mainTask]), threadId: switched[1], messages: [] } });
  }
  if (path === "/api/instances") return json({ instances: [] });
  if (path === "/api/routines") return json({ routines: [], runs: [] });
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [] });
  return json({});
}

const { StoreProvider, useStore, FOLLOW_SETTLE_MS } = await import("@/state/store");
const { ChatView } = await import("./ChatView");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");

let seen!: AppState;
let shownThreads: string[] = [];
function Shell() {
  const { state, dispatch } = useStore();
  seen = state;
  (Shell as { dispatch?: typeof dispatch }).dispatch = dispatch;
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  if (bot && shownThreads.at(-1) !== bot.threadId) shownThreads.push(bot.threadId);
  return bot ? createElement(ChatView, { bot }) : null;
}

let root: Root;
let container: HTMLDivElement;
const settle = async () => { await act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let cursor = 0;

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("fetch", vi.fn(route));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(StoreProvider, null, createElement(Shell))));
  await settle();
  FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
  await act(async () => { (Shell as { dispatch?: (action: never) => void }).dispatch!({ type: "select", id: BOT } as never); });
  await settle();
});
afterAll(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a routine run seen from the bot's chat", () => {
  it("keeps the chat on the person's conversation, with no remount and no row toggling", async () => {
    expect(seen.bots.find((bot) => bot.id === BOT)?.threadId).toBe(MAIN);
    const column = container.querySelector("[data-chat-column]");
    expect(column).not.toBeNull();
    const added = new Map<string, number>();
    const removed = new Map<string, number>();
    const label = (node: Node) => node instanceof Element
      ? `${node.tagName.toLowerCase()}${[...node.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("")}`
      : "";
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) added.set(label(node), (added.get(label(node)) ?? 0) + 1);
        for (const node of record.removedNodes) if (node instanceof Element) removed.set(label(node), (removed.get(label(node)) ?? 0) + 1);
      }
    });
    observer.observe(container, { subtree: true, childList: true });
    const frames = routineRunFrames(40);
    // one frame at a time, each rendered before the next arrives (as over a network)
    for (const frame of frames) {
      FixtureEventSource.opened[0]!.send(frame, `run:${++cursor}`);
      await settle();
    }
    // past the time a newer topic must hold before the chat follows it
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, FOLLOW_SETTLE_MS + 100)); });
    await settle();
    observer.disconnect();
    const toggledBoth = [...added.keys()].filter((key) => removed.has(key)).map((key) => `${key} +${added.get(key)} -${removed.get(key)}`);
    // the chat never followed the run's thread, here or on the server
    expect(shownThreads).toEqual([MAIN]);
    expect(switches).toEqual([]);
    // the same column, never remounted
    expect(container.querySelector("[data-chat-column]")).toBe(column);
    // the person's rows are drawn once: nothing came and went
    expect(toggledBoth).toEqual([]);
  });

  it("still follows a newer topic that holds, once it has held", async () => {
    const topic: Task = { threadId: "topic-2", title: "From the phone", createdAt: at + 60_000, busy: false, activity: "idle", unread: false, modelSelection: model, approvalMode: "ask" };
    FixtureEventSource.opened[0]!.send({ kind: "bot", bot: announce([topic, runTask({ routineRunId: RUN_ID }), mainTask], { mainThreadId: "topic-2" }) }, `run:${++cursor}`);
    await settle();
    expect(switches).toEqual([]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, FOLLOW_SETTLE_MS + 100)); });
    await settle();
    expect(switches).toEqual(["topic-2"]);
  });
});
