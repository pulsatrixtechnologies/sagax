// One line per ACP turn with the server's own stages, so a slow answer can be
// pinned to a stage from the logs alone (docs/grok-latency.md):
//
//   [turn-latency] grok thread=800b207c path=pooled queue=99ms setup=21ms ttfa=1150ms ttft=1150ms tools=1 total=2111ms prompt=1655ch full=no in=18225 cached=16000 ok
//
// queue: the person's message was stored -> the engine took the turn
// (context, recall, place); setup: the engine took it -> the prompt was sent
// (spawn, handshake, session/new|load, mode and model); ttfa: prompt -> the
// first thing the model streamed (thought, text or tool call); ttft: prompt ->
// first answer text; total: the engine took it -> settled. path: pooled (live
// session prompted as is), load (pooled process, session re-established),
// spawn (a new process). Ids, sizes and milliseconds only: never the words.
//
// #3561: queueBy and setupBy name the parts of queue and setup, in ms, from
// the turn's own step marks (server/turns/turn-trace.ts). Each step closes
// the part it names; a part the turn did not reach is left out.
//   queueBy: admit (checks before the turn starts, and #3679 the message's
//   admission and the claim after them), prewarm (a warm being joined),
//   help (#4215: the sagax_help lookup run before the engine for a question
//   about Sagax itself),
//   engines (#3679: the engines' list read once after a start), compact
//   (the fold check), context (selection, soul, skills), mcp (the tool
//   servers' sign-in refresh and probe), connector (the account's connection, and
//   the turn's connectors plan),
//   place (where it runs: workspace, sandbox, the computer, what is left of
//   the stage), mounts (#3619: the person's and the plugins' tool servers),
//   plugins (starting the plugin copy into the person's environment; since
//   #4456 the turn never waits for the copy, which goes on beside it), checkpoint
//   (the project folder's snapshot), browser (the built-in browser), prompt, recall,
//   access (the turn's credentials, a typed command), slot (an engine start
//   slot), send, dispatch (pictures, hand-off to the engine).
//   setupBy: prepare (sign-in check, command, spawn contract), init (process
//   start and handshake), session (session/new or load), model (model and
//   mode), tools (the engine's tool servers answering), prompt (the rest
//   until the prompt is sent).
// #4215: queueBusy, when over 250 ms: how long the server's own main thread
// was busy between the turn's start and its send. Near the queue, the wait
// was Sagax's own work (other turns, a save, the collector); near zero, the
// turn waited on I/O (a read, a sign-in refresh, the person's environment).
// #3598: starts=<count>:<ms>, the process starts the server made from the
// turn's start until the engine took its prompt (every start of the server in
// that window, as queueBusy counts its work) and their total synchronous time
// on the main thread; absent when there was none.
// #3623: toolsBy names the servers the tools part waited for: Sagax's own
// mounts by product name, the person's own connections as one count
// (own:<count>:<longest ms>), pending:<count> when the wait hit its limit.
// Each server's ms is the first poll after the last one where it waited;
// resolved:<ms> is the first poll where the engine said its servers were
// resolved. toolsServed is Sagax's own side of the same wait: when each of
// its endpoints got its first request and answered its tool list.
// toolsSlow names the parts of one of those endpoints whose tool list took
// more than 250 ms from its first request (connector:env:12,open:410,
// hello:230,list:980,kb:85): env (the person's plugin copy), open (the
// stream to the server in the person's environment), hello (the server's
// answer to initialize), list (its answer to tools/list) and kb (that
// answer's size). Mounts are separated by `;`. Names and numbers only.
// toolsGap names the time of the tools part spent outside the mounts'
// answers, each part only when it is over 250 ms: first (the wait's start to
// the first request any of Sagax's endpoints got: the engine starting its
// tool server processes) and after (the last tool list answered, by an
// endpoint or as the engine saw a mount ready, to the engine saying resolved).
// With a gap, busy says how long the server's own main thread was busy during
// the wait, when over 250 ms: near the gap, the time is Sagax's (other turns,
// a spawn, the collector), so its endpoints answered and its polls read late;
// near zero, it is the engine's and its tool server processes'.
// #4394: spawnWhy, on a turn whose path is spawn: why no warm engine took it.
// first (no engine process of this conversation since this server started),
// closed:<why> (Sagax closed its process: idle, warm budget, call ended, stop,
// reestablish...), exited:<code or signal> (the process ended on its own:
// between turns, at the end of the last one, or killed by the system),
// instance (its process runs under another engine of this server), closing (its process was being closed
// when the turn came), contract:<fields> (the process was
// started for another command, variables or tool scope; the fields that
// changed), budget (the warm budget had let it go), tools (the engine's tool
// servers changed on an engine that restarts for that), reset (the person
// started over). fullWhy, on a turn whose prompt carried the whole system
// block (full=yes): new:<why> (a new native session: no-cursor, the
// conversation's session could not be loaded (load-failed, load-timeout,
// load-empty) or was on another model (load-model)), unsent (a session with
// no record of its opening block), stable (the stable half changed) or anchor
// (the periodic re-anchor). The engine's own start and its tool listing are setupBy's
// init and tools; ttfa is the prompt to the first streamed update (the
// model's first token, and whatever the engine does before it), and
// firstWords splits the rest of ttft, up to the first answer text, in ms:
// think (reasoning streamed), tool (a tool running: from its tool_call to
// the update that says it completed or failed, however long it stays
// silent), quiet (any other gap of a second or more between two updates once
// the stream began). Numbers only.
// #4456: ttfc, prompt -> the first tool call (only on a turn that called
// one: the model chose a tool before any words); shown, the person's message
// stored -> the first answer text Sagax streamed to the person (what the
// person waited for words, queue and setup included); sent, on a prompt
// without the whole system block, the ids of the opening block's sections
// that rode it because they changed (nothing else of the block is resent:
// the engine's cache keeps it; `cached` says how much of the input it hit).
// #4394: toolTime is the time after the prompt while at least one tool call
// ran (calls side by side count once), toolsFailed the calls that ended
// failed, and modelTime the rest of the time after the prompt: the engine
// and its model reading, thinking and writing. A browser task of 41 calls in
// 10 minutes reads from the line alone as the browser's time or the model's.

