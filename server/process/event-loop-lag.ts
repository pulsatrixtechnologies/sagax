// Event loop lag in the server log (2026-10-28, after the 0.8.8 health guard
// failure on an organization host: /api/health behind Caddy did not answer in 10 s three times
// in a row, with nothing in the log to say why).
//
// Two probes, both written to the server log tail (server/process/server-log-ring.ts),
// so they survive a container recreation on the data disk:
//
// - A periodic summary (`[loop-lag] p50 .. p99 .. max ..`) from
//   perf_hooks.monitorEventLoopDelay, reset after each report.
// - A stall event as soon as the main thread is back from a block longer than
//   STALL_MS. A watchdog worker (its own thread, so it still runs while the
//   main thread is blocked) sees the missing heartbeat and, when the
//   inspector is available, pauses the main thread once through
//   `inspector.Session.connectToMainThread()` to read the JavaScript stack it
//   is stuck in. The stack comes with the stall line. A stack is read at most
//   once per STACK_COOLDOWN_MS, and never when the inspector is missing.
//
// #1750: when Debugger.pause returns nothing (common in containers, and during
// stall bursts under the 5 min cooldown), the watchdog samples a short CPU
// profile instead and posts its hottest frames. A failed capture uses a short
// cooldown so the next stall in a burst can still be attributed.
//
// Never throws at the caller: without workers or the inspector, the lag
// summary and the stall line still work.
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

export const LAG_REPORT_MS = 60_000;
export const STALL_MS = 1_000;
export const STACK_COOLDOWN_MS = 5 * 60_000;
/** After a capture that returned no frames, try again sooner (#1750). */
export const STACK_RETRY_COOLDOWN_MS = 15_000;
const HEARTBEAT_MS = 200;
const MAX_FRAMES = 25;
const STACK_WAIT_MS = 800;
const PROFILE_MS = 250;

export interface LoopLagLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface LoopLagOptions {
  reportMs?: number;
  stallMs?: number;
  stackCooldownMs?: number;
  /** Read the blocked thread's stack through a watchdog worker (default true). */
  stacks?: boolean;
}

const ms = (ns: number) => Math.round(ns / 1e6);

/** The watchdog worker: plain JavaScript, evaluated, so it needs no file in
 * the bundle. It receives heartbeats; when none came for stallMs, it pauses
 * the main thread through the inspector and posts the top frames back. When
 * pause yields nothing, it samples Profiler for a short window instead. */
const WATCHDOG_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
let inspector = null;
try { inspector = require("node:inspector"); } catch {}
const { stallMs, cooldownMs, retryCooldownMs, maxFrames, profileMs } = workerData;
let last = Date.now();
let lastStackAt = 0;
let lastGotStack = false;
let busy = false;
let inspectorMissingLogged = false;
parentPort.on("message", (m) => { if (m === "beat") last = Date.now(); });

function topProfileFrames(profile) {
  if (!profile || !Array.isArray(profile.nodes)) return null;
  const hits = new Map();
  for (const node of profile.nodes) {
    const call = node.callFrame || {};
    const name = call.functionName || "(anonymous)";
    const url = call.url || "?";
    const line = (call.lineNumber || 0) + 1;
    const col = (call.columnNumber || 0) + 1;
    const key = name + " " + url + ":" + line + ":" + col;
    const hit = (node.hitCount || 0) + (Array.isArray(node.children) ? 0 : 0);
    hits.set(key, (hits.get(key) || 0) + (node.hitCount || 0));
  }
  const ranked = [...hits.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, maxFrames);
  if (!ranked.length) return null;
  return ranked.map(([frame, n]) => frame + " x" + n);
}

