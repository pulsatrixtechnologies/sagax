// What a bot may do in the signed-in person's name.
// The caller is that person. A route they cannot call is refused.
// Reads and screen changes run now. A write waits for Allow unless this
// turn's mode is Full, or Auto and the write stays in the person's own
// environment (their bots, tasks, routines, plugins). Changing an approval mode,
// answering a card, or calling a /respond route is refused in every mode.
// This module decides. It does not perform.

import { DEVICE_PREFERENCE_KEYS } from "./settings-actions.ts";

const PATH_MAX = 512;
const QUERY_KEYS_MAX = 20;
const QUERY_VALUE_MAX = 200;
const BODY_MAX = 100_000;
const PLUGIN_BOT = /^[\w-]{1,80}$/;
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PLUGIN_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PLUGIN_FIELDS: Record<string, readonly string[]> = {
  list: ["action", "botId"],
  addMarketplace: ["action", "botId", "source", "ref"],
  install: ["action", "botId", "marketplace", "plugin"],
  setEnabled: ["action", "botId", "key", "enabled"],
  uninstall: ["action", "botId", "key"],
  removeMarketplace: ["action", "botId", "marketplace"],
};
const PLUGIN_UNAVAILABLE = "That plugin action is not available.";
const ACTION_MAX = 100_000;
const OBJECT_MAX = 50_000;
const ID_MAX = 200;
const TEXT_MAX = 20_000;
const ARRAY_MAX = 64;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const CALLBACKS = new Set(["onError", "onCreated", "onSettled", "onSent", "onCancelled", "onSaved", "onDeleted"]);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MOTIONS = new Set([
  "arrive", "switch", "customize", "alert", "thinking", "working", "launch",
  "success", "celebrate", "blink", "surprise", "failure",
  "spread-wings", "flap", "take-off", "shake", "hoot",
]);

export type TurnFacts = {
  automation: boolean;
  guest: boolean;
  requestUsable: boolean;
  senderUnproven: boolean;
  provenPerson: string | null;
  sharedServer: boolean;
};

export type TurnActor =
  | { kind: "none"; reason: "automation" | "guest" | "unproven" | "stale" | "shared" }
  | { kind: "person"; personKey: string }
  | { kind: "operator" };

export function actorForTurn(facts: TurnFacts): TurnActor {
  if (facts.automation) return { kind: "none", reason: "automation" };
  if (facts.guest) return { kind: "none", reason: "guest" };
  if (!facts.requestUsable) return { kind: "none", reason: "unproven" };
  if (facts.senderUnproven) return { kind: "none", reason: "stale" };
  if (facts.provenPerson) return { kind: "person", personKey: facts.provenPerson };
  if (facts.sharedServer) return { kind: "none", reason: "shared" };
  return { kind: "operator" };
}

export type UiTarget = {
  kind: "ui";
  command: string;
  input: Record<string, unknown>;
  action: Record<string, unknown>;
  write: boolean;
};

