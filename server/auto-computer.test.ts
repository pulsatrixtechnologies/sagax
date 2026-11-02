import { describe, expect, it } from "vitest";

import {
  AUTO_COMPUTER_MCP_NAME,
  AUTO_COMPUTER_RULES,
  COMPUTER_SELECT_TOOL,
  autoComputerGuidance,
  autoComputerReason,
  autoComputerToolRefusal,
  autoStartLine,
  autoStartTarget,
  parseAutoComputerTarget,
  selectAutoComputer,
  type AutoComputerState,
} from "./auto-computer.ts";
import { AUTO_COMPUTER_SERVER, computerSelectTarget } from "../shared/execution-target.ts";
import { PROXIED_TOOL_SERVERS } from "./user-sandbox-proxy.ts";
import { parseWorkspaceLine, workspaceLineName } from "../shared/workspace-line.ts";

const auto = (over: Partial<AutoComputerState> = {}): AutoComputerState => ({
  auto: true, selected: "cloud", routine: false, sandboxConfigured: true, desktopMounted: true, routinesAllowed: false, browserAvailable: true, ...over,
});

describe("computer_select availability", () => {
  it("is served by its own proxied tool server, named like the UI reads it", () => {
    expect(AUTO_COMPUTER_MCP_NAME).toBe(AUTO_COMPUTER_SERVER);
    expect(PROXIED_TOOL_SERVERS[AUTO_COMPUTER_MCP_NAME].endpoint).toBe("/api/internal/workplace/mcp");
    expect(COMPUTER_SELECT_TOOL.inputSchema.properties.target.enum).toEqual(["this_computer", "browser", "cloud", "local_vm"]);
  });

  it("lists what is available when called without a target", () => {
    const answer = selectAutoComputer(auto(), {}, true);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("this_computer, browser, cloud, local_vm");
    expect(answer.changed).toBeUndefined();
  });

  it("refuses to switch a fixed Works on and names the setting", () => {
    for (const [fixed, label] of [["cloud", "Cloud (server environment)"], ["vm", "Local VM"], ["local", "This computer"], ["browser", "Browser"], ["off", "Off"]] as const) {
      const answer = selectAutoComputer(auto({ auto: false, fixed, selected: null }), { target: "this_computer" }, true);
      expect(answer.ok).toBe(false);
      expect(answer.text).toContain(`fixed to ${label}`);
      expect(answer.target).toBeUndefined();
    }
  });

  it("answers a fixed Cloud asked for the cloud with where it already works, not a refusal", () => {
    const answer = selectAutoComputer(auto({ auto: false, fixed: "cloud", selected: null }), { target: "cloud" }, true);
    expect(answer).toMatchObject({ ok: true, target: "cloud", changed: false });
    expect(answer.text).toContain("You already work on the cloud");
    expect(selectAutoComputer(auto({ auto: false, fixed: "local", selected: null }), { target: "cloud" }, true).ok).toBe(false);
  });

  it("refuses this_computer and local_vm when the desktop app is not connected", () => {
    for (const target of ["this_computer", "local_vm"]) {
      const notMounted = selectAutoComputer(auto({ desktopMounted: false }), { target }, false);
      expect(notMounted.ok).toBe(false);
      expect(notMounted.text).toContain("not connected");
      expect(notMounted.text).toContain("You still work on the cloud");
      // mounted at turn start, then the app closed
      expect(selectAutoComputer(auto(), { target }, false).ok).toBe(false);
    }
  });

  it("refuses cloud when the server environment is not enabled", () => {
    const answer = selectAutoComputer(auto({ sandboxConfigured: false, selected: null }), { target: "cloud" }, true);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("not enabled");
  });

  it("routines use the owner's computer only when allowed and connected", () => {
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: false }), { target: "this_computer" }, true).text).toContain("routine");
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: true }), { target: "this_computer" }, true)).toMatchObject({ ok: true, target: "this_computer", changed: true });
    expect(selectAutoComputer(auto({ routine: true, routinesAllowed: true, desktopMounted: false }), { target: "this_computer" }, false).ok).toBe(false);
  });

  it("rejects unknown targets and accepts common spellings", () => {
    expect(selectAutoComputer(auto(), { target: "mars" }, true).ok).toBe(false);
    expect(parseAutoComputerTarget("Local VM")).toBe("local_vm");
    expect(parseAutoComputerTarget("this-computer")).toBe("this_computer");
    expect(parseAutoComputerTarget("server")).toBe("cloud");
    expect(parseAutoComputerTarget("computer")).toBe("this_computer");
    expect(parseAutoComputerTarget("Navigateur")).toBe("browser");
  });

  it("reports a change only when the place changes, with the previous one", () => {
    expect(selectAutoComputer(auto(), { target: "this_computer" }, true)).toMatchObject({ ok: true, target: "this_computer", from: "cloud", changed: true });
    expect(selectAutoComputer(auto({ selected: "this_computer" }), { target: "this_computer" }, true)).toMatchObject({ ok: true, changed: false });
  });

  it("keeps the audit reason to one short line", () => {
    expect(autoComputerReason("  files\n on her   Mac ")).toBe("files on her Mac");
    expect(autoComputerReason("x".repeat(500))).toHaveLength(200);
    expect(autoComputerReason(42)).toBe("");
  });
});

