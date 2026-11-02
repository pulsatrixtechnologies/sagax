// Where a bot works when its Works on is Auto (organization mode): the bot
// itself picks the computer per task or step with `computer_select`, served
// as the "sagax-computer" tool server (server/user-sandbox-proxy.ts). Pure:
// the server keeps the state per turn (TurnWorkplace.auto in index.ts) and
// asks this module what is allowed. Tests: server/auto-computer.test.ts.
//
//   cloud          the person's server environment (sagax-environment)
//   this_computer  their own computer through their Sagax desktop app
//                  (sagax-desktop: shell, files, apps, network, screen)
//   local_vm       the Local VM on their computer (sagax-desktop local_vm)
//   browser        the built-in browser only, for pure web work
//
// Where an Auto turn starts (autoStartTarget, 2026-10-15; routines 2026-11-01):
// a person-asked turn prefers their own computer when it is connected, else
// the cloud. A routine starts in the cloud by default; routinesAllowed only
// lets computer_select choose this_computer (or local_vm) explicitly. A
// thread opened with a workspace (start_thread, create_agent) starts there
// when it is allowed, else falls back and says so.
//
// A fixed Works on (Cloud, Local VM, This computer, Browser, Off) stays
// fixed: the tool only reports it. Nothing here widens what a turn may
// reach: the desktop bridge, the person's consent for a Local VM, host tools
// withheld, private threads and payer rules are unchanged.

import type { SelectedComputer } from "../shared/execution-target.ts";
import type { WorkspaceFallbackReason, WorkspaceLine } from "../shared/workspace-line.ts";

/** The MCP server computer_select is mounted under. */
export const AUTO_COMPUTER_MCP_NAME = "sagax-computer";

export type AutoComputerTarget = SelectedComputer;
export const AUTO_COMPUTER_TARGETS: readonly AutoComputerTarget[] = ["this_computer", "browser", "cloud", "local_vm"];

/** The fixed Works on of a turn, when it is not Auto. */
export type FixedWorksOn = "cloud" | "vm" | "local" | "browser" | "off";

export interface AutoComputerState {
  /** Works on is Auto for this turn (bot setting, or the thread's override). */
  auto: boolean;
  /** The fixed setting when not Auto. */
  fixed?: FixedWorksOn;
  /** Where the next tool call runs; null before anything was chosen. */
  selected: AutoComputerTarget | null;
  /** The turn belongs to a routine (runs as the bot owner, unattended). */
  routine: boolean;
  /** The person's server environment is configured on this server. */
  sandboxConfigured: boolean;
  /** The desktop tools (sagax-desktop) were mounted for this turn. */
  desktopMounted: boolean;
  /** Routines may use the owner's computer (their own preference). */
  routinesAllowed: boolean;
  /** The built-in browser is mounted for this turn (absent: it is not). */
  browserAvailable?: boolean;
}

export interface AutoComputerSelection {
  ok: boolean;
  /** The text the tool answers with (the bot can relay it). */
  text: string;
  /** The new selection when ok. */
  target?: AutoComputerTarget;
  /** The previous selection, when it changed. */
  from?: AutoComputerTarget | null;
  /** True when the selection actually changed (audit only then). */
  changed?: boolean;
}

const FIXED_LABEL: Record<FixedWorksOn, string> = {
  cloud: "Cloud (server environment)",
  vm: "Local VM",
  local: "This computer",
  browser: "Browser",
  off: "Off",
};

export function autoComputerLabel(target: AutoComputerTarget): string {
  return target === "cloud" ? "the cloud (their server environment)" : target === "local_vm" ? "the Local VM on their computer"
    : target === "browser" ? "the built-in browser" : "their own computer";
}

/** "cloud", "local_vm", "this_computer" and a few spellings a model may use. */
export function parseAutoComputerTarget(value: unknown): AutoComputerTarget | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "cloud" || key === "server" || key === "server_environment") return "cloud";
  if (key === "this_computer" || key === "local" || key === "computer" || key === "my_computer") return "this_computer";
  if (key === "local_vm" || key === "vm") return "local_vm";
  if (key === "browser" || key === "web" || key === "navigateur") return "browser";
  return null;
}

