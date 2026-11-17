// Which tools a bot keeps listed and which it leaves out of its next
// conversations, from how long each went unused (#4527, lot B).
//
// The rule (one module, these numbers only): a tool is left out when, since
// its last use, the bot went
// - LEFT_OUT_PROMPTS prompts spread across at least LEFT_OUT_PROMPT_SESSIONS
//   sessions, or
// - LEFT_OUT_SESSIONS sessions of any length,
// and it is not in the never-pruned set (neverPruned). One use puts it back
// in the kept set. A bot with fewer than EVIDENCE_SESSIONS sessions of
// evidence keeps the listing it had before any use was known. This replaced
// the "20 recorded agents calls, then the 12 most used tools" verdict
// (KNOWN_USE_CALLS, PIN_MIN_USES), which also borrowed the use of the same
// owner's other bots: a bot is now judged on its own use only.
//
// Sessions and prompts. A session is one conversation of the bot until its
// context is folded (a compaction gives it a new session): the id of the
// conversation and of the compaction record in force. A prompt is one turn
// started in it by a person, a routine or a teammate (a warm start is not).
// A call is counted by the journal (server/activity/tool-use-counts.ts) and
// handed here for the conversation's open session (toolKeepCall).
//
// The fold. When a session is replaced (a new compaction in the same
// conversation) or another session of the bot starts, its evidence is
// folded into the streaks: every tool it was offered (the tools already
// known, the ones it used, the ones the turn said it listed through
// toolKeepOffered) either used it (streak back to 0) or not (one more
// session, its prompts added). A conversation that goes on after its fold
// keeps adding prompts and uses, without counting as one more session. A
// tool seen for the first time starts at zero, with its own full window.
//
// Frozen per session. The verdict a session starts with is kept for every
// later turn of that session (toolKeepTurn returns it), even across a
// restart: a kept set that changed mid-conversation would break the
// engine's prompt cache. A change shows at the next conversation or after a
// compaction.
//
// The store: one small file per bot and person,
// `<data>/tool-keep/<sha256(botId)[0:40]>/<sha256(person)[0:40]>.json`, mode
// 0600, written atomically, removed with the bot (forgetToolKeep). It holds
// tool ids and integers only (and hashes of conversation ids for the open
// sessions): never an argument, a result or any text. One person's use is
// never read for another person, even on the same bot.
//
// For lot C (filtering every engine's catalog): toolKeepTurn gives the
// session's frozen verdict (`leftOut`, `evidence`, the compact `pins`),
// computed at the session's first turn; toolKeepOffered
// records what a session really listed, and toolKeepVerdict computes a
// verdict from a state. For lot E (the tool selection card): readToolKeep
// reads the state, bringAllToolsBack empties the streaks.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { stepToolId, toolIdParts } from "../../shared/searched-tool-call.ts";
import { HANG_UP_TOOL_SPEC, SEND_DTMF_TOOL_SPEC, TRANSFER_CALL_TOOL_SPEC } from "../../shared/phone-call-live.ts";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import type { CompactPromptInput } from "../contracts.ts";
import { COMPACT_CORE_AGENT_TOOL_NAMES } from "../drivers/agents-catalog.ts";
import { PHONE_TOOL_NAMES } from "../drivers/agents-tools/phone.ts";
import { PERSPICAX_BRIDGE_PINS } from "../mcp/mcp-gate-search.ts";

/** Unused over this many prompts... */
export const LEFT_OUT_PROMPTS = 10;
/** ...spread across at least this many sessions... */
export const LEFT_OUT_PROMPT_SESSIONS = 2;
/** ...or over this many sessions, however short: left out. */
export const LEFT_OUT_SESSIONS = 5;
/** Sessions of a bot's own evidence before any tool is left out. */
export const EVIDENCE_SESSIONS = 2;
/** A compact prompt lists at most this many used tools of one server whole:
 * a cut of the same verdict, the most recently used first. */
export const PINNED_PER_SERVER_MAX = 12;

