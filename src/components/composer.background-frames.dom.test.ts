// @vitest-environment happy-dom
// #3624: a bot working in a conversation that is not on screen renders
// nothing of the open conversation's message box: its thread picker, its
// pinned waiting card, its model picker and the limit dot on it, its call
// button, and the link back to an earlier conversation. Each component sits
// in its own Profiler under one element drawn again for every store change,
// so only a store subscription can render it. Counted in renders per frame,
// never in milliseconds (the headless measure, scripts/capture/idle-cost.mjs,
// saw them all render on each of the background bots' frames).
import { act, createElement, Profiler, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Action, AppState, Bot, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BotEditorStore, initialState } = await import("@/state/store");
const { TaskPicker, ThreadReturnLink } = await import("./TaskPicker");
const { PinnedWaitingCard } = await import("./Composer.tsx-parts/PinnedWaitingCard");
const { ModelPicker } = await import("./ModelPicker");
const { EngineLimitIndicator } = await import("./LimitResetContinue");
const { CallButton } = await import("./CallView");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");

const bot = (id: string, name: string): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", color: "green", notifications: true, unread: false, section: "Ops",
  modelSelection: { instanceId: "test", model: "m" },
  messages: [{ id: `m-${id}`, role: "bot", kind: "text", text: "Synthetic reply.", at: 1 }],
  tasks: [{ threadId: `t-${id}`, title: "General", createdAt: 1 }],
} as Bot);

const OPEN = bot("atlas", "Atlas");
let state: AppState;
let root: Root;
let host: HTMLDivElement;
const renders: Record<string, number> = {};

const counted = (id: string, child: ReactNode) =>
  createElement(Profiler, { id, onRender: () => { renders[id] = (renders[id] ?? 0) + 1; } }, child);
const pinned = { items: [], index: 0, current: undefined, go: () => {}, collapsed: false, setCollapsed: () => {} };
// one element, drawn again under each new state
const box = createElement(
  "div",
  null,
  counted("threads", createElement(TaskPicker, { bot: OPEN })),
  counted("return", createElement(ThreadReturnLink, { ownerId: OPEN.id, threadId: OPEN.threadId })),
  counted("pinned", createElement(PinnedWaitingCard, { pinned: pinned as never, threadId: OPEN.threadId, bot: OPEN, botFor: () => OPEN, nameFor: () => OPEN.name, onCancelTurn: () => {} })),
  counted("model", createElement(ModelPicker, { inComposer: true, bot: OPEN, threadId: OPEN.threadId })),
  counted("limit", createElement(EngineLimitIndicator, { engine: "test", botId: OPEN.id, threadId: OPEN.threadId })),
  counted("call", createElement(CallButton, { bot: OPEN })),
);

const dispatch = (_action: Action) => {};
const commands = { flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

async function draw() {
  // the store's commands are stable, as StoreProvider's are
  const value = { state, dispatch, ...commands };
  await act(async () => { root.render(createElement(BotEditorStore, { value: value as never, children: box })); });
}

/** One frame of a bot working elsewhere: its transcript grows, it is busy. */
function frameElsewhere(n: number) {
  state = {
    ...state,
    bots: state.bots.map((entry) => entry.id !== "iris" ? entry : {
      ...entry, busy: true,
      messages: [...entry.messages, { id: `tool-${n}`, role: "bot", kind: "activity", text: "", at: 2 + n } as Message],
    }),
  };
}

beforeEach(() => {
  // the box's reads never answer: only the store moves
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  for (const key of Object.keys(renders)) delete renders[key];
  state = { ...initialState, hydrated: true, selectedId: OPEN.id, bots: [OPEN, bot("iris", "Iris"), bot("milo", "Milo")], groups: [] } as AppState;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the open conversation's message box while other bots work (#3624)", () => {
  it("renders none of its parts for another bot's frames", async () => {
    await draw();
    const first = { ...renders };
    expect(Object.keys(first).sort()).toEqual(["call", "limit", "model", "pinned", "return", "threads"]);
    for (let n = 0; n < 30; n++) {
      frameElsewhere(n);
      await draw();
    }
    expect(renders).toEqual(first);
  });

  it("still renders the link back when the conversation it points to changes", async () => {
    await draw();
    const before = renders.return ?? 0;
    state = { ...state, threadReturn: { ownerId: "milo", threadId: "t-milo" } } as AppState;
    await draw();
    expect((renders.return ?? 0) - before).toBeGreaterThan(0);
    expect(host.querySelector("[data-thread-return]")).not.toBeNull();
  });

  it("still renders the model picker when the open bot's own entry changes", async () => {
    await draw();
    const before = renders.model ?? 0;
    state = { ...state, bots: state.bots.map((entry) => entry.id === OPEN.id ? { ...entry, busy: true } : entry) };
    await draw();
    expect((renders.model ?? 0) - before).toBeGreaterThan(0);
  });
});