/** The tool, as tools/list shows it. */
export const COMPUTER_SELECT_TOOL = {
  name: "computer_select",
  description:
    "Choose where your next tool calls run in this turn when this bot's Workspace is Auto: this_computer = the person's own computer through their Sagax desktop app (sagax-desktop tools: their files, apps, local network), browser = the built-in browser only, for pure web work, cloud = the person's server environment (sagax-environment tools), also where work keeps running while they are away, local_vm = the isolated Local VM on their computer (sagax-desktop local_vm tool: shell, and use to see and drive that VM's desktop). Give a short reason. You can switch again mid-task. Call with no target to see where you work now and what is available. A place the person did not allow is refused: say so instead of working elsewhere. A fixed Workspace cannot be changed here.",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["this_computer", "browser", "cloud", "local_vm"], description: "Where the next tool calls run." },
      reason: { type: "string", description: "One short sentence: why this place for this step (shown to the person and kept in the activity log)." },
    },
    additionalProperties: false,
  },
} as const;

/** Why a target cannot be used right now, or null when it can. */
export function autoComputerUnavailable(state: AutoComputerState, target: AutoComputerTarget, desktopConnected: boolean): string | null {
  if (target === "cloud") {
    return state.sandboxConfigured ? null
      : "The server environment (cloud) is not enabled on this server. Tell the person; an administrator can enable it.";
  }
  if (target === "browser") {
    return state.browserAvailable ? null
      : "The built-in browser is not available to this bot in this turn (it is turned off for the bot or the workspace, or this engine cannot use it).";
  }
  if (state.routine && !state.routinesAllowed) {
    return "This is a routine: it uses the owner's computer only when they allowed routines on it (Settings > Computer, Where bots work). It keeps working in the cloud.";
  }
  if (!state.desktopMounted || !desktopConnected) {
    return "The person's computer is not connected: their Sagax desktop app is closed or signed out. Ask them to open it, signed in to this server, then send the request again; or work in the cloud.";
  }
  return null;
}

/** What computer_select answers, and the new selection. */
export function selectAutoComputer(
  state: AutoComputerState,
  request: { target?: unknown; reason?: unknown },
  desktopConnected: boolean,
): AutoComputerSelection {
  if (!state.auto) {
    // Asking for the place it is fixed to is not a refusal: the bot already
    // works there (a cloud-only bot asking for the cloud, server/cloud-only-bots.ts).
    if (state.fixed === "cloud" && parseAutoComputerTarget(request.target) === "cloud") {
      return { ok: true, text: "You already work on the cloud (their server environment); this bot's Workspace is fixed there. Use the sagax-environment tools.", target: "cloud", from: "cloud", changed: false };
    }
    const fixed = FIXED_LABEL[state.fixed ?? "off"];
    return { ok: false, text: `This bot's Workspace is fixed to ${fixed}, so you cannot switch computers. Only the person can change it (the bot's Computer tab, or the composer's computer menu for this conversation, set to Auto).` };
  }
  const available = AUTO_COMPUTER_TARGETS.filter((target) => autoComputerUnavailable(state, target, desktopConnected) === null);
  const now = state.selected ? autoComputerLabel(state.selected) : "nowhere yet";
  if (request.target === undefined || request.target === null || request.target === "") {
    return { ok: true, text: `You work on ${now}. Available now: ${available.join(", ") || "none"}.` };
  }
  const target = parseAutoComputerTarget(request.target);
  if (!target) return { ok: false, text: "target must be this_computer, browser, cloud or local_vm." };
  const unavailable = autoComputerUnavailable(state, target, desktopConnected);
  if (unavailable) return { ok: false, text: `${unavailable} You still work on ${now}.` };
  const tools = target === "cloud" ? "Use the sagax-environment tools."
    : target === "local_vm" ? "Use the sagax-desktop local_vm tool (status, start, run, and use to see and drive the VM desktop; create asks the person on their computer first)."
    : target === "browser" ? "Use the built-in browser tools; the shell and file tools are not in use."
    : "Use the sagax-desktop tools.";
  if (state.selected === target) return { ok: true, text: `You already work on ${autoComputerLabel(target)}. ${tools}`, target, from: target, changed: false };
  return { ok: true, text: `Now working on ${autoComputerLabel(target)}. ${tools}`, target, from: state.selected, changed: true };
}

