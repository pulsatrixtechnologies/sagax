// @vitest-environment happy-dom
// the owner, 0.8.35: "when a task's status changes from Running to something else
// very fast, the page goes haywire, the app flashes". The real store, its
// live fold and the real ChatView get a routine run whose card flips status
// in rapid frames (queued, running, completed, running again on a retry...),
// as syncRoutineRunToSource sends them: the run's record, its card patched in
// place in the person's conversation, the conversation turned unread.
// The card must update in place: never remounted, never gone and back, its
// bubble never swapping between the short line and the whole report on each
// flip, and nothing else in the transcript or the app shell changing.
import { act, createElement, Profiler } from "react";
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
const at = Date.UTC(2026, 10, 3, 16, 48);
const model = { instanceId: "fake", model: "m" };
const mainTask = (patch: Partial<Task> = {}): Task => ({ threadId: MAIN, title: "Clive", createdAt: at - 60_000, busy: false, activity: "idle", unread: false, modelSelection: model, approvalMode: "ask", ...patch });
const runTask = (patch: Partial<Task> = {}): Task => ({ threadId: RUN, title: "Project completion recalc", createdAt: at, busy: false, activity: "idle", unread: false, modelSelection: model, approvalMode: "ask", routineRunId: RUN_ID, ...patch });
const transcript: Message[] = [
  { id: "ask", at: at - 50_000, role: "user", kind: "text", text: "Hello" },
  { id: "answer", parentId: "ask", at: at - 49_000, role: "bot", kind: "text", text: "Hi, how can I help?" },
];
/** A report as long as the owner's (18 projects): longer than the card's short line. */
const REPORT = [
  "The 18 open projects are there (385 tickets). The completion recalc moved 4 of them:",
  "",
  ...Array.from({ length: 18 }, (_, index) => `- Project ${index + 1}: ${40 + index}% complete, ${10 + index} tickets open, ${index % 3} blocked`),
].join("\n");
type Status = "queued" | "running" | "waiting" | "completed";
const card = (status: Status) => ({
  runId: RUN_ID, routineId: "routine-1", routineName: "Project completion recalc", scheduledFor: at, status,
  executionThreadId: RUN, summary: REPORT,
});
const receipt = (status: Status): Message => ({
  id: "receipt", parentId: "answer", at, role: "bot", kind: "routine.run", text: "Routine: Project completion recalc",
  routineRun: card(status) as never,
});
const runRecord = (status: Status) => ({
  id: RUN_ID, routineId: "routine-1", routineName: "Project completion recalc", prompt: "Recalc", timeoutMinutes: 30, target: "bot", botId: BOT, runOn: "maus",
  scheduledFor: at, createdAt: at, status, manual: true, threadId: RUN, executionThreadId: RUN, resultsThreadId: MAIN, output: REPORT,
});
const announce = (tasks: Task[]): BotAnnouncement => ({
  id: BOT, threadId: MAIN, mainThreadId: MAIN, name: "Clive", title: "", description: "", notifications: true, unread: false,
  color: "green", modelSelection: model, busy: false, activity: "idle", tasks,
} as BotAnnouncement);

/** What one status change sends (server/index.ts syncRoutineRunToSource and
 * the routine runner): the run's record, the card patched in place, the run's
 * task busy or not, and the conversation turned unread (something for the
 * person, once per state). */
function statusFrames(status: Status): ServerFrame[] {
  const working = status === "running";
  return [
    { kind: "routine.run", run: runRecord(status) } as ServerFrame,
    { kind: "message.patch", threadId: MAIN, message: receipt(status) } as ServerFrame,
    { kind: "bot", bot: announce([runTask({ busy: working, activity: working ? "working" : "idle" }), mainTask({ unread: true })]) } as ServerFrame,
  ];
}

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
function route(input: RequestInfo | URL): Promise<Response> {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
  if (path.startsWith("/api/bots?")) return json({ bots: [{ ...announce([runTask(), mainTask()]), messages: [...transcript, receipt("completed")], activeLeafId: "receipt" }], groups: [] });
  if (path === "/api/instances") return json({ instances: [] });
  if (path.split("?")[0] === "/api/routines") return json({ routines: [], runs: [runRecord("completed")] });
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [] });
  return json({});
}