export type RouteTarget = {
  kind: "route";
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type ActTarget = UiTarget | RouteTarget;

export type ActDecision =
  | { ok: false; status: 400 | 403; error: string }
  | { ok: true; effect: "run" | "hold"; summary: string; target: ActTarget };

type ScopeName = "admin" | "client";

/** A screen frame reaches only the streams of the audience it names. */
export function botActFrameAllowed(audience: string, viewerId: string | undefined, localPrincipalId: string): boolean {
  return audience === (viewerId ?? localPrincipalId);
}

export function summaryOf(target: ActTarget): string {
  if (target.kind === "ui") return `Screen: ${target.command}`;
  if (target.kind === "route" && target.method === "POST" && target.path === "/api/nudges") return "Nudge";
  return `${target.method} ${target.path}`;
}

type CommandSpec = { write: boolean; fields: Record<string, string> };

const COMMANDS: Record<string, CommandSpec> = {
  showRoutines: { write: false, fields: { section: "e?:schedule|logs", view: "e?:calendar|list", botId: "s?", routineId: "s?", runStatus: "e?:all|problems|queued|running|waiting|completed|failed|blocked|cancelled|missed" } },
  showTeamMap: { write: false, fields: {} },
  showChat: { write: false, fields: {} },
  select: { write: false, fields: { id: "s" } },
  revealThread: { write: false, fields: { threadId: "s" } },
  toggleSettings: { write: false, fields: { open: "b?", section: "s?", botId: "s?" } },
  openPersonPanel: { write: false, fields: { personId: "n" } },
  openBotActivity: { write: false, fields: { botId: "s", itemId: "s" } },
  togglePlugins: { write: false, fields: { open: "b?", surface: "e?:apps|mcp" } },
  toggleTriggers: { write: false, fields: { open: "b?" } },
  toggleNewBot: { write: false, fields: { open: "b?" } },
  toggleComputer: { write: false, fields: { open: "b?" } },
  toggleInspector: { write: false, fields: { open: "b?" } },
  toggleActivity: { write: false, fields: { open: "b?" } },
  focusMessage: { write: false, fields: { threadId: "s", messageId: "s", matchText: "S?" } },
  toggleAppSettings: { write: false, fields: { open: "b?", section: "s?", subPage: "s?", phonePairing: "b?" } },
  toggleShortcuts: { write: false, fields: { open: "b?" } },
  toggleWelcome: { write: false, fields: { open: "b?" } },
  toggleLaunch: { write: false, fields: { open: "b?", mode: "e?:solo|server" } },
  toggleTour: { write: false, fields: { open: "b?" } },
  loadOlderMessages: { write: false, fields: { threadId: "s" } },
  createRoutine: { write: true, fields: { input: "o" } },
  updateRoutine: { write: true, fields: { routineId: "s", patch: "o" } },
  deleteRoutine: { write: true, fields: { routineId: "s" } },
  runRoutine: { write: true, fields: { routineId: "s" } },
  cancelRoutineRun: { write: true, fields: { runId: "s" } },
  markRoutineRunSeen: { write: true, fields: { runId: "s" } },
  markAllRoutineRunsSeen: { write: true, fields: {} },
  createGroup: { write: true, fields: { memberIds: "a", name: "s?", section: "s?" } },
  openPeopleDm: { write: true, fields: { principalId: "s" } },
  // Same POST /api/nudges the button uses. decideBotAct turns it into that
  // route so the server, not every open window, performs it once.
  nudgePerson: { write: true, fields: { principalId: "s" } },
  nudgeGroup: { write: true, fields: { groupId: "s" } },
  sendGroup: { write: true, fields: { groupId: "s", text: "S", sendId: "s?", replyToId: "s?", threadId: "s?", mode: "e?:chat|goal" } },
  patchGroup: { write: true, fields: { groupId: "s", patch: "o" } },
  deleteGroup: { write: true, fields: { groupId: "s" } },
  newGroupTask: { write: true, fields: { groupId: "s" } },
  switchGroupTask: { write: true, fields: { groupId: "s", threadId: "s" } },
  renameGroupTask: { write: true, fields: { groupId: "s", threadId: "s", title: "S" } },
  pinGroupTask: { write: true, fields: { groupId: "s", threadId: "s", pinned: "b", title: "S" } },
  deleteGroupTask: { write: true, fields: { groupId: "s", threadId: "s" } },
  interruptGroup: { write: true, fields: { groupId: "s", threadId: "s?" } },
  send: { write: true, fields: { botId: "s", text: "S", sendId: "s?", replyToId: "s?", threadId: "s?", voiceCall: "o?", busyMode: "e?:steer|parallel|after" } },
  stopParallelTask: { write: true, fields: { botId: "s", threadId: "s" } },
  cancelQueued: { write: true, fields: { botId: "s", queueId: "s", threadId: "s?" } },
  steerQueued: { write: true, fields: { botId: "s", queueId: "s", threadId: "s?" } },
  cancelGroupQueued: { write: true, fields: { groupId: "s", threadId: "s", queueId: "s" } },
  steerGroupQueued: { write: true, fields: { groupId: "s", queueId: "s", threadId: "s?" } },
  editMessage: { write: true, fields: { botId: "s", messageId: "s", text: "S", threadId: "s?", sendId: "s?" } },
  switchBranch: { write: true, fields: { botId: "s", messageId: "s", threadId: "s?" } },
  answerCard: { write: true, fields: { botId: "s", messageId: "s", answer: "S", threadId: "s?", groupId: "s?" } },
  dismissCard: { write: true, fields: { botId: "s", messageId: "s", threadId: "s?", groupId: "s?" } },
  decideRequest: { write: true, fields: { threadId: "s", requestId: "s", behavior: "e:allow|deny|answer", message: "S?", reviewedSha256: "s?", alwaysAllow: "o?", always: "b?", rememberCommand: "b?" } },
  newTask: { write: true, fields: { botId: "s", projectId: "s?" } },
  switchTask: { write: true, fields: { botId: "s", threadId: "s" } },
  renameTask: { write: true, fields: { botId: "s", threadId: "s", title: "S" } },
  regenerateTaskTitle: { write: true, fields: { botId: "s", threadId: "s" } },
  deleteTask: { write: true, fields: { botId: "s", threadId: "s" } },
  newBot: { write: true, fields: { role: "s?", visibility: "v?", section: "s?", preserveSelection: "b?" } },
  updateTask: { write: true, fields: { botId: "s", threadId: "s", patch: "o" } },
  refreshTaskPermissions: { write: true, fields: { botId: "s", threadId: "s", acknowledgeLocalAuto: "b?" } },
  createProject: { write: true, fields: { botId: "s", name: "S", emoji: "z?" } },
  updateProject: { write: true, fields: { botId: "s", projectId: "s", patch: "o" } },
  deleteProject: { write: true, fields: { botId: "s", projectId: "s" } },
  reorderProjects: { write: true, fields: { botId: "s", projectIds: "a" } },
  deleteBot: { write: true, fields: { botId: "s" } },
  duplicateBot: { write: true, fields: { botId: "s" } },
  markUnread: { write: true, fields: { botId: "s" } },
  playMascotMotion: { write: true, fields: { botId: "s", kind: "m" } },
  setModel: { write: true, fields: { botId: "s", selection: "o", threadId: "s?", updateBotDefault: "b?" } },
  interrupt: { write: true, fields: { botId: "s", threadId: "s?" } },
  updateBot: { write: true, fields: { botId: "s", patch: "o" } },
  // a preference kept on the person's device (sagax_settings): only the
  // keys the settings registry names (DEVICE_PREFERENCE_KEYS)
  setPreference: { write: true, fields: { key: "s", value: "S" } },
};

/** Screen or button the desktop app already dispatches. Unknown names and
 * internal frames are null, which the route refuses. Callbacks are dropped. */
export function uiCommandToAction(ui: string, input: unknown): { action: Record<string, unknown>; write: boolean; input: Record<string, unknown> } | null {
  const spec = COMMANDS[ui];
  if (!spec) return null;
  if (input === undefined) input = {};
  if (!plainObject(input) || hasBadKey(input)) return null;
  const source = input as Record<string, unknown>;
  const action: Record<string, unknown> = { type: ui };
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (CALLBACKS.has(key)) continue;
    if (!(key in spec.fields)) return null;
  }
  for (const [key, code] of Object.entries(spec.fields)) {
    if (!(key in source)) {
      if (!code.includes("?")) return null;
      continue;
    }
    const value = accept(code, source[key]);
    if (value === INVALID) return null;
    action[key] = value;
    kept[key] = value;
  }
  if (ui === "playMascotMotion" && !MOTIONS.has(String(action.kind))) return null;
  if (ui === "setPreference" && !DEVICE_PREFERENCE_KEYS.has(String(action.key))) return null;
  let encoded: string;
  try {
    encoded = JSON.stringify(action);
  } catch {
    return null;
  }
  if (encoded.length > ACTION_MAX) return null;
  return { action, write: spec.write, input: kept };
}