const DIR_NAME = "tool-keep";
const VERSION = 1;
/** Bounds of one file: tools known, open sessions, tools of one session. */
const TOOLS_MAX = 2_000;
const OPEN_MAX = 32;
const SESSION_TOOLS_MAX = 1_000;
const SAVE_MS = 5_000;
const KEPT_IN_MEMORY = 4_096;
const THREADS_IN_MEMORY = 8_192;
const ID_KEY = /^[A-Za-z0-9][\w./:-]{0,264}$/;

/** How long a tool has gone unused: sessions and prompts since its last use. */
export interface ToolStreak {
  sessions: number;
  prompts: number;
  /** sessions in which it was used (capped): ranks the compact cut */
  uses: number;
}

/** A session's verdict, frozen for its whole life. */
export interface ToolKeepVerdict {
  /** the bot had EVIDENCE_SESSIONS sessions or more when the session began */
  evidence: boolean;
  /** tools known to the bot and listed, the most recently used first */
  kept: string[];
  /** tools left out, sorted */
  leftOut: string[];
}

/** What a session lists, decided when it starts and kept for its whole
 * life: lot C lists every tool offered but `leftOut`; a compact prompt
 * (Claude Code, Pi on a local model) lists `pins` whole. */
export interface ToolSessionVerdict {
  evidence: boolean;
  leftOut: string[];
  pins: Pick<CompactPromptInput, "agents" | "pinned">;
}

/** One session that has not ended, under a hash of its conversation id. */
export interface OpenToolSession {
  /** hash of the conversation id and its compaction record */
  key: string;
  prompts: number;
  used: string[];
  offered: string[];
  /** 1: a routine run prompted it */
  routine: 0 | 1;
  /** 1: already counted as a session at an earlier fold */
  counted: 0 | 1;
  at: number;
  frozen: ToolSessionVerdict;
}

export interface ToolKeepState {
  v: typeof VERSION;
  /** sessions with a prompt folded so far */
  sessions: number;
  tools: Record<string, ToolStreak>;
  /** every tool a routine run of the bot called: never left out */
  routineTools: string[];
  /** the rule's verdict after the last fold, sorted */
  leftOut: string[];
  /** when the person brought every tool back (epoch ms), or null */
  restoredAt: number | null;
  open: Record<string, OpenToolSession>;
}

/** What one session adds to the never-pruned set. */
export interface ToolKeepContext {
  /** a live call: its call tools are never one search away */
  voiceCall?: boolean;
  /** tools named by the person's tool selection, the turn's prompt, an
   * organization rule: any spelling, read as tool ids */
  named?: Iterable<string>;
}

export const emptyToolKeep = (): ToolKeepState => ({ v: VERSION, sessions: 0, tools: {}, routineTools: [], leftOut: [], restoredAt: null, open: {} });

/** Agents tools that are never left out: the heart of a chat turn
 * (COMPACT_CORE_AGENT_TOOL_NAMES), approvals and cards, the tools that
 * find or run another tool, task list and help. */
const NEVER_PRUNED_AGENT_TOOLS: ReadonlySet<string> = new Set([
  ...COMPACT_CORE_AGENT_TOOL_NAMES,
  "ask_choice", "create_options_card", "sagax_approvals", "request_login", "request_sign_in",
  "search_tools", "describe_tool", "call_tool", "find_tool", "use_tool",
  "shared_computer", "task_list", "sagax_help",
]);
/** Agents tools of a live call. */
const LIVE_CALL_TOOLS: ReadonlySet<string> = new Set([...PHONE_TOOL_NAMES, HANG_UP_TOOL_SPEC.name, SEND_DTMF_TOOL_SPEC.name, TRANSFER_CALL_TOOL_SPEC.name]);
const DIRECTORY_TOOLS: ReadonlySet<string> = new Set(["search_tools", "describe_tool", "call_tool"]);
const BRIDGE_PINNED: ReadonlySet<string> = new Set(PERSPICAX_BRIDGE_PINS.pinned);

/** The tool ids a list of names stands for (any spelling, or an id). */
function idsOf(names: Iterable<string> | undefined): Set<string> {
  const ids = new Set<string>();
  for (const name of names ?? []) {
    const id = stepToolId({ tool: name, title: name });
    if (id) ids.add(id);
  }
  return ids;
}

/** The MCP tools a person chose by name in the bot's tool selection
 * (`mcp:<server>:<tool>` allow lines, shared/tool-scope.ts), as ids. */