export type TurnLatencyPath = "pooled" | "load" | "spawn";

export interface TurnLatency {
  /** sendTurn took the turn (epoch ms) */
  start: number;
  /** the person's message was stored (epoch ms), when the caller knows it */
  receivedAt?: number;
  path?: TurnLatencyPath;
  promptAt?: number;
  firstActivityAt?: number;
  firstTextAt?: number;
  /** #4456: the first tool call of the prompt (ttfc) */
  firstToolAt?: number;
  /** #4456: the first answer text streamed to the person (shown) */
  shownAt?: number;
  /** #4456: the opening block's sections that rode a prompt without the
   * whole block, because they changed (sent) */
  sent?: string[];
  tools: number;
  promptChars?: number;
  /** the prompt carried the full system block */
  full?: boolean;
  inputTokens?: number;
  cachedTokens?: number;
  /** the stall guard cancelled a silent prompt and asked again */
  stallRetried?: boolean;
  stallMs?: number;
  /** #3623: the engine's tool servers the setup waited for (toolsBy) */
  toolWait?: TurnToolWait;
  /** #4215: the server's main thread busy during the queue, ms (queueBusy) */
  queueBusyMs?: number;
  /** #3598: the process starts during queue and setup and their total
   * synchronous ms (starts) */
  starts?: { count: number; ms: number };
  /** #4394: why the engine's process was started for this turn (spawnWhy) */
  spawnWhy?: string;
  /** #4394: why this turn opened a new native session instead of loading the
   * conversation's own (no-cursor, load-failed, load-timeout, load-model,
   * load-empty) */
  newSessionWhy?: string;
  /** #4394: why the prompt carried the whole system block (fullWhy) */
  fullWhy?: string;
  /** #4394: the stream before the first answer text, ms by what it was
   * doing (firstWords); `last` is the latest update's time and kind */
  beforeText?: { think: number; tool: number; quiet: number; last?: { at: number; kind: "think" | "tool" | "text" }; open?: Set<string> };
  /** #4394: the tool calls running now (toolTime) */
  toolsRunning?: Set<string>;
  /** #4394: when the current stretch with a tool running began */
  toolsBusySince?: number;
  /** #4394: ms after the prompt with at least one tool running */
  toolMs?: number;
  /** #4394: tool calls that ended failed */
  toolsFailed?: number;
}

