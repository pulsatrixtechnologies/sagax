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
//   main thread is blocked) reaches the main thread through one
//   `inspector.Session.connectToMainThread()`.
//
// #3473: a block that reaches LONG_STALL_MS gets a stack every time, cooldown
// or not, so each long block names its path. The stall line also gives the
// process size at that moment.
//
// #3524: the stack is read from one second (LONG_STALL_MS = STALL_MS), so
// every stall line names its path; and the line gives the garbage
// collection time inside the block.
//
// #1750: when Debugger.pause returned nothing, the watchdog sampled a short
// CPU profile instead.
//
// #3629: a pause lands on the first JavaScript function the main thread
// ENTERS after the stop, which is rarely the one that did the work (two fix
// lots chased functions named that way). The main thread is now sampled all
// the time at a low rate (SAMPLE_INTERVAL_MS) in windows of WINDOW_MS: the
// worker starts the first window itself (so a block at start is covered),
// then the main thread rotates them with `inspector.console.profile` /
// `profileEnd`, the next window started before the last one ends so the
// profiler is never torn down (a restart walks the whole heap, hundreds of
// milliseconds on a big one). A window in which no stop was seen is dropped
// unread. When the heartbeat shows a stop, the window covering it is read
// once the main thread is back, cut to the stopped stretch with the samples'
// timestamps, and the line says what RAN during it: the functions with the
// most self time and their share, then the heaviest stack. A stop inside
// native code called from JavaScript (a synchronous file write, a process
// start, a SQLite statement, a hash) shows as self time of that call. When
// the profiler cannot start, Debugger.pause is the fallback and the line
// says `stack after the block`.
//
// Never throws at the caller: without workers or the inspector, the lag
// summary and the stall line still work.
import { createRequire } from "node:module";
import { monitorEventLoopDelay, PerformanceObserver } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

export const LAG_REPORT_MS = 60_000;
export const STALL_MS = 1_000;
/** A block this long gets a stack whatever the cooldown (#3473); from one
 * second, the stall threshold itself, since #3524. Only the pause fallback
 * has a cooldown: a sampled window read costs little, so every stop gets its
 * names (#3629). */
export const LONG_STALL_MS = 1_000;
export const STACK_COOLDOWN_MS = 5 * 60_000;
/** After a capture that returned no frames, try again sooner (#1750). */
export const STACK_RETRY_COOLDOWN_MS = 15_000;
/** The sampling period of the main thread (#3629): 10 ms cost about 0.9% of one
 * core on a loop busy at 30%, 20 ms about 0.6%, so 20. */
export const SAMPLE_INTERVAL_MS = 20;
/** The length of a sampled window (#3629): bounds the profile the worker holds. */
export const WINDOW_MS = 30_000;
/** At most this many functions by self time on a stall line. */
export const MAX_TOP_FUNCTIONS = 8;
const HEARTBEAT_MS = 200;
const MAX_FRAMES = 25;
const STACK_WAIT_MS = 800;
/** A window larger than this is dropped with one line, never read (#3629). */
const MAX_PROFILE_NODES = 200_000;
const MAX_PROFILE_SAMPLES = 1_000_000;

export interface LoopLagLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface LoopLagOptions {
  reportMs?: number;
  stallMs?: number;
  stackCooldownMs?: number;
  /** A block this long reads a stack even inside the cooldown. */
  longStallMs?: number;
  /** Name what blocked the thread through a watchdog worker (default true). */
  stacks?: boolean;
  /** Sample the main thread (default true); false keeps the pause fallback. */
  sampling?: boolean;
  /** The sampled window's length (default WINDOW_MS). */
  windowMs?: number;
  /** Seen by tests: a window rotated without being read, or read for a stop. */
  onWindow?: (event: "dropped" | "read") => void;
}

const ms = (ns: number) => Math.round(ns / 1e6);

/** One garbage collection, on the performance timeline (milliseconds). */
export interface GcSpan {
  start: number;
  duration: number;
  /** "major" (mark-compact), "minor" (scavenge) or another kind */
  kind: string;
}

const GC_KEEP = 64;

/** The collection time inside [from, to] (performance.now() times), the
 * major share apart. */
export function gcWithin(spans: readonly GcSpan[], from: number, to: number): { total: number; major: number } {
  let total = 0, major = 0;
  for (const span of spans) {
    const overlap = Math.min(to, span.start + span.duration) - Math.max(from, span.start);
    if (overlap <= 0) continue;
    total += overlap;
    if (span.kind === "major") major += overlap;
  }
  return { total, major };
}

