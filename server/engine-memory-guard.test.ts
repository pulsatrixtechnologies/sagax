import { describe, expect, it, vi } from "vitest";

import {
  IdleEnginePool,
  MemoryWatch,
  markOomVictim,
  memoryGuardSettings,
  memoryLevel,
  readCgroupMemory,
  sweepOomScores,
  type CgroupMemory,
  type ProcFs,
} from "./engine-memory-guard.ts";

const GiB = 1024 ** 3;

function files(map: Record<string, string>) {
  return (path: string) => (path in map ? map[path]! : null);
}

describe("readCgroupMemory", () => {
  it("reads cgroup v2 usage, limit, peak and OOM kills", () => {
    const memory = readCgroupMemory(files({
      "/sys/fs/cgroup/memory.current": "3151364096\n",
      "/sys/fs/cgroup/memory.max": "5368709120\n",
      "/sys/fs/cgroup/memory.peak": "4000000000\n",
      "/sys/fs/cgroup/memory.events": "low 0\nhigh 0\nmax 3\noom 1\noom_kill 2\n",
    }));
    expect(memory).toEqual({ current: 3151364096, max: 5368709120, peak: 4000000000, oomKills: 2 });
  });

  it("reads the working set: reclaimable inactive file cache is not pressure", () => {
    expect(readCgroupMemory(files({
      "/sys/fs/cgroup/memory.current": "4000",
      "/sys/fs/cgroup/memory.max": "5000",
      "/sys/fs/cgroup/memory.stat": "anon 2500\nfile 1500\nactive_file 500\ninactive_file 1000\n",
    }))?.current).toBe(3000);
    expect(readCgroupMemory(files({
      "/sys/fs/cgroup/memory/memory.usage_in_bytes": "4000",
      "/sys/fs/cgroup/memory/memory.stat": "cache 1500\ntotal_inactive_file 900\n",
    }))?.current).toBe(3100);
  });

  it("reads an unlimited v2 cgroup as no limit", () => {
    const memory = readCgroupMemory(files({ "/sys/fs/cgroup/memory.current": "100", "/sys/fs/cgroup/memory.max": "max" }));
    expect(memory?.max).toBeNull();
    expect(memoryLevel(memory, 0.75, 0.88)).toBe("unknown");
  });

  it("falls back to cgroup v1 and treats the huge v1 limit as unlimited", () => {
    expect(readCgroupMemory(files({
      "/sys/fs/cgroup/memory/memory.usage_in_bytes": "200",
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": "9223372036854771712",
    }))).toEqual({ current: 200, max: null, peak: null, oomKills: null });
  });

  it("returns null where no cgroup reports memory (desktop)", () => {
    expect(readCgroupMemory(files({}))).toBeNull();
  });
});

describe("memoryLevel", () => {
  const at = (current: number): CgroupMemory => ({ current, max: 5 * GiB, peak: null, oomKills: null });
  it("grades usage against the marks", () => {
    expect(memoryLevel(at(2 * GiB), 0.75, 0.88)).toBe("ok");
    expect(memoryLevel(at(4 * GiB), 0.75, 0.88)).toBe("high");
    expect(memoryLevel(at(4.5 * GiB), 0.75, 0.88)).toBe("critical");
  });
});

