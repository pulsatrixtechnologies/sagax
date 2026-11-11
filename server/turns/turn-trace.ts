// Per-step timing of a turn's path to the engine (2026-10-20 perf parity,
// round 4). The stderr line is off unless SAGAX_TURN_TRACE=1. Two counters
// stay on either way: how long the turn waited before it was sent, and how
// long until the first answer text. They are numbers only. Never the words,
// never a secret, never more than the thread id's first 8 characters on the
// optional line.
import { createHash } from "node:crypto";

const enabled = () => process.env.SAGAX_TURN_TRACE === "1";
const MAX_CLOCKS = 500;

interface TurnClock {
  queuedAt?: number;
  startedAt?: number;
  sentAt?: number;
  firstAt?: number;
  queueMs?: number;
  firstResponseMs?: number;
  /** every step of this turn so far with its time (epoch ms), oldest first:
   * the per-turn latency line names its parts from them (#3561) */
  marks?: Array<[step: string, at: number]>;
  /** #3623: while the engine's setup waits for its tool servers, Sagax's own
   * endpoints of this thread: the mount, its first request and its tool list
   * answer (epoch ms). Mount names and times only, never a request's content. */
  serving?: { since: number; mounts: Array<[label: string, inAt: number, outAt?: number]> };
}

/** Steps kept per thread: a routine's turns never restart the clock. */
const MAX_MARKS = 64;

const clocks = new Map<string, TurnClock>();

export interface TurnTiming {
  queueMs?: number;
  firstResponseMs?: number;
}

/** Writes the numbers onto the conversation. Absent in tests. */
let writeTiming: ((threadId: string, timing: TurnTiming) => void) | null = null;

export function setTurnTimingWriter(writer: ((threadId: string, timing: TurnTiming) => void) | null): void {
  writeTiming = writer;
}

function publish(threadId: string, row: TurnClock): void {
  const timing: TurnTiming = {};
  if (row.queueMs !== undefined) timing.queueMs = row.queueMs;
  if (row.firstResponseMs !== undefined) timing.firstResponseMs = row.firstResponseMs;
  if (timing.queueMs === undefined && timing.firstResponseMs === undefined) return;
  writeTiming?.(threadId, timing);
}

function take(threadId: string): TurnClock {
  const existing = clocks.get(threadId);
  if (existing) return existing;
  const row: TurnClock = {};
  clocks.set(threadId, row);
  while (clocks.size > MAX_CLOCKS) {
    const oldest = clocks.keys().next().value;
    if (oldest === undefined) break;
    clocks.delete(oldest);
  }
  return clocks.get(threadId) ?? row;
}

/** The person's message was stored. A number of epoch ms, nothing else. */
export function noteTurnQueued(threadId: string, at: number): void {
  if (!threadId || !Number.isFinite(at) || at <= 0) return;
  const row = take(threadId);
  row.queuedAt ??= at;
}

/** First answer text for this turn. Later calls do not move the number. */
export function noteFirstResponse(threadId: string, at = Date.now()): void {
  if (!threadId || !Number.isFinite(at)) return;
  const row = take(threadId);
  if (row.firstAt !== undefined) return;
  row.firstAt = at;
  const from = row.sentAt ?? row.startedAt ?? row.queuedAt;
  if (from !== undefined) row.firstResponseMs = Math.max(0, Math.round(at - from));
  publish(threadId, row);
  // Same stderr line as turnTrace steps: server-side TTFT for the harness.
  if (!enabled()) return;
  const start = row.startedAt ?? row.sentAt ?? row.queuedAt ?? at;
  console.error(`[turn-trace] ${threadId.slice(0, 8)} first-token ${at} +${at - start}`);
}

/** Queue wait and time to first answer. Null until that moment has happened. */
export function turnCounters(threadId: string): { queueMs: number | null; firstResponseMs: number | null } {
  const row = clocks.get(threadId);
  return { queueMs: row?.queueMs ?? null, firstResponseMs: row?.firstResponseMs ?? null };
}

/** The steps marked on this thread between `from` and `to` (epoch ms,
 * inclusive), oldest first. Step names and times only. */
export function turnTraceMarks(threadId: string, from: number, to: number): Array<[step: string, at: number]> {
  return (clocks.get(threadId)?.marks ?? []).filter(([, at]) => at >= from && at <= to);
}

/** #3623: the engine's setup starts waiting for its tool servers: from now
 * until closeTurnServing, Sagax's own endpoints of this thread note their
 * first request and their tool list answer (noteTurnServed). */
export function openTurnServing(threadId: string, at = Date.now()): void {
  if (!threadId || !Number.isFinite(at)) return;
  take(threadId).serving = { since: at, mounts: [] };
}

/** #3623: one request on one of Sagax's own endpoints of this thread: its
 * arrival ("in"), or its tool list answer leaving ("out"). Only the first of
 * each per mount counts, and only while the setup waits (an answer to a
 * request that arrived before the wait is not one). */