/** "major", "minor", ... from a gc performance entry (node 16+ detail.kind). */
function gcKind(entry: { detail?: unknown; kind?: unknown }): string {
  const kind = (entry.detail as { kind?: unknown } | undefined)?.kind ?? entry.kind;
  switch (kind) {
    case 4: return "major";
    case 1: return "minor";
    case 2: return "incremental";
    case 8: return "weak";
    default: return "other";
  }
}

/** A sampled window, as the worker reads it: the V8 profile and the
 * process.hrtime (microseconds) taken just before it started and ended, to
 * map the profile's own clock onto the heartbeat's. */
export interface SampledWindow {
  profile: {
    nodes: { id: number; callFrame?: { functionName?: string; url?: string; lineNumber?: number }; children?: number[] }[];
    startTime: number;
    endTime: number;
    samples: number[];
    timeDeltas: number[];
  };
  startHr: number;
  endHr: number;
}

export interface RanDuring {
  /** samples inside the stretch */
  samples: number;
  /** "name file:line share%", the most self time first */
  top: string[];
  /** the heaviest stack, innermost frame first */
  stack: string[];
}

/** What ran during [fromHr, toHr] (process.hrtime microseconds) in these
 * windows: self time per function and the heaviest stack, the idle loop
 * around the stop left out. Null when no busy sample falls inside. Plain JavaScript inside: the watchdog evaluates the
 * same source (RAN_DURING_SOURCE). */
export const ranDuring: (windows: readonly SampledWindow[], fromHr: number, toHr: number, maxTop: number, maxFrames: number) => RanDuring | null =
  // eslint-disable-next-line no-new-func
  new Function(`return ${ranDuringSource()}`)() as never;

function ranDuringSource(): string {
  return `function ranDuring(windows, fromHr, toHr, maxTop, maxFrames) {
  const label = (call) => {
    const name = (call && call.functionName) || "(anonymous)";
    const url = (call && call.url) || "";
    if (!url) return name;
    const file = url.split("?")[0].split(/[\\\\/]/).pop() || url;
    return name + " " + file + ":" + ((call.lineNumber || 0) + 1);
  };
  const self = new Map();
  const stacks = new Map();
  let total = 0;
  for (const w of windows) {
    const p = w.profile;
    // the profile clock minus the hrtime clock: each estimate is late by the
    // time the main thread took to act on it, so the smaller one is closer
    const offset = Math.min(p.startTime - w.startHr, p.endTime - w.endHr);
    const lo = fromHr + offset, hi = toHr + offset;
    if (p.endTime < lo || p.startTime > hi) continue;
    const byId = new Map();
    for (const node of p.nodes) byId.set(node.id, node);
    const parent = new Map();
    for (const node of p.nodes) for (const child of node.children || []) parent.set(child, node.id);
    const hits = new Map();
    let t = p.startTime;
    for (let i = 0; i < p.samples.length; i++) {
      t += p.timeDeltas[i] || 0;
      if (t < lo) continue;
      if (t > hi) break;
      hits.set(p.samples[i], (hits.get(p.samples[i]) || 0) + 1);
    }
    for (const [id, n] of hits) {
      const node = byId.get(id);
      // the loop waiting for work around the stop is not part of it
      if (!node || (node.callFrame && node.callFrame.functionName === "(idle)")) continue;
      total += n;
      const key = label(node.callFrame);
      self.set(key, (self.get(key) || 0) + n);
      const frames = [];
      for (let at = id; at !== undefined && frames.length < maxFrames; at = parent.get(at)) {
        const frame = byId.get(at);
        if (!frame || (frame.callFrame && frame.callFrame.functionName === "(root)")) break;
        frames.push(label(frame.callFrame));
      }
      const stackKey = frames.join("\\n");
      stacks.set(stackKey, (stacks.get(stackKey) || 0) + n);
    }
  }
  if (!total) return null;
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxTop)
    .map(([key, n]) => key + " " + Math.round((100 * n) / total) + "%");
  let heaviest = "", most = 0;
  for (const [key, n] of stacks) if (n > most) { most = n; heaviest = key; }
  return { samples: total, top, stack: heaviest ? heaviest.split("\\n") : [] };
}`;
}

/** The watchdog worker: plain JavaScript, evaluated, so it needs no file in
 * the bundle. It enables the profiler on the main thread and starts the
 * first sampled window; the main thread rotates the next ones and sends, on
 * each heartbeat, the window it ended and the stopped stretch if any. When
 * the profiler cannot start, a stop is named by pausing the main thread
 * (the stack after the block). */