/** The part of an ACP session update the line reads: which call, and how it ended. */
export interface TurnActivityUpdate {
  toolCallId?: unknown;
  status?: unknown;
}

/** #4394: a gap between two streamed updates that counts as quiet. */
export const STREAM_QUIET_MS = 1_000;

/** #3623: the wait for the engine's tool servers, server by server. */
export interface TurnToolWait {
  /** the whole wait, ms */
  waitedMs: number;
  /** Sagax's own mounts by product name (or kind) and ms, slowest first */
  mounts: Array<[label: string, ms: number]>;
  /** the other servers of the engine's catalog (the person's own
   * connections): how many and the longest, never their names */
  own?: { count: number; longestMs: number };
  /** servers still connecting when the wait ended on its limit */
  pending?: number;
  /** the first poll where the engine said `sessionMcpResolved`, ms */
  resolvedMs?: number;
  /** Sagax's own endpoints during the wait, in order of arrival: the mount,
   * its first request (ms from the wait's start) and its tool list answer */
  served?: Array<[label: string, inMs: number, outMs?: number, parts?: Array<[part: string, ms: number]>]>;
  /** how long the server's own main thread was busy during the wait, ms
   * (event loop utilization): the share of the gap that is Sagax's */
  busyMs?: number;
}

/** A tool list that took longer than this from its first request names its
 * parts (toolsSlow). */
export const TOOLS_SLOW_MS = 250;

/** Sagax's mounts printed at most, slowest first. */
const TOOLS_BY_MOUNTS_MAX = 8;

/** The toolsBy field: `agents:120,browser:340,own:3:2500,pending:1`; nothing
 * for a wait under 50 ms. */
export function turnToolsBy(wait: TurnToolWait | undefined): string | undefined {
  if (!wait || wait.waitedMs < 50) return undefined;
  const out = wait.mounts.slice(0, TOOLS_BY_MOUNTS_MAX).map(([label, ms]) => `${label}:${Math.round(ms)}`);
  if (wait.own) out.push(`own:${wait.own.count}:${Math.round(wait.own.longestMs)}`);
  if (wait.resolvedMs !== undefined) out.push(`resolved:${Math.round(wait.resolvedMs)}`);
  if (wait.pending) out.push(`pending:${wait.pending}`);
  return out.length ? out.join(",") : undefined;
}

/** The toolsServed field: `data:330-360,browser:400-520` in order of
 * arrival, at most eight; a mount with no tool list answer yet prints its
 * arrival only. Nothing for a wait under 50 ms or with no request. */
export function turnToolsServed(wait: TurnToolWait | undefined): string | undefined {
  if (!wait?.served?.length || wait.waitedMs < 50) return undefined;
  return wait.served.slice(0, TOOLS_BY_MOUNTS_MAX)
    .map(([label, inMs, outMs]) => `${label}:${Math.round(inMs)}${outMs === undefined ? "" : `-${Math.round(outMs)}`}`)
    .join(",");
}

/** The toolsSlow field: the parts of each of Sagax's endpoints whose tool
 * list took more than TOOLS_SLOW_MS, `connector:open:410,hello:230,list:980`. */
export function turnToolsSlow(wait: TurnToolWait | undefined): string | undefined {
  const slow = (wait?.served ?? []).filter(([, inMs, outMs, parts]) =>
    outMs !== undefined && outMs - inMs > TOOLS_SLOW_MS && parts?.length);
  if (!slow.length) return undefined;
  return slow.slice(0, TOOLS_BY_MOUNTS_MAX)
    .map(([label, , , parts]) => `${label}:${parts!.map(([part, ms]) => `${part}:${Math.round(ms)}`).join(",")}`)
    .join(";");
}

/** The toolsGap field: `first:2510,after:2800,busy:2300`, each part only when
 * it is over TOOLS_SLOW_MS; nothing when neither first nor after is. */
