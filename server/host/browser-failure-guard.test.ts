import { describe, expect, it } from "vitest";

import type { ModelSelection, RuntimeEvent } from "../contracts.ts";
import { Store } from "../store.ts";
import {
  bareToolName,
  browserGuardSettings,
  createBrowserFailureGuard,
  isWebPageTool,
  type BrowserGuardSettings,
} from "./browser-failure-guard.ts";
import { wireTurnBudget } from "./turn-budget-wiring.ts";
import { WORK_STYLE_PROMPT } from "../system-prompt.ts";

const at = "2026-11-08T00:00:00.000Z";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(settings: BrowserGuardSettings = { enabled: true, stopAt: 4 }, language: "fr" | "en" = "fr") {
  const steers: string[] = [];
  const stops: string[] = [];
  const posts: string[] = [];
  let live = true;
  const guard = createBrowserFailureGuard({
    settings: () => settings,
    live: () => live,
    canSteer: () => live,
    steer: async (_threadId, note) => { steers.push(note); return "steered"; },
    interrupt: async (_threadId, cause) => { stops.push(cause); live = false; },
    post: (_threadId, text) => { posts.push(text); },
    language: () => language,
    log: () => {},
  });
  const emit = (event: object) => guard.onEvent({ threadId: "th", instanceId: "grok", driver: "d", createdAt: at, turnId: "t1", ...event } as unknown as RuntimeEvent);
  let n = 0;
  const call = (title: string, ok: boolean) => {
    const itemId = `i${n++}`;
    emit({ type: "item.started", itemType: "tool", itemId, title });
    emit({ type: "item.completed", itemType: "tool", itemId, ok, output: ok ? "page" : "browser crashed" });
  };
  emit({ type: "turn.started" });
  return { guard, emit, call, steers, stops, posts };
}