const WATCHDOG_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
let inspector = null;
try { inspector = require("node:inspector"); } catch {}
const { stallMs, longStallMs, cooldownMs, retryCooldownMs, maxFrames, maxTop, sampleIntervalUs, sampling, maxNodes, maxSamples } = workerData;
const ranDuring = ${ranDuringSource()};
const hrUs = () => Number(process.hrtime.bigint() / 1000n);
let last = Date.now();
let lastStackAt = 0;
// The heartbeat a capture was taken for: one capture per block.
let capturedFor = -1;
let lastGotStack = false;
let busy = false;
let inspectorMissingLogged = false;
let session = null;
// "starting" until the profiler answers, then "sampling" or "pause"
let mode = "pause";
// title -> { profile, info: { startHr, endHr, stall } } until both halves are in
const ending = new Map();
// the last windows read in full (at most two): a stretch can start in the previous one
const finished = [];
let frontendStall = null;

function post(message) { try { parentPort.postMessage(message); } catch {} }

function connect() {
  if (session) return true;
  if (!inspector || typeof inspector.Session !== "function") return false;
  try {
    session = new inspector.Session();
    session.connectToMainThread();
    return true;
  } catch {
    session = null;
    return false;
  }
}

function settle(title) {
  const entry = ending.get(title);
  if (!entry || !entry.profile || !entry.info) return;
  ending.delete(title);
  const { profile, info } = entry;
  let reason = null;
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) reason = "profile unreadable";
  else if (profile.nodes.length > maxNodes || profile.samples.length > maxSamples) reason = "profile too large";
  if (!reason) {
    finished.push({ profile, startHr: info.startHr, endHr: info.endHr });
    while (finished.length > 2) finished.shift();
  }
  if (!info.stall) { post({ window: "dropped" }); return; }
  if (reason) { post({ window: "read", ran: null, reason }); return; }
  try {
    const ran = ranDuring(finished, info.stall[0], info.stall[1], maxTop, maxFrames);
    post({ window: "read", ran, reason: ran ? null : "no sample in the block", interval: sampleIntervalUs / 1000 });
  } catch {
    post({ window: "read", ran: null, reason: "profile unreadable" });
  }
}

function windowEnded(title, part) {
  const entry = ending.get(title) || {};
  Object.assign(entry, part);
  ending.set(title, entry);
  // a window whose profile never comes is not kept forever
  if (ending.size > 4) ending.delete(ending.keys().next().value);
  settle(title);
}

function startSampling() {
  if (!sampling || !connect()) return;
  mode = "starting";
  try {
    session.on("Profiler.consoleProfileFinished", (event) => {
      const params = event && event.params;
      if (params && typeof params.title === "string") windowEnded(params.title, { profile: params.profile || null });
    });
    session.post("Profiler.enable", (err) => {
      if (err) { mode = "pause"; return; }
      session.post("Profiler.setSamplingInterval", { interval: sampleIntervalUs }, (intervalErr) => {
        if (intervalErr) { mode = "pause"; return; }
        // the first window: started from here, so a block at start is covered
        const startHr = hrUs();
        session.post("Profiler.start", (startErr) => {
          if (startErr) { mode = "pause"; return; }
          mode = "sampling";
          frontendStartHr = startHr;
          post({ sampling: true });
        });
      });
    });
  } catch {
    mode = "pause";
  }
}
let frontendStartHr = 0;

function endFrontend() {
  const endHr = hrUs();
  const stall = frontendStall;
  frontendStall = null;
  try {
    session.post("Profiler.stop", (err, result) => {
      windowEnded("first", { profile: (!err && result && result.profile) || null, info: { startHr: frontendStartHr, endHr, stall } });
    });
  } catch {
    if (stall) post({ window: "read", ran: null, reason: "profile unreadable" });
  }
}

function capture() {
  capturedFor = last;
  if (!connect()) {
    if (!inspectorMissingLogged) {
      inspectorMissingLogged = true;
      post({ stack: null, reason: "inspector unavailable", at: Date.now() });
    }
    return;
  }
  busy = true;
  lastStackAt = Date.now();
  const finish = (frames, reason) => {
    busy = false;
    lastGotStack = Boolean(frames && frames.length);
    try { session.post("Debugger.disable", () => {}); } catch {}
    post({ stack: frames || null, reason: reason || null, at: Date.now() });
  };
  const timer = setTimeout(() => finish(null, "pause timed out"), 5000);
  session.once("Debugger.paused", (event) => {
    clearTimeout(timer);
    const frames = (event.params.callFrames || []).slice(0, maxFrames).map((f) => {
      const name = f.functionName || "(anonymous)";
      const file = (f.url || "?").split("?")[0].split(/[\\\\/]/).pop();
      return name + " " + file + ":" + (f.location.lineNumber + 1);
    });
    try { session.post("Debugger.resume", () => finish(frames, null)); }
    catch { finish(frames, null); }
  });
  try {
    session.post("Debugger.enable", (err) => {
      if (err) { clearTimeout(timer); return finish(null, "debugger unavailable"); }
      session.post("Debugger.pause", (e) => { if (e) { clearTimeout(timer); finish(null, "pause failed"); } });
    });
  } catch {
    clearTimeout(timer);
    finish(null, "capture failed");
  }
}

