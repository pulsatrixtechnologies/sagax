import { describe, expect, it, vi } from "vitest";

import { EngineStartGate } from "./engine-start-gate.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function gate(options: { limit?: number; windowMs?: number; maxHoldMs?: number } = {}) {
  let clock = 1_000;
  const instance = new EngineStartGate({
    limit: options.limit ?? 2,
    windowMs: options.windowMs ?? 60_000,
    ...(options.maxHoldMs !== undefined ? { maxHoldMs: options.maxHoldMs } : {}),
    now: () => clock,
  });
  return { instance, advance: (ms: number) => { clock += ms; } };
}

describe("EngineStartGate", () => {
  it("lets everything through before the server starts", async () => {
    const { instance } = gate();
    const slots = await Promise.all(Array.from({ length: 5 }, () => instance.acquire("turn")));
    expect(slots.every((slot) => !slot.gated)).toBe(true);
    expect(instance.stats().peak).toBe(0);
  });

  it("never runs more than the limit at once during boot, whatever the burst", async () => {
    const { instance } = gate({ limit: 2 });
    instance.beginBoot();
    let running = 0;
    let most = 0;
    const work = Array.from({ length: 16 }, (_, index) => instance.run(index % 3 ? "turn" : "probe", `w${index}`, async () => {
      running += 1;
      most = Math.max(most, running);
      await flush();
      running -= 1;
      return index;
    }));
    expect(await Promise.all(work)).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(most).toBe(2);
    expect(instance.stats()).toEqual({ held: 0, waiting: 0, peak: 2 });
  });

  it("serves a waiting probe before a waiting turn", async () => {
    const { instance } = gate({ limit: 1 });
    instance.beginBoot();
    const first = await instance.acquire("turn", "first");
    const order: string[] = [];
    const turn = instance.acquire("turn", "turn").then((slot) => { order.push("turn"); return slot; });
    const probe = instance.acquire("probe", "probe").then((slot) => { order.push("probe"); return slot; });
    first.release();
    (await probe).release();
    (await turn).release();
    expect(order).toEqual(["probe", "turn"]);
  });

  it("admits at once after the window but drains what was queued at the limit", async () => {
    const { instance, advance } = gate({ limit: 1, windowMs: 10_000 });
    instance.beginBoot();
    const held = await instance.acquire("turn");
    let queuedAdmitted = false;
    const queued = instance.acquire("turn").then((slot) => { queuedAdmitted = true; return slot; });
    advance(10_000);
    expect(instance.booting).toBe(false);
    // Work arriving after the window while something still waits queues
    // behind it: the end of the window is not a burst.
    let lateAdmitted = false;
    const late = instance.acquire("turn").then((slot) => { lateAdmitted = true; return slot; });
    await flush();
    expect(queuedAdmitted).toBe(false);
    expect(lateAdmitted).toBe(false);
    held.release();
    const queuedSlot = await queued;
    await flush();
    expect(lateAdmitted).toBe(false);
    queuedSlot.release();
    (await late).release();
    // Nothing waits any more: new work is not gated.
    expect((await instance.acquire("turn")).gated).toBe(false);
  });

  it("is off with a limit of 0", async () => {
    const { instance } = gate({ limit: 0 });
    instance.beginBoot();
    expect(instance.booting).toBe(false);
    const slots = await Promise.all(Array.from({ length: 4 }, () => instance.acquire("turn")));
    expect(slots.every((slot) => !slot.gated)).toBe(true);
  });

  it("frees a slot its holder never released after the hold limit", async () => {
    vi.useFakeTimers();
    try {
      const { instance } = gate({ limit: 1, maxHoldMs: 5_000 });
      instance.beginBoot();
      await instance.acquire("turn");
      let admitted = false;
      void instance.acquire("turn").then(() => { admitted = true; });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(admitted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(admitted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases once even when release is called twice", async () => {
    const { instance } = gate({ limit: 1 });
    instance.beginBoot();
    const slot = await instance.acquire("probe");
    slot.release();
    slot.release();
    expect(instance.stats().held).toBe(0);
    const again = await instance.acquire("probe");
    const other = instance.acquire("probe");
    let otherAdmitted = false;
    void other.then(() => { otherAdmitted = true; });
    await flush();
    expect(otherAdmitted).toBe(false);
    again.release();
    await other;
  });

  it("releases the slot when the run throws", async () => {
    const { instance } = gate({ limit: 1 });
    instance.beginBoot();
    await expect(instance.run("probe", "boom", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(instance.stats().held).toBe(0);
  });
});

describe("engine probes through execCli", () => {
  it("knows the engine CLIs by name or path", async () => {
    const { isEngineCli } = await import("./procs.ts");
    expect(isEngineCli("opencode")).toBe(true);
    expect(isEngineCli("/usr/local/bin/kimi")).toBe(true);
    expect(isEngineCli("C:\\Tools\\codex.cmd")).toBe(true);
    expect(isEngineCli("/usr/bin/git")).toBe(false);
    expect(isEngineCli("docker")).toBe(false);
  });

  it.skipIf(process.platform === "win32")("waits for a free slot while the server boots", async () => {
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { engineStartGate } = await import("./engine-start-gate.ts");
    const { execCli } = await import("./procs.ts");
    const dir = mkdtempSync(join(tmpdir(), "engine-gate-"));
    try {
      const kimi = join(dir, "kimi");
      writeFileSync(kimi, "#!/bin/sh\necho 9.9.9\n");
      chmodSync(kimi, 0o755);
      engineStartGate.beginBoot();
      expect(engineStartGate.booting).toBe(true);
      const held = await Promise.all(Array.from({ length: engineStartGate.limit }, () => engineStartGate.acquire("turn", "held")));
      let output: string | null = null;
      const done = new Promise<void>((resolve) => execCli(kimi, ["--version"], { timeout: 5_000 }, (_error, stdout) => {
        output = stdout.trim();
        resolve();
      }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(output).toBeNull();
      expect(engineStartGate.stats().waiting).toBe(1);
      for (const slot of held) slot.release();
      await done;
      expect(output).toBe("9.9.9");
      expect(engineStartGate.stats().held).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with no window (the routine gate) keeps its limit long after boot", async () => {
    const { instance, advance } = gate({ limit: 1, windowMs: Number.POSITIVE_INFINITY });
    instance.beginBoot();
    advance(24 * 60 * 60_000);
    const first = await instance.acquire("turn", "a");
    expect(first.gated).toBe(true);
    let second = false;
    const waiting = instance.acquire("turn", "b").then((slot) => { second = true; return slot; });
    await flush();
    expect(second).toBe(false);
    first.release();
    (await waiting).release();
    expect(second).toBe(true);
    expect(instance.stats().peak).toBe(1);
  });
});
