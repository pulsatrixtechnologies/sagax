// How long a desktop loop waits before it asks its organization server again
// (2026-10-20). A desktop whose session ended used to ask every 5 seconds
// forever (Windows 0.5.11 and 0.5.25: 12 to 24 requests a minute, each a
// 401). Now the wait doubles on every failure in a row: up to 10 minutes
// while the server refuses the session (401/403: nothing changes until the
// person signs in again, and the main window shows that), up to a minute
// while it is only unreachable (a deploy, a restart: 5xx, network). A
// success starts over.

export const AUTH_BACKOFF_MAX_MS = 10 * 60_000;
export const TRANSIENT_BACKOFF_MAX_MS = 60_000;

/** Whether an error from a server request is the server refusing the session. */
export function refusedSession(error) {
  return error?.status === 401 || error?.status === 403;
}

/** `next(error)` is the wait before the next try; `reset()` after a success. */
export function createAuthBackoff({ baseMs = 5_000, authMaxMs = AUTH_BACKOFF_MAX_MS, transientMaxMs = TRANSIENT_BACKOFF_MAX_MS, random = Math.random } = {}) {
  let failures = 0;
  return {
    next(error) {
      failures += 1;
      const cap = Math.max(baseMs, refusedSession(error) ? authMaxMs : transientMaxMs);
      const raw = Math.min(cap, baseMs * 2 ** Math.min(failures - 1, 20));
      // up to 10% jitter, so a fleet of desktops does not come back in step
      return Math.round(Math.min(cap, raw * (1 + 0.1 * random())));
    },
    reset() {
      failures = 0;
    },
    get failures() {
      return failures;
    },
  };
}