export function turnToolsGap(wait: TurnToolWait | undefined): string | undefined {
  if (!wait || wait.waitedMs < 50) return undefined;
  const out: string[] = [];
  const served = wait.served ?? [];
  if (served.length) {
    const first = Math.min(...served.map(([, inMs]) => inMs));
    if (first > TOOLS_SLOW_MS) out.push(`first:${Math.round(first)}`);
  }
  if (wait.resolvedMs !== undefined) {
    const answers = [
      ...served.flatMap(([, , outMs]) => (outMs === undefined ? [] : [outMs])),
      ...wait.mounts.map(([, ms]) => ms),
      ...(wait.own ? [wait.own.longestMs] : []),
    ];
    if (answers.length) {
      const after = wait.resolvedMs - Math.max(...answers);
      if (after > TOOLS_SLOW_MS) out.push(`after:${Math.round(after)}`);
    }
  }
  if (out.length && wait.busyMs !== undefined && wait.busyMs > TOOLS_SLOW_MS) out.push(`busy:${Math.round(wait.busyMs)}`);
  return out.length ? out.join(",") : undefined;
}

export function newTurnLatency(start: number, receivedAt?: number): TurnLatency {
  return { start, tools: 0, ...(typeof receivedAt === "number" && Number.isFinite(receivedAt) && receivedAt > 0 && receivedAt <= start ? { receivedAt } : {}) };
}

/** Record a streamed update of the running prompt. `update`: the update's
 * tool call id and status, which open and close a running tool (firstWords,
 * toolTime). */
export function noteTurnActivity(trace: TurnLatency | undefined, kind: string, at: number, update?: TurnActivityUpdate): void {
  if (!trace || trace.promptAt === undefined) return;
  const callId = typeof update?.toolCallId === "string" && update.toolCallId ? update.toolCallId : undefined;
  // #4394: a tool's progress closes the time it ran (firstWords, toolTime),
  // and is not an activity of its own
  if (kind === "tool_call_update") {
    noteBeforeText(trace, "tool", at);
    noteToolState(trace, update, false);
    if (callId && (update?.status === "completed" || update?.status === "failed")) toolEnded(trace, callId, update.status === "failed", at);
    return;
  }
  if (kind !== "agent_message_chunk" && kind !== "agent_thought_chunk" && kind !== "tool_call") return;
  noteBeforeText(trace, kind === "agent_message_chunk" ? "text" : kind === "tool_call" ? "tool" : "think", at);
  if (kind === "tool_call") noteToolState(trace, update, true);
  trace.firstActivityAt ??= at;
  if (kind === "agent_message_chunk") trace.firstTextAt ??= at;
  if (kind === "tool_call") {
    trace.tools += 1;
    trace.firstToolAt ??= at;
    if (callId) {
      const running = (trace.toolsRunning ??= new Set());
      if (!running.size) trace.toolsBusySince = at;
      running.add(callId);
      // a call that starts and ends in one update
      if (update?.status === "completed" || update?.status === "failed") toolEnded(trace, callId, update.status === "failed", at);
    }
  }
}

function toolEnded(trace: TurnLatency, callId: string, failed: boolean, at: number): void {
  const running = trace.toolsRunning;
  if (!running?.delete(callId)) return;
  if (failed) trace.toolsFailed = (trace.toolsFailed ?? 0) + 1;
  if (!running.size && trace.toolsBusySince !== undefined) {
    trace.toolMs = (trace.toolMs ?? 0) + Math.max(0, at - trace.toolsBusySince);
    trace.toolsBusySince = undefined;
  }
}

/** toolTime, toolsFailed and modelTime at `end`; nothing for a turn with no tracked tool call. */
export function turnToolShare(trace: TurnLatency, end: number): string | undefined {
  if (trace.promptAt === undefined || (trace.toolMs === undefined && !trace.toolsRunning?.size)) return undefined;
  const open = trace.toolsRunning?.size && trace.toolsBusySince !== undefined ? Math.max(0, end - trace.toolsBusySince) : 0;
  const toolMs = Math.round((trace.toolMs ?? 0) + open);
  const modelMs = Math.max(0, Math.round(end - trace.promptAt) - toolMs);
  return `toolTime=${toolMs}ms${trace.toolsFailed ? ` toolsFailed=${trace.toolsFailed}` : ""} modelTime=${modelMs}ms`;
}

/** #4456: answer text of the running prompt reached the person (the driver
 * streamed it after its own filters). */
export function noteTurnShown(trace: TurnLatency | undefined, at: number): void {
  if (!trace || trace.promptAt === undefined) return;
  trace.shownAt ??= at;
}

/** Sections named at most on the sent field. */
const SENT_SECTIONS_MAX = 12;