const INVALID = Symbol("invalid");

function accept(code: string, value: unknown): unknown {
  const kind = code.replace("?", "");
  if (kind === "s" || kind === "S") {
    const max = kind === "S" ? TEXT_MAX : ID_MAX;
    if (typeof value !== "string" || value.length < 1 || value.length > max) return INVALID;
    return value;
  }
  if (kind === "b") return typeof value === "boolean" ? value : INVALID;
  if (kind.startsWith("e:")) {
    const allowed = kind.slice(2).split("|");
    return typeof value === "string" && allowed.includes(value) ? value : INVALID;
  }
  if (kind === "a") {
    if (!Array.isArray(value) || value.length > ARRAY_MAX) return INVALID;
    if (value.some((item) => typeof item !== "string" || item.length < 1 || item.length > ID_MAX)) return INVALID;
    return [...value];
  }
  if (kind === "o") {
    if (!plainObject(value)) return INVALID;
    return cloneJson(value, OBJECT_MAX);
  }
  if (kind === "n") {
    if (value === null) return null;
    if (typeof value !== "string" || value.length < 1 || value.length > ID_MAX) return INVALID;
    return value;
  }
  if (kind === "z") {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 32) return INVALID;
    return value;
  }
  if (kind === "v") {
    if (typeof value === "string") return value.length > 0 && value.length <= ID_MAX ? value : INVALID;
    if (!plainObject(value)) return INVALID;
    return cloneJson(value, OBJECT_MAX);
  }
  if (kind === "m") return typeof value === "string" && MOTIONS.has(value) ? value : INVALID;
  return INVALID;
}