export function noteTurnServed(threadId: string, label: string, phase: "in" | "out", at = Date.now()): void {
  const serving = clocks.get(threadId)?.serving;
  if (!serving || !label) return;
  const entry = serving.mounts.find(([name]) => name === label);
  if (phase === "in") {
    if (!entry) serving.mounts.push([label, at]);
  } else if (entry && entry[2] === undefined) {
    entry[2] = at;
  }
}

/** #3623: the wait ended: what Sagax's own endpoints saw, in order of
 * arrival, in ms from the wait's start. Stops the noting. */
export function closeTurnServing(threadId: string): Array<[label: string, inMs: number, outMs?: number]> {
  const row = clocks.get(threadId);
  const serving = row?.serving;
  if (!row || !serving) return [];
  delete row.serving;
  const ms = (at: number) => Math.max(0, Math.round(at - serving.since));
  return serving.mounts.map(([label, inAt, outAt]) =>
    outAt === undefined ? [label, ms(inAt)] as [string, number] : [label, ms(inAt), ms(outAt)] as [string, number, number]);
}

/** #3623: the mount a turn capability's requests serve, by its kind (the
 * name the engine's catalog shows, or `connector` for a mount whose name may
 * carry a person's or a bot's identifier). Undefined for a kind that is not
 * a tool server. */
const SERVED_MOUNTS: Readonly<Record<string, string>> = {
  agents: "agents", browser: "browser", data: "data", messages: "messages", perspicax: "perspicax",
  computer: "computer", workplace: "sagax-computer", desktop: "sagax-desktop", sandbox: "sagax-environment",
  connectors: "connector", "personal-mcp": "connector",
};
export function turnServedMount(kind: string): string | undefined {
  return Object.hasOwn(SERVED_MOUNTS, kind) ? SERVED_MOUNTS[kind] : undefined;
}

/** #3623: whether a request body to one of Sagax's endpoints asks for the
 * tool list: the frame itself, or a frame wrapped as `{ message }`. */
export function isToolListRequest(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const frame = body as { method?: unknown; message?: { method?: unknown } | null };
  return frame.method === "tools/list" || (typeof frame.message === "object" && frame.message?.method === "tools/list");
}

/** Test helper. Production turns just age out of the map. */
export function clearTurnCounters(): void {
  clocks.clear();
  writeTiming = null;
}

/** Mark one step of a thread's turn; `first` restarts the clock. The line
 * is printed only when the trace flag is on. The counters update either way. */
export function turnTrace(threadId: string, step: string, first = false): void {
  const now = Date.now();
  const previous = clocks.get(threadId);
  if (first) {
    // A queued time carries over only while its turn is still to be sent.
    // Once a turn was sent, the next one is measured from its own message
    // (2026-10-28: the second turn kept the first one's time, so the wait
    // before send grew with the conversation's age).
    const queuedAt = previous?.sentAt === undefined ? previous?.queuedAt : undefined;
    clocks.set(threadId, { startedAt: now, ...(queuedAt !== undefined && queuedAt <= now ? { queuedAt } : {}) });
  } else {
    const row = take(threadId);
    row.startedAt ??= now;
  }
  const row = clocks.get(threadId) ?? take(threadId);
  const marks = row.marks ??= [];
  marks.push([step, now]);
  if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  if (step === "send" && row.sentAt === undefined) {
    row.sentAt = now;
    const from = row.queuedAt ?? row.startedAt;
    if (from !== undefined) row.queueMs = Math.max(0, Math.round(now - from));
    publish(threadId, row);
  }
  if (!enabled()) return;
  const start = row.startedAt ?? now;
  console.error(`[turn-trace] ${threadId.slice(0, 8)} ${step} ${now} +${now - start}`);
}

/** Stable sha256 of the material the prepare/setup/prompt path built for
 * the engine. Off unless SAGAX_TURN_TRACE=1. Never prints the words. */
export function turnTracePayloadHash(
  threadId: string,
  payload: {
    system?: string;
    systemStable?: string;
    systemVolatile?: string;
    transcript?: ReadonlyArray<{ role: string; text: string }>;
    text?: string;
    integrations?: ReadonlyArray<string> | Record<string, unknown>;
    model?: string;
    effort?: string | null;
    resumeCursor?: string;
    sessionReset?: boolean;
  },
): void {
  if (!enabled() || !threadId) return;
  const integrations = Array.isArray(payload.integrations)
    ? [...payload.integrations].sort()
    : Object.keys(payload.integrations ?? {}).sort();
  const body = JSON.stringify({
    system: payload.system ?? "",
    systemStable: payload.systemStable ?? "",
    systemVolatile: payload.systemVolatile ?? "",
    transcript: payload.transcript ?? [],
    text: payload.text ?? "",
    integrations,
    model: payload.model ?? "",
    effort: payload.effort ?? null,
    resumeCursor: payload.resumeCursor ?? "",
    sessionReset: payload.sessionReset === true,
  });
  const hash = createHash("sha256").update(body).digest("hex");
  console.error(`[turn-trace] ${threadId.slice(0, 8)} payload-hash ${hash}`);
}