/** #4394: a tool call opens until an update of it says completed or failed;
 * one reported already ended opens nothing. A call with no id is one at a
 * time. */
function noteToolState(trace: TurnLatency, update: { toolCallId?: unknown; status?: unknown } | undefined, started: boolean): void {
  if (trace.firstTextAt !== undefined || !trace.beforeText) return;
  const ended = update?.status === "completed" || update?.status === "failed";
  const id = typeof update?.toolCallId === "string" && update.toolCallId ? update.toolCallId : "";
  const open = (trace.beforeText.open ??= new Set());
  if (started && !ended) open.add(id);
  else if (!started && ended) open.delete(id);
}

/** #4394: the time since the previous update, until the first answer text,
 * goes to a tool while one is running (whatever the gap), else to what the
 * stream was doing then, or to quiet past STREAM_QUIET_MS. */
function noteBeforeText(trace: TurnLatency, kind: "think" | "tool" | "text", at: number): void {
  if (trace.firstTextAt !== undefined) return;
  const before = (trace.beforeText ??= { think: 0, tool: 0, quiet: 0 });
  const last = before.last;
  if (last && last.kind !== "text") {
    const gap = Math.max(0, at - last.at);
    if (before.open?.size) before.tool += gap;
    else if (gap >= STREAM_QUIET_MS) before.quiet += gap;
    else before[last.kind] += gap;
  }
  before.last = { at, kind };
}

/** The firstWords field: `think:20100,tool:500,quiet:3000`, each part only
 * when over zero; nothing before the first answer text. The time from the
 * prompt to the first update is the line's own ttfa, never said twice. */
export function turnFirstWords(trace: TurnLatency): string | undefined {
  if (trace.promptAt === undefined || trace.firstTextAt === undefined || trace.firstActivityAt === undefined) return undefined;
  const before = trace.beforeText ?? { think: 0, tool: 0, quiet: 0 };
  const parts: Array<[string, number]> = [
    ["think", before.think], ["tool", before.tool], ["quiet", before.quiet],
  ];
  const out = parts.filter(([, ms]) => Math.round(ms) > 0).map(([part, ms]) => `${part}:${Math.round(ms)}`);
  return out.length ? out.join(",") : undefined;
}

/** #4394: why each conversation's last engine process went, so the next
 * turn's spawn says it (spawnWhy): `closed:<why>` when Sagax closed it,
 * `exited:<code or signal>` when it ended on its own. Ids only, a few words of
 * reason. */
const closedEngines = new Map<string, string>();
/** #4394: the engine instance each conversation last started a process on,
 * so a spawn with no recorded end tells a first start from another engine's. */
const openedEngines = new Map<string, string>();
const CLOSED_ENGINES_MAX = 2_000;

function remember(map: Map<string, string>, threadId: string, value: string): void {
  map.delete(threadId);
  map.set(threadId, value);
  while (map.size > CLOSED_ENGINES_MAX) map.delete(map.keys().next().value!);
}

const reasonWord = (why: string, fallback: string) =>
  why.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || fallback;

export function noteEngineClosed(threadId: string, why: string): void {
  remember(closedEngines, threadId, `closed:${reasonWord(why, "closed")}`);
}

/** The process ended on its own (an exit, a signal, or a start that failed),
 * not by Sagax's close. */
export function noteEngineExited(threadId: string, code: number | null, signal?: NodeJS.Signals | null | "error"): void {
  remember(closedEngines, threadId, `exited:${code !== null ? code : reasonWord(signal ?? "", "unknown")}`);
}

/** A process was started for this conversation on `instanceId`. */
export function noteEngineOpened(threadId: string, instanceId: string): void {
  remember(openedEngines, threadId, instanceId);
}

/** How the conversation's last engine process went (`closed:<why>` or
 * `exited:<code>`), once. */
export function takeEngineClosed(threadId: string): string | undefined {
  const why = closedEngines.get(threadId);
  closedEngines.delete(threadId);
  return why;
}

/** spawnWhy for a turn that found no process of its conversation in its
 * engine's pool: how the last one went, else `first` (no process of this
 * conversation since this server started) or `instance` (its process runs
 * under another engine of this server). */