function cloneJson(value: unknown, max: number): unknown {
  if (!plainObject(value) && !Array.isArray(value)) return INVALID;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > max) return INVALID;
    return JSON.parse(encoded) as unknown;
  } catch {
    return INVALID;
  }
}

export function decideBotAct(input: {
  raw: unknown;
  mode: "ask" | "edits" | "auto" | "full" | "custom" | undefined;
  scopes: readonly string[];
  neededScope: (method: string, path: string) => ScopeName;
}): ActDecision {
  const parsed = parseActTarget(input.raw);
  if (!parsed.ok) return parsed;
  const target = nudgeActRoute(parsed.target);
  if (target.kind === "route") {
    const needed = input.neededScope(target.method, target.path);
    if (!input.scopes.includes(needed)) {
      return { ok: false, status: 403, error: "This person cannot call that route." };
    }
  } else if (!input.scopes.includes("admin") && !input.scopes.includes("client")) {
    return { ok: false, status: 403, error: "This person cannot call that route." };
  }
  // a device preference is set by sagax_settings only, with its own classes
  if (target.kind === "ui" && target.command === "setPreference") {
    return { ok: false, status: 403, error: "Use sagax_settings to change a preference." };
  }
  // #1545: the device channel is sagax_settings' own (its policy, its card),
  // and an app's answer is never a bot's to give
  if (target.kind === "route" && (target.path === "/api/me/device-settings" || target.path.startsWith("/api/me/device-settings/"))) {
    return { ok: false, status: 403, error: "Use sagax_settings to read or change a setting kept on the person's device." };
  }
  if (escalatesApproval(target)) {
    return { ok: false, status: 403, error: "act does not change approval levels, rules or grants, nor answer a card: use sagax_settings (bot.approvalMode, rules.*), which asks the person when it must." };
  }
  const write = target.kind === "route" ? target.method !== "GET" && target.method !== "HEAD" : target.write;
  // Full runs an ordinary write. Auto runs a write that stays in the
  // person's own environment (their bots, tasks, projects, routines,
  // plugins): the routes still check the bot is theirs, so another
  // person's bot is refused there. A write that reaches other people
  // (groups, DMs, nudges, sharing, admin routes) still waits in Auto. A
  // write that widens who gets a bot's team-memory cards waits at every
  // level, as sagax_settings' bot.teamMemorySharing does.
  const unattended = (input.mode === "full" || (input.mode === "auto" && staysInOwnEnvironment(target))) && !widensTeamMemorySharing(target);
  return {
    ok: true,
    effect: write && !unattended ? "hold" : "run",
    summary: summaryOf(target),
    target,
  };
}

/** Screen writes on the person's own bots, tasks, projects and routines. */
const OWN_UI_WRITES = new Set([
  "createRoutine", "updateRoutine", "deleteRoutine", "runRoutine", "cancelRoutineRun", "markRoutineRunSeen", "markAllRoutineRunsSeen",
  "send", "stopParallelTask", "cancelQueued", "steerQueued", "editMessage", "switchBranch", "dismissCard",
  "newTask", "switchTask", "renameTask", "regenerateTaskTitle", "deleteTask", "updateTask",
  "createProject", "updateProject", "deleteProject", "reorderProjects",
  "newBot", "deleteBot", "duplicateBot", "markUnread", "playMascotMotion", "setModel", "interrupt", "updateBot",
]);
/** Routes on the person's own bots and routines. The route itself refuses
 * a bot that is not theirs. Credentials (vault cards) and a third-party
 * workspace link stay held. */
