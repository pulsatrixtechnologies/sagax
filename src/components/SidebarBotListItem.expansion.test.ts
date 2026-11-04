import { type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

// Preserve only the owner's hook state across prop updates. Descendants still
// render with React's real hooks; no DOM or live workspace is needed here.
const fixture = vi.hoisted(() => ({
  capturing: false, cursor: 0, slots: [] as unknown[], effects: [] as EffectCallback[],
  state: { activeView: "chat", selectedId: "atlas", deletingBots: {}, pendingQueued: {}, instances: [], revealThread: null as null | { threadId: string; nonce: number } },
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!fixture.capturing) return actual.useState(initial);
      const index = fixture.cursor++;
      if (!(index in fixture.slots)) fixture.slots[index] = typeof initial === "function" ? initial() : initial;
      return [fixture.slots[index], (next: unknown) => {
        fixture.slots[index] = typeof next === "function" ? next(fixture.slots[index]) : next;
      }];
    },
    useEffect: (effect: EffectCallback, dependencies?: unknown[]) => {
      if (fixture.capturing) fixture.effects.push(effect);
      else actual.useEffect(effect, dependencies);
    },
    useMemo: <T,>(factory: () => T, dependencies: unknown[]) => fixture.capturing ? factory() : actual.useMemo(factory, dependencies),
  };
});
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", async (original) => ({ ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
  useThreadsLocationChoice: () => "header" as const,
  useThreadsMode: () => "header" as "one" | "header" | "sidebar",
}));
vi.mock("@/lib/live-call-media", async (original) => {
  const actual = await original<typeof import("@/lib/live-call-media")>();
  return { ...actual, useLiveMedia: actual.liveMedia };
});
// This harness invokes the owner's hooks without React's dispatcher.
vi.mock("@/state/store-selector", async (original) => ({
  ...await original<typeof import("@/state/store-selector")>(),
  useStoreSelector: (select: (state: import("@/state/store").AppState) => unknown) => select(fixture.state as unknown as import("@/state/store").AppState),
  useStoreDispatch: () => vi.fn(),
}));
import { BotListItem } from "./Sidebar";

const bot: Bot = {
  id: "atlas", threadId: "current", name: "Atlas", title: "", description: "",
  notifications: true, color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" },
  messages: [{ id: "reply", role: "bot", kind: "text", text: "The latest reply", at: 1 }],
  tasks: [{ threadId: "current", title: "Current", createdAt: 1 }],
};
function render(candidate = bot) {
  fixture.cursor = 0; fixture.effects = []; fixture.capturing = true;
  let row;
  try { row = BotListItem({ bot: candidate, density: "comfortable", onMenu: vi.fn() }); }
  finally { fixture.capturing = false; }
  return renderToStaticMarkup(row);
}
const ownerTag = (markup: string) => markup.match(/<div[^>]*data-sidebar-bot-row="atlas"[^>]*>/)?.[0];
function expectSoleRow(markup: string) {
  expect(ownerTag(markup)).toContain('aria-current="page"');
  expect(markup).not.toContain('data-sidebar-thread-row=');
  expect(markup).not.toContain("Atlas threads");
}
beforeEach(() => { fixture.slots = []; fixture.state.revealThread = null; });

// Threads on: nothing unfolds under a bot any more (owner, 2026-10-08). The row
// stays the conversation being looked at, with its preview, whatever the bot
// holds and whatever thread a chip asked to reveal.
describe("bot row with threads on never expands", () => {
  it("keeps the sole conversation row and preview with several threads and a folder", () => {
    const multiple = { ...bot, projects: [{ id: "p1", name: "Research" }], tasks: [...bot.tasks!, { threadId: "older", title: "Earlier", createdAt: 0, projectId: "p1" }] };
    const markup = render(multiple);
    expectSoleRow(markup);
    expect(markup).not.toContain("Earlier");
    expect(markup).toContain("The latest reply");
  });

  it("does not unfold for a revealed sibling thread", () => {
    const multiple = { ...bot, tasks: [...bot.tasks!, { threadId: "older", title: "Earlier", createdAt: 0 }] };
    fixture.state.revealThread = { threadId: "older", nonce: 1 };
    render(multiple);
    fixture.effects.forEach(effect => effect());
    const markup = render(multiple);
    expectSoleRow(markup);
    expect(markup).not.toContain('data-sidebar-thread-row="older"');
  });

  it.each([
    [{ busy: true }, 'class="sr-only">Working…'],
    [{ activity: "waiting-on-you" }, '<span dir="auto" class="truncate">Waiting for you…'],
    [{ waitingForTeammates: true }, '<span dir="auto" class="truncate">Waiting on a teammate…'],
  ] as const)("keeps sole-thread activity visible after a reveal (%j)", (status, label) => {
    fixture.state.revealThread = { threadId: "current", nonce: 1 };
    render({ ...bot, ...status });
    fixture.effects.forEach(effect => effect());
    const markup = render({ ...bot, ...status });
    expectSoleRow(markup);
    expect(markup).toContain(label);
  });
});
