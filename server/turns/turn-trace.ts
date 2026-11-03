// Per-step timing of a turn's path to the engine (2026-10-20 perf parity,
// round 4). The stderr line is off unless SAGAX_TURN_TRACE=1. Two counters
// stay on either way: how long the turn waited before it was sent, and how
// long until the first answer text. They are numbers only. Never the words,
// never a secret, never more than the thread id's first 8 characters on the
// optional line.

const enabled = () => process.env.SAGAX_TURN_TRACE === "1";
const MAX_CLOCKS = 500;

interface TurnClock {
  queuedAt?: number;
  startedAt?: number;
  sentAt?: number;
  firstAt?: number;
  queueMs?: number;
  firstResponseMs?: number;
}

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
}

/** Queue wait and time to first answer. Null until that moment has happened. */
export function turnCounters(threadId: string): { queueMs: number | null; firstResponseMs: number | null } {
  const row = clocks.get(threadId);
  return { queueMs: row?.queueMs ?? null, firstResponseMs: row?.firstResponseMs ?? null };
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