const OWN_ROUTE = /^\/api\/(?:bots|routines|routine-runs)(?:\/|$)/;
const OWN_ROUTE_HELD = /\/(?:vault-cards|slack-management)(?:\/|$)/;

/** A write Auto runs without a card: it stays in the person's environment
 * and does not change who else sees a bot. */
function staysInOwnEnvironment(target: ActTarget): boolean {
  if (target.kind === "ui") {
    if (!OWN_UI_WRITES.has(target.command)) return false;
    return !setsKey(target.input, "visibility");
  }
  const path = target.path.split("?")[0] ?? target.path;
  if (!OWN_ROUTE.test(path) || OWN_ROUTE_HELD.test(path)) return false;
  return !setsKey(target.query, "visibility") && !setsKey(target.body, "visibility");
}

function setsKey(value: unknown, name: string, depth = 0): boolean {
  if (value === null || typeof value !== "object") return false;
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => setsKey(item, name, depth + 1));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === name) return true;
    if (setsKey(child, name, depth + 1)) return true;
  }
  return false;
}

/** A write that sets a bot's team memory sharing to anything but "private"
 * (back to "shared" reaches other people). Narrowing to "private" is an
 * ordinary write. */
function widensTeamMemorySharing(target: ActTarget): boolean {
  const records = target.kind === "ui" ? [target.input] : [target.query, target.body];
  return records.some((record) => setsWiderSharing(record));
}

function setsWiderSharing(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== "object") return false;
  // deeper than the check reads: held, never assumed clean
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => setsWiderSharing(item, depth + 1));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "teamMemorySharing" && child !== "private") return true;
    if (setsWiderSharing(child, depth + 1)) return true;
  }
  return false;
}

const ESCALATION_KEYS = new Set(["approvalMode", "confirmFullAccess", "autoApprove", "alwaysAllow", "stepUp", "refreshPermissions"]);
/** Screen commands that give a thread its bot's (wider) permissions. */
const ESCALATION_COMMANDS = new Set(["decideRequest", "answerCard", "refreshTaskPermissions"]);

/** Routes that widen what runs without asking, or touch the person's
 * security keys (2026-10-16): standing grants, saved commands, rules,
 * permission modes, tool grants. A bot acting for its person never calls
 * them, whatever the method. */
const ESCALATION_PATH = /\/(?:always-allow|command-allowlist(?:\/.*)?|permission-mode|tool-grants(?:\/.*)?)$|^\/api\/(?:security-keys|custom-rules|approval-rules)(?:\/|$)/;

/** A card answer, a permission decision, a /respond route, a route that
 * widens approvals, or any approvalMode / confirmFullAccess / alwaysAllow /
 * autoApprove / stepUp field. Refused, not held: holding it would still let
 * Allow on this thread raise a sibling to Full. */
function escalatesApproval(target: ActTarget): boolean {
  if (target.kind === "ui") {
    if (ESCALATION_COMMANDS.has(target.command)) return true;
    return recordHasEscalation(target.input);
  }
  if (target.path.endsWith("/respond")) return true;
  // the Approvals screen's bulk answer is a person's tap, never a bot's
  if (/^\/api\/approvals\/bulk(?:[?/]|$)/.test(target.path)) return true;
  if (ESCALATION_PATH.test(target.path.split("?")[0] ?? target.path)) return true;
  return recordHasEscalation(target.query) || recordHasEscalation(target.body);
}

function recordHasEscalation(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== "object") return false;
  // deeper than the check reads: refused, never assumed clean
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => recordHasEscalation(item, depth + 1));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (ESCALATION_KEYS.has(key)) return true;
    if (recordHasEscalation(child, depth + 1)) return true;
  }
  return false;
}

/** The nudge button's catalog name is one server call, not a screen
 * broadcast. Every open window would otherwise post, and only the first
 * would pass the cooldown. */
