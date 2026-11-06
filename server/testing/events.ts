// Event recorder for adapter tests: collect every canonical event and
// await predicates instead of sleeping (a test that needs a timeout to
// pass is wrong — it should wait on the event that proves the behavior).
import type { ProviderAdapter, RuntimeEvent } from "../contracts.ts";

export interface EventRecorder {
  events: RuntimeEvent[];
  /** Resolves with the first event matching `pred` (including already-seen
   * ones). Rejects after `timeoutMs` with the transcript so far. */
  until(pred: (e: RuntimeEvent) => boolean, timeoutMs?: number): Promise<RuntimeEvent>;
  stop(): void;
}

export function recordEvents(adapter: ProviderAdapter): EventRecorder {
  const events: RuntimeEvent[] = [];
  const waiters: Array<{ pred: (e: RuntimeEvent) => boolean; resolve: (e: RuntimeEvent) => void }> = [];
  const unsubscribe = adapter.onEvent((event) => {
    events.push(event);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(event)) {
        const [w] = waiters.splice(i, 1);
        w.resolve(event);
      }
    }
  });
  return {
    events,
    until(pred, timeoutMs = 10_000) {
      // Register the waiter before reading the buffer so an event that
      // arrives between find and push cannot be missed.
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (event: RuntimeEvent) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const idx = waiters.indexOf(waiter);
          if (idx !== -1) waiters.splice(idx, 1);
          resolve(event);
        };
        const waiter = { pred, resolve: settle };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const idx = waiters.indexOf(waiter);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(
            new Error(
              `no matching event within ${timeoutMs}ms; saw: ${events.map((e) => e.type).join(", ") || "(none)"}`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
        waiters.push(waiter);
        const seen = events.find(pred);
        if (seen) settle(seen);
      });
    },
    stop: unsubscribe,
  };
}
