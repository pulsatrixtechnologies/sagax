// Prompt-cache keep-warm for bot threads.
//
// Ported from the design of Cache Tax (MIT, Copyright (c) 2026 Karan Bansal,
// https://github.com/karanb192/claude-code-mods, hooks/register.ts): bots run
// Claude Code with project-only settings, so a person's own Claude Code
// plugins never reach them. A bot that sits idle past the provider's cache
// lifetime with a big context pays to re-write all of it on the next
// message; a cheap cache read every ~50 idle minutes keeps it warm instead.
//
// After each completed turn of a thread whose context is big enough to
// matter (MIN_CONTEXT_TOKENS), a bounded window is armed (the setting's
// "for", 3h by default). While the thread is idle inside it, ONE ping is
// sent per idle stretch, PING_AFTER_MS after the last request: a tool-less
// request forked from the thread's live session (the driver's
// cacheKeepWarm.ping), which never changes the conversation. Its usage is
// read after every ping, and the window stops for good if the ping read
// nothing from the cache or wrote at least a tenth of what it read (the
// cache was already gone, so pinging again would only pay to re-write it).
// It also stops at its deadline, on a failed ping, at the spend cap and when
// the account's usage limit refuses a ping. There is no polling loop: one
// timer per window, re-armed after each ping and each turn.
//
// Only engines whose prompt cache lives an hour: a subscription (Pro/Max)
// login. A metered API key's main cache lives five minutes by default, and a
// ping every four minutes costs more than the one re-write it avoids after
// about 50 minutes of idle, so API-key engines are never pinged.
//
// Nothing is persisted. After a restart the live session is gone, and the
// next turn relaunches the CLI with a freshly computed system prompt, which
// misses the cache whatever was warmed; a window that survived a restart
// could only spend money.

import type { CacheWarmPingResult } from "./contracts.ts";
import type { CacheKeepWarmStatus } from "../shared/wire.ts";

export const CACHE_TTL_MS = 60 * 60_000;
export const PING_AFTER_MS = 50 * 60_000;
/** A busy bot is asked again this much later, while the cache is still warm. */
export const BUSY_RETRY_MS = 60_000;
export const MIN_CONTEXT_TOKENS = 50_000;
export const DEFAULT_WINDOW_MINUTES = 180;
export const MAX_WINDOW_MINUTES = 24 * 60;
/** Cache Tax's stop rule: a warm ping writes only its own few tokens. */
export const MAX_WRITE_RATIO = 0.1;

export interface KeepWarmTarget {
  threadId: string;
  botId: string;
  instanceId: string;
}

export type KeepWarmPingResult = CacheWarmPingResult;

/** The status a client shows, per thread (shared/wire.ts). */
export type KeepWarmStatus = CacheKeepWarmStatus;

export interface KeepWarmDeps {
  now: () => number;
  /** one-shot timer; the window never keeps more than one */
  after: (ms: number, fn: () => void) => { cancel: () => void };
  /** the window this bot's threads get, or null when keep-warm is off for it */
  windowMs: (botId: string) => number | null;
  /** why this target cannot be warmed now (engine not on a subscription,
   * thread gone, engine without keep-warm), or null when it can */
  ineligible: (target: KeepWarmTarget) => string | null;
  /** a turn is running for this bot or in this thread */
  busy: (target: KeepWarmTarget) => boolean;
  /** the workspace's spend cap is reached */
  overBudget: () => boolean;
  ping: (target: KeepWarmTarget, signal: AbortSignal) => Promise<KeepWarmPingResult>;
  /** keep the live session open until `until`, or release it (null) */
  hold: (target: KeepWarmTarget, until: number | null) => void;
  /** book a ping's usage in the ledger (spend tracking and the cap) */
  book: (target: KeepWarmTarget, result: Extract<KeepWarmPingResult, { ok: true }>) => void;
  /** a thread's status changed */
  changed: (target: KeepWarmTarget) => void;
}

interface Window {
  target: KeepWarmTarget;
  deadline: number;
  /** the last request that refreshed the cache: a turn's end or a warm ping */
  lastRequestAt: number;
  pending: { cancel: () => void } | null;
  nextPingAt: number | null;
  inflight: AbortController | null;
  /** a turn is running: no timer until it completes */
  paused: boolean;
}

export function fmtTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** A ping that read the prefix and wrote only its own message. */
export function pingWasWarm(read: number, write: number): boolean {
  return read > 0 && write < MAX_WRITE_RATIO * read;
}

