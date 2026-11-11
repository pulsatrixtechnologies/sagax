// @vitest-environment happy-dom
// #3624: a bot working in a conversation that is not on screen renders
// nothing of the open bot's panel that shows none of it: its mascot card,
// its routines, its suggestions, its task list, its actions menu, the closed share and leave
// dialogs, and the author label every bubble of the open conversation
// holds. Each component sits in its own Profiler under one element drawn
// again for every store change, so only a store subscription can render it.
// Counted in renders per frame, never in milliseconds.
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
const { RoutinesSection } = await import("./bot-settings/RoutinesSection");
const { SuggestionsSection } = await import("./bot-settings/SuggestionsSection");
const { BotTaskSection } = await import("./bot-settings/BotTaskSection");
const { BotActionsMenu } = await import("./bot-settings/BotActionsMenu");
const { LeaveGroupDialog } = await import("./LeaveGroupDialog");
const { ShareTeamDialog } = await import("./ShareTeamDialog");
const { useRemoteSessions } = await import("./remote-session/use-remote-sessions");
const { OtherAuthorLabel } = await import("./MessageAuthor");
const { BotProfileAvatarCard } = await import("./BotProfileAvatarCard");
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
const anchorRef = { current: null };
// one element, drawn again under each new state
const panel = createElement(
  "div",
  null,
  counted("routines", createElement(RoutinesSection, { bot: OPEN, routines: [], runs: [], grouped: true, upcoming: true, followFocus: false })),
  counted("suggestions", createElement(SuggestionsSection, { bot: OPEN, routineCount: 0 })),
  counted("tasks", createElement(BotTaskSection, { botId: OPEN.id })),
  counted("avatar", createElement(BotProfileAvatarCard, { bot: OPEN, activeState: "idle", mascotMotion: null, onPatch: () => {}, size: 92 })),
  counted("actions", createElement(BotActionsMenu, { bot: OPEN, anchor: null, onAnchor: () => {}, onRename: () => {}, trigger: false })),
  counted("leave", createElement(LeaveGroupDialog, { groupId: null, onClose: () => {} })),
  counted("share", createElement(ShareTeamDialog, { open: false, team: "Ops", onClose: () => {}, anchorRef })),
  // every bubble of the open conversation holds one
  counted("author", createElement(OtherAuthorLabel, { message: { role: "user", sender: { id: "p1", name: "Sam" } } as Message })),
);

const dispatch = (_action: Action) => {};
const commands = { flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

async function draw() {
  // the store's commands are stable, as StoreProvider's are
  const value = { state, dispatch, ...commands };
  await act(async () => { root.render(createElement(BotEditorStore, { value: value as never, children: panel })); });
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
  // the panel's reads never answer: only the store moves
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
  vi.useRealTimers();
});

describe("the open bot's panel while other bots work (#3624)", () => {
  it("renders none of its parts that show nothing of another bot's frames", async () => {
    await draw();
    const first = { ...renders };
    expect(Object.keys(first).sort()).toEqual(["actions", "author", "avatar", "leave", "routines", "share", "suggestions", "tasks"]);
    for (let n = 0; n < 30; n++) {
      frameElsewhere(n);
      await draw();
    }
    expect(renders).toEqual(first);
  });

  it("still renders the routines list for what it draws (its load failing)", async () => {
    await draw();
    const before = renders.routines ?? 0;
    state = { ...state, routinesLoadState: "error" };
    await draw();
    expect((renders.routines ?? 0) - before).toBeGreaterThan(0);
  });

  it("renders nothing when a remote sessions poll brings the same list", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    let count = 0;
    function Sessions() {
      count += 1;
      useRemoteSessions("atlas");
      return null;
    }
    await act(async () => { root.render(createElement(Sessions)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const settled = count;
    // ten seconds of the four second poll
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(count).toBe(settled);
  });
});
