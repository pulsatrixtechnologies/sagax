import { describe, expect, it, vi } from "vitest";
import { MiB, WarmResourceBudget, warmResourceLimits, warmResourcePerson, type WarmResourceLimits, type WarmResourceLease } from "./warm-resources.ts";

const limits = (extra: Partial<WarmResourceLimits> = {}): WarmResourceLimits => ({ count: 100, bytes: 1000, personCount: 100, personBytes: 1000, ...extra });
function fixture(extra: Partial<WarmResourceLimits> = {}) {
  const budget = new WarmResourceBudget({ limits: limits(extra), intervalMs: 0 });
  const closed: string[] = [], leases: WarmResourceLease[] = [];
  const add = (id: string, person = "osprey", bytes = 10, active = false) => {
    const lease = budget.register({ kind: "codex", person, bytes, evict: () => { closed.push(id); } });
    leases.push(lease);
    if (!active) lease.idle();
    return lease;
  };
  return { budget, closed, add, cleanup: () => leases.forEach(l => l.forget()) };
}

describe("shared warm resource budget", () => {
  it("keeps reuse unchanged below caps and exposes no person identifiers", async () => {
    const f = fixture(); const lease = f.add("one");
    expect(lease.active()).toBe(true); lease.idle();
    await f.budget.settled();
    expect(f.closed).toEqual([]);
    expect(f.budget.stats()).toMatchObject({ count: 1, memoryBytes: 10, active: 0, idle: 1, evictions: 0 });
    expect(JSON.stringify(f.budget.stats())).not.toContain("osprey"); f.cleanup();
  });
  it.each([{ count: 2 }, { bytes: 20 }])("caps global retention by %j", async cap => {
    const f = fixture(cap);
    f.add("one"); f.add("two", "wren"); f.add("three", "tern");
    await f.budget.settled();
    expect(f.closed).toEqual(["one"]);
    expect(f.budget.stats()).toMatchObject({ count: 2, memoryBytes: 20, globalEvictions: 1 }); f.cleanup();
  });
  it.each([{ personCount: 1 }, { personBytes: 10 }])("charges a person's excess only to them: %j", async cap => {
    const f = fixture(cap);
    f.add("wren-oldest", "wren"); f.add("osprey-one"); f.add("osprey-two");
    await f.budget.settled();
    expect(f.closed).toEqual(["osprey-one"]);
    expect(f.budget.stats()).toMatchObject({ count: 2, personEvictions: 1 }); f.cleanup();
  });
  it("uses LRU after an idle resource is used again", async () => {
    const f = fixture({ count: 2 });
    const first = f.add("one"); f.add("two"); first.active(); first.idle(); f.add("three");
    await f.budget.settled(); expect(f.closed).toEqual(["two"]); f.cleanup();
  });
  it("never evicts active turns even with zero caps and recovers on idle", async () => {
    const f = fixture({ count: 0, bytes: 0, personCount: 0, personBytes: 0 });
    const a = f.add("active-a", "osprey", 10, true), b = f.add("active-b", "wren", 10, true);
    await f.budget.refresh();
    expect(f.closed).toEqual([]); expect(f.budget.stats().overBudget).toBe(true);
    a.idle(); await f.budget.settled();
    expect(f.closed).toEqual(["active-a"]); expect(b.active()).toBe(true);
    b.idle(); await f.budget.settled(); expect(f.budget.stats()).toMatchObject({ count: 0, overBudget: false });
  });
  it("protects owner-side in-flight operations and rechecks after completion", async () => {
    let protectedIO = true;
    const budget = new WarmResourceBudget({ limits: limits({ count: 0 }), intervalMs: 0, sample: async () => [] });
    const close = vi.fn(); const lease = budget.register({ person: "osprey", kind: "perspicax", bytes: 1, protected: () => protectedIO, evict: close });
    lease.idle(); expect(close).not.toHaveBeenCalled(); protectedIO = false;
    await budget.refresh(); await budget.settled(); expect(close).toHaveBeenCalledOnce();
  });
  it("detaches synchronously, keeps slow closes charged and avoids over-eviction", async () => {
    let finish!: () => void;
    const budget = new WarmResourceBudget({ limits: limits({ count: 1 }), intervalMs: 0 });
    const close = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const old = budget.register({ person: "osprey", kind: "codex", bytes: 10, evict: close }); old.idle();
    const next = budget.register({ person: "wren", kind: "acp", bytes: 10, evict: vi.fn() }); next.idle();
    expect(close).toHaveBeenCalledOnce(); expect(old.active()).toBe(false);
    expect(budget.stats()).toMatchObject({ count: 2, closing: 1, idle: 1, evictions: 1 });
    finish(); await budget.settled(); expect(budget.stats().count).toBe(1); next.forget();
  });
  it("keeps failed closes charged and retries without counting another eviction", async () => {
    const budget = new WarmResourceBudget({ limits: limits({ count: 0 }), intervalMs: 0, sample: async () => [] });
    const close = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("fixture")).mockResolvedValueOnce(true);
    const lease = budget.register({ person: "osprey", kind: "codex", bytes: 10, evict: close }); lease.idle();
    await budget.settled(); expect(budget.stats()).toMatchObject({ count: 1, closing: 1, closeFailures: 1 });
    await budget.refresh(); await budget.settled(); await budget.refresh(); await budget.settled();
    expect(budget.stats()).toMatchObject({ count: 0, evictions: 1, closeFailures: 2 });
  });
  it("does not evict healthy resources while an ordinary owner teardown is already freeing room", async () => {
    const f = fixture({ count: 2 });
    f.add("healthy"); const closing = f.add("outdated"); closing.retiring(); f.add("replacement");
    await f.budget.settled(); expect(f.closed).toEqual([]);
    expect(f.budget.stats()).toMatchObject({ count: 3, closing: 1, evictions: 0 });
    closing.forget(); expect(f.budget.stats()).toMatchObject({ count: 2, overBudget: false }); f.cleanup();
  });
  it("reclaims global idle capacity across people when what is retained exceeds the cap", async () => {
    const f = fixture({ personCount: 1, count: 2 });
    f.add("active-one", "osprey", 10, true); f.add("idle-osprey", "osprey"); f.add("idle-wren", "wren"); f.add("idle-tern", "tern");
    await f.budget.settled(); expect(f.closed).toEqual(["idle-osprey"]); f.cleanup();
  });
  it("keeps a conversation's idle engine while the same person's other engines run (#4215)", async () => {
    // production defaults: 1 GiB per person, four running engines of 256 MiB
    const f = fixture({ personBytes: 1024, bytes: 2048 });
    for (const id of ["busy-1", "busy-2", "busy-3", "busy-4"]) f.add(id, "osprey", 256, true);
    const conversation = f.add("conversation", "osprey", 256, true);
    conversation.idle(); await f.budget.settled();
    expect(f.closed).toEqual([]);
    expect(conversation.active()).toBe(true); f.cleanup();
  });
  it("updates growing process trees and deduplicates concurrent samples", async () => {
    const sample = vi.fn(async () => [{ pid: 20, parent: 1, bytes: 30 }, { pid: 21, parent: 20, bytes: 30 }]);
    const budget = new WarmResourceBudget({ limits: limits({ bytes: 50 }), sample, intervalMs: 0 });
    const close = vi.fn(); const lease = budget.register({ person: "osprey", kind: "codex", bytes: 10, pids: () => [20], evict: close }); lease.idle();
    await Promise.all([budget.refresh(), budget.refresh()]); await budget.settled();
    expect(sample).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("accounts multi-process mounts in count and keeps memory reservations when sampling fails", async () => {
    const budget = new WarmResourceBudget({ limits: limits(), intervalMs: 0, sample: async () => { throw new Error("fixture"); } });
    const lease = budget.register({ person: "osprey", kind: "http-mcp", bytes: 90, count: () => 3, pids: () => [21, 22, 23], evict() {} });
    lease.idle(); await budget.refresh(); expect(budget.stats()).toMatchObject({ count: 3, resources: 1, memoryBytes: 90 }); lease.forget();
  });
  it("preserves a large last-known RSS through a failed sample before the turn goes idle", async () => {
    let failed = false;
    const close = vi.fn();
    const budget = new WarmResourceBudget({ limits: limits({ bytes: 50 }), intervalMs: 0,
      sample: async () => { if (failed) throw new Error("fixture"); return [{ pid: 20, parent: 1, bytes: 80 }]; } });
    const lease = budget.register({ person: "osprey", kind: "codex", bytes: 10, pids: () => [20], evict: close });
    await budget.refresh(); failed = true; await budget.refresh();
    expect(budget.stats().sampledRssBytes).toBe(80); expect(close).not.toHaveBeenCalled();
    lease.idle(); await budget.settled(); expect(close).toHaveBeenCalledOnce();
  });
  it("bounds 50 people by three threads across mixed resource families", async () => {
    const f = fixture({ count: 12, bytes: 120, personCount: 2, personBytes: 20 });
    for (let person = 0; person < 50; person++) {
      for (let thread = 0; thread < 3; thread++) {
        f.add(`thread-${person}-${thread}`, `person-${person}`); await f.budget.settled();
        expect(f.budget.stats().count).toBeLessThanOrEqual(12); expect(f.budget.stats().memoryBytes).toBeLessThanOrEqual(120);
      }
    }
    expect(f.budget.stats()).toMatchObject({ count: 12, evictions: 138, overBudget: false }); f.cleanup();
  });
  it("uses speaker identity independently of payer and validates cap settings including zero", () => {
    expect(warmResourcePerson({ principalId: "osprey", access: { via: "org-key", identity: "shared" } })).toBe("osprey");
    expect(warmResourcePerson({})).toBe("solo");
    expect(warmResourceLimits({ SAGAX_WARM_MAX_COUNT: "0", SAGAX_WARM_MAX_BYTES: "-1", SAGAX_WARM_PERSON_MAX_COUNT: "invalid" })).toMatchObject({ count: 0, bytes: 2048 * MiB, personCount: 12 });
  });
});
