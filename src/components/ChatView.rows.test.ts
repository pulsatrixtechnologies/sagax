// @vitest-environment happy-dom
// The open chat's rows re-render only when their own message changes. A
// store event elsewhere (another bot's frame, a field of this bot that no
// row shows) renders none of them; a patched tool chip renders that chip
// and nothing else. Counted through the leaf each row draws, which is not
// memoized here, so it renders exactly when its row does.
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";
import { formatTime } from "@/state/store";

const renders = vi.hoisted(() => ({ botText: 0, userText: 0, toolChip: 0, speak: 0 }));
vi.mock("./ChatMarkdown", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ChatMarkdown")>(),
  ChatMarkdown: ({ text }: { text: string }) => {
    renders.botText++;
    return createElement("p", null, text);
  },
}));
vi.mock("./ThreadRefs", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ThreadRefs")>(),
  ThreadRefText: ({ text }: { text: string }) => {
    renders.userText++;
    return createElement("span", null, text);
  },
}));
vi.mock("./ToolActivity", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ToolActivity")>(),
  ToolActivity: ({ tool }: { tool: { name: string } }) => {
    renders.toolChip++;
    return createElement("span", null, tool.name);
  },
}));
// The real button, run inside a counting component: whatever it subscribes
// to re-renders this component, so every render of it is counted.
vi.mock("./SpeakButton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SpeakButton")>();
  const { SpeakButton, SpeakMenuItem } = actual;
  return {
    ...actual,
    SpeakButton: (props: Parameters<typeof SpeakButton>[0]) => {
      renders.speak++;
      return SpeakButton(props);
    },
    SpeakMenuItem: (props: Parameters<typeof SpeakMenuItem>[0]) => {
      renders.speak++;
      return SpeakMenuItem(props);
    },
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");
const { setRemoteVoiceProvider } = await import("@/lib/local-voice");
const { t } = await import("@/lib/i18n");
const { liveActivityPhrases } = await import("@/lib/live-activity");

const message = (id: string, parentId: string | undefined, fields: Partial<Message>): Message =>
  ({ id, parentId, role: "bot", kind: "text", at: new Date(2026, 9, 3, 9, Number(id.slice(1))).getTime(), ...fields });
// Three turns, each a question, one tool step and an answer; the last turn's
// step is still running.
const messages: Message[] = [];
for (let turn = 0; turn < 3; turn++) {
  const at = turn * 3;
  messages.push(
    message(`m${at}`, messages.at(-1)?.id, { role: "user", text: `Question ${turn}` }),
    message(`m${at + 1}`, `m${at}`, { kind: "activity", tool: { name: `Read file ${turn}`, ok: turn < 2 ? true : undefined } }),
  );
  if (turn < 2) messages.push(message(`m${at + 2}`, `m${at + 1}`, { text: `Answer ${turn}`, ...(turn === 0 ? { turnRun: { instanceId: "test", model: "m", effort: "medium" as const } } : {}) }));
}
const running = messages.at(-1)!;

const profile = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: `${id}-thread`, title: "Thread", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
  ...extra,
});

let state: AppState = {
  ...initialState,
  connected: true,
  selectedId: "pepper",
  bots: [profile("pepper", { messages, activeLeafId: running.id }), profile("scout")],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Model M" }] } } as unknown as InstanceInfo],
  config: { features: { showToolCalls: true } } as AppState["config"],
};
const dispatch = vi.fn();
let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function draw() {
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const children = createElement(ChatView, { bot: state.bots.find((bot) => bot.id === "pepper")! });
  flushSync(() => root.render(createElement(BotEditorStore, { value, children })));
  await settle();
}
// Regenerate and read aloud live in each message's "…" menu, mounted while open.
async function openMenus() {
  const handles = document.querySelectorAll<HTMLButtonElement>('[data-message-bar] button[aria-haspopup="menu"]');
  flushSync(() => handles.forEach((handle) => { if (handle.getAttribute("aria-expanded") !== "true") handle.click(); }));
  await settle();
}
async function rowRendersAfter(change: (current: AppState) => AppState) {
  renders.botText = renders.userText = renders.toolChip = renders.speak = 0;
  state = change(state);
  await draw();
  return { ...renders };
}

