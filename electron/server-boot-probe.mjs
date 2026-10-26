// Kernel of the packaged-server boot wait (see issue #506): poll a freshly
// forked child's /api/health until it either proves its identity, we learn
// some other process owns the port, or the wall-clock budget runs out.
//
// Extracted from electron/main.mjs so the failure modes below can carry
// regression tests without booting Electron (main.mjs is not importable in a
// bare node test — importing it starts the whole app bootstrap).
//
// - The budget is wall-clock and shared by every step: each in-flight probe is
//   aborted at the remaining deadline, so a server that accepts connections
//   but never answers cannot wedge the launcher past its own timeout.
// - ANY HTTP answer on the port proves somebody owns it. Only our own child's
//   identity payload counts as ready; everything else (a 404/503 from an
//   unrelated app, wrong pid, non-JSON body) is reported as a foreign owner
//   immediately instead of burning the rest of the budget re-polling a port
//   we will never win.
// - The expected pid must be read as a GETTER at response time, not captured
//   when the caller forks: Electron's utilityProcess assigns proc.pid on the
//   async `spawn` event, so a value grabbed right after fork() is still
//   undefined and our own freshly-bound child would fail the identity match
//   and be reaped as a "foreign owner" on its very first health answer.
import { isOwnHealth } from "./legacy-names.mjs";

// A healthy child usually binds within a few seconds of fork, and a refused
// loopback connect costs well under a millisecond, so poll briskly over that
// window. Slower boots fall back to the old interval, which keeps a boot that
// never listens to a few hundred probes over the whole budget.
export const BOOT_PROBE_FAST_INTERVAL_MS = 25;
export const BOOT_PROBE_FAST_WINDOW_MS = 5_000;
export const BOOT_PROBE_INTERVAL_MS = 500;

export const SERVER_BOOT_TIMEOUT_MS = 60_000;
export const SERVER_LISTENING_GRACE_MS = 180_000;
const LISTENING_LINE = "openmausbot server on ";

export function listeningSignal() {
  let tail = "";
  let heard = false;
  return {
    hear(chunk) {
      if (heard) return;
      const text = tail + chunk;
      tail = text.slice(-LISTENING_LINE.length);
      heard = text.includes(LISTENING_LINE);
    },
    heard: () => heard,
  };
}

/** @param {number} port @param {{ outcome: string, waitedMs?: number }} identity */
export function bootFailureMessage(port, identity) {
  if (identity.outcome === "exited") return `child on port ${port} exited before answering /api/health`;
  if (identity.outcome === "foreign-owner") return `port ${port} answered health checks from another process`;
  if (identity.outcome === "ready") return `child on port ${port} answered after it stopped being the current server`;
  return `child on port ${port} did not answer /api/health within ${Math.round((identity.waitedMs ?? 0) / 1000)}s`;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *   port: number,
 *   pid: () => number | undefined,
 *   bootTimeoutMs: number,
 *   isExited?: () => boolean,
 *   isListening?: () => boolean,
 *   listeningGraceMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<{ outcome: "ready" | "foreign-owner" | "timeout" | "exited", latencyMs?: number, waitedMs?: number }>}
*/
export async function pollServerIdentity({
  port,
  pid,
  bootTimeoutMs,
  isExited = () => false,
  isListening = () => false,
  listeningGraceMs = 0,
  now = Date.now,
  sleep = defaultSleep,
  fetchImpl = globalThis.fetch,
}) {
  const startedAt = now();
  const deadline = () => startedAt + bootTimeoutMs + (isListening() ? listeningGraceMs : 0);
  for (;;) {
    if (isExited()) return { outcome: "exited" };
    const remainingMs = Math.max(0, deadline() - now());
    if (remainingMs <= 0) return { outcome: "timeout", waitedMs: now() - startedAt };

    let res;
    try {
      res = await fetchImpl(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch {
      // Not up yet, or this probe ran into the wall-clock budget — either way
      // back off (fast inside the usual boot window, the slow interval after
      // it), then let the loop condition decide.
      const intervalMs =
        now() - startedAt < BOOT_PROBE_FAST_WINDOW_MS ? BOOT_PROBE_FAST_INTERVAL_MS : BOOT_PROBE_INTERVAL_MS;
      await sleep(Math.min(intervalMs, Math.max(1, deadline() - now())));
      continue;
    }
    const body = await res.json().catch(() => null);
    // Body consumption is covered by the same abort signal as fetch. If it
    // reaches the deadline, a null body means the probe timed out, not that a
    // different process answered on the port.
    if (now() >= deadline()) return { outcome: "timeout", waitedMs: now() - startedAt };
    // Read the expected pid NOW, after the response landed: until the child's
    // `spawn` event fires the getter yields undefined, and a child that has
    // not spawned cannot be the one answering — so an answer during that
    // window is genuinely somebody else's.
    const expectedPid = pid();
    const identified =
      res.ok &&
      expectedPid !== undefined &&
      isOwnHealth(body) &&
      body.pid === expectedPid &&
      body.static;
    if (!identified) return { outcome: "foreign-owner" };
    // A response that finishes after the budget must not count as a healthy
    // boot: re-check the clock before declaring victory.
    if (now() >= deadline()) return { outcome: "timeout", waitedMs: now() - startedAt };
    return { outcome: "ready", latencyMs: now() - startedAt };
  }
}