export function engineGoneWhy(threadId: string, instanceId: string): string {
  const gone = takeEngineClosed(threadId);
  if (gone) return gone;
  const opened = openedEngines.get(threadId);
  return opened === undefined ? "first" : opened !== instanceId ? "instance" : "unrecorded";
}

/** The parts of a spawn contract (turn-prepare-spawn.ts contractKey) that
 * differ between two keys: `envFingerprint+cwd`. */
const CONTRACT_FIELDS = ["person", "bot", "command", "args", "spawnArgs", "cwd", "fullAuto", "envFingerprint", "spawnFingerprint", "toolScope", "inheritedScope"];
export function contractFieldsChanged(before: string, after: string): string {
  try {
    const a = JSON.parse(before) as unknown[];
    const b = JSON.parse(after) as unknown[];
    const parts: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) parts.push(CONTRACT_FIELDS[i] ?? String(i));
    }
    return parts.join("+") || "?";
  } catch {
    return "?";
  }
}

type Mark = readonly [step: string, at: number];

const QUEUE_PARTS = ["admit", "prewarm", "help", "engines", "compact", "context", "mcp", "connector", "place", "mounts", "plugins", "checkpoint", "browser", "prompt", "recall", "access", "slot", "send", "dispatch"] as const;
const QUEUE_STEP: Record<string, (typeof QUEUE_PARTS)[number]> = {
  start: "admit",
  "prewarm-joined": "prewarm",
  // #4215: what ran before the lookup is admission; the lookup closes its own
  "help-start": "admit",
  "help-prefetched": "help",
  // #3679: what ran before the fold check closes its own part
  admitted: "admit",
  "connectors-planned": "connector",
  "engines-read": "engines",
  compacted: "compact",
  "context-selected": "context",
  "soul-drift": "context",
  "skills-selected": "context",
  "mcp-mounted": "mcp",
  integrations: "connector",
  // #3619: the parts of place, each closed by its own step
  "place-workspace": "place",
  "mounts-ready": "mounts",
  "plugins-synced": "plugins",
  "place-computer": "place",
  "checkpoint-taken": "checkpoint",
  "place-browser": "place",
  "browser-ready": "browser",
  "prompt-start": "place",
  "prompt-sections": "prompt",
  "state.prompt-built": "prompt",
  recall: "recall",
  access: "access",
  command: "access",
  "engine-slot": "slot",
  "memory-guard": "slot",
  "routine-memory": "slot",
  send: "send",
};
const SETUP_PARTS = ["prepare", "init", "session", "model", "tools", "prompt"] as const;
const SETUP_STEP: Record<string, (typeof SETUP_PARTS)[number]> = {
  "acp-prepared": "prepare",
  "acp-handshake": "init",
  "acp-session-new": "session",
  "acp-session-loaded": "session",
  "acp-model": "model",
  "acp-mcp-settled": "tools",
  "acp-session-configured": "model",
};

/** `name:ms,...` of the span from..to, each step closing the part it names
 * and the rest going to `tail`. A step run beside the chain (the sign-in
 * refresh) names no part and closes nothing. */
function spanParts(marks: readonly Mark[], from: number | undefined, to: number | undefined, order: readonly string[], step: (name: string) => string | undefined, tail: string): string | undefined {
  if (from === undefined || to === undefined || to < from) return undefined;
  const sums = new Map<string, number>();
  let previous = from;
  for (const [name, at] of marks) {
    const part = step(name);
    if (!part || at < previous || at > to) continue;
    sums.set(part, (sums.get(part) ?? 0) + (at - previous));
    previous = at;
  }
  sums.set(tail, (sums.get(tail) ?? 0) + (to - previous));
  const out = order.filter((part) => Math.round(sums.get(part) ?? 0) > 0).map((part) => `${part}:${Math.round(sums.get(part)!)}`);
  return out.length ? out.join(",") : undefined;
}

/** queueBy and setupBy of one turn, from its step marks. */
export function turnLatencyParts(trace: TurnLatency, marks: readonly Mark[]): { queueBy?: string; setupBy?: string } {
  const queueBy = spanParts(marks, trace.receivedAt, trace.start, QUEUE_PARTS,
    (name) => QUEUE_STEP[name] ?? (name.startsWith("start:") ? "admit" : undefined), "dispatch");
  const setupBy = spanParts(marks, trace.start, trace.promptAt, SETUP_PARTS, (name) => SETUP_STEP[name], "prompt");
  return { ...(queueBy ? { queueBy } : {}), ...(setupBy ? { setupBy } : {}) };
}

