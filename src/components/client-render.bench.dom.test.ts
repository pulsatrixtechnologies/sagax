// @vitest-environment happy-dom
// Client cost per streamed delta (#1954): real store fold + LiveReply path on a
// fixture of 10 bots / 12 threads, active transcript at 40 / 400 / 2000 messages,
// then a 120-word Markdown reply (table + fenced code) as 65 content.delta frames.
//
//   pnpm exec vitest run src/components/client-render.bench.dom.test.ts
//
// Headless only. Writes CLIENT-RENDER-BENCH JSON lines to stdout for RESULT.md.
import { act, createElement, memo, Profiler, useMemo, useReducer, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, Message } from "@/state/store";
import type { ServerFrame } from "../../shared/wire";
import { foldLiveFrame, type FoldLiveFrameCtx } from "@/state/store/fold-live-frame";
import { splitLiveMarkdown } from "@/lib/live-markdown-blocks";

const measured = vi.hoisted(() => ({
  renders: {} as Record<string, number>,
  durations: {} as Record<string, number>,
  splitMs: 0,
  splitCalls: 0,
  record(id: string, actualDuration: number) {
    this.renders[id] = (this.renders[id] ?? 0) + 1;
    this.durations[id] = (this.durations[id] ?? 0) + actualDuration;
  },
  bump(id: string) {
    this.renders[id] = (this.renders[id] ?? 0) + 1;
  },
  reset() {
    this.renders = {};
    this.durations = {};
    this.splitMs = 0;
    this.splitCalls = 0;
  },
}));

vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({
    capabilities: {
      dictation: { available: false },
      host: { packaged: true, platform: "other" },
      localComputer: { available: false },
    },
    ready: true,
  }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), initAnalytics: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

vi.mock("./ChatMarkdown", async (original) => {
  const mod = await original<typeof import("./ChatMarkdown")>();
  const Real = mod.ChatMarkdown;
  const Counted = memo(function CountedChatMarkdown(props: ComponentProps<typeof Real>) {
    return createElement(
      Profiler,
      {
        id: "ChatMarkdown",
        onRender: (_id, _phase, actualDuration) => measured.record("ChatMarkdown", actualDuration),
      },
      createElement(Real, props),
    );
  }, (previous, next) => (
    previous.text === next.text
    && previous.botId === next.botId
    && previous.everyone === next.everyone
    && previous.inert === next.inert
    && previous.emailDrafts === next.emailDrafts
    && previous.youtubeSendToBot === next.youtubeSendToBot
    && previous.message?.threadId === next.message?.threadId
    && previous.message?.messageId === next.message?.messageId
    && mod.samePeers(previous.mentionPeers ?? [], next.mentionPeers ?? [])
  ));
  return { ...mod, ChatMarkdown: Counted };
});

vi.mock("./LiveReply", async (original) => {
  const mod = await original<typeof import("./LiveReply")>();
  const Real = mod.LiveReply;
  return {
    ...mod,
    LiveReply: (props: ComponentProps<typeof Real>) => createElement(
      Profiler,
      {
        id: "LiveReply",
        onRender: (_id, _phase, actualDuration) => measured.record("LiveReply", actualDuration),
      },
      createElement(Real, props),
    ),
  };
});

vi.mock("@/lib/live-markdown-blocks", async (original) => {
  const mod = await original<typeof import("@/lib/live-markdown-blocks")>();
  return {
    ...mod,
    splitLiveMarkdown(text: string) {
      const t0 = performance.now();
      const blocks = mod.splitLiveMarkdown(text);
      measured.splitMs += performance.now() - t0;
      measured.splitCalls += 1;
      return blocks;
    },
  };
});