describe("browser failure guard (QA 0.8.67 G4)", () => {
  it("names the web page tools of every engine, never web search or a shell", () => {
    for (const title of ["browse", "fetch_url", "tab_new", "tab_switch", "tab_wait", "sagax-environment__browse", "mcp__sagax-environment__fetch_url", "agent_browser_open", "WebFetch", "web_fetch"]) {
      expect(isWebPageTool(title), title).toBe(true);
    }
    for (const title of ["web_search", "WebSearch", "run_command", "Bash", "cw_psa_query", "", undefined]) {
      expect(isWebPageTool(title), String(title)).toBe(false);
    }
    expect(bareToolName("mcp__sagax-environment__browse")).toBe("browse");
  });

  it("replays the G4 turn: a note at the 2nd failure in a row, a stop with a clear message at the 4th, not 8 tries", async () => {
    const h = harness();
    h.call("browse", false);
    expect(h.steers).toEqual([]);
    h.call("fetch_url", false);
    expect(h.steers).toHaveLength(1);
    expect(h.steers[0]).toContain("[Sagax : le navigateur a échoué 2 fois de suite (browse, fetch_url)");
    expect(h.steers[0]).toContain("réponds tout de suite de mémoire, sans outil");
    expect(h.steers[0]).toContain("au plus une seule recherche web");
    h.call("web_search", true);
    h.call("tab_new", false);
    expect(h.steers).toHaveLength(1);
    h.call("tab_switch", false);
    await flush();
    expect(h.stops).toEqual(["le navigateur a échoué 4 fois ; le tour a été arrêté au lieu de boucler"]);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toContain("le navigateur a échoué 4 fois (browse, fetch_url, tab_new, tab_switch)");
    expect(h.posts[0]).toContain("réponds sans navigateur");
    h.call("tab_wait", false);
    expect(h.stops).toHaveLength(1);
  });

  it("keeps the working notes in the stop message", async () => {
    const h = harness({ enabled: true, stopAt: 3 }, "en");
    h.emit({ type: "item.completed", itemType: "assistant_text", text: "Tailscale is a mesh VPN; Pangolin is a tunnel." });
    h.call("browse", false);
    h.call("browse", false);
    h.call("browse", false);
    await flush();
    expect(h.posts[0]).toContain("I stopped this turn: the browser failed 3 times (browse)");
    expect(h.posts[0]).toContain("> Tailscale is a mesh VPN");
  });

  it("a page call that works resets the run; failures apart still stop the turn at 6", async () => {
    const h = harness();
    for (let round = 0; round < 3; round += 1) {
      h.call("browse", false);
      h.call("browse", round === 2 ? false : true);
    }
    // failures: 1, reset, 1, reset, 1, 2 => note once, total 4, no stop yet
    expect(h.steers).toHaveLength(1);
    expect(h.stops).toEqual([]);
    h.call("browse", true);
    h.call("fetch_url", false);
    h.call("browse", true);
    h.call("fetch_url", false);
    await flush();
    expect(h.stops).toHaveLength(1);
    expect(h.stops[0]).toContain("6 fois");
  });

  it("starts over on each turn, and stays silent when off or idle", () => {
    const h = harness();
    h.call("browse", false);
    h.emit({ type: "turn.completed" });
    h.emit({ type: "turn.started", turnId: "t2" });
    h.emit({ type: "item.started", itemType: "tool", itemId: "x", title: "browse", turnId: "t2" });
    h.emit({ type: "item.completed", itemType: "tool", itemId: "x", ok: false, turnId: "t2" });
    expect(h.steers).toEqual([]);

    const off = harness({ enabled: false });
    for (let n = 0; n < 8; n += 1) off.call("browse", false);
    expect(off.steers).toEqual([]);
    expect(off.stops).toEqual([]);
  });

  it("reads its settings from the environment", () => {
    expect(browserGuardSettings({})).toEqual({ enabled: true, stopAt: 4 });
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD: "0" })).toEqual({ enabled: false });
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD_STOP_AT: "0" })).toEqual({ enabled: true });
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD_STOP_AT: "6" })).toEqual({ enabled: true, stopAt: 6 });
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD_STOP_AT: "2" })).toEqual({ enabled: true, stopAt: 4 });
  });

  it("is wired on every direct conversation with the turn budget, and posts its message in the chat", async () => {
    const store = new Store((): ModelSelection => ({ instanceId: "grok", model: "grok-4.6" }));
    const bot = store.createBot({ name: "Melonie" }, { seedMessages: false });
    const threadId = bot.threadId;
    let listener: ((event: RuntimeEvent) => void) | undefined;
    const busy = new Set([threadId]);
    const steers: string[] = [];
    const stops: string[] = [];
    wireTurnBudget({
      config: () => ({ turnBudget: { maxSteps: null, maxMinutes: null } }),
      env: {},
      botByThread: (id) => store.botByThread(id),
      threadBusy: (_botId, id) => busy.has(id),
      steerer: () => async (_id, note) => { steers.push(note); return "steered"; },
      stopDirectThread: async (_botId, id) => { stops.push(id); busy.delete(id); },
      appendMessage: (id, message) => store.appendMessage(id, message),
      messages: (id) => store.activePath(id),
      preferredLanguage: () => "en",
      subscribe: (next) => { listener = next; },
      log: () => {},
    });
    const emit = (event: object) => listener?.({ threadId, instanceId: "grok", driver: "d", createdAt: at, turnId: "t1", ...event } as unknown as RuntimeEvent);
    emit({ type: "turn.started" });
    for (let n = 0; n < 4; n += 1) {
      emit({ type: "item.started", itemType: "tool", itemId: `b${n}`, title: "browse" });
      emit({ type: "item.completed", itemType: "tool", itemId: `b${n}`, ok: false });
    }
    await flush();
    expect(steers.some((note) => note.startsWith("[Sagax: the browser failed 2 times in a row"))).toBe(true);
    expect(stops).toEqual([threadId]);
    const last = store.messagesFor(threadId).at(-1);
    expect(last?.role).toBe("bot");
    expect(last?.text).toContain("I stopped this turn: the browser failed 4 times");
  });

  it("tells every bot to answer general knowledge without a tool and to stop after two browser failures", () => {
    expect(WORK_STYLE_PROMPT).toContain("General knowledge (compare products, explain a concept) is answered from what you know, no tool.");
    expect(WORK_STYLE_PROMPT).toContain("Two failed browse or page calls in a row: stop browsing");
  });
});
