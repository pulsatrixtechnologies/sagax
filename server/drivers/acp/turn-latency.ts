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
//   queueBy: admit (checks before the turn starts), prewarm (a warm being
//   joined), compact, context (selection, soul, skills), mcp (the tool
//   servers' sign-in refresh and probe), connector (the account's connection),
//   place (where it runs: workspace, sandbox, mounts), prompt, recall,
//   access (the turn's credentials, a typed command), slot (an engine start
//   slot), send, dispatch (pictures, hand-off to the engine).
//   setupBy: prepare (sign-in check, command, spawn contract), init (process
//   start and handshake), session (session/new or load), model (model and
//   mode), tools (the engine's tool servers answering), prompt (the rest
//   until the prompt is sent).

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
  tools: number;
  promptChars?: number;
  /** the prompt carried the full system block */
  full?: boolean;
  inputTokens?: number;
  cachedTokens?: number;
  /** the stall guard cancelled a silent prompt and asked again */
  stallRetried?: boolean;
  stallMs?: number;
}

export function newTurnLatency(start: number, receivedAt?: number): TurnLatency {
  return { start, tools: 0, ...(typeof receivedAt === "number" && Number.isFinite(receivedAt) && receivedAt > 0 && receivedAt <= start ? { receivedAt } : {}) };
}

/** Record a streamed update of the running prompt. */
export function noteTurnActivity(trace: TurnLatency | undefined, kind: string, at: number): void {
  if (!trace || trace.promptAt === undefined) return;
  if (kind !== "agent_message_chunk" && kind !== "agent_thought_chunk" && kind !== "tool_call") return;
  trace.firstActivityAt ??= at;
  if (kind === "agent_message_chunk") trace.firstTextAt ??= at;
  if (kind === "tool_call") trace.tools += 1;
}

type Mark = readonly [step: string, at: number];

const QUEUE_PARTS = ["admit", "prewarm", "compact", "context", "mcp", "connector", "place", "prompt", "recall", "access", "slot", "send", "dispatch"] as const;
const QUEUE_STEP: Record<string, (typeof QUEUE_PARTS)[number]> = {
  start: "admit",
  "prewarm-joined": "prewarm",
  compacted: "compact",
  "context-selected": "context",
  "soul-drift": "context",
  "skills-selected": "context",
  "mcp-mounted": "mcp",
  integrations: "connector",
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
  if (trace.stallMs !== undefined) parts.push(`stallGuard=${trace.stallMs}ms${trace.stallRetried ? " retried" : ""}`);
  parts.push(outcome);
  return parts.join(" ");
}