await import("@/state/store");
await import("./ChatView");
const { BotEditorStore, initialState, createStreamDeltaBuffer, StreamingPreview } = await import("@/state/store");
const { reducer } = await import("@/state/store/reducer");
const { useStoreSelector } = await import("@/state/store-selector");
const { ChatView } = await import("./ChatView");
const { ConfirmProvider } = await import("./ConfirmProvider");
const { ThreadRefsProvider } = await import("./ThreadRefs");
const { setLocale } = await import("@/lib/i18n");
const { setStreamReplies, STREAM_REPLIES_KEY } = await import("@/lib/stream-replies-preference");
const sidebarHelpers = await import("./Sidebar.tsx-parts/helpers");
const composerFocus = await import("./Composer.tsx-parts/useComposerFocus");
setLocale("en");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** ~120-word Markdown reply with a table and a fenced code block (same shape as scripts/bench-turn-latency.ts). */
const REPLY = [
  "Here is a concise plan for the next verification pass on the fixture bot.",
  "",
  "Start with the smoke checks, then the context build, then the engine warm path.",
  "Keep each stage timed so a regression shows up in the harness table.",
  "",
  "| Stage | Owner | Budget |",
  "|---|---|---|",
  "| Smoke | harness | 2 min |",
  "| Context | server | 800 ms |",
  "| Dispatch | engine | 600 ms |",
  "",
  "```ts",
  "export function mark(stage: string, ms: number) {",
  "  return { stage, ms };",
  "}",
  "```",
  "",
  "When the reply settles, confirm the thread is idle before the next send.",
  "Do not print secrets, credentials, or live customer names in any log line.",
  "This paragraph pads the answer toward one hundred and twenty words so the",
  "token cadence matches a realistic short assistant reply under the fake CLI.",
].join("\n");

const DELTA_COUNT = 65;
const ITERATIONS = Number(process.env.CLIENT_RENDER_BENCH_ITERS ?? 20);
const MESSAGE_COUNTS = [40, 400, 2000] as const;
const ACTIVE = "thread-0";
const BOT0 = "bot-0";
const at = Date.UTC(2026, 11, 4, 12);

function chunkReply(text: string, parts: number): string[] {
  const tokens = text.split(/(\s+)/).filter((part) => part.length > 0);
  const chunks: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const remaining = tokens.length - i;
    const left = parts - chunks.length;
    const take = Math.max(1, Math.ceil(remaining / left));
    chunks.push(tokens.slice(i, i + take).join(""));
    i += take;
  }
  return chunks;
}

const DELTAS = chunkReply(REPLY, DELTA_COUNT);

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, j) => ({
    id: `m-0-${j}`,
    parentId: j ? `m-0-${j - 1}` : undefined,
    at: at + j,
    role: (j % 2 ? "bot" : "user") as Message["role"],
    kind: "text" as const,
    text: j % 2 ? `Bot reply ${j} with a short paragraph for the fixture.` : `User message ${j}.`,
  }));
}

function makeBots(messageCount: number): Bot[] {
  return Array.from({ length: 10 }, (_, i) => {
    const tasks = Array.from({ length: i === 0 ? 12 : 1 }, (_, t) => ({
      threadId: i === 0 ? `thread-${t}` : `thread-${i}`,
      title: i === 0 ? `Topic ${t}` : `Conversation`,
      createdAt: at - 60_000 + t,
      busy: false,
      activity: "idle" as const,
      unread: false,
    }));
    return {
      id: `bot-${i}`,
      name: i === 0 ? "Osprey" : `Wren ${i}`,
      threadId: i === 0 ? ACTIVE : `thread-${i}`,
      title: "",
      description: "",
      color: "blue",
      notifications: true,
      unread: false,
      busy: i === 0,
      activity: i === 0 ? "working" : "idle",
      modelSelection: { instanceId: "fixture", model: "test" },
      tasks,
      messages: i === 0 ? makeMessages(messageCount) : makeMessages(4),
      activeLeafId: i === 0 ? `m-0-${messageCount - 1}` : `m-${i}-3`,
      hasMore: false,
    } as Bot;
  });
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? 0,
  };
}

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const services = {
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
};

type StreamState = { streaming: Record<string, string>; reasoning: Record<string, string> };

let send: (action: Action) => void;
let seen: AppState;
let deltaBuffer: ReturnType<typeof createStreamDeltaBuffer>;
let clearStreamFn: (threadId: string) => void;

