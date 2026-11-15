import { describe, expect, it } from "vitest";

import type { ModelSelection, RuntimeEvent } from "../contracts.ts";
import { Store } from "../store.ts";
import {
  bareToolName,
  browserGuardSettings,
  createBrowserFailureGuard,
  isWebPageTool,
  browserStopNote,
  carriesBrowserNote,
  type BrowserGuardSettings,
} from "./browser-failure-guard.ts";
import { pageBlockNote } from "../browser/browser-tool-shape.ts";
import { addHeldSecretScrubber } from "../../shared/redact.ts";
import { wireTurnBudget } from "./turn-budget-wiring.ts";
import { WORK_STYLE_PROMPT } from "../system-prompt.ts";
import { chatToolName } from "../drivers/chat-mcp-tools.ts";
import { USER_SANDBOX_MCP_NAME } from "../sandbox/user-sandbox-routing.ts";
import { AUTO_COMPUTER_MCP_NAME } from "../computer/auto-computer.ts";

const at = "2026-11-08T00:00:00.000Z";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(settings: BrowserGuardSettings = { enabled: true }, language: "fr" | "en" = "fr") {
  const steers: string[] = [];
  const live = true;
  const guard = createBrowserFailureGuard({
    settings: () => settings,
    live: () => live,
    canSteer: () => live,
    steer: async (_threadId, note) => { steers.push(note); return "steered"; },
    language: () => language,
    log: () => {},
  });
  const emit = (event: object) => guard.onEvent({ threadId: "th", instanceId: "grok", driver: "d", createdAt: at, turnId: "t1", ...event } as unknown as RuntimeEvent);
  let n = 0;
  const call = (title: string, ok: boolean, output?: string) => {
    const itemId = `i${n++}`;
    emit({ type: "item.started", itemType: "tool", itemId, title });
    emit({ type: "item.completed", itemType: "tool", itemId, ok, ...(output === "" ? {} : { output: output ?? (ok ? "page" : "browser crashed") }) });
  };
  emit({ type: "turn.started" });
  return { guard, emit, call, steers };
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

  it("names the tools of a browser MCP server (claude-in-chrome, playwright), never a non-browser server's generic names", () => {
    for (const title of [
      "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__computer", "mcp__claude-in-chrome__read_page",
      "mcp__claude-in-chrome__tabs_create_mcp", "mcp__claude-in-chrome__get_page_text", "mcp__claude-in-chrome__find",
      "mcp__playwright__browser_navigate", "mcp__playwright__navigate", "mcp__browser__agent_browser_tab_new", "puppeteer.navigate",
    ]) {
      expect(isWebPageTool(title), title).toBe(true);
    }
    for (const title of ["mcp__computer-use__computer", "mcp__files__find", "navigate", "mcp__agents__sagax_help", "mcp__browser-search__web_search"]) {
      expect(isWebPageTool(title), title).toBe(false);
    }
  });

  it("names the page tools in the titles the chat engine emits (Grok, every chat-completions engine)", () => {
    // chatToolName joins server and tool with ONE underscore: sagax_environment_browse.
    for (const [server, tool] of [
      [USER_SANDBOX_MCP_NAME, "browse"], [AUTO_COMPUTER_MCP_NAME, "fetch_url"], [AUTO_COMPUTER_MCP_NAME, "browse"],
      ["browser", "agent_browser_tab_new"], ["browser", "agent_browser_tab_switch"], ["browser", "agent_browser_wait_ms"],
      ["browser", "agent_browser_wait_for_load"], ["claude-in-chrome", "navigate"], ["claude-in-chrome", "tabs_create_mcp"],
      ["playwright", "browser_navigate"],
    ] as const) {
      const title = chatToolName(server, tool);
      expect(isWebPageTool(title), title).toBe(true);
    }
    expect(chatToolName(USER_SANDBOX_MCP_NAME, "browse")).toBe("sagax_environment_browse");
    for (const [server, tool] of [
      [USER_SANDBOX_MCP_NAME, "run_command"], [AUTO_COMPUTER_MCP_NAME, "computer_use"], [AUTO_COMPUTER_MCP_NAME, "read_file"],
      ["git", "fetch"], ["agents", "sagax_help"], ["agents", "remote_support_hosts"], ["browser-search", "web_search"], ["connectwise", "cw_psa_query"],
    ] as const) {
      const title = chatToolName(server, tool);
      expect(isWebPageTool(title), title).toBe(false);
    }
  });

  it("replays the G4 turn with the chat engine titles: one note at 2, and the turn is never stopped by the server", async () => {
    const h = harness();
    h.call(chatToolName(USER_SANDBOX_MCP_NAME, "browse"), false);
    h.call(chatToolName(AUTO_COMPUTER_MCP_NAME, "fetch_url"), false);
    expect(h.steers).toHaveLength(1);
    expect(h.steers[0]).toContain("sagax_environment_browse, sagax_computer_fetch_url");
    h.call(chatToolName("browser", "agent_browser_tab_new"), false);
    h.call(chatToolName("browser", "agent_browser_wait_ms"), false);
    await flush();
    expect(h.steers).toHaveLength(1);
  });

  it("replays the G4 turn: a note at the 2nd failure in a row, once", async () => {
    const h = harness();
    h.call("browse", false);
    expect(h.steers).toEqual([]);
    h.call("fetch_url", false);
    expect(h.steers).toHaveLength(1);
    expect(h.steers[0]).toContain("[Sagax : 2 appels de page web ont échoué de suite (browse, fetch_url)");
    expect(h.steers[0]).toContain("Ne refais pas le même appel");
    expect(h.steers[0]).toContain("dans tes mots, ce qui te bloque");
    expect(h.steers[0]).toContain("réponds de mémoire, sans outil");
    expect(h.steers[0]).toContain("au plus une seule recherche web");
    // An action task is not told the browser did not respond.
    expect(h.steers[0]).not.toMatch(/n'a pas répondu/);
    h.call("web_search", true);
    h.call("tab_new", false);
    h.call("tab_switch", false);
    h.call("tab_wait", false);
    expect(h.steers).toHaveLength(1);
  });

  it("leaves the note to the built-in browser's own results when one carried it (#4394): no second copy", () => {
    const h = harness({ enabled: true }, "en");
    const stop = browserStopNote({ failures: 2, tools: ["agent_browser_click"] });
    h.call("agent_browser_click", false, "Element not found");
    h.call(chatToolName("browser", "agent_browser_fill"), false, `${stop}\nElement not found`);
    h.call("mcp__browser__agent_browser_open", false);
    expect(h.steers).toEqual([]);
    // A page block note in the first failure says it too.
    const wall = harness();
    wall.call("agent_browser_open", false, pageBlockNote({ kind: "challenge", host: "social.test" }));
    wall.call("agent_browser_click", false);
    expect(wall.steers).toEqual([]);
  });

  it("steers when built-in browser steps fail by throwing or before the runtime (#4394): no result carried the note", () => {
    // The browser not up yet in a freshly woken environment: the route throws
    // (409) before the runtime, and the engine's tool output is the bare error.
    const h = harness();
    h.call("mcp__browser__agent_browser_open", false, "Browser access changed while connecting.");
    h.call("mcp__browser__agent_browser_open", false, "");
    expect(h.steers).toHaveLength(1);
    expect(h.steers[0]).toContain("(agent_browser_open)");
    // A mixed run is steered too.
    const mixed = harness();
    mixed.call("fetch_url", false);
    mixed.call("agent_browser_open", false);
    expect(mixed.steers).toHaveLength(1);
  });

  it("logs each failed page step with its own error text, redacted and short, never a held secret (#4394)", () => {
    const lines: string[] = [];
    const held = "Vault-Held-Value-93";
    const remove = addHeldSecretScrubber((text) => text.split(held).join("••••••"));
    try {
      const guard = createBrowserFailureGuard({
        settings: () => ({ enabled: true }), live: () => true, canSteer: () => true,
        steer: async () => "steered", language: () => "en", log: (line) => lines.push(line),
      });
      const emit = (event: object) => guard.onEvent({ threadId: "th", instanceId: "grok", driver: "d", createdAt: at, turnId: "t1", ...event } as unknown as RuntimeEvent);
      emit({ type: "turn.started" });
      emit({ type: "item.started", itemType: "tool", itemId: "a", title: "agent_browser_click" });
      emit({ type: "item.completed", itemType: "tool", itemId: "a", ok: false, output: `Element @e12 not found while typing ${held} with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123\n${"page text ".repeat(80)}` });
      emit({ type: "item.started", itemType: "tool", itemId: "b", title: "agent_browser_open" });
      emit({ type: "item.completed", itemType: "tool", itemId: "b", ok: false, output: `${pageBlockNote({ kind: "refused", host: "example.test" })}\nHTTP 403` });
      emit({ type: "item.started", itemType: "tool", itemId: "c", title: "agent_browser_open" });
      emit({ type: "item.completed", itemType: "tool", itemId: "c", ok: true, output: "fine" });
      const failed = lines.filter((line) => line.includes("step failed"));
      expect(failed).toHaveLength(2);
      expect(failed[0]).toContain("tool=agent_browser_click");
      expect(failed[0]).toContain("Element @e12 not found");
      expect(failed[0]).not.toContain(held);
      expect(failed[0]).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
      expect(failed[0]).not.toContain("page text");
      expect(failed[0].length).toBeLessThan(320);
      expect(failed[1]).toContain("tool=agent_browser_open");
      expect(failed[1]).toContain("HTTP 403");
    } finally {
      remove();
    }
  });

  it("finds the note in a tool output whatever the language", () => {
    expect(carriesBrowserNote(browserStopNote({ failures: 2, tools: ["browse"] }))).toBe(true);
    expect(carriesBrowserNote(browserStopNote({ language: "fr", failures: 3, tools: ["browse"] }))).toBe(true);
    expect(carriesBrowserNote(`Error\n${pageBlockNote({ kind: "refused", host: "social.test" })}`)).toBe(true);
    expect(carriesBrowserNote("browser crashed")).toBe(false);
    expect(carriesBrowserNote(undefined)).toBe(false);
  });

  it("a page call that works resets the run", async () => {
    const h = harness();
    for (let round = 0; round < 3; round += 1) {
      h.call("browse", false);
      h.call("browse", round === 2 ? false : true);
    }
    // failures: 1, reset, 1, reset, 1, 2 => note once
    expect(h.steers).toHaveLength(1);
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
  });

  it("reads its settings from the environment", () => {
    expect(browserGuardSettings({})).toEqual({ enabled: true });
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD: "0" })).toEqual({ enabled: false });
    // #4394: no ceiling any more; an old setting changes nothing.
    expect(browserGuardSettings({ SAGAX_BROWSER_GUARD_STOP_AT: "6" })).toEqual({ enabled: true });
  });

  it("is wired on every direct conversation with the turn budget, and never stops the turn or speaks in the bot's name (#4394)", async () => {
    const store = new Store((): ModelSelection => ({ instanceId: "grok", model: "grok-4.6" }));
    const bot = store.createBot({ name: "Osprey" }, { seedMessages: false });
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
    expect(steers.some((note) => note.startsWith("[Sagax: 2 web page calls failed in a row"))).toBe(true);
    expect(stops).toEqual([]);
    // Only the bot's own words reach the person: nothing written by the server in its name.
    expect(store.messagesFor(threadId).some((message) => message.kind === "text" && /failed in a row/.test(message.text ?? ""))).toBe(false);
  });

  it("tells every bot once to answer general knowledge without a tool; the two-failures rule stays a runtime note", () => {
    expect(WORK_STYLE_PROMPT).toContain("General knowledge needs no tool: answer from what you know.");
    expect(WORK_STYLE_PROMPT).not.toContain("failed browse");
  });
});
