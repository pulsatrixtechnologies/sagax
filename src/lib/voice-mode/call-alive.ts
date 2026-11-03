// The server's record of a live call (server/voice/voice-call-session.ts) expires
// after 20 minutes without a turn or a heartbeat. A laptop that slept, or a
// network that came back, missed heartbeats: the call says it is alive the
// moment the page is visible or online again, not five minutes later.
// Timers a call arms (a send's retry) die with it, so nothing is sent under
// a call id that already hung up.

/** The heartbeat while the page runs (under sandboxd's 10 minute idle stop). */
export const CALL_ALIVE_MS = 5 * 60_000;

type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface AliveTargets {
  window?: Events | null;
  document?: (Events & { visibilityState?: string }) | null;
}

/** Say `alive` every CALL_ALIVE_MS, and at once when the page becomes
 * visible or the network comes back. Returns the stop. */
export function keepCallAlive(alive: () => void, targets: AliveTargets = defaultTargets(), everyMs = CALL_ALIVE_MS): () => void {
  const timer = setInterval(alive, everyMs);
  const visible = () => {
    if (targets.document?.visibilityState === undefined || targets.document.visibilityState === "visible") alive();
  };
  targets.document?.addEventListener("visibilitychange", visible);
  targets.window?.addEventListener("online", alive);
  return () => {
    clearInterval(timer);
    targets.document?.removeEventListener("visibilitychange", visible);
    targets.window?.removeEventListener("online", alive);
  };
}

function defaultTargets(): AliveTargets {
  return {
    window: typeof window === "undefined" ? null : window,
    document: typeof document === "undefined" ? null : document,
  };
}

/** Timeouts owned by one call: `clear` drops every one still pending. */
export function callTimers() {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    later(fn: () => void, ms: number): void {
      const timer = setTimeout(() => {
        pending.delete(timer);
        fn();
      }, ms);
      pending.add(timer);
    },
    clear(): void {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
    get size(): number {
      return pending.size;
    },
  };
}