export function namedByToolScope(scope: { allow?: readonly string[] } | undefined | null): string[] {
  const named: string[] = [];
  for (const line of scope?.allow ?? []) {
    if (typeof line !== "string" || !line.startsWith("mcp:")) continue;
    const separator = line.indexOf(":", 4);
    const tool = separator > 4 ? line.slice(separator + 1) : "";
    if (tool && tool !== "*" && toolIdParts(`${line.slice(4, separator)}/${tool}`)) named.push(`${line.slice(4, separator)}/${tool}`);
  }
  return named;
}

/** Whether a tool is never left out, whatever its streak. */
export function neverPruned(id: string, routineTools: ReadonlySet<string>, named: ReadonlySet<string>, context: ToolKeepContext = {}): boolean {
  const parts = toolIdParts(id);
  if (!parts) return true;
  if (routineTools.has(id) || named.has(id)) return true;
  const { server, tool } = parts;
  if (tool.startsWith("memory_")) return true;
  if (server === "agents") return NEVER_PRUNED_AGENT_TOOLS.has(tool) || (context.voiceCall === true && LIVE_CALL_TOOLS.has(tool));
  // a connector's own finding tools, and the Perspicax bridge's core
  return DIRECTORY_TOOLS.has(tool) || BRIDGE_PINNED.has(tool) || PERSPICAX_BRIDGE_PINS.pinnedSuffixes.some((suffix) => tool.endsWith(suffix));
}

/** The rule, on one streak. */
export function meetsLeftOutRule(streak: Pick<ToolStreak, "sessions" | "prompts">): boolean {
  return (streak.prompts >= LEFT_OUT_PROMPTS && streak.sessions >= LEFT_OUT_PROMPT_SESSIONS) || streak.sessions >= LEFT_OUT_SESSIONS;
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The verdict a session starting now gets from a state. */
export function toolKeepVerdict(state: ToolKeepState, context: ToolKeepContext = {}): ToolKeepVerdict {
  const evidence = state.sessions >= EVIDENCE_SESSIONS;
  const routine = new Set(state.routineTools);
  const named = idsOf(context.named);
  const leftOut: string[] = [];
  const kept: Array<[string, ToolStreak]> = [];
  for (const [id, streak] of Object.entries(state.tools)) {
    if (evidence && meetsLeftOutRule(streak) && !neverPruned(id, routine, named, context)) leftOut.push(id);
    else kept.push([id, streak]);
  }
  kept.sort(([a, x], [b, y]) => x.sessions - y.sessions || x.prompts - y.prompts || y.uses - x.uses || byName(a, b));
  return { evidence, kept: kept.map(([id]) => id), leftOut: leftOut.sort(byName) };
}

/** One session's evidence folded into the streaks (pure). */
export function foldToolSession(state: ToolKeepState, session: { prompts: number; used: Iterable<string>; offered?: Iterable<string>; routine?: boolean; counted?: boolean }): ToolKeepState {
  if (session.prompts <= 0) return state;
  const used = new Set(session.used);
  const tools: Record<string, ToolStreak> = { ...state.tools };
  const newSession = session.counted ? 0 : 1;
  for (const id of new Set([...Object.keys(tools), ...used, ...(session.offered ?? [])])) {
    const streak = tools[id];
    if (used.has(id)) tools[id] = { sessions: 0, prompts: 0, uses: Math.min((streak?.uses ?? 0) + 1, 1_000_000) };
    // seen for the first time: its own full window from here
    else if (!streak) tools[id] = { sessions: 0, prompts: 0, uses: 0 };
    else tools[id] = { sessions: streak.sessions + newSession, prompts: streak.prompts + session.prompts, uses: streak.uses };
  }
  const ids = Object.keys(tools);
  if (ids.length > TOOLS_MAX) {
    // the longest unused leave the store first
    ids.sort((a, b) => tools[b]!.sessions - tools[a]!.sessions || tools[b]!.prompts - tools[a]!.prompts || byName(a, b));
    for (const id of ids.slice(0, ids.length - TOOLS_MAX)) delete tools[id];
  }
  const routineTools = session.routine ? [...new Set([...state.routineTools, ...used])].sort(byName).slice(0, TOOLS_MAX) : state.routineTools;
  const next: ToolKeepState = { ...state, sessions: Math.min(state.sessions + newSession, 1_000_000), tools, routineTools };
  return { ...next, leftOut: toolKeepVerdict({ ...next, sessions: Math.max(next.sessions, EVIDENCE_SESSIONS) }).leftOut };
}

/** "Bring all back": every streak emptied, nothing left out (pure). */
export function restoreAllTools(state: ToolKeepState, now: number): ToolKeepState {
  return { ...state, tools: {}, leftOut: [], restoredAt: now };
}

/** What a compact prompt lists whole, from a session's verdict: the core
 * once the bot has evidence, and per server the tools it used and kept,
 * the most recently used first, cut to PINNED_PER_SERVER_MAX. */
export function compactPinsOf(verdict: ToolKeepVerdict, state: Pick<ToolKeepState, "tools">): Pick<CompactPromptInput, "agents" | "pinned"> {
  const byServer = new Map<string, string[]>();
  for (const id of verdict.kept) {
    const parts = toolIdParts(id);
    if (!parts || !(state.tools[id]?.uses ?? 0)) continue;
    if (parts.server === "agents" && COMPACT_CORE_AGENT_TOOL_NAMES.has(parts.tool)) continue;
    const list = byServer.get(parts.server) ?? [];
    if (list.length < PINNED_PER_SERVER_MAX) list.push(parts.tool);
    byServer.set(parts.server, list);
  }
  const pinned: Record<string, string[]> = {};
  // the lists ride the prompt: sorted, so the same verdict gives the same bytes
  for (const server of [...byServer.keys()].sort(byName)) if (server !== "agents") pinned[server] = byServer.get(server)!.sort(byName);
  return { agents: { core: verdict.evidence ? "used" : "default", pinned: (byServer.get("agents") ?? []).sort(byName) }, pinned };
}

// ---- the store ----

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 40);
const personKey = (person: string) => person.trim().toLowerCase();
export const toolKeepDir = (): string => join(DATA_DIR, DIR_NAME);
const botDir = (botId: string) => join(toolKeepDir(), hashOf(botId));
const fileOf = (botId: string, person: string) => join(botDir(botId), `${hashOf(personKey(person))}.json`);
const memoryKey = (botId: string, person: string) => `${botId}\u0000${personKey(person)}`;