type BenchStreamApi = {
  clearStream: (threadId: string) => void;
  flushDeltas: () => void;
  deltaBuffer: ReturnType<typeof createStreamDeltaBuffer>;
};

/** Mirrors store.tsx StreamRoot: delta setState stays off the store host. */
function BenchStreamRoot({
  apiRef,
  children,
}: {
  apiRef: { current: BenchStreamApi | null };
  children: ReactNode;
}) {
  const [stream, setStream] = useState<StreamState>({ streaming: {}, reasoning: {} });
  const buffer = useMemo(() => createStreamDeltaBuffer((entries) => {
    setStream((prev) => {
      const streaming = { ...prev.streaming };
      const reasoning = { ...prev.reasoning };
      for (const [threadId, d] of entries) {
        if (d.text) streaming[threadId] = (streaming[threadId] ?? "") + d.text;
        if (d.reasoning) reasoning[threadId] = (reasoning[threadId] ?? "") + d.reasoning;
      }
      return { streaming, reasoning };
    });
  }), []);
  const clearStream = (threadId: string) => {
    buffer.clear(threadId);
    setStream((prev) => {
      if (!(threadId in prev.streaming) && !(threadId in prev.reasoning)) return prev;
      const { [threadId]: _s, ...streaming } = prev.streaming;
      const { [threadId]: _r, ...reasoning } = prev.reasoning;
      return { streaming, reasoning };
    });
  };
  apiRef.current = { clearStream, flushDeltas: buffer.flush, deltaBuffer: buffer };
  deltaBuffer = buffer;
  clearStreamFn = clearStream;
  return createElement(StreamingPreview, { streaming: stream.streaming, children });
}

function Host({ children, start }: { children: ReactNode; start: AppState }) {
  const [state, dispatch] = useReducer(reducer, start);
  send = dispatch;
  seen = state;
  const streamApiRef = useRef<BenchStreamApi | null>(null);
  // Same identity rule as StoreProvider: stream frames must not rebuild the store value.
  const value = useMemo(
    () => ({ state, dispatch, ...services }),
    [state, dispatch],
  );
  return createElement(BotEditorStore, {
    value,
    children: createElement(BenchStreamRoot, { apiRef: streamApiRef, children }),
  });
}

function Surface() {
  // Subscribe like BotSurface: a settled message must rebuild ChatView's bot prop.
  const bot = useStoreSelector((state) => state.bots.find((candidate) => candidate.id === state.selectedId) ?? null);
  // Function-body count: Profiler on ChatView also fires for LiveReply subtree
  // commits, so this is the ChatView / BotSurface execution signal.
  measured.bump("ChatView");
  return bot ? createElement(ChatView, { bot }) : null;
}

function foldCtx(): FoldLiveFrameCtx {
  return {
    rawDispatch: (action) => send(action),
    dispatch: (action) => send(action),
    stateRef: { current: seen },
    clearStream: (threadId) => clearStreamFn(threadId),
    flushDeltas: () => deltaBuffer.flush(),
    deltaBuffer,
    withTaskWrites: (bot) => bot,
    botPatchQueue: { overlayFor: () => ({}), cancel: () => {} },
    showThreadsRef: { current: false },
    refreshInstancesPeripheral: () => {},
  };
}

function deltaFrame(index: number, text: string): ServerFrame {
  return {
    kind: "runtime",
    event: {
      type: "content.delta",
      eventId: `d${index}`,
      provider: "claudeAgent",
      threadId: ACTIVE,
      createdAt: new Date(at + 10_000 + index).toISOString(),
      streamKind: "assistant_text",
      delta: text,
    },
  } as ServerFrame;
}