const { StoreProvider, useStore } = await import("@/state/store");
const { ChatView } = await import("./ChatView");
const { ROUTINE_STATUS_SETTLE_MS } = await import("./RoutineRunCard");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");

let seen!: AppState;
const commits = { shell: 0, chat: 0 };
function Shell() {
  const { state, dispatch } = useStore();
  seen = state;
  (Shell as { dispatch?: typeof dispatch }).dispatch = dispatch;
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  return bot ? createElement(Profiler, { id: "chat", onRender: () => { commits.chat++; } }, createElement(ChatView, { bot })) : null;
}

let root: Root;
let container: HTMLDivElement;
const tick = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const settle = async () => { await act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let cursor = 0;
const send = (frame: ServerFrame) => FixtureEventSource.opened[0]!.send(frame, `run:${++cursor}`);

beforeAll(async () => {
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("fetch", vi.fn(route));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(Profiler, { id: "shell", onRender: () => { commits.shell++; } }, createElement(StoreProvider, null, createElement(Shell)))));
  await settle();
  FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "run:0" });
  await settle();
  await act(async () => { (Shell as { dispatch?: (action: never) => void }).dispatch!({ type: "select", id: BOT } as never); });
  await settle();
  // the run starts: its card, Running, before the burst
  for (const frame of statusFrames("running")) send(frame);
  await settle();
  await tick(400);
});
afterAll(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cardOf = () => container.querySelector<HTMLElement>("section[data-routine-run-card]") ?? container.querySelector<HTMLElement>("section[aria-label*='routine run']");
// #3581: the run's one form: the live row while it runs, the result card once it has settled
const bubbleOf = () => cardOf()?.firstElementChild as HTMLElement | null;
const formOf = () => cardOf()?.getAttribute("data-routine-run-form") ?? "";
const statusText = () => cardOf()?.querySelector("[data-routine-run-status]")?.textContent ?? "";

describe("a routine run's card flipping status fast", () => {
  it("updates in place: no remount, no toggling, no jump, the shell untouched", async () => {
    const column = container.querySelector("[data-chat-column]");
    const firstCard = cardOf();
    expect(column).not.toBeNull();
    expect(firstCard).not.toBeNull();
    expect(statusText()).toContain("Running");
    const firstBubble = bubbleOf();
    const added = new Map<string, number>();
    const removed = new Map<string, number>();
    let outside = 0;
    const outsideKinds = new Map<string, number>();
    let insideCard = 0;
    const label = (node: Node) => node instanceof Element
      ? `${node.tagName.toLowerCase()}${[...node.attributes].filter((a) => a.name.startsWith("data-") || a.name === "aria-label").map((a) => `[${a.name}]`).join("")}`
      : "";
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target && firstCard && (firstCard === target || firstCard.contains(target))) insideCard++;
        // not a change: React writing an input's same attributes again on a
        // commit, and the mascot's idle motion (time-driven, every frame)
        else if (record.type === "attributes" && (record.oldValue === target?.getAttribute(record.attributeName!) || target?.closest("[data-part]"))) continue;
        else {
          outside++;
          const key = `${record.type}:${label(target as Node)}${record.attributeName ? `@${record.attributeName}` : ""}`;
          outsideKinds.set(key, (outsideKinds.get(key) ?? 0) + 1);
        }
        for (const node of record.addedNodes) if (node instanceof Element) added.set(label(node), (added.get(label(node)) ?? 0) + 1);
        for (const node of record.removedNodes) if (node instanceof Element) removed.set(label(node), (removed.get(label(node)) ?? 0) + 1);
      }
    });
    observer.observe(container, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
    const scrolls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length;
    const focused = document.activeElement;
    const before = { ...commits };
    // the burst's own clock: each gap is exactly what it says, however long
    // a render takes here
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0); });
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    const burst: Status[] = ["queued", "running", "completed", "running", "completed", "queued", "running", "waiting", "running", "completed"];
    let cardSwaps = 0;
    let bubbleSwaps = 0;
    let cardGone = 0;
    const bubbleSizes = new Set<number>();
    const statusesShown: string[] = [statusText()];
    const formsShown: string[] = [formOf()];
    let lastCard = firstCard;
    let lastBubble = firstBubble;
    const sample = () => {
      const now = cardOf();
      if (!now) { cardGone++; return; }
      if (now !== lastCard) { cardSwaps++; lastCard = now; }
      const bubble = bubbleOf();
      if (bubble !== lastBubble) { bubbleSwaps++; lastBubble = bubble; }
      bubbleSizes.add(bubble?.textContent?.length ?? 0);
      const text = statusText();
      if (statusesShown.at(-1) !== text) statusesShown.push(text);
      if (formsShown.at(-1) !== formOf()) formsShown.push(formOf());
    };
    // ten changes, 20 to 100 ms apart, each frame rendered as it arrives
    for (const [index, status] of burst.entries()) {
      for (const frame of statusFrames(status)) { send(frame); await settle(); sample(); }
      await tick([20, 60, 100, 40, 30][index % 5]!);
      sample();
    }
    // the burst over, its last status holds
    await tick(ROUTINE_STATUS_SETTLE_MS + 300);
    sample();
    vi.useRealTimers();
    observer.disconnect();
    const toggled = [...added.keys()].filter((key) => removed.has(key)).map((key) => `${key} +${added.get(key)} -${removed.get(key)}`);
    const report = {
      cardRemounts: cardSwaps, cardGone, bubbleRemounts: bubbleSwaps, bubbleSizes: [...bubbleSizes],
      statusesShown, formsShown, toggled, outsideMutations: outside, outsideKinds: Object.fromEntries(outsideKinds), cardMutations: insideCard,
      shellCommits: commits.shell - before.shell, chatCommits: commits.chat - before.chat,
      scrolls: vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length - scrolls,
      columnSame: container.querySelector("[data-chat-column]") === column,
      focusSame: document.activeElement === focused,
    };
    if (process.env.STATUS_FLASH_REPORT) process.stdout.write(`STATUS-FLASH ${JSON.stringify(report)}\n`);
    // the run's section: the same node, never gone
    expect(report.cardRemounts).toBe(0);
    expect(report.cardGone).toBe(0);
    // #3581: the burst draws once: the live row (Running) holds through every
    // flip, then the settled result becomes its card at the end. #4234: the
    // row and the card are one line (the reference's), so even that change
    // keeps its node: only its text and classes change
    expect(report.formsShown).toEqual(["row", "card"]);
    expect(report.bubbleRemounts).toBe(0);
    expect(report.bubbleSizes.length).toBeLessThanOrEqual(2);
    // nothing came and went
    expect(report.toggled).toEqual([]);
    // a finished result without problems has no state word (#2283)
    expect(report.statusesShown).toEqual(["Running", ""]);
    // nothing outside the card changed, the column is the same, no jump
    expect(report.outsideMutations).toBe(0);
    expect(report.columnSame).toBe(true);
    expect(report.focusSame).toBe(true);
    expect(report.scrolls).toBe(0);
    // the final state, read once the burst is over
    expect(seen.bots.find((bot) => bot.id === BOT)?.threadId).toBe(MAIN);
    expect(seen.bots.find((bot) => bot.id === BOT)?.messages.find((m) => m.id === "receipt")?.routineRun?.status).toBe("completed");
    expect(cardOf()?.getAttribute("aria-label")).toBe("Project completion recalc routine run: Done");
    expect(cardOf()?.querySelector(".animate-spin")).toBeNull();
    // the card's lines: the report's own first sentence (its closing line ends
    // with a colon); the whole report opens behind Details
    expect(cardOf()?.querySelector("[data-routine-run-brief]")?.textContent).toBe("The 18 open projects are there (385 tickets).");
    expect(cardOf()?.textContent).not.toContain("Project 18");
  });

  it("still shows a single status change once it has held", async () => {
    // The card starts completed from the burst above; running holds the
    // previous card until ROUTINE_STATUS_SETTLE_MS, then flips to the live row once.
    for (const frame of statusFrames("running")) send(frame);
    await settle();
    expect(statusText()).toBe("");
    await tick(ROUTINE_STATUS_SETTLE_MS + 100);
    expect(statusText()).toBe("Running");
    expect(cardOf()?.querySelector(".animate-shimmer")).not.toBeNull();
  });
});