describe("switching routes the next tool calls", () => {
  it("follows each selection in turn, mid-task", () => {
    let state = auto();
    const run = (server: "sagax-environment" | "sagax-desktop", tool = "run_command") => autoComputerToolRefusal(state.selected, server, tool);
    // starts in the cloud
    expect(run("sagax-environment")).toBeNull();
    expect(run("sagax-desktop")).toContain("computer_select");
    // the person said "sur mon Mac"
    const toMac = selectAutoComputer(state, { target: "this_computer", reason: "files on her Mac" }, true);
    state = { ...state, selected: toMac.target! };
    expect(run("sagax-desktop")).toBeNull();
    expect(run("sagax-desktop", "local_vm")).toBeNull();
    expect(run("sagax-environment")).toContain("target cloud");
    // isolated work: only the Local VM tool
    state = { ...state, selected: selectAutoComputer(state, { target: "local_vm" }, true).target! };
    expect(run("sagax-desktop", "local_vm")).toBeNull();
    expect(run("sagax-desktop", "run_command")).toContain("local_vm tool");
    expect(run("sagax-desktop", "computer_use")).toContain("local_vm tool");
    expect(run("sagax-environment")).not.toBeNull();
    // back to the cloud for the scraping
    state = { ...state, selected: selectAutoComputer(state, { target: "cloud" }, true).target! };
    expect(run("sagax-environment")).toBeNull();
    expect(run("sagax-desktop")).not.toBeNull();
  });

  it("refuses everything before a first choice when nothing was selected", () => {
    expect(autoComputerToolRefusal(null, "sagax-environment", "run_command")).toContain("computer_select");
    expect(autoComputerToolRefusal(null, "sagax-desktop", "run_command")).toContain("computer_select");
  });
});