describe("IdleEnginePool", () => {
  it("keeps at most maxIdle finished sessions warm, closing the oldest", () => {
    const closed: string[] = [];
    const pool = new IdleEnginePool({ maxIdle: 2, ttlMs: 600_000 });
    for (const id of ["a", "b", "c", "d"]) pool.noteIdle(id, () => closed.push(id));
    expect(closed).toEqual(["a", "b"]);
    expect(pool.stats()).toMatchObject({ idle: 2, evictions: 2 });
  });

  it("never closes a thread whose turn started again", () => {
    const closed: string[] = [];
    const pool = new IdleEnginePool({ maxIdle: 1, ttlMs: 600_000 });
    pool.noteIdle("a", () => closed.push("a"));
    pool.noteBusy("a");
    pool.noteIdle("b", () => closed.push("b"));
    pool.noteIdle("c", () => closed.push("c"));
    expect(closed).toEqual(["b"]);
  });

  it("a thread finishing again moves to the newest end", () => {
    const closed: string[] = [];
    const pool = new IdleEnginePool({ maxIdle: 2, ttlMs: 600_000 });
    pool.noteIdle("a", () => closed.push("a"));
    pool.noteIdle("b", () => closed.push("b"));
    pool.noteIdle("a", () => closed.push("a"));
    pool.noteIdle("c", () => closed.push("c"));
    expect(closed).toEqual(["b"]);
  });

  it("keeps a live call's process and does not count it", () => {
    const closed: string[] = [];
    const pool = new IdleEnginePool({ maxIdle: 1, ttlMs: 600_000, exempt: (id) => id === "call" });
    pool.noteIdle("call", () => closed.push("call"));
    pool.noteIdle("a", () => closed.push("a"));
    expect(closed).toEqual([]);
    pool.noteIdle("b", () => closed.push("b"));
    expect(closed).toEqual(["a"]);
    expect(pool.releaseAll("test")).toBe(1);
    expect(closed).toEqual(["a", "b"]);
  });

  it("forgets entries the driver already closed on its own idle timer", () => {
    let clock = 0;
    const closed: string[] = [];
    const pool = new IdleEnginePool({ maxIdle: 1, ttlMs: 1_000, now: () => clock });
    pool.noteIdle("a", () => closed.push("a"));
    clock = 5_000;
    pool.noteIdle("b", () => closed.push("b"));
    expect(closed).toEqual([]);
    expect(pool.stats().idle).toBe(1);
  });

  it("maxIdle 0 closes each session as its turn ends; a throwing release is contained", () => {
    const pool = new IdleEnginePool({ maxIdle: 0, ttlMs: 600_000 });
    expect(() => pool.noteIdle("a", () => { throw new Error("gone"); })).not.toThrow();
    expect(pool.stats()).toMatchObject({ idle: 0, evictions: 1 });
  });
});

describe("OOM priority", () => {
  it("raises an engine's oom_score_adj, never the server's or init's", () => {
    const writes: Array<[string, string]> = [];
    const write = (path: string, text: string) => { writes.push([path, text]); };
    expect(markOomVictim(4242, 500, write)).toBe(true);
    expect(markOomVictim(process.pid, 500, write)).toBe(false);
    expect(markOomVictim(1, 500, write)).toBe(false);
    expect(markOomVictim(undefined, 500, write)).toBe(false);
    expect(markOomVictim(4243, 0, write)).toBe(false);
    expect(writes).toEqual([["/proc/4242/oom_score_adj", "500"]]);
  });

  it("sweeps every descendant of the server below the score, and nothing else", () => {
    // 7 = server; 10 claude -> 11, 12 proxies -> 13 grandchild; 20 unrelated
    const parent: Record<number, number> = { 1: 0, 7: 1, 10: 7, 11: 10, 12: 10, 13: 12, 20: 1 };
    const adj: Record<number, number> = { 1: 0, 7: 0, 10: 500, 11: 0, 12: 0, 13: 0, 20: 0 };
    const written: number[] = [];
    const proc: ProcFs = {
      pids: () => Object.keys(parent).map(Number),
      ppid: (pid) => parent[pid] ?? null,
      oomScoreAdj: (pid) => adj[pid] ?? null,
      write: (path) => { written.push(Number(path.split("/")[2])); },
    };
    expect(sweepOomScores(500, 7, proc)).toBe(3);
    expect(written.sort()).toEqual([11, 12, 13]);
  });
});