beforeAll(async () => {
  // late on the day of the thread, so its separator reads "Today"
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 23, 0));
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await draw();
  await settle();
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("chat transcript rows", () => {
  it("draws every row once on mount", () => {
    expect(document.querySelectorAll("[data-mid]")).toHaveLength(messages.length);
    expect(document.body.textContent).toContain("Today");
    expect(document.body.textContent).toContain("Answer 1");
    expect(document.body.textContent).toContain("Read file 2");
    const stamp = document.querySelector("[data-testid=transcript-date]");
    expect(stamp?.textContent).toBe(`Today ${formatTime(messages[0]!.at)}`);
    expect(document.querySelectorAll("[data-testid=transcript-date]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-message-time]").length).toBeGreaterThan(0);
  });

  it("stamps a second date after a 30 minute gap on the same day", async () => {
    const last = messages.at(-1)!;
    const extra = message("late", last.id, {
      role: "user",
      text: "later the same day",
      at: last.at + 31 * 60_000,
    });
    await rowRendersAfter((current) => {
      const pepper = current.bots.find((bot) => bot.id === "pepper")!;
      return {
        ...current,
        bots: current.bots.map((bot) =>
          bot.id === "pepper" ? { ...pepper, messages: [...messages, extra], activeLeafId: extra.id } : bot,
        ),
      };
    });
    const stamps = [...document.querySelectorAll("[data-testid=transcript-date]")].map((node) => node.textContent);
    expect(stamps).toEqual([
      `Today ${formatTime(messages[0]!.at)}`,
      `Today ${formatTime(extra.at)}`,
    ]);
    expect(document.body.textContent).toContain("later the same day");
    await rowRendersAfter((current) => {
      const pepper = current.bots.find((bot) => bot.id === "pepper")!;
      return {
        ...current,
        bots: current.bots.map((bot) =>
          bot.id === "pepper" ? { ...pepper, messages, activeLeafId: running.id } : bot,
        ),
      };
    });
    expect(document.querySelectorAll("[data-testid=transcript-date]")).toHaveLength(1);
  });

  it("renders no row when another bot changes", async () => {
    const scout = state.bots.find((bot) => bot.id === "scout")!;
    expect(await rowRendersAfter((current) => reducer(current, { type: "botPatched", bot: { ...scout, busy: true } })))
      .toEqual({ botText: 0, userText: 0, toolChip: 0, speak: 0 });
  });

  it("renders no row when this bot changes in a way no row shows", async () => {
    expect(await rowRendersAfter((current) => {
      const { messages: _transcript, ...frame } = current.bots.find((bot) => bot.id === "pepper")!;
      return reducer(current, { type: "botPatched", bot: { ...frame, turnStartedAt: 5, tasks: frame.tasks?.map((task) => ({ ...task, updatedAt: 99 })) } });
    })).toEqual({ botText: 0, userText: 0, toolChip: 0, speak: 0 });
  });

  it("renders only the tool chip that changed", async () => {
    expect(await rowRendersAfter((current) => reducer(current, {
      type: "messagePatched", threadId: "pepper-thread", message: { ...running, tool: { name: "Read file 2, page 2" } },
    }))).toEqual({ botText: 0, userText: 0, toolChip: 1, speak: 0 });
    expect(document.body.textContent).toContain("Read file 2, page 2");
  });

  // #3323: whether the turn runs and which tool calls are live are read by
  // the few rows that show them (the tool chips, Edit, Regenerate, the
  // version arrows), not by every message row.
  it("renders no message row when a turn starts, runs a new tool and ends", async () => {
    const turn = (busy: boolean, transcript: Message[] = messages) => (current: AppState) => {
      const pepper = current.bots.find((bot) => bot.id === "pepper")!;
      const tasks = pepper.tasks?.map((task) => ({ ...task, busy, activity: busy ? "working" as const : "idle" as const }));
      return { ...current, bots: current.bots.map((bot) => bot.id === "pepper"
        ? { ...pepper, busy, turnStartedAt: running.at, tasks, messages: transcript, activeLeafId: transcript.at(-1)!.id }
        : bot) };
    };
    const started = await rowRendersAfter(turn(true));
    expect(started).toMatchObject({ botText: 0, userText: 0, speak: 0 });
    // the running step turns live: its chip, and no other row
    expect(started.toolChip).toBe(1);
    const next = message("m8", running.id, { kind: "activity", tool: { name: "Read file 3" } });
    const grown = await rowRendersAfter(turn(true, [...messages, next]));
    expect(grown).toMatchObject({ botText: 0, userText: 0, speak: 0 });
    // #3581: the running turn's row says "Working" and nothing more; the
    // working line under the transcript names the new step
    const live = document.querySelector('[data-testid="activity-run"][data-live="true"]');
    expect(live?.textContent).toContain(t("chat.activity.working"));
    expect(document.querySelector(".turn-presence")?.textContent).toContain(liveActivityPhrases(next).phrases[0]);
    expect(await rowRendersAfter(turn(false))).toMatchObject({ botText: 0, userText: 0, speak: 0 });
  });

  // The separator used to follow every store event; now it follows the date.
  it("moves Today on to Yesterday after midnight, at the next store event", async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 0, 30));
    const scout = state.bots.find((bot) => bot.id === "scout")!;
    await rowRendersAfter((current) => reducer(current, { type: "botPatched", bot: { ...scout, unread: true } }));
    expect(document.body.textContent).toContain("Yesterday");
    expect(document.body.textContent).not.toContain("Today");
    expect(document.querySelector("[data-testid=transcript-date]")?.textContent).toBe(
      `Yesterday ${formatTime(messages[0]!.at)}`,
    );
  });

  it("offers Regenerate on the last answer only, and not during a turn", async () => {
    await openMenus();
    // the menus are drawn in a portal: a menu's message is its opener's
    const ownerMid = (item: Element) => {
      const menu = item.closest('[role="menu"]');
      const opener = menu?.id ? document.querySelector(`[aria-controls="${CSS.escape(menu.id)}"]`) : null;
      return (opener ?? item).closest("[data-mid]")?.getAttribute("data-mid");
    };
    const regenerate = () => [...document.querySelectorAll(`[role="menuitem"]`)]
      .filter((item) => item.textContent === t("chat.regenerate"))
      .map(ownerMid);
    expect(regenerate()).toEqual(["m5"]);
    const busy = (value: boolean) => (current: AppState) => {
      const { messages: _transcript, ...frame } = current.bots.find((bot) => bot.id === "pepper")!;
      const tasks = frame.tasks?.map((task) => ({ ...task, busy: value, activity: value ? "working" as const : "idle" as const }));
      return reducer(current, { type: "botPatched", bot: { ...frame, busy: value, tasks } });
    };
    await rowRendersAfter(busy(true));
    await openMenus();
    expect(regenerate()).toEqual([]);
    await rowRendersAfter(busy(false));
    await openMenus();
    expect(regenerate()).toEqual(["m5"]);
  });

  it("shows the model and effort after the pointer rests 1.2 s on an answer, and never on the person's own message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 23, 0));
    try {
      const rowOf = (id: string) => document.querySelector(`[data-mid="${id}"] [data-retro-role]`)!;
      const hover = (id: string, type: "pointerover" | "pointerout") => {
        rowOf(id).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
      };
      const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
      // an answer that recorded its turn: model "m" labelled Model M, effort Medium
      // Owner, 2026-10-15: the line is laid out from the start and only fades
      // in, so the answer above it never moves (same rows, same height)
      const line = () => document.querySelector("[data-turn-run]")!;
      const layout = () => [...rowOf("m2").children].map((child) => `${child.tagName}:${child.getAttribute("data-turn-run") ?? ""}`).join(",");
      const before = layout();
      expect(line().className).toContain("invisible");
      expect(line().className).toContain("opacity-0");
      expect(line().getAttribute("aria-hidden")).toBe("true");
      // keyboard focus in the message shows it too
      expect(line().className).toContain("group-focus-within:visible");
      hover("m2", "pointerover");
      await tick(1199);
      expect(line().className).toContain("invisible");
      await tick(1);
      expect(line().textContent).toBe("Model M · effort Medium");
      expect(line().getAttribute("aria-hidden")).toBe("false");
      expect(line().className).not.toContain(" invisible");
      expect(rowOf("m2").contains(line())).toBe(true);
      expect(layout()).toBe(before);
      hover("m2", "pointerout");
      await tick(200);
      expect(line().className).toContain("opacity-0");
      expect(layout()).toBe(before);
      // the person's own message, and an answer with no record: nothing
      expect(document.querySelectorAll("[data-turn-run]")).toHaveLength(1);
      for (const id of ["m0", "m5"]) {
        expect(rowOf(id).querySelector("[data-turn-run]")).toBeNull();
      }
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 3, 23, 0));
    }
  });

  // A paired Mac keeps its voice choice ("This Mac" or "Host voice") on the
  // device, outside the store. The read-aloud buttons pick up a switch at the
  // next store event, here the settings beside the chat closing.
  it("follows this device's voice choice at the next store event", async () => {
    const bridge = window.ogb;
    window.ogb = { ...bridge, platform: "darwin", remoteClient: { active: true } } as typeof window.ogb;
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => kept.set(key, value) });
    vi.stubGlobal("speechSynthesis", { getVoices: () => [] });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const speak = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .filter((item) => item.textContent === t("chat.speak.read") || item.textContent === t("chat.speak.needsKey"))
      .map((item) => `${item.textContent}${item.disabled ? " (off)" : ""}`);
    const switchTo = async (provider: "host" | "system") => {
      await rowRendersAfter((current) => reducer(current, { type: "toggleSettings", open: true }));
      setRemoteVoiceProvider(provider);
      await rowRendersAfter((current) => reducer(current, { type: "toggleSettings", open: false }));
    };
    try {
      await switchTo("system");
      await openMenus();
      expect(speak()).toEqual([t("chat.speak.read"), t("chat.speak.read")]);
      // no speech key on the host, so Host voice cannot read aloud
      await switchTo("host");
      await openMenus();
      expect(speak()).toEqual([`${t("chat.speak.needsKey")} (off)`, `${t("chat.speak.needsKey")} (off)`]);
    } finally {
      // the stubbed globals go in afterAll
      window.ogb = bridge;
    }
  });
});
