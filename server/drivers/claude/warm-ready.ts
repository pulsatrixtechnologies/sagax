// Wait until a Claude warmOnly process has announced init (boot finished),
// so the first real turn does not still pay the cold start (#1971).
import type { ClaudeSession } from "./session-types.ts";

/** Cap for waiting on init during warmOnly. A CLI that never speaks still
 * returns so the composer is not stuck; the process is at least spawned. */
export const CLAUDE_PREWARM_READY_MS = 120_000;

/** Resolves once the warm process has seen init, closed, aborted, or timed out. */
export function waitClaudePrewarmed(
  session: ClaudeSession,
  signal?: AbortSignal,
  timeoutMs = CLAUDE_PREWARM_READY_MS,
): Promise<void> {
  if (session.sawInit || session.closing || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const poll = setInterval(() => {
      if (session.sawInit || session.closing) done();
    }, 25);
    poll.unref?.();
    const timeout = setTimeout(done, Math.max(0, timeoutMs));
    timeout.unref?.();
    signal?.addEventListener("abort", done, { once: true });
  });
}