describe("MemoryWatch", () => {
  function watch(reading: { current: number }, extra: { oomKills?: number } = {}) {
    const pool = new IdleEnginePool({ maxIdle: 10, ttlMs: 600_000 });
    const log = vi.fn();
    const warn = vi.fn();
    const sweep = vi.fn(() => 0);
    const w = new MemoryWatch({
      pool,
      intervalMs: 1_000,
      highRatio: 0.75,
      criticalRatio: 0.88,
      childOomScoreAdj: 500,
      read: () => ({ current: reading.current, max: 5 * GiB, peak: null, oomKills: extra.oomKills ?? null }),
      sweep,
      log,
      warn,
    });
    return { pool, w, log, warn, sweep };
  }

  it("closes idle sessions at the high mark and alerts once at critical", () => {
    const reading = { current: 2 * GiB };
    const { pool, w, warn, sweep } = watch(reading);
    const closed: string[] = [];
    pool.noteIdle("a", () => closed.push("a"));
    expect(w.tick()).toBe("ok");
    expect(closed).toEqual([]);
    reading.current = 4 * GiB;
    expect(w.tick()).toBe("high");
    expect(closed).toEqual(["a"]);
    reading.current = 4.6 * GiB;
    w.tick();
    w.tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/ALERT critical/);
    expect(sweep).toHaveBeenCalledWith(500);
  });

  it("alerts when the kernel reports a new OOM kill", () => {
    const reading = { current: 2 * GiB };
    const extra = { oomKills: 0 };
    const { w, warn } = watch(reading, extra);
    w.tick();
    extra.oomKills = 1;
    w.tick();
    expect(warn.mock.calls.some(([line]) => /OOM-killed 1 process/.test(String(line)))).toBe(true);
  });

  it("holds routine starts while critical and lets them go when usage falls", async () => {
    const reading = { current: 4.6 * GiB };
    const { w } = watch(reading);
    w.start();
    try {
      expect(w.current()).toBe("critical");
      let released = false;
      const waiting = w.whenBelowCritical(60_000).then(() => { released = true; });
      await new Promise((resolve) => setImmediate(resolve));
      expect(released).toBe(false);
      reading.current = 2 * GiB;
      w.tick();
      await waiting;
      expect(released).toBe(true);
    } finally {
      w.stop();
    }
  });

  it("never holds work forever on a stuck reading", async () => {
    vi.useFakeTimers();
    try {
      const { w, warn } = watch({ current: 4.9 * GiB });
      w.start();
      const waiting = w.whenBelowCritical(5_000);
      vi.advanceTimersByTime(5_000);
      await expect(waiting).resolves.toBeUndefined();
      expect(warn.mock.calls.some(([line]) => /starts anyway/.test(String(line)))).toBe(true);
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("memoryGuardSettings", () => {
  it("bounds a Linux server by default and leaves the desktop app as it was", () => {
    expect(memoryGuardSettings({}, "linux", false)).toEqual({ maxIdle: 4, intervalMs: 15_000, highRatio: 0.75, criticalRatio: 0.88, childOomScoreAdj: 500 });
    const desktop = memoryGuardSettings({}, "darwin", true);
    expect(desktop.maxIdle).toBe(Number.POSITIVE_INFINITY);
    expect(desktop.childOomScoreAdj).toBe(0);
    expect(memoryGuardSettings({}, "linux", true).maxIdle).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads overrides and rejects nonsense", () => {
    const s = memoryGuardSettings({
      SAGAX_MAX_IDLE_ENGINE_SESSIONS: "2",
      SAGAX_MEMORY_HIGH_RATIO: "0.6",
      SAGAX_MEMORY_CRITICAL_RATIO: "0.5",
      SAGAX_CHILD_OOM_SCORE_ADJ: "abc",
      SAGAX_MEMORY_WATCH_MS: "-1",
    }, "linux", false);
    expect(s).toEqual({ maxIdle: 2, intervalMs: 15_000, highRatio: 0.6, criticalRatio: 0.6, childOomScoreAdj: 500 });
  });
});
