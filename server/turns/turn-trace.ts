// Per-step timing of a turn's path to the engine (2026-10-20 perf parity,
// round 4). The stderr line is off unless SAGAX_TURN_TRACE=1. Two counters
// stay on either way: how long the turn waited before it was sent, and how
// long until the first answer text. They are numbers only. Never the words,
// never a secret, never more than the thread id's first 8 characters on the
// optional line.
import { createHash } from "node:crypto";
import { performance, type EventLoopUtilization } from "node:perf_hooks";
import type { WireTurnTiming } from "../../shared/wire.ts";
import { processStartTotals } from "../process/spawn-helper.ts";

const enabled = () => process.env.SAGAX_TURN_TRACE === "1";
const MAX_CLOCKS = 500;

interface TurnClock {
  queuedAt?: number;
  startedAt?: number;
  sentAt?: number;
  firstAt?: number;
  queueMs?: number;
  firstResponseMs?: number;
  /** #4215: the prompt reached the engine, and whether it was already running */
  engineAt?: number;
  engineStart?: "warm" | "cold";
  /** #4215: the turn ended */
  settledAt?: number;
  /** #4215: the server's main thread at the turn's start, and how long it
   * was busy from there to the send (ms): near the queue, the wait is
   * Sagax's own work (other turns, a save); near zero, it waited on I/O */
  loopAtStart?: EventLoopUtilization;
  queueBusyMs?: number;
  /** #3598: the server's process starts at the turn's start, and those made
   * from there until the engine took the prompt (count and synchronous ms;
   * every start of the server in that window, as queueBusy counts its work) */
  startsAtStart?: { count: number; ms: number };
  starts?: { count: number; ms: number };
  /** every step of this turn so far with its time (epoch ms), oldest first:
   * the per-turn latency line names its parts from them (#3561) */
  marks?: Array<[step: string, at: number]>;
  /** #3623: while the engine's setup waits for its tool servers, Sagax's own
   * endpoints of this thread: the mount, its first request and its tool list
   * answer (epoch ms). Mount names and times only, never a request's content. */
  serving?: { since: number; mounts: Array<[label: string, inAt: number, outAt?: number]>; parts?: Map<string, Array<[part: string, ms: number]>> };
}

/** #3623: one mount's tool list, named by its parts (toolsSlow). */
export type ServedParts = Array<[part: string, ms: number]>;

/** Steps kept per thread: a routine's turns never restart the clock. */
const MAX_MARKS = 64;

const clocks = new Map<string, TurnClock>();

export type TurnTiming = WireTurnTiming;

/** Writes the numbers onto the conversation. Absent in tests. */
let writeTiming: ((threadId: string, timing: TurnTiming) => void) | null = null;

export function setTurnTimingWriter(writer: ((threadId: string, timing: TurnTiming) => void) | null): void {
  writeTiming = writer;
}

/** The turn's numbers so far, from its own marks (#4215: send to first
 * word, where it went, the total). A whole snapshot of this turn: nothing
 * of the previous turn rides along. */
export function turnTimingOf(row: TurnClock): TurnTiming {
  const ms = (from: number | undefined, to: number | undefined) =>
    from === undefined || to === undefined ? undefined : Math.max(0, Math.round(to - from));
  const origin = row.queuedAt ?? row.startedAt;
  const timing: TurnTiming = {};
  if (row.queueMs !== undefined) timing.queueMs = row.queueMs;
  if (row.firstResponseMs !== undefined) timing.firstResponseMs = row.firstResponseMs;
  const firstWordMs = ms(origin, row.firstAt);
  if (firstWordMs !== undefined) timing.firstWordMs = firstWordMs;
  const engineStartMs = ms(row.sentAt, row.engineAt);
  if (engineStartMs !== undefined) timing.engineStartMs = engineStartMs;
  if (row.engineStart) timing.engineStart = row.engineStart;
  const totalMs = ms(origin, row.settledAt);
  if (totalMs !== undefined) timing.totalMs = totalMs;
  return timing;
}

function publish(threadId: string, row: TurnClock): void {
  const timing = turnTimingOf(row);
  if (!Object.keys(timing).length) return;
  writeTiming?.(threadId, timing);
}

/** #4215: the engine took this turn's prompt: how long it took to start
 * (cold) or to be reached (warm) after the turn was handed to it. */
export function noteEnginePrompt(threadId: string, warm: boolean, at = Date.now()): void {
  const row = clocks.get(threadId);
  if (!row || row.engineAt !== undefined || !Number.isFinite(at)) return;
  row.engineAt = at;
  row.engineStart = warm ? "warm" : "cold";
  if (row.startsAtStart) {
    const now = processStartTotals();
    row.starts = { count: now.count - row.startsAtStart.count, ms: Math.round(now.ms - row.startsAtStart.ms) };
  }
  publish(threadId, row);
}

