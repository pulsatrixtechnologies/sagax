// Per-step timing of a turn's path to the engine (2026-10-20 perf parity,
// round 4). Off unless SAGAX_TURN_TRACE=1: then each step prints one
// stderr line "[turn-trace] <thread> <step> <epoch ms> +<ms since the
// turn's first step>", so a bench can line the server's steps up with the
// engine's own frames. Never carries content, ids beyond the thread's
// first 8 characters, or anything a person typed.

const enabled = () => process.env.SAGAX_TURN_TRACE === "1";
const starts = new Map<string, number>();

/** Mark one step of a thread's turn; `first` restarts the clock. */
export function turnTrace(threadId: string, step: string, first = false): void {
  if (!enabled()) return;
  const now = Date.now();
  if (first || !starts.has(threadId)) starts.set(threadId, now);
  if (starts.size > 500) starts.delete(starts.keys().next().value!);
  console.error(`[turn-trace] ${threadId.slice(0, 8)} ${step} ${now} +${now - starts.get(threadId)!}`);
}