parentPort.on("message", (m) => {
  last = Date.now();
  if (!m || m === "beat") return;
  if (m.endFirst) { if (mode === "sampling") endFrontend(); return; }
  if (m.ended) { windowEnded(m.ended.title, { info: { startHr: m.ended.startHr, endHr: m.ended.endHr, stall: m.stall || null } }); return; }
  // a stop before the main thread took the windows over: it is in the first one
  if (m.stall && mode === "sampling") frontendStall = m.stall;
});
startSampling();
const tick = setInterval(() => {
  // the pause fallback only: a sampled window is read once the thread is back
  if (busy || mode !== "pause") return;
  const now = Date.now();
  const cool = lastGotStack ? cooldownMs : retryCooldownMs;
  if (now - last >= stallMs && now - lastStackAt >= cool) capture();
  else if (now - last >= longStallMs && capturedFor !== last) capture();
}, Math.max(50, Math.floor(stallMs / 4)));
parentPort.on("close", () => clearInterval(tick));
`;

interface InspectorConsole {
  profile(label?: string): void;
  profileEnd(label?: string): void;
}

function inspectorConsole(): InspectorConsole | null {
  try {
    const consoleApi = (createRequire(import.meta.url)("node:inspector") as { console?: InspectorConsole }).console;
    return consoleApi && typeof consoleApi.profile === "function" && typeof consoleApi.profileEnd === "function" ? consoleApi : null;
  } catch {
    return null;
  }
}

const hrUs = () => Number(process.hrtime.bigint() / 1000n);
let monitorCount = 0;

type WatchdogMessage = {
  stack?: string[] | null;
  reason?: string | null;
  sampling?: boolean;
  window?: "dropped" | "read";
  ran?: { samples?: number; top?: unknown; stack?: unknown } | null;
  interval?: number;
};

/** Start both probes; returns the stop. */
export function startEventLoopLagMonitor(log: LoopLagLogger, options: LoopLagOptions = {}): () => void {
  const reportMs = options.reportMs ?? LAG_REPORT_MS;
  const stallMs = options.stallMs ?? STALL_MS;
  const cooldownMs = options.stackCooldownMs ?? STACK_COOLDOWN_MS;
  const longStallMs = Math.max(stallMs, options.longStallMs ?? LONG_STALL_MS);
  const windowMs = Math.max(HEARTBEAT_MS, options.windowMs ?? WINDOW_MS);
  const monitorId = ++monitorCount;
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

  // What the watchdog said about the last stop: what ran during it (the
  // sampled window), else the stack after it (the pause fallback), else why
  // neither. It arrives first and waits here for the line.
  let pendingRan: { samples: number; top: string[]; stack: string[]; interval: number } | null = null;
  let pendingStack: string[] | null = null;
  let pendingReason: string | null = null;
  // the recent collections, so a stall line can say how much of it was one
  const gcSpans: GcSpan[] = [];
  let gcObserver: PerformanceObserver | null = null;
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) gcSpans.push({ start: entry.startTime, duration: entry.duration, kind: gcKind(entry as never) });
      if (gcSpans.length > GC_KEEP) gcSpans.splice(0, gcSpans.length - GC_KEEP);
    });
    gcObserver.observe({ entryTypes: ["gc"] });
  } catch {
    gcObserver = null;
  }

  // The sampled windows the main thread rotates once the watchdog started
  // the first one (#3629).
  const consoleApi = options.stacks !== false && options.sampling !== false ? inspectorConsole() : null;
  let sampling = false;
  let windowSeq = 0;
  let current: { title: string; startHr: number; startedAt: number } | null = null;
  const openWindow = () => {
    const title = `loop-lag-${monitorId}-${++windowSeq}`;
    const startHr = hrUs();
    consoleApi!.profile(title);
    return { title, startHr, startedAt: performance.now() };
  };
  /** Start the next window, then end the current one: the profiler stays up. */
  const rotate = (stall: [number, number] | null) => {
    const ended = current;
    try {
      current = openWindow();
      if (!ended) return;
      const endHr = hrUs();
      watchdog?.postMessage({ ended: { title: ended.title, startHr: ended.startHr, endHr }, stall });
      consoleApi!.profileEnd(ended.title);
    } catch {
      sampling = false;
    }
  };

  let last = performance.now();
  let lastHr = hrUs();
  const beat = setInterval(() => {
    const now = performance.now();
    const nowHr = hrUs();
    const gap = now - last - HEARTBEAT_MS;
    const stall: [number, number] | null = gap >= stallMs ? [lastHr, nowHr] : null;
    last = now;
    lastHr = nowHr;
    try {
      if (sampling && current && (stall || now - current.startedAt >= windowMs)) rotate(stall);
      else watchdog?.postMessage(stall ? { stall } : "beat");
    } catch {
      /* the watchdog is best effort */
    }
    if (stall) {
      const blocked = Math.round(gap);
      const from = now - gap - HEARTBEAT_MS;
      // The watchdog's answer is delivered after this timer; give it a
      // moment, then write one line with whatever arrived.
      const write = setTimeout(() => {
        const ran = pendingRan;
        const stack = pendingStack;
        const reason = pendingReason;
        pendingRan = null;
        pendingStack = null;
        pendingReason = null;
        const detail = ran
          ? `; ran during the block (${ran.samples} samples every ${ran.interval} ms): ${ran.top.join(", ")}${ran.stack.length ? `; heaviest stack:\n  ${ran.stack.join("\n  ")}` : ""}`
          : stack
            ? `; stack after the block:\n  ${stack.join("\n  ")}`
            : reason
              ? ` (no stack; ${reason})`
              : " (no stack)";
        const { rss, heapUsed } = process.memoryUsage();
        const gc = gcWithin(gcSpans, from, now);
        const gcPart = gc.total >= 1
          ? `, of which gc ${Math.round(gc.total)} ms${gc.major >= 1 ? ` (major ${Math.round(gc.major)} ms)` : ""}${gc.total * 2 > blocked ? ", mostly garbage collection" : ""}`
          : "";
        log.warn(`[loop-lag] event loop blocked ${blocked} ms (rss ${Math.round(rss / 1048576)} MB, heap ${Math.round(heapUsed / 1048576)} MB)${gcPart}${detail}`);
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
          longStallMs,
          cooldownMs,
          retryCooldownMs: Math.min(STACK_RETRY_COOLDOWN_MS, cooldownMs),
          maxFrames: MAX_FRAMES,
          maxTop: MAX_TOP_FUNCTIONS,
          sampleIntervalUs: SAMPLE_INTERVAL_MS * 1000,
          sampling: consoleApi !== null,
          maxNodes: MAX_PROFILE_NODES,
          maxSamples: MAX_PROFILE_SAMPLES,
        },
        // A small thread: heartbeats, and at most two sampled windows.
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 },
      });
      watchdog.unref();
      watchdog.on("message", (message: WatchdogMessage) => {
        if (message?.sampling === true) {
          // The watchdog's first window is up: take the next ones over.
          if (!consoleApi || sampling) return;
          try {
            current = openWindow();
            sampling = true;
            watchdog?.postMessage({ endFirst: true });
          } catch {
            sampling = false;
          }
          return;
        }
        if (message?.window) {
          options.onWindow?.(message.window);
          if (message.window !== "read") return;
          const ran = message.ran;
          if (ran && Array.isArray(ran.top) && ran.top.length) {
            pendingRan = {
              samples: Number(ran.samples) || 0,
              top: ran.top.map(String),
              stack: Array.isArray(ran.stack) ? ran.stack.map(String) : [],
              interval: Number(message.interval) || SAMPLE_INTERVAL_MS,
            };
          } else if (typeof message.reason === "string" && message.reason) {
            pendingReason = message.reason;
          }
          return;
        }
        if (Array.isArray(message?.stack) && message.stack.length) {
          pendingStack = message.stack.map(String);
          pendingReason = typeof message.reason === "string" ? message.reason : null;
        } else if (typeof message?.reason === "string" && message.reason) {
          pendingReason = message.reason;
        }
      });
      watchdog.on("error", () => {
        watchdog = null;
        sampling = false;
      });
    } catch {
      watchdog = null;
    }
  }

  return () => {
    clearInterval(report);
    clearInterval(beat);
    gcObserver?.disconnect();
    histogram?.disable();
    if (sampling && current) {
      try {
        consoleApi?.profileEnd(current.title);
      } catch {
        /* nothing to end */
      }
    }
    sampling = false;
    current = null;
    void watchdog?.terminate();
    watchdog = null;
  };
}