/** #4215: the turn ended: its total, from the person's message. */
export function noteTurnSettled(threadId: string, at = Date.now()): void {
  const row = clocks.get(threadId);
  if (!row || row.settledAt !== undefined || row.sentAt === undefined || !Number.isFinite(at)) return;
  row.settledAt = at;
  publish(threadId, row);
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

/** #4215: how long the server's main thread was busy between this turn's
 * start and its send, ms; undefined before the send. */
export function turnQueueBusyMs(threadId: string): number | undefined {
  return clocks.get(threadId)?.queueBusyMs;
}

/** #3598: the process starts the server made from this turn's start until
 * the engine took its prompt, and their total synchronous ms; undefined
 * before that moment. */
export function turnProcessStarts(threadId: string): { count: number; ms: number } | undefined {
  const starts = clocks.get(threadId)?.starts;
  return starts ? { ...starts } : undefined;
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

/** #3623: one part of one of Sagax's own endpoints of this thread while the
 * setup waits for its tool servers (the environment, the stream's opening,
 * the server's handshake, its tool list): a name and milliseconds (or a size
 * in KB), added up per part. Only while the setup waits. */
export function noteTurnServedPart(threadId: string, label: string, part: string, ms: number): void {
  const serving = clocks.get(threadId)?.serving;
  if (!serving || !label || !part || !Number.isFinite(ms)) return;
  serving.parts ??= new Map();
  const parts = serving.parts.get(label) ?? [];
  const entry = parts.find(([name]) => name === part);
  if (entry) entry[1] += ms;
  else parts.push([part, ms]);
  serving.parts.set(label, parts);
}

/** #3623: the wait ended: what Sagax's own endpoints saw, in order of
 * arrival, in ms from the wait's start. Stops the noting. */
export function closeTurnServing(threadId: string): Array<[label: string, inMs: number, outMs?: number, parts?: ServedParts]> {
  const row = clocks.get(threadId);
  const serving = row?.serving;
  if (!row || !serving) return [];
  delete row.serving;
  const ms = (at: number) => Math.max(0, Math.round(at - serving.since));
  return serving.mounts.map(([label, inAt, outAt]) => {
    if (outAt === undefined) return [label, ms(inAt)] as [string, number];
    const parts = serving.parts?.get(label);
    return parts?.length
      ? [label, ms(inAt), ms(outAt), parts.map(([part, value]) => [part, Math.round(value)] as [string, number])] as [string, number, number, ServedParts]
      : [label, ms(inAt), ms(outAt)] as [string, number, number];
  });
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

/** #4215: sends that waited for their conversation's pre-warm before their
 * turn started (server/index.ts startOrQueueDirectMessage): when the send
 * arrived and when the wait ended (epoch ms). The turn's start takes it. */
const arrivals = new Map<string, { arrivedAt: number; joinedAt: number }>();

/** #4215: a send waited for the conversation's pre-warm (the engine the
 * composer started) before its message was stored. Its turn counts from the
 * send, and its line names the wait `prewarm`, instead of a wait no number
 * showed. */
export function noteTurnArrival(threadId: string, arrivedAt: number, joinedAt: number): void {
  if (!threadId || !Number.isFinite(arrivedAt) || !Number.isFinite(joinedAt) || arrivedAt <= 0 || joinedAt < arrivedAt) return;
  arrivals.set(threadId, { arrivedAt, joinedAt });
  while (arrivals.size > MAX_CLOCKS) {
    const oldest = arrivals.keys().next().value;
    if (oldest === undefined) break;
    arrivals.delete(oldest);
  }
}

/** The send's turn started, or never will (queued, refused): forget it. */
export function clearTurnArrival(threadId: string): void {
  arrivals.delete(threadId);
}

/** #4215: when this turn's clock starts (the send's arrival when it waited
 * for a pre-warm, else its message), epoch ms; undefined before. */
export function turnQueuedAt(threadId: string): number | undefined {
  return clocks.get(threadId)?.queuedAt;
}

/** Test helper. Production turns just age out of the map. */
export function clearTurnCounters(): void {
  clocks.clear();
  arrivals.clear();
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
    const carried = previous?.sentAt === undefined ? previous?.queuedAt : undefined;
    // #4215: a send that waited for the pre-warm counts from its arrival;
    // the wait is a step of its own, closed when the wait ended
    const arrival = arrivals.get(threadId);
    arrivals.delete(threadId);
    const arrived = arrival && arrival.joinedAt <= now ? arrival : undefined;
    const queuedAt = arrived && (carried === undefined || arrived.arrivedAt < carried) ? arrived.arrivedAt : carried;
    clocks.set(threadId, {
      startedAt: now, loopAtStart: performance.eventLoopUtilization(), startsAtStart: processStartTotals(),
      ...(queuedAt !== undefined && queuedAt <= now ? { queuedAt } : {}),
      ...(arrived && arrived.joinedAt > arrived.arrivedAt ? { marks: [["prewarm-joined", arrived.joinedAt]] as Array<[string, number]> } : {}),
    });
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
    if (row.loopAtStart) row.queueBusyMs = Math.round(performance.eventLoopUtilization(row.loopAtStart).active);
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