const states = new Map<string, { botId: string; person: string; state: ToolKeepState }>();
const threads = new Map<string, { botId: string; person: string }>();
const unsaved = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const ids = (value: unknown, max: number): string[] | null =>
  Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string" && ID_KEY.test(entry)) ? value as string[] : null;
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A stored file, checked field by field; anything else is a fresh state. */
function parseStored(text: string): ToolKeepState | null {
  let value: Record<string, unknown>;
  try { value = JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  if (!value || value.v !== VERSION || !count(value.sessions) || !value.tools || typeof value.tools !== "object" || !value.open || typeof value.open !== "object") return null;
  const tools: Record<string, ToolStreak> = {};
  for (const [id, raw] of Object.entries(value.tools as Record<string, unknown>)) {
    const streak = raw as Partial<ToolStreak> | null;
    if (!ID_KEY.test(id) || !streak || !count(streak.sessions) || !count(streak.prompts) || !count(streak.uses)) return null;
    tools[id] = { sessions: streak.sessions, prompts: streak.prompts, uses: streak.uses };
  }
  const open: Record<string, OpenToolSession> = {};
  for (const [hash, raw] of Object.entries(value.open as Record<string, unknown>)) {
    const session = raw as Partial<OpenToolSession> | null;
    const frozen = session?.frozen as OpenToolSession["frozen"] | undefined;
    const used = ids(session?.used, SESSION_TOOLS_MAX);
    const offered = ids(session?.offered, TOOLS_MAX);
    const leftOut = ids(frozen?.leftOut, TOOLS_MAX);
    const pins = parsePins(frozen?.pins);
    if (!/^[0-9a-f]{40}$/.test(hash) || !session || typeof session.key !== "string" || !count(session.prompts) || !count(session.at) || !used || !offered || !leftOut || !pins) return null;
    open[hash] = {
      key: session.key, prompts: session.prompts, used, offered, routine: session.routine === 1 ? 1 : 0, counted: session.counted === 1 ? 1 : 0, at: session.at,
      frozen: { evidence: frozen?.evidence === true, leftOut, pins },
    };
  }
  const routineTools = ids(value.routineTools, TOOLS_MAX);
  const leftOut = ids(value.leftOut, TOOLS_MAX);
  if (!routineTools || !leftOut) return null;
  return { v: VERSION, sessions: value.sessions, tools, routineTools, leftOut, restoredAt: count(value.restoredAt) ? value.restoredAt : null, open };
}

const TOOL_NAME = /^[A-Za-z0-9][\w.:-]{0,199}$/;
const names = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length <= PINNED_PER_SERVER_MAX && value.every((entry) => typeof entry === "string" && TOOL_NAME.test(entry)) ? value as string[] : null;

function parsePins(value: unknown): ToolSessionVerdict["pins"] | null {
  const pins = value as { agents?: { core?: unknown; pinned?: unknown }; pinned?: unknown } | null | undefined;
  const agents = names(pins?.agents?.pinned);
  if (!pins || !agents || (pins.agents?.core !== "used" && pins.agents?.core !== "default") || !pins.pinned || typeof pins.pinned !== "object") return null;
  const pinned: Record<string, string[]> = {};
  for (const [server, list] of Object.entries(pins.pinned as Record<string, unknown>)) {
    const tools = names(list);
    if (!toolIdParts(`${server}/x`) || !tools) return null;
    pinned[server] = tools;
  }
  return { agents: { core: pins.agents.core, pinned: agents }, pinned };
}

function load(botId: string, person: string): ToolKeepState {
  const key = memoryKey(botId, person);
  const held = states.get(key);
  if (held) {
    states.delete(key);
    states.set(key, held);
    return held.state;
  }
  let state: ToolKeepState | null = null;
  try { state = parseStored(readFileSync(fileOf(botId, person), "utf8")); } catch { /* none yet */ }
  const entry = { botId, person, state: state ?? emptyToolKeep() };
  states.set(key, entry);
  while (states.size > KEPT_IN_MEMORY) {
    const oldest = states.keys().next().value!;
    if (unsaved.has(oldest)) saveOne(oldest);
    states.delete(oldest);
  }
  return entry.state;
}

function store(botId: string, person: string, state: ToolKeepState): void {
  const key = memoryKey(botId, person);
  states.set(key, { botId, person, state });
  unsaved.add(key);
  if (!saveTimer) {
    saveTimer = setTimeout(saveToolKeep, SAVE_MS);
    saveTimer.unref?.();
  }
}

function saveOne(key: string): void {
  unsaved.delete(key);
  const entry = states.get(key);
  if (!entry) return;
  try {
    mkdirSync(botDir(entry.botId), { recursive: true, mode: 0o700 });
    writeFileAtomic(fileOf(entry.botId, entry.person), JSON.stringify(entry.state), { mode: 0o600, durable: false });
  } catch {
    /* kept in memory; written at the next change */
  }
}

/** Writes the states changed since the last save (on a timer, and at exit). */
export function saveToolKeep(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  for (const key of unsaved) saveOne(key);
}
process.once("exit", saveToolKeep);

/** The open sessions of a state, every one folded, kept open as a
 * continuation (pure). `except`: the one not folded. */
function foldOthers(state: ToolKeepState, except: string): ToolKeepState {
  let next = state;
  for (const [hash, session] of Object.entries(state.open)) {
    if (hash === except || session.prompts <= 0) continue;
    next = foldToolSession(next, { prompts: session.prompts, used: session.used, offered: session.offered, routine: session.routine === 1, counted: session.counted === 1 });
    next = { ...next, open: { ...next.open, [hash]: { ...session, prompts: 0, used: [], routine: 0, counted: 1 } } };
  }
  return next;
}

export interface ToolTurn {
  botId: string;
  /** the person the turn acts for: their own evidence, never another's */
  person: string;
  threadId: string;
  /** the compaction record in force in the conversation, if any */
  compaction?: string | null;
  /** a routine run (its tools are never left out) */
  routine?: boolean;
  /** a turn with a prompt; false for a warm start */
  prompt: boolean;
  /** false: the bot has no routine left, its routine tools are forgotten */
  hasRoutines?: boolean;
  context?: ToolKeepContext;
}

/** A turn starts: its prompt is counted in the conversation's session, a
 * new session folds the others, and the session's frozen verdict comes
 * back (the same for every turn of the session). */
export function toolKeepTurn(turn: ToolTurn): ToolSessionVerdict {
  let state = load(turn.botId, turn.person);
  if (turn.hasRoutines === false && state.routineTools.length) state = { ...state, routineTools: [] };
  const hash = hashOf(turn.threadId);
  const key = hashOf(`${turn.threadId}\u0000${turn.compaction ?? ""}`);
  let open = state.open[hash];
  if (!open || open.key !== key) {
    // the conversation's earlier session ends here; every other one is
    // folded so far, and goes on as a continuation
    state = foldOthers(state, "");
    const verdict = toolKeepVerdict(state, turn.context);
    open = { key, prompts: 0, used: [], offered: [], routine: 0, counted: 0, at: Date.now(), frozen: { evidence: verdict.evidence, leftOut: verdict.leftOut, pins: compactPinsOf(verdict, state) } };
    const others = Object.entries(state.open).filter(([other]) => other !== hash).sort(([, a], [, b]) => b.at - a.at).slice(0, OPEN_MAX - 1);
    state = { ...state, open: { ...Object.fromEntries(others), [hash]: open } };
  }
  if (turn.prompt) {
    open = { ...open, prompts: open.prompts + 1, at: Date.now(), ...(turn.routine ? { routine: 1 as const } : {}) };
    state = { ...state, open: { ...state.open, [hash]: open } };
  }
  store(turn.botId, turn.person, state);
  threads.delete(turn.threadId);
  threads.set(turn.threadId, { botId: turn.botId, person: turn.person });
  while (threads.size > THREADS_IN_MEMORY) threads.delete(threads.keys().next().value!);
  return structuredClone(open.frozen);
}

function updateOpen(threadId: string, change: (session: OpenToolSession) => OpenToolSession | null): void {
  const owner = threads.get(threadId);
  if (!owner) return;
  const state = load(owner.botId, owner.person);
  const hash = hashOf(threadId);
  const open = state.open[hash];
  if (!open) return;
  const next = change(open);
  if (next) store(owner.botId, owner.person, { ...state, open: { ...state.open, [hash]: next } });
}

/** A live call in a conversation: a use in its open session. */
export function toolKeepCall(threadId: string, toolId: string): void {
  if (!ID_KEY.test(toolId)) return;
  updateOpen(threadId, (open) => open.used.includes(toolId) || open.used.length >= SESSION_TOOLS_MAX ? null : { ...open, used: [...open.used, toolId] });
}

/** Lot C: the tools a session really listed (ids), so the fold counts a
 * tool never called in it as unused. */
export function toolKeepOffered(threadId: string, offered: Iterable<string>): void {
  const list = [...idsOf(offered)].sort(byName).slice(0, TOOLS_MAX);
  updateOpen(threadId, (open) => ({ ...open, offered: list }));
}

/** Lot E: the person's state for one bot (read only). */
export function readToolKeep(botId: string, person: string): ToolKeepState {
  return load(botId, person);
}

/** Lot E: "Bring all back" for one bot and person. */
export function bringAllToolsBack(botId: string, person: string): void {
  store(botId, person, restoreAllTools(load(botId, person), Date.now()));
}

/** A deleted bot: its files and memory go with it. */
export function forgetToolKeep(botId: string): void {
  for (const [key, entry] of states) {
    if (entry.botId !== botId) continue;
    states.delete(key);
    unsaved.delete(key);
  }
  for (const [threadId, owner] of threads) if (owner.botId === botId) threads.delete(threadId);
  try { rmSync(botDir(botId), { recursive: true, force: true }); } catch { /* left for the next delete */ }
}

/** Tests: what a restart forgets (the files stay). */
export function forgetToolKeepInMemory(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  unsaved.clear();
  states.clear();
  threads.clear();
}