function capture() {
  if (!inspector || typeof inspector.Session !== "function") {
    if (!inspectorMissingLogged) {
      inspectorMissingLogged = true;
      parentPort.postMessage({ stack: null, reason: "inspector unavailable", at: Date.now() });
    }
    return;
  }
  let session;
  try {
    session = new inspector.Session();
    session.connectToMainThread();
  } catch (error) {
    parentPort.postMessage({ stack: null, reason: "inspector connect failed", at: Date.now() });
    return;
  }
  busy = true;
  lastStackAt = Date.now();
  const finish = (frames, reason) => {
    busy = false;
    lastGotStack = Boolean(frames && frames.length);
    try {
      session.post("Profiler.disable", () => {
        try { session.post("Debugger.disable", () => session.disconnect()); } catch { try { session.disconnect(); } catch {} }
      });
    } catch { try { session.disconnect(); } catch {} }
    parentPort.postMessage({ stack: frames || null, reason: reason || null, at: Date.now() });
  };
  const profileFallback = (why) => {
    try {
      session.post("Profiler.enable", (err) => {
        if (err) return finish(null, why || "capture failed");
        session.post("Profiler.start", (startErr) => {
          if (startErr) return finish(null, why || "capture failed");
          setTimeout(() => {
            session.post("Profiler.stop", (stopErr, result) => {
              if (stopErr) return finish(null, why || "capture failed");
              const frames = topProfileFrames(result && result.profile);
              finish(frames, frames ? "cpu profile" : (why || "capture failed"));
            });
          }, profileMs);
        });
      });
    } catch {
      finish(null, why || "capture failed");
    }
  };
  const timer = setTimeout(() => profileFallback("pause timed out"), 5000);
  session.once("Debugger.paused", (event) => {
    clearTimeout(timer);
    const frames = (event.params.callFrames || []).slice(0, maxFrames).map((f) =>
      (f.functionName || "(anonymous)") + " " + (f.url || "?") + ":" + (f.location.lineNumber + 1) + ":" + (f.location.columnNumber + 1));
    try { session.post("Debugger.resume", () => finish(frames, null)); }
    catch { finish(frames, null); }
  });
  session.post("Debugger.enable", (err) => {
    if (err) { clearTimeout(timer); return profileFallback("debugger unavailable"); }
    session.post("Debugger.pause", (e) => { if (e) { clearTimeout(timer); profileFallback("pause failed"); } });
  });
}
const tick = setInterval(() => {
  if (busy) return;
  const now = Date.now();
  const cool = lastGotStack ? cooldownMs : retryCooldownMs;
  if (now - last >= stallMs && now - lastStackAt >= cool) capture();
}, Math.max(50, Math.floor(stallMs / 4)));
parentPort.on("close", () => clearInterval(tick));
`;

/** Start both probes; returns the stop. */
export function startEventLoopLagMonitor(log: LoopLagLogger, options: LoopLagOptions = {}): () => void {
  const reportMs = options.reportMs ?? LAG_REPORT_MS;
  const stallMs = options.stallMs ?? STALL_MS;
  const cooldownMs = options.stackCooldownMs ?? STACK_COOLDOWN_MS;
  let histogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
  try {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
  } catch {
    histogram = null;
  }

  const report = setInterval(() => {
    if (!histogram || histogram.count === 0) return;
    try {
      log.info(
        `[loop-lag] p50 ${ms(histogram.percentile(50))} ms, p99 ${ms(histogram.percentile(99))} ms, max ${ms(histogram.max)} ms over ${Math.round(reportMs / 1000)} s`,
      );
    } finally {
      histogram.reset();
    }
  }, reportMs);
  report.unref?.();

  // The stall line: the gap between two heartbeats, measured on the main
  // thread once it is back. The stack, when the watchdog read one during the
  // block, arrives first and waits here.
  let pendingStack: string[] | null = null;
  let pendingReason: string | null = null;
  let last = performance.now();
  const beat = setInterval(() => {
    const now = performance.now();
    const gap = now - last - HEARTBEAT_MS;
    last = now;
    try {
      watchdog?.postMessage("beat");
    } catch {
      /* the watchdog is best effort */
    }
    if (gap >= stallMs) {
      const blocked = Math.round(gap);
      // The watchdog's stack message is delivered after this timer; give it
      // a moment, then write one line with whatever arrived.
      const write = setTimeout(() => {
        const stack = pendingStack;
        const reason = pendingReason;
        pendingStack = null;
        pendingReason = null;
        const detail = stack
          ? `; stack during the block:\n  ${stack.join("\n  ")}`
          : reason
            ? ` (no stack; ${reason})`
            : " (no stack)";
        log.warn(`[loop-lag] event loop blocked ${blocked} ms${detail}`);
      }, STACK_WAIT_MS);
      write.unref?.();
    }
  }, HEARTBEAT_MS);
  beat.unref?.();

  let watchdog: Worker | null = null;
  if (options.stacks !== false) {
    try {
      watchdog = new Worker(WATCHDOG_SOURCE, {
        eval: true,
        workerData: {
          stallMs,
          cooldownMs,
          retryCooldownMs: Math.min(STACK_RETRY_COOLDOWN_MS, cooldownMs),
          maxFrames: MAX_FRAMES,
          profileMs: PROFILE_MS,
        },
        // A small thread: it only counts heartbeats.
        resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 },
      });
      watchdog.unref();
      watchdog.on("message", (message: { stack?: string[] | null; reason?: string | null }) => {
        if (Array.isArray(message?.stack) && message.stack.length) {
          pendingStack = message.stack.map(String);
          pendingReason = typeof message.reason === "string" ? message.reason : null;
        } else if (typeof message?.reason === "string" && message.reason) {
          pendingReason = message.reason;
        }
      });
      watchdog.on("error", () => {
        watchdog = null;
      });
    } catch {
      watchdog = null;
    }
  }

  return () => {
    clearInterval(report);
    clearInterval(beat);
    histogram?.disable();
    void watchdog?.terminate();
    watchdog = null;
  };
}