function settledFrame(text: string): ServerFrame {
  const parent = `m-0-${seen.bots[0]!.messages.length - 1}`;
  return {
    kind: "message",
    threadId: ACTIVE,
    message: {
      id: `live-settled`,
      parentId: parent,
      at: at + 20_000,
      role: "bot",
      kind: "text",
      text,
    },
  } as ServerFrame;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  localStorage.removeItem(STREAM_REPLIES_KEY);
  setStreamReplies(true);
  measured.reset();
  const fade = sidebarHelpers.useScrollFade;
  vi.spyOn(sidebarHelpers, "useScrollFade").mockImplementation(() => {
    measured.renders.Sidebar = (measured.renders.Sidebar ?? 0) + 1;
    return fade();
  });
  const focus = composerFocus.useComposerFocus;
  vi.spyOn(composerFocus, "useComposerFocus").mockImplementation((...args) => {
    measured.renders.Composer = (measured.renders.Composer ?? 0) + 1;
    return focus(...args);
  });
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/activity")) return new Response(JSON.stringify({ items: [], subagents: [], launchedAgents: [] }));
    return new Response("{}", { status: 404 });
  }));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

type FrameSample = {
  foldMs: number;
  commitMs: number;
  splitMs: number;
  domMutations: number;
  renders: Record<string, number>;
};

async function runOnce(messageCount: number): Promise<{
  perFrame: FrameSample[];
  totals: {
    foldMs: number;
    commitMs: number;
    splitMs: number;
    domMutations: number;
    settleMs: number;
    renders: Record<string, number>;
  };
  finalText: string;
  liveNodes: number;
  settledInStore: boolean;
}> {
  const start: AppState = {
    ...initialState,
    bots: makeBots(messageCount),
    selectedId: BOT0,
    connected: true,
    everConnected: true,
    hydrated: true,
  };
  measured.reset();
  await act(async () => {
    root.render(createElement(Host, {
      start,
      children: createElement(ConfirmProvider, null, createElement(ThreadRefsProvider, null, createElement(Surface))),
    }));
  });
  await settle();
  expect(container.querySelector("[data-chat-column]")).not.toBeNull();

  const perFrame: FrameSample[] = [];
  let accumulated = "";
  const ctx = foldCtx();

  for (let i = 0; i < DELTAS.length; i++) {
    const delta = DELTAS[i]!;
    measured.reset();
    let domMutations = 0;
    const observer = new MutationObserver((records) => { domMutations += records.length; });
    observer.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    let foldMs = 0;
    let commitMs = 0;
    await act(async () => {
      const foldStart = performance.now();
      foldLiveFrame(deltaFrame(i, delta), ctx);
      foldMs = performance.now() - foldStart;
      const commitStart = performance.now();
      deltaBuffer.flush();
      commitMs = performance.now() - commitStart;
      accumulated += delta;
    });
    observer.disconnect();
    perFrame.push({
      foldMs,
      commitMs,
      splitMs: measured.splitMs,
      domMutations,
      renders: { ...measured.renders },
    });
  }

  measured.reset();
  const settleStart = performance.now();
  await act(async () => {
    foldLiveFrame(settledFrame(accumulated), foldCtx());
  });
  await settle();
  const settleMs = performance.now() - settleStart;

  const totals = {
    foldMs: perFrame.reduce((sum, frame) => sum + frame.foldMs, 0),
    commitMs: perFrame.reduce((sum, frame) => sum + frame.commitMs, 0),
    splitMs: perFrame.reduce((sum, frame) => sum + frame.splitMs, 0),
    domMutations: perFrame.reduce((sum, frame) => sum + frame.domMutations, 0),
    settleMs,
    renders: Object.fromEntries(
      [...new Set(perFrame.flatMap((frame) => Object.keys(frame.renders)))].map((name) => [
        name,
        perFrame.reduce((sum, frame) => sum + (frame.renders[name] ?? 0), 0),
      ]),
    ),
  };

  return {
    perFrame,
    totals,
    finalText: accumulated,
    liveNodes: container.querySelector("[data-live-reply]")?.querySelectorAll("*").length ?? 0,
    settledInStore: Boolean(seen.bots[0]?.messages.some((message) => message.id === "live-settled")),
  };
}