/** #4456: queueBusy is printed over 250 ms; a benchmark of the queue
 * (server/first-text-latency.e2e.test.ts) sets SAGAX_TURN_LATENCY_BUSY_MS=0
 * to read it on every turn. */
function queueBusyFloorMs(): number {
  const floor = Number(process.env.SAGAX_TURN_LATENCY_BUSY_MS);
  return Number.isFinite(floor) && floor >= 0 && process.env.SAGAX_TURN_LATENCY_BUSY_MS !== "" ? floor : TOOLS_SLOW_MS;
}

export function turnLatencyLine(driver: string, threadId: string, trace: TurnLatency, end: number, outcome: string, marks: readonly Mark[] = []): string {
  const ms = (from: number | undefined, to: number | undefined) =>
    from === undefined || to === undefined ? "?" : `${Math.max(0, Math.round(to - from))}ms`;
  const parts = [
    `[turn-latency] ${driver} thread=${threadId.slice(0, 8)}`,
    `path=${trace.path ?? "?"}`,
    `queue=${ms(trace.receivedAt, trace.start)}`,
    `setup=${ms(trace.start, trace.promptAt)}`,
    `ttfa=${ms(trace.promptAt, trace.firstActivityAt)}`,
    `ttft=${ms(trace.promptAt, trace.firstTextAt)}`,
    `tools=${trace.tools}`,
    `total=${ms(trace.start, end)}`,
    `prompt=${trace.promptChars ?? "?"}ch`,
    `full=${trace.full === undefined ? "?" : trace.full ? "yes" : "no"}`,
    `in=${trace.inputTokens ?? "?"}`,
    `cached=${trace.cachedTokens ?? "?"}`,
  ];
  if (marks.length) {
    const { queueBy, setupBy } = turnLatencyParts(trace, marks);
    if (queueBy) parts.push(`queueBy=${queueBy}`);
    if (setupBy) parts.push(`setupBy=${setupBy}`);
  }
  if (trace.queueBusyMs !== undefined && trace.queueBusyMs > queueBusyFloorMs()) parts.push(`queueBusy=${Math.round(trace.queueBusyMs)}ms`);
  if (trace.starts && trace.starts.count > 0) parts.push(`starts=${trace.starts.count}:${Math.round(trace.starts.ms)}ms`);
  const toolsBy = turnToolsBy(trace.toolWait);
  if (toolsBy) parts.push(`toolsBy=${toolsBy}`);
  const toolsServed = turnToolsServed(trace.toolWait);
  if (toolsServed) parts.push(`toolsServed=${toolsServed}`);
  const toolsSlow = turnToolsSlow(trace.toolWait);
  if (toolsSlow) parts.push(`toolsSlow=${toolsSlow}`);
  const toolsGap = turnToolsGap(trace.toolWait);
  if (toolsGap) parts.push(`toolsGap=${toolsGap}`);
  const toolShare = turnToolShare(trace, end);
  if (toolShare) parts.push(toolShare);
  if (trace.path === "spawn" && trace.spawnWhy) parts.push(`spawnWhy=${trace.spawnWhy}`);
  if (trace.full && trace.fullWhy) parts.push(`fullWhy=${trace.fullWhy}`);
  const firstWords = turnFirstWords(trace);
  if (firstWords) parts.push(`firstWords=${firstWords}`);
  if (trace.firstToolAt !== undefined) parts.push(`ttfc=${ms(trace.promptAt, trace.firstToolAt)}`);
  if (trace.shownAt !== undefined) parts.push(`shown=${ms(trace.receivedAt ?? trace.start, trace.shownAt)}`);
  if (trace.full === false && trace.sent?.length) {
    const more = trace.sent.length - SENT_SECTIONS_MAX;
    parts.push(`sent=${trace.sent.slice(0, SENT_SECTIONS_MAX).join(",")}${more > 0 ? `,+${more}` : ""}`);
  }
  if (trace.stallMs !== undefined) parts.push(`stallGuard=${trace.stallMs}ms${trace.stallRetried ? " retried" : ""}`);
  parts.push(outcome);
  return parts.join(" ");
}