/** A short reason for the audit: one line, at most 200 characters. */
export function autoComputerReason(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** Whether one tool call of a proxied server may run under the current Auto
 * selection: null when it may, else the text the tool answers with. */
export function autoComputerToolRefusal(
  selected: AutoComputerTarget | null,
  server: "sagax-environment" | "sagax-desktop",
  toolName: string,
): string | null {
  if (selected === "browser") {
    return "You chose the built-in browser for this step, so the shell, file and desktop tools are not in use. Use the browser tools, or call computer_select with target this_computer, cloud or local_vm first.";
  }
  if (server === "sagax-environment") {
    if (selected === "cloud") return null;
    return selected
      ? `You chose to work on ${autoComputerLabel(selected)} in this turn, so the server environment tools are not in use. Use the sagax-desktop tools, or call computer_select with target cloud first.`
      : "Call computer_select with target cloud before using the server environment tools.";
  }
  if (selected === "this_computer") return null;
  if (selected === "local_vm") {
    return toolName === "local_vm" ? null
      : "You chose the Local VM: use the sagax-desktop local_vm tool (status, start, run, create, or use to see and drive its desktop). Call computer_select with target this_computer to work on the person's own machine directly.";
  }
  return selected === "cloud"
    ? "You work in the cloud (the person's server environment) in this turn. Call computer_select with target this_computer or local_vm before using the tools on their computer."
    : "Call computer_select with target this_computer or local_vm before using the tools on the person's computer.";
}

/** The standing rules of an Auto bot (2026-10-15). They ride in the
 * system prompt's volatile "workplace" section (server/system-prompt.ts):
 * a reused engine session gets them once, not appended to every message
 * (2026-10-20 perf parity, round 4: 2,300 characters per message, about
 * 800 tokens written to the cache on every turn of an organization bot).
 * Nothing here changes from one turn to the next; where a turn starts and
 * what it can reach is the per-message line (autoComputerGuidance). */
export const AUTO_COMPUTER_RULES = [
  "This bot's Workspace is Auto: you choose where each task or step runs with the computer_select tool (target this_computer, browser, cloud or local_vm, plus a short reason). Each message's <workplace> line says where that turn starts and what is available now. Your choice holds for the next tool calls of this turn and you can switch again mid-task; each new message starts over from the default (a person-asked turn: the person's computer when it is connected; a routine: the cloud). Routines may call computer_select for this_computer or local_vm only when the owner allowed routines on their computer.",
  "- this_computer: anything on the person's own machine: their files and folders, their apps, their local network and printers, devices plugged in (USB, camera), Docker on their computer, local dev servers (localhost), their VPN.",
  "- browser: pure web work (read a site, search, fill a web form) with the built-in browser, when nothing on their machine is needed.",
  "On this_computer, web lookups (search, read a page, find a video) stay out of sight too: browse, fetch_url or web search, with the result shown in the chat. computer_use acts on the person's own screen in front of them: use it only when they asked for work on their screen or in their own browser, or no out-of-sight way works, and say so in one line first.",
  "- cloud: work that must keep running while the person is away from their computer (a routine, their computer offline or asleep, a long job), and heavy tasks.",
  "- local_vm: isolated or risky work on their machine (try an install, run untrusted code) in the Local VM, including seeing and driving that VM's desktop (local_vm action use); creating one asks them on their computer first.",
  "Sub-agents: start_thread (on yourself) and create_agent take a workspace too, chosen by the same rule: one can run in the cloud while another works on the person's computer or in the Local VM.",
  "computer_select only moves the shell, files and desktop tools (sagax-environment, sagax-desktop). Connector and Sagax tools (ConnectWise, Pulsatrix memory and flow, agents, search, other MCP servers) run on the server wherever you are: they need no computer and no computer_select.",
  "The person's own words win: \"sur mon Mac\", \"sur mon ordinateur\", \"on my computer\", \"localement\", \"locally\" mean this_computer; \"dans une VM\", \"in a VM\" mean local_vm; \"dans le cloud\", \"in the cloud\", \"sur le serveur\", \"on the server\" mean cloud. Call computer_select only when a step needs a place other than the one you are on (not to confirm it). Never work around a refusal: a place they did not allow (their computer for routines, the browser turned off) stays closed; if the place they asked for is unavailable, say why (the tool's answer) instead of quietly working elsewhere. Use computer_select, not select_computer, for this.",
].join("\n");

/** The per-message line of an Auto turn (provider text only): where this
 * turn starts and what it can reach now. The rules are AUTO_COMPUTER_RULES. */
export function autoComputerGuidance(state: AutoComputerState, desktopConnected: boolean): string {
  const available = AUTO_COMPUTER_TARGETS.filter((target) => autoComputerUnavailable(state, target, desktopConnected) === null);
  const start = state.selected ? autoComputerLabel(state.selected) : "no computer";
  return `<workplace>This bot's Workspace is Auto (computer_select; its rules are in the Workspace part of your Sagax context). This turn starts on ${start}; available now: ${available.join(", ") || "none"}.</workplace>`;
}

/** Where one Auto turn starts. */
export interface AutoStart {
  /** The place it starts on; null when nothing at all is available. */
  target: AutoComputerTarget | null;
  /** The place it wanted (the thread's workspace, else the default). */
  wanted: AutoComputerTarget;
  /** Why it could not start where it wanted, or null when it did. */
  fallback: WorkspaceFallbackReason | null;
}

/** Where an Auto turn starts (2026-10-15; routines default 2026-11-01). Pure:
 * tested on its own.
 * - Default: a person-asked turn prefers the person's own computer when
 *   their Sagax app is connected; a routine starts in the cloud. The owner
 *   preference routinesAllowed only permits an explicit computer_select to
 *   this_computer or local_vm (never the default start).
 * - When the person's computer is offline before the first turn, a routine
 *   never tries it: the default is already the cloud.
 * - A thread opened with a workspace (start_thread or create_agent with
 *   `workspace`) wants that place instead.
 * - A place that is not allowed or not available is never used: the turn
 *   falls back (this computer, then the Local VM, the cloud, the browser)
 *   and the reason is kept for the thread line. */
export function autoStartTarget(input: {
  wanted?: AutoComputerTarget | null;
  routine: boolean;
  /** A person's own message started the turn. */
  personAsked: boolean;
  desktopConnected: boolean;
  routinesAllowed: boolean;
  sandboxConfigured: boolean;
  browserAvailable: boolean;
}): AutoStart {
  const desktopUsable = input.desktopConnected && (input.routine ? input.routinesAllowed : input.personAsked);
  const usable = (target: AutoComputerTarget): boolean =>
    target === "cloud" ? input.sandboxConfigured
      : target === "browser" ? input.browserAvailable
      : desktopUsable;
  // Routines start in the cloud (Owner 2026-11-01). An offline computer is
  // never the default for a routine, so the first turn does not try it.
  const defaultTarget: AutoComputerTarget = input.routine ? "cloud" : "this_computer";
  const wanted = input.wanted ?? defaultTarget;
  if (usable(wanted)) return { target: wanted, wanted, fallback: null };
  const order: AutoComputerTarget[] = ["this_computer", "local_vm", "cloud", "browser"];
  const target = order.find((candidate) => candidate !== wanted && usable(candidate)) ?? null;
  let fallback: WorkspaceFallbackReason = "unavailable";
  if (wanted === "this_computer" || wanted === "local_vm") {
    if (input.routine && !input.routinesAllowed) fallback = "routine-not-allowed";
    else if (!input.desktopConnected) fallback = "offline";
  }
  return { target, wanted, fallback };
}

/** The thread line for a turn start, or null when it says nothing new:
 * the place did not change since the thread's last line or switch, and no
 * explicit choice (a thread's workspace) fell back. A default that falls
 * back is said once, when the place changes. */
export function autoStartLine(start: AutoStart, last: AutoComputerTarget | null, explicit: boolean): WorkspaceLine | null {
  if (!start.target) return null;
  if (start.target === last && !(explicit && start.fallback)) return null;
  return start.fallback ? { target: start.target, fallback: { wanted: start.wanted, reason: start.fallback } } : { target: start.target };
}
