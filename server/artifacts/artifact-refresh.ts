// The artifact refresher (docs/superpowers/specs/2026-10-16-artifacts-design.md,
// "Refresh"): re-runs a saved source on its interval, with no model turn,
// and stores the JSON it answered.
//
// Sober by design: an artifact refreshes only while it is visible (a client
// holds a watch lease because its dialog or window is open) or a favorite.
// Nothing runs for an artifact nobody looks at. A paused artifact waits for
// the bot (update_artifact paused false) or Refresh now. Runs are bounded:
// two at once, 30 seconds each.
import type { Artifact } from "../../shared/artifacts.ts";
import type { ArtifactRun, ArtifactStore } from "./artifacts.ts";

export const REFRESH_TICK_MS = 5_000;
export const WATCH_LEASE_MS = 90_000;
export const RUN_TIMEOUT_MS = 30_000;
export const MAX_CONCURRENT_RUNS = 2;
export const OPEN_STALE_MS = 30_000;

export interface ArtifactRefresher {
  /** A viewer has these artifacts on screen: each gets a lease. */
  watch(ids: readonly string[]): void;
  /** Run now, whatever the interval, and clear a pause. */
  refreshNow(id: string): Promise<Artifact | null>;
  /** One pass of the scheduler (the timer calls it; tests too). */
  tick(): Promise<void>;
  /** Whether this artifact would refresh now: visible or a favorite. */
  active(artifact: Artifact): boolean;
  start(): void;
  stop(): void;
}

export function createArtifactRefresher(options: {
  store: ArtifactStore;
  run: (artifact: Artifact, signal: AbortSignal) => Promise<ArtifactRun>;
  now?: () => number;
  tickMs?: number;
  leaseMs?: number;
  timeoutMs?: number;
  concurrency?: number;
  log?: (line: string) => void;
  /** 2026-11-04: a source that runs as soon as its artifact opens (a new
   * lease), not on the next interval: one whose runner keeps its own short
   * cache, so opening it again and again costs nothing (dispatch_kpi). */
  refreshOnOpen?: (artifact: Artifact) => boolean;
  /** No run on open when the last one is more recent than this. */
  openStaleMs?: number;
}): ArtifactRefresher {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? WATCH_LEASE_MS;
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  const concurrency = options.concurrency ?? MAX_CONCURRENT_RUNS;
  const leases = new Map<string, number>();
  const running = new Map<string, Promise<Artifact | null>>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const leased = (id: string) => {
    const until = leases.get(id);
    if (until === undefined) return false;
    if (until > now()) return true;
    leases.delete(id);
    return false;
  };

  const active = (artifact: Artifact) => artifact.favorite || leased(artifact.id);

  const due = (artifact: Artifact) => {
    if (!artifact.source || !artifact.intervalSeconds) return false;
    if (artifact.refresh.state === "paused" || running.has(artifact.id) || !active(artifact)) return false;
    return now() - (artifact.refresh.lastRunAt ?? 0) >= artifact.intervalSeconds * 1000;
  };

  const runOne = (artifact: Artifact): Promise<Artifact | null> => {
    const existing = running.get(artifact.id);
    if (existing) return existing;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const work = (async () => {
      let result: ArtifactRun;
      try {
        result = await Promise.race([
          options.run(artifact, controller.signal),
          new Promise<ArtifactRun>((resolve) => controller.signal.addEventListener("abort", () => resolve({ ok: false, error: "The source took longer than 30 seconds." }), { once: true })),
        ]);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "The source failed." };
      } finally {
        clearTimeout(timeout);
      }
      // deleted while it ran: nothing to record
      if (!options.store.get(artifact.id)) return null;
      return options.store.recordRun(artifact.id, result);
    })().finally(() => running.delete(artifact.id));
    running.set(artifact.id, work);
    return work;
  };

  const tick = async () => {
    const free = concurrency - running.size;
    if (free <= 0) return;
    const ready = options.store.all().filter(due)
      .sort((a, b) => (a.refresh.lastRunAt ?? 0) - (b.refresh.lastRunAt ?? 0))
      .slice(0, free);
    await Promise.all(ready.map(runOne));
  };

  return {
    watch(ids) {
      const until = now() + leaseMs;
      const opened = options.refreshOnOpen ? ids.filter((id) => !leased(id)) : [];
      for (const id of ids) leases.set(id, until);
      for (const id of opened) {
        const artifact = options.store.get(id);
        if (!artifact?.source || artifact.refresh.state === "paused" || running.has(id) || !options.refreshOnOpen!(artifact)) continue;
        if (now() - (artifact.refresh.lastRunAt ?? 0) < (options.openStaleMs ?? OPEN_STALE_MS)) continue;
        if (running.size >= concurrency) continue;
        void runOne(artifact).catch(() => {});
      }
    },
    async refreshNow(id) {
      const current = options.store.get(id);
      if (!current?.source) return current;
      const resumed = options.store.resume(id) ?? current;
      return runOne(resumed);
    },
    tick,
    active,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick().catch((error: unknown) => options.log?.(`[artifacts] refresh pass failed: ${error instanceof Error ? error.message : "error"}`));
      }, options.tickMs ?? REFRESH_TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