describe("client-render bench (#1954)", () => {
  it("measures fold + render cost per delta at 40 / 400 / 2000 messages", async () => {
    expect(DELTAS.length).toBe(DELTA_COUNT);
    expect(DELTAS.join("")).toBe(REPLY);
    expect(splitLiveMarkdown(REPLY).length).toBeGreaterThan(1);

    const report: Record<string, unknown> = {
      fixture: {
        bots: 10,
        threadsOnActive: 12,
        deltas: DELTA_COUNT,
        replyChars: REPLY.length,
        replyWords: REPLY.split(/\s+/).filter(Boolean).length,
        iterations: ITERATIONS,
        cadenceNote: "frames flushed synchronously (25 ms server cadence is wall-clock only)",
      },
      sizes: {} as Record<string, unknown>,
    };

    for (const messageCount of MESSAGE_COUNTS) {
      const foldPerFrame: number[] = [];
      const commitPerFrame: number[] = [];
      const splitPerFrame: number[] = [];
      const totalFold: number[] = [];
      const totalCommit: number[] = [];
      const totalSplit: number[] = [];
      const settleMs: number[] = [];
      const rendersPerFrame: Record<string, number[]> = {
        LiveReply: [],
        ChatMarkdown: [],
        ChatView: [],
        Sidebar: [],
        Composer: [],
      };
      const totalRenders: Record<string, number[]> = {
        LiveReply: [],
        ChatMarkdown: [],
        ChatView: [],
        Sidebar: [],
        Composer: [],
      };
      const domPerFrame: number[] = [];

      for (let iter = 0; iter < ITERATIONS; iter++) {
        const result = await runOnce(messageCount);
        expect(result.finalText).toBe(REPLY);
        expect(result.settledInStore).toBe(true);
        // Stream cleared after settle; live bubble gone, settled text present
        expect(container.querySelector("[data-live-reply]")).toBeNull();
        expect(container.textContent).toContain("verification pass");

        for (const frame of result.perFrame) {
          foldPerFrame.push(frame.foldMs);
          commitPerFrame.push(frame.commitMs);
          splitPerFrame.push(frame.splitMs);
          domPerFrame.push(frame.domMutations);
          for (const name of Object.keys(rendersPerFrame)) {
            rendersPerFrame[name]!.push(frame.renders[name] ?? 0);
          }
        }
        totalFold.push(result.totals.foldMs);
        totalCommit.push(result.totals.commitMs);
        totalSplit.push(result.totals.splitMs);
        settleMs.push(result.totals.settleMs);
        for (const name of Object.keys(totalRenders)) {
          totalRenders[name]!.push(result.totals.renders[name] ?? 0);
        }
      }

      const sizeReport = {
        messages: messageCount,
        perFrame: {
          foldMs: summarize(foldPerFrame),
          commitMs: summarize(commitPerFrame),
          splitMs: summarize(splitPerFrame),
          domMutations: summarize(domPerFrame),
          renders: Object.fromEntries(
            Object.entries(rendersPerFrame).map(([name, samples]) => [name, summarize(samples)]),
          ),
        },
        totalOver65: {
          foldMs: summarize(totalFold),
          commitMs: summarize(totalCommit),
          splitMs: summarize(totalSplit),
          settleMs: summarize(settleMs),
          renders: Object.fromEntries(
            Object.entries(totalRenders).map(([name, samples]) => [name, summarize(samples)]),
          ),
        },
        reducerPlusRenderP50:
          summarize(foldPerFrame).p50 + summarize(commitPerFrame).p50,
      };
      (report.sizes as Record<string, unknown>)[String(messageCount)] = sizeReport;
    }

    process.stdout.write(`CLIENT-RENDER-BENCH ${JSON.stringify(report)}\n`);

    // Soft contract: the bench ran and produced numbers for every size.
    for (const messageCount of MESSAGE_COUNTS) {
      const size = (report.sizes as Record<string, { reducerPlusRenderP50: number }>)[String(messageCount)]!;
      expect(size.reducerPlusRenderP50).toBeGreaterThanOrEqual(0);
    }
  }, 600_000);
});