function nudgeActRoute(target: ActTarget): ActTarget {
  if (target.kind !== "ui") return target;
  if (target.command === "nudgePerson") {
    const principalId = target.input.principalId;
    if (typeof principalId !== "string" || principalId.length < 1) return target;
    return { kind: "route", method: "POST", path: "/api/nudges", body: { principalId } };
  }
  if (target.command === "nudgeGroup") {
    const groupId = target.input.groupId;
    if (typeof groupId !== "string" || groupId.length < 1) return target;
    return { kind: "route", method: "POST", path: "/api/nudges", body: { groupId } };
  }
  return target;
}

function pluginFail(): { ok: false; status: 400; error: string } {
  return { ok: false, status: 400, error: PLUGIN_UNAVAILABLE };
}

/** Plugin writes and reads are the existing plugin routes. The route stays
 * the permission check. A missing botId is filled by the server before this. */
function parsePluginAct(value: unknown): { ok: true; target: ActTarget } | { ok: false; status: 400; error: string } {
  if (!plainObject(value)) return pluginFail();
  const record = value;
  const action = record.action;
  if (typeof action !== "string" || !PLUGIN_FIELDS[action]) return pluginFail();
  for (const key of Object.keys(record)) {
    if (!PLUGIN_FIELDS[action]!.includes(key)) return pluginFail();
  }
  const botId = record.botId;
  if (typeof botId !== "string" || !PLUGIN_BOT.test(botId)) return pluginFail();
  const base = `/api/bots/${botId}/plugins`;
  if (action === "list") return { ok: true, target: { kind: "route", method: "GET", path: base } };
  if (action === "addMarketplace") {
    const source = record.source;
    if (typeof source !== "string" || source.length < 1 || source.length > 500) return pluginFail();
    const body: Record<string, string> = { source };
    if (record.ref !== undefined) {
      if (typeof record.ref !== "string" || record.ref.length < 1 || record.ref.length > 200) return pluginFail();
      body.ref = record.ref;
    }
    return { ok: true, target: { kind: "route", method: "POST", path: `${base}/marketplaces`, body } };
  }
  if (action === "install") {
    if (typeof record.marketplace !== "string" || !PLUGIN_NAME.test(record.marketplace)) return pluginFail();
    if (typeof record.plugin !== "string" || !PLUGIN_NAME.test(record.plugin)) return pluginFail();
    return { ok: true, target: { kind: "route", method: "POST", path: `${base}/install`, body: { marketplace: record.marketplace, plugin: record.plugin } } };
  }
  if (action === "setEnabled") {
    if (typeof record.key !== "string" || !PLUGIN_KEY.test(record.key)) return pluginFail();
    if (typeof record.enabled !== "boolean") return pluginFail();
    return { ok: true, target: { kind: "route", method: "PATCH", path: `${base}/${record.key}`, body: { enabled: record.enabled } } };
  }
  if (action === "uninstall") {
    if (typeof record.key !== "string" || !PLUGIN_KEY.test(record.key)) return pluginFail();
    return { ok: true, target: { kind: "route", method: "DELETE", path: `${base}/${record.key}` } };
  }
  if (typeof record.marketplace !== "string" || !PLUGIN_NAME.test(record.marketplace)) return pluginFail();
  return { ok: true, target: { kind: "route", method: "DELETE", path: `${base}/marketplaces/${record.marketplace}` } };
}

