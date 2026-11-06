// The Connectors card on a conversation is a post-dispatch bookkeeping write:
// commitBotChange fsyncs bots.json, so doing it before `send` held accept→send
// (#1950 leftover on #1971). A short timer keeps the fsync off the first-token
// path too (setImmediate alone still raced the harness's ~10 ms first delta).

/** Delay before the bots.json write. Past typical overhead_ttft; well under a
 * live engine's first token. */
export const CONNECTORS_PATCH_DEFER_MS = 50;

/** Run `apply` after `CONNECTORS_PATCH_DEFER_MS` (tests may inject `schedule`). */
export function deferConnectorsPatch(
  apply: () => void,
  schedule: (fn: () => void) => void = (fn) => {
    const timer = setTimeout(fn, CONNECTORS_PATCH_DEFER_MS);
    timer.unref?.();
  },
): void {
  schedule(() => {
    try {
      apply();
    } catch (error) {
      console.warn(`[connectors] ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