describe("Auto guidance (prompt fixture)", () => {
  // The standing rules ride in the system prompt (volatile "workplace"
  // section); each message carries only the short per-turn line.
  const text = AUTO_COMPUTER_RULES;
  const line = autoComputerGuidance(auto(), true);

  it("names the tool, the start place and what is available", () => {
    expect(line).toMatch(/^<workplace>This bot's Workspace is Auto/);
    expect(line).toContain("computer_select");
    expect(line).toContain("This turn starts on the cloud (their server environment); available now: this_computer, browser, cloud, local_vm.");
    expect(line.endsWith("</workplace>")).toBe(true);
    expect(text).toMatch(/^This bot's Workspace is Auto/);
    expect(text).toContain("switch again mid-task");
  });

  it("keeps the per-message line short and free of the rules (2026-10-20 perf parity)", () => {
    expect(line.length).toBeLessThan(260);
    expect(line).not.toContain("this_computer: anything");
    expect(text).not.toContain("This turn starts on");
    expect(text).toContain("Each message's <workplace> line says where that turn starts");
  });

  it("routes the person's own machine, isolated work and heavy work", () => {
    expect(text).toMatch(/this_computer: .*files.*apps.*local network.*USB.*camera.*Docker.*localhost/);
    expect(text).toMatch(/local_vm: isolated/);
    expect(text).toMatch(/browser: pure web work/);
    expect(text).toMatch(/cloud: work that must keep running while the person is away .*routine.*offline or asleep.*long job/);
    expect(text).toContain("each new message starts over from the default (a person-asked turn: the person's computer when it is connected; a routine: the cloud)");
    expect(text).toContain("Routines may call computer_select for this_computer or local_vm only when the owner allowed routines on their computer");
    expect(text).toMatch(/Sub-agents: start_thread .* and create_agent take a workspace too/);
  });

  it("lets the person's explicit words win, in French and English", () => {
    for (const phrase of ["\"sur mon Mac\"", "\"localement\"", "\"on my computer\"", "\"locally\""]) {
      expect(text).toMatch(new RegExp(`${phrase}[^;]*mean this_computer`));
    }
    expect(text).toMatch(/"dans une VM", "in a VM" mean local_vm/);
    expect(text).toMatch(/"dans le cloud", "in the cloud", "sur le serveur", "on the server" mean cloud/);
    expect(text).toContain("say why (the tool's answer) instead of quietly working elsewhere");
  });

  it("lists only what can be reached", () => {
    expect(autoComputerGuidance(auto({ desktopMounted: false }), false)).toContain("available now: browser, cloud.");
    expect(autoComputerGuidance(auto({ desktopMounted: false, browserAvailable: false }), false)).toContain("available now: cloud.");
    expect(autoComputerGuidance(auto({ sandboxConfigured: false, selected: null }), true)).toContain("This turn starts on no computer; available now: this_computer, browser, local_vm.");
  });

  it("does not send the bot to computer_select for connector tools or to confirm where it already is", () => {
    expect(text).toContain("Connector and Sagax tools (ConnectWise, Pulsatrix memory and flow, agents, search, other MCP servers) run on the server wherever you are: they need no computer and no computer_select.");
    expect(text).toContain("Call computer_select only when a step needs a place other than the one you are on (not to confirm it).");
    expect(text).not.toContain("Select before the first tool call");
    expect(text).not.toContain("Prefer the cloud");
    expect(text).toContain("Never work around a refusal");
  });

  it("rides the volatile half of the system prompt, never the stable one", async () => {
    const { buildSystemPrompt } = await import("./system-prompt.ts");
    const built = buildSystemPrompt("persona", "", [{ id: "workplace", label: "Workspace", text: `\n${AUTO_COMPUTER_RULES}` }]);
    expect(built.stable).not.toContain("This bot's Workspace is Auto");
    expect(built.volatile).toContain("This bot's Workspace is Auto");
    expect(built.volatileSections.map((section) => section.id)).toContain("workplace");
  });

  it("has no long dashes", () => {
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(line).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the transcript chip", () => {
  it("reads the chosen place from a computer_select call", () => {
    expect(computerSelectTarget("mcp__sagax-computer__computer_select", JSON.stringify({ target: "this_computer", reason: "x" }))).toBe("this_computer");
    expect(computerSelectTarget("sagax-computer__computer_select", "{\"target\": \"cloud\"}")).toBe("cloud");
    expect(computerSelectTarget("mcp__sagax-computer__computer_select", "{}")).toBeNull();
    expect(computerSelectTarget("mcp__sagax-desktop__run_command", "{\"target\":\"cloud\"}")).toBeNull();
  });
});

describe("the browser as a place (per task)", () => {
  it("switches to the browser for pure web work and back", () => {
    const toBrowser = selectAutoComputer(auto({ selected: "this_computer" }), { target: "browser", reason: "read a public page" }, true);
    expect(toBrowser).toMatchObject({ ok: true, target: "browser", from: "this_computer", changed: true });
    expect(toBrowser.text).toContain("built-in browser tools");
    // the shell and desktop tools wait for a switch back
    expect(autoComputerToolRefusal("browser", "sagax-desktop", "run_command")).toContain("built-in browser");
    expect(autoComputerToolRefusal("browser", "sagax-environment", "run_command")).toContain("built-in browser");
    expect(selectAutoComputer(auto({ selected: "browser" }), { target: "this_computer" }, true)).toMatchObject({ ok: true, target: "this_computer", changed: true });
  });

  it("refuses the browser when it is turned off for the bot", () => {
    const answer = selectAutoComputer(auto({ browserAvailable: false }), { target: "browser" }, true);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("not available");
    expect(answer.text).toContain("You still work on the cloud");
  });

  it("reads a browser switch for the transcript chip", () => {
    expect(computerSelectTarget("mcp__sagax-computer__computer_select", "{\"target\":\"browser\"}")).toBe("browser");
  });
});

describe("where an Auto turn starts (Owner 2026-10-15)", () => {
  const base = { routine: false, personAsked: true, desktopConnected: true, routinesAllowed: false, sandboxConfigured: true, browserAvailable: true };

  it("defaults to the person's computer when it is connected", () => {
    expect(autoStartTarget(base)).toEqual({ target: "this_computer", wanted: "this_computer", fallback: null });
  });

  it("falls back to the cloud, and says why, when the computer is offline", () => {
    expect(autoStartTarget({ ...base, desktopConnected: false })).toEqual({ target: "cloud", wanted: "this_computer", fallback: "offline" });
    // no cloud either: the browser, then nothing
    expect(autoStartTarget({ ...base, desktopConnected: false, sandboxConfigured: false }).target).toBe("browser");
    expect(autoStartTarget({ ...base, desktopConnected: false, sandboxConfigured: false, browserAvailable: false }).target).toBeNull();
  });

  it("gives a sub-agent its own workspace, and never one that is not allowed", () => {
    expect(autoStartTarget({ ...base, wanted: "cloud" })).toMatchObject({ target: "cloud", fallback: null });
    expect(autoStartTarget({ ...base, wanted: "local_vm" })).toMatchObject({ target: "local_vm", fallback: null });
    expect(autoStartTarget({ ...base, wanted: "browser" })).toMatchObject({ target: "browser", fallback: null });
    // the Local VM lives on their computer: offline means the cloud
    expect(autoStartTarget({ ...base, wanted: "local_vm", desktopConnected: false })).toEqual({ target: "cloud", wanted: "local_vm", fallback: "offline" });
    // the browser turned off for the bot: their computer instead
    expect(autoStartTarget({ ...base, wanted: "browser", browserAvailable: false })).toEqual({ target: "this_computer", wanted: "browser", fallback: "unavailable" });
  });

  it("starts a routine in the cloud by default; routinesAllowed only permits an explicit computer_select", () => {
    const routine = { ...base, routine: true, personAsked: false };
    // default is cloud even when the Mac is online and routines are allowed
    expect(autoStartTarget(routine)).toEqual({ target: "cloud", wanted: "cloud", fallback: null });
    expect(autoStartTarget({ ...routine, routinesAllowed: true })).toEqual({ target: "cloud", wanted: "cloud", fallback: null });
    // offline before the first turn: never try the computer (default is already cloud)
    expect(autoStartTarget({ ...routine, routinesAllowed: true, desktopConnected: false })).toEqual({ target: "cloud", wanted: "cloud", fallback: null });
    // explicit this_computer with permission, online
    expect(autoStartTarget({ ...routine, routinesAllowed: true, wanted: "this_computer" })).toEqual({
      target: "this_computer", wanted: "this_computer", fallback: null,
    });
    // explicit this_computer with permission, offline: fall back and say so
    expect(autoStartTarget({ ...routine, routinesAllowed: true, wanted: "this_computer", desktopConnected: false })).toEqual({
      target: "cloud", wanted: "this_computer", fallback: "offline",
    });
    // a routine sub-agent sent to the computer without that permission
    expect(autoStartTarget({ ...routine, wanted: "this_computer" })).toEqual({ target: "cloud", wanted: "this_computer", fallback: "routine-not-allowed" });
  });

  it("never reaches a computer nobody asked for", () => {
    expect(autoStartTarget({ ...base, personAsked: false })).toMatchObject({ target: "cloud", fallback: "unavailable" });
  });
});

describe("the thread line", () => {
  it("says the place when it changes, and the fallback once", () => {
    const onComputer = autoStartTarget({ routine: false, personAsked: true, desktopConnected: true, routinesAllowed: false, sandboxConfigured: true, browserAvailable: true });
    expect(autoStartLine(onComputer, null, false)).toEqual({ target: "this_computer" });
    expect(autoStartLine(onComputer, "this_computer", false)).toBeNull();
    const offline = autoStartTarget({ routine: false, personAsked: true, desktopConnected: false, routinesAllowed: false, sandboxConfigured: true, browserAvailable: true });
    expect(autoStartLine(offline, "this_computer", false)).toEqual({ target: "cloud", fallback: { wanted: "this_computer", reason: "offline" } });
    // still offline next turn: nothing new to say
    expect(autoStartLine(offline, "cloud", false)).toBeNull();
    // a sub-agent sent somewhere it cannot go always says so
    expect(autoStartLine(offline, "cloud", true)).not.toBeNull();
  });

  it("round-trips through the stored activity name", () => {
    const line = { target: "cloud" as const, fallback: { wanted: "this_computer" as const, reason: "offline" as const } };
    expect(workspaceLineName(line)).toBe("notice: Workspace: moved to the cloud: your computer is offline");
    expect(parseWorkspaceLine(workspaceLineName(line))).toEqual(line);
    expect(workspaceLineName({ target: "browser" })).toBe("notice: Workspace: In the browser");
    expect(parseWorkspaceLine(workspaceLineName({ target: "local_vm" }))).toEqual({ target: "local_vm" });
    expect(parseWorkspaceLine("notice: something else")).toBeNull();
  });
});