export function createCacheKeepWarm(deps: KeepWarmDeps) {
  const windows = new Map<string, Window>();
  const lastPing = new Map<string, NonNullable<KeepWarmStatus["last"]>>();
  const stoppedWhy = new Map<string, string>();
  let disposed = false;

  const disarm = (w: Window) => {
    w.pending?.cancel();
    w.pending = null;
    w.nextPingAt = null;
  };

  /** Ends a window. A reason is kept for the status until the next turn. */
  const end = (w: Window, why: string | null) => {
    disarm(w);
    w.inflight?.abort();
    w.inflight = null;
    if (windows.get(w.target.threadId) === w) windows.delete(w.target.threadId);
    if (why) stoppedWhy.set(w.target.threadId, why);
    deps.hold(w.target, null);
    deps.changed(w.target);
  };

  const arm = (w: Window) => {
    disarm(w);
    if (disposed || w.paused || windows.get(w.target.threadId) !== w) return;
    const now = deps.now();
    if (now >= w.deadline) return end(w, null);
    // A cold cache is never pinged: that would pay the re-write it avoids.
    const untilCold = w.lastRequestAt + CACHE_TTL_MS - now;
    if (untilCold <= 0) return end(w, null);
    const due = Math.max(1000, w.lastRequestAt + PING_AFTER_MS - now);
    const delay = Math.min(w.deadline - now, untilCold, due);
    w.nextPingAt = now + due < w.deadline && due < untilCold ? now + due : null;
    w.pending = deps.after(delay, () => { void ping(w); });
    deps.changed(w.target);
  };

  const ping = async (w: Window) => {
    w.pending = null;
    if (disposed || w.paused || windows.get(w.target.threadId) !== w) return;
    const now = deps.now();
    if (now >= w.deadline || now - w.lastRequestAt >= CACHE_TTL_MS) return end(w, null);
    // The timer fired early for this stretch (a turn re-armed it): wait more.
    if (now - w.lastRequestAt < PING_AFTER_MS - 1000) return arm(w);
    if (deps.windowMs(w.target.botId) === null) return end(w, null);
    const ineligible = deps.ineligible(w.target);
    if (ineligible) return end(w, ineligible);
    if (deps.overBudget()) return end(w, "the workspace's monthly spend limit is reached");
    if (deps.busy(w.target)) return retryLater(w, now);
    const controller = new AbortController();
    w.inflight = controller;
    let result: KeepWarmPingResult;
    try {
      result = await deps.ping(w.target, controller.signal);
    } catch (error) {
      result = { ok: false, reason: `the ping failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (w.inflight === controller) w.inflight = null;
    // Whatever happened to the window meanwhile, a ping that ran is booked.
    if (result.ok) {
      try { deps.book(w.target, result); } catch { /* bookkeeping never fails the window */ }
    }
    if (disposed || windows.get(w.target.threadId) !== w || controller.signal.aborted) return;
    if (!result.ok) {
      if (result.busy) return retryLater(w, deps.now());
      return end(w, result.reason);
    }
    const warm = pingWasWarm(result.cacheRead, result.cacheWrite);
    lastPing.set(w.target.threadId, { at: now, read: result.cacheRead, write: result.cacheWrite, costUsd: result.costUsd });
    if (!warm) {
      return end(w, `the ping read ${fmtTokens(result.cacheRead)} and wrote ${fmtTokens(result.cacheWrite)} tokens: the cache was already gone`);
    }
    w.lastRequestAt = now;
    arm(w);
  };

  /** A busy bot is asked again in a minute, while the cache is still warm. */
  const retryLater = (w: Window, now: number) => {
    disarm(w);
    const untilCold = w.lastRequestAt + CACHE_TTL_MS - now;
    if (untilCold <= BUSY_RETRY_MS || now + BUSY_RETRY_MS >= w.deadline) return end(w, null);
    w.nextPingAt = now + BUSY_RETRY_MS;
    w.pending = deps.after(BUSY_RETRY_MS, () => { void ping(w); });
    deps.changed(w.target);
  };

  return {
    /** A turn started in this thread: no ping while it runs. */
    noteTurnStarted(threadId: string): void {
      const w = windows.get(threadId);
      if (!w) return;
      w.paused = true;
      disarm(w);
      w.inflight?.abort();
      w.inflight = null;
      deps.changed(w.target);
    },

    /** A turn completed: arm (or extend) the thread's window when it qualifies. */
    noteTurnCompleted(target: KeepWarmTarget, turn: { ok: boolean; stopReason?: string | null; contextTokens?: number }): void {
      if (disposed) return;
      const existing = windows.get(target.threadId);
      const hadStopped = stoppedWhy.delete(target.threadId);
      const windowMs = deps.windowMs(target.botId);
      const quiet = (w: Window | undefined) => {
        const hadLast = lastPing.delete(target.threadId);
        if (w) end(w, null);
        else if (hadStopped || hadLast) deps.changed(target);
      };
      if (windowMs === null || !turn.ok) return quiet(existing);
      if ((turn.contextTokens ?? 0) < MIN_CONTEXT_TOKENS) return quiet(existing);
      if (deps.ineligible(target)) return quiet(existing);
      const now = deps.now();
      const w: Window = existing ?? { target, deadline: 0, lastRequestAt: now, pending: null, nextPingAt: null, inflight: null, paused: false };
      w.target = target;
      w.deadline = now + windowMs;
      w.lastRequestAt = now;
      w.paused = false;
      windows.set(target.threadId, w);
      deps.hold(target, w.deadline);
      arm(w);
    },

    /** The thread was deleted, or its engine changed: end its window quietly. */
    cancelThread(threadId: string): void {
      stoppedWhy.delete(threadId);
      lastPing.delete(threadId);
      const w = windows.get(threadId);
      if (w) end(w, null);
    },

    /** The bot was deleted, or its keep-warm was switched off. */
    cancelBot(botId: string): void {
      for (const w of windows.values()) if (w.target.botId === botId) end(w, null);
    },

    /** The workspace setting changed: windows of bots now off end. */
    refresh(): void {
      for (const w of windows.values()) if (deps.windowMs(w.target.botId) === null) end(w, null);
    },

    status(threadId: string): KeepWarmStatus | undefined {
      const w = windows.get(threadId);
      const last = lastPing.get(threadId);
      if (w) {
        return {
          state: "warm",
          until: w.deadline,
          ...(w.nextPingAt !== null && !w.paused ? { nextPingAt: w.nextPingAt } : {}),
          ...(last ? { last } : {}),
        };
      }
      const why = stoppedWhy.get(threadId);
      return why ? { state: "stopped", stopped: why, ...(last ? { last } : {}) } : undefined;
    },

    /** App quit: every timer and in-flight ping goes, and every hold. */
    dispose(): void {
      disposed = true;
      for (const w of windows.values()) {
        disarm(w);
        w.inflight?.abort();
        deps.hold(w.target, null);
      }
      windows.clear();
    },
  };
}

export type CacheKeepWarm = ReturnType<typeof createCacheKeepWarm>;