function parseActTarget(raw: unknown): { ok: true; target: ActTarget } | { ok: false; status: 400; error: string } {
  if (!plainObject(raw) || hasBadKey(raw)) return { ok: false, status: 400, error: "Send either ui and input, or method and path." };
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.plugins !== undefined) {
    if (keys.some((key) => key !== "plugins")) {
      return { ok: false, status: 400, error: "plugins cannot be combined with ui, method, path, query or body." };
    }
    return parsePluginAct(record.plugins);
  }
  for (const key of keys) {
    if (!["ui", "input", "method", "path", "query", "body"].includes(key)) {
      return { ok: false, status: 400, error: "Send either ui and input, or method and path." };
    }
  }
  const hasUi = record.ui !== undefined;
  const hasRoute = record.method !== undefined || record.path !== undefined || record.query !== undefined || record.body !== undefined;
  if (hasUi === hasRoute) return { ok: false, status: 400, error: hasUi ? "ui cannot be combined with method, path, query or body." : "Send either ui and input, or method and path." };
  if (hasUi) {
    if (typeof record.ui !== "string" || record.ui.length < 1 || record.ui.length > 64) {
      return { ok: false, status: 400, error: "That screen action is not available." };
    }
    const built = uiCommandToAction(record.ui, record.input);
    if (!built) return { ok: false, status: 400, error: "That screen action is not available." };
    return { ok: true, target: { kind: "ui", command: record.ui, input: built.input, action: built.action, write: built.write } };
  }
  if (typeof record.method !== "string" || typeof record.path !== "string") {
    return { ok: false, status: 400, error: "Send either ui and input, or method and path." };
  }
  const method = record.method.toUpperCase();
  if (!METHODS.has(method)) return { ok: false, status: 400, error: "method must be GET, POST, PUT, PATCH, DELETE or HEAD." };
  if (!acceptablePath(record.path)) return { ok: false, status: 400, error: "That path is not available." };
  if ((method === "GET" || method === "HEAD") && record.body !== undefined) {
    return { ok: false, status: 400, error: "A read cannot carry a body." };
  }
  let query: Record<string, string> | undefined;
  if (record.query !== undefined) {
    const parsed = parseQuery(record.query);
    if (!parsed.ok) return parsed;
    query = parsed.query;
  }
  let body: unknown;
  if (record.body !== undefined) {
    if (!plainJson(record.body)) return { ok: false, status: 400, error: "The body must be a JSON object or a list." };
    let encoded: string;
    try {
      encoded = JSON.stringify(record.body);
      body = JSON.parse(encoded) as unknown;
    } catch {
      return { ok: false, status: 400, error: "The body must be a JSON object or a list." };
    }
    if (encoded.length > BODY_MAX) return { ok: false, status: 400, error: "The body is too large." };
  }
  return { ok: true, target: { kind: "route", method, path: record.path, ...(query ? { query } : {}), ...(body !== undefined ? { body } : {}) } };
}

/** The same path the server routes, under /api, never internal or testing. */
export function acceptablePath(path: string): boolean {
  if (path.length < 5 || path.length > PATH_MAX) return false;
  if (path.includes("%") || path.includes("?") || path.includes("#") || path.includes("\\") || path.includes("..") || path.includes("//")) return false;
  // 2026-10-16 (security review): the server reads the path through the URL
  // parser, which folds `/./` away (`/api/./custom-rules` is
  // `/api/custom-rules`). The guard reads the same path or none: no `.` or
  // `..` segment, no empty segment, and the parser must leave it unchanged.
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  try {
    if (new URL(path, "http://localhost").pathname !== path) return false;
  } catch {
    return false;
  }
  if (!/^\/api\/[A-Za-z0-9_./~:@+-]*$/.test(path)) return false;
  if (path === "/api/internal" || path.startsWith("/api/internal/")) return false;
  if (path === "/api/testing" || path.startsWith("/api/testing/")) return false;
  return true;
}

function parseQuery(value: unknown): { ok: true; query: Record<string, string> } | { ok: false; status: 400; error: string } {
  if (!plainObject(value)) return { ok: false, status: 400, error: "query values must be short strings." };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > QUERY_KEYS_MAX) return { ok: false, status: 400, error: "query values must be short strings." };
  const query: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[\w.-]{1,64}$/.test(key) || typeof item !== "string" || item.length > QUERY_VALUE_MAX) {
      return { ok: false, status: 400, error: "query values must be short strings." };
    }
    query[key] = item;
  }
  return { ok: true, query };
}

function plainJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item) || plainJson(item));
  if (!plainObject(value)) return false;
  return true;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasBadKey(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasBadKey(item, depth + 1));
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (BAD_KEYS.has(key)) return true;
    if (hasBadKey((value as Record<string, unknown>)[key], depth + 1)) return true;
  }
  return false;
}

/** The turn's bot, when the model omits plugins.botId. A botId already
 * present is left alone, and the route still decides whether this person
 * may change that bot. Does not mutate `raw`. */
export function fillPluginBot(raw: unknown, botId: string): unknown {
  if (!plainObject(raw)) return raw;
  const plugins = raw.plugins;
  if (!plainObject(plugins) || Object.prototype.hasOwnProperty.call(plugins, "botId")) return raw;
  if (!PLUGIN_BOT.test(botId)) return raw;
  return { ...raw, plugins: { ...plugins, botId } };
}
