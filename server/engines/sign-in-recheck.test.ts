import { describe, expect, it, vi } from "vitest";

import { createSignInRecheck, settleSignInRefusal, SIGN_IN_RECHECK_COOLDOWN_MS, SIGN_IN_REFUSAL_HOLD_MS, type SignInRecheckDeps } from "./sign-in-recheck.ts";

function harness(renewResults: boolean[]) {
  const marked = new Set<string>();
  let clock = 1_000;
  const deps: SignInRecheckDeps = {
    renew: vi.fn(async () => renewResults.shift() ?? false),
    markExpired: vi.fn((pid, driver) => { marked.add(`${pid}/${driver}`); }),
    clearExpired: vi.fn((pid, driver) => { marked.delete(`${pid}/${driver}`); }),
    expired: (pid, driver) => marked.has(`${pid}/${driver}`),
    onRestored: vi.fn(),
    now: () => clock,
  };
  return { deps, marked, tick: (ms: number) => { clock += ms; }, recheck: createSignInRecheck(deps) };
}

describe("sign-in recheck (#2040)", () => {
  it("does not sign a person out when a renew works", async () => {
    const h = harness([true]);
    await h.recheck.refused("p1", "claudeAgent");
    expect(h.deps.markExpired).not.toHaveBeenCalled();
    expect(h.deps.onRestored).toHaveBeenCalledWith("p1", "claudeAgent", undefined);
  });

  it("marks the sign-in expired when the renew fails", async () => {
    const h = harness([false]);
    await h.recheck.refused("p1", "claudeAgent");
    expect(h.marked.has("p1/claudeAgent")).toBe(true);
  });

  it("shares one renew between refusals at the same time", async () => {
    const h = harness([true]);
    await Promise.all([h.recheck.refused("p1", "claudeAgent"), h.recheck.refused("p1", "claudeAgent")]);
    expect(h.deps.renew).toHaveBeenCalledTimes(1);
    expect(h.deps.markExpired).not.toHaveBeenCalled();
  });

  it("marks at once right after a failed renew, then retries after the cooldown", async () => {
    const h = harness([false, true]);
    await h.recheck.refused("p1", "codex");
    await h.recheck.refused("p1", "codex");
    expect(h.deps.renew).toHaveBeenCalledTimes(1);
    h.tick(SIGN_IN_RECHECK_COOLDOWN_MS);
    await h.recheck.refused("p1", "codex");
    expect(h.deps.renew).toHaveBeenCalledTimes(2);
    expect(h.marked.has("p1/codex")).toBe(false);
  });

  it("marks engines it cannot renew and second sign-ins directly", async () => {
    const h = harness([]);
    await h.recheck.refused("p1", "grokAgent");
    await h.recheck.refused("p1", "claudeAgent", "second");
    expect(h.deps.renew).not.toHaveBeenCalled();
    expect(h.deps.markExpired).toHaveBeenCalledTimes(2);
  });

  it("heals people already marked at start", async () => {
    const h = harness([true]);
    h.marked.add("p1/claudeAgent");
    const restored = await h.recheck.heal(["p1", "p2"]);
    expect(restored).toBe(1);
    expect(h.marked.size).toBe(0);
    expect(h.deps.renew).toHaveBeenCalledTimes(1);
  });

  it("#4192: restore renews a refused Grok sign-in once, then restores it; a failure marks nothing", async () => {
    const h = harness([true, false]);
    h.marked.add("p1/grokAgent");
    const [first, second] = await Promise.all([h.recheck.restore("p1", "grokAgent", "grok"), h.recheck.restore("p1", "grokAgent", "grok")]);
    expect([first, second]).toEqual([true, true]);
    expect(h.deps.renew).toHaveBeenCalledTimes(1);
    expect(h.marked.has("p1/grokAgent")).toBe(false);
    expect(h.deps.onRestored).toHaveBeenCalledWith("p1", "grokAgent", "grok");
    expect(await h.recheck.restore("p1", "grokAgent", "grok")).toBe(false);
    expect(h.deps.markExpired).not.toHaveBeenCalled();
  });

  it("a renew that throws counts as a failure", async () => {
    const h = harness([]);
    (h.deps.renew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("cli"));
    await h.recheck.refused("p1", "claudeAgent");
    expect(h.marked.has("p1/claudeAgent")).toBe(true);
  });
});

describe("sign-in refusal card (#2057)", () => {
  /** A refused chat turn: show = the expired card, retry = the same message again. */
  function turn(retries = true) {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    return {
      timers,
      show: vi.fn(),
      retry: vi.fn(() => retries),
      fail: vi.fn(),
      setTimer: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
    };
  }
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("refused reports whether the sign-in works again", async () => {
    expect(await harness([true]).recheck.refused("p1", "claudeAgent")).toBe(true);
    expect(await harness([false]).recheck.refused("p1", "claudeAgent")).toBe(false);
    expect(await harness([]).recheck.refused("p1", "grokAgent")).toBe(false);
  });

  it("renew ok: no card, and the turn is sent again", async () => {
    const h = harness([true]);
    const t = turn();
    expect(settleSignInRefusal(h.recheck, { principalId: "p1", driver: "claudeAgent", ...t })).toBe(true);
    await flush();
    expect(t.show).not.toHaveBeenCalled();
    expect(t.retry).toHaveBeenCalledTimes(1);
    expect(t.fail).not.toHaveBeenCalled();
    expect(h.marked.size).toBe(0);
    // the hold timer firing afterwards changes nothing
    t.timers[0]!.fn();
    expect(t.show).not.toHaveBeenCalled();
  });

  it("renew failed: the card, and the sign-in is marked expired", async () => {
    const h = harness([false]);
    const t = turn();
    expect(settleSignInRefusal(h.recheck, { principalId: "p1", driver: "claudeAgent", ...t })).toBe(true);
    expect(t.show).not.toHaveBeenCalled();
    await flush();
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.retry).not.toHaveBeenCalled();
    expect(h.marked.has("p1/claudeAgent")).toBe(true);
  });

  it("renew ok but nothing to send again: the engine's error, never the card", async () => {
    const h = harness([true]);
    const t = turn(false);
    settleSignInRefusal(h.recheck, { principalId: "p1", driver: "claudeAgent", ...t });
    await flush();
    expect(t.show).not.toHaveBeenCalled();
    expect(t.fail).toHaveBeenCalledTimes(1);
  });

  it("a renew that outlasts the hold shows the card once", async () => {
    let finish: (ok: boolean) => void = () => {};
    const h = harness([]);
    (h.deps.renew as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const t = turn();
    settleSignInRefusal(h.recheck, { principalId: "p1", driver: "claudeAgent", ...t });
    expect(t.timers[0]!.ms).toBe(SIGN_IN_REFUSAL_HOLD_MS);
    t.timers[0]!.fn();
    expect(t.show).toHaveBeenCalledTimes(1);
    finish(true);
    await flush();
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.retry).not.toHaveBeenCalled();
  });

  it("shows the card at once when no renew can help", async () => {
    const h = harness([false]);
    await h.recheck.refused("p1", "claudeAgent");
    const inCooldown = turn();
    expect(settleSignInRefusal(h.recheck, { principalId: "p1", driver: "claudeAgent", ...inCooldown })).toBe(false);
    expect(inCooldown.show).toHaveBeenCalledTimes(1);
    const notRenewable = turn();
    expect(settleSignInRefusal(h.recheck, { principalId: "p1", driver: "grokAgent", ...notRenewable })).toBe(false);
    expect(notRenewable.show).toHaveBeenCalledTimes(1);
    const noRecheck = turn();
    expect(settleSignInRefusal(null, { principalId: "p1", driver: "claudeAgent", ...noRecheck })).toBe(false);
    expect(noRecheck.show).toHaveBeenCalledTimes(1);
    expect(h.deps.renew).toHaveBeenCalledTimes(1);
  });
});

// #2384: a refusal on an added account renews and marks that account only;
// heal walks every account of the person.
describe("sign-in recheck per account (#2384)", () => {
  function accountHarness(renew: (pid: string, driver: string, instanceId?: string) => boolean) {
    const marked = new Set<string>();
    const k = (pid: string, driver: string, id?: string) => `${pid}/${driver}/${id ?? ""}`;
    const deps: SignInRecheckDeps = {
      renew: vi.fn(async (pid, driver, id) => renew(pid, driver, id)),
      markExpired: vi.fn((pid, driver, _slot, id) => { marked.add(k(pid, driver, id)); }),
      clearExpired: vi.fn((pid, driver, _slot, id) => { marked.delete(k(pid, driver, id)); }),
      expired: (pid, driver, _slot, id) => marked.has(k(pid, driver, id)),
      accounts: () => [undefined, "claude-b"],
      onRestored: vi.fn(),
    };
    return { deps, marked, k, recheck: createSignInRecheck(deps) };
  }

  it("marks the refused account, never the provider's own", async () => {
    const h = accountHarness(() => false);
    await h.recheck.refused("p1", "claudeAgent", "primary", "claude-b");
    expect(h.deps.renew).toHaveBeenCalledWith("p1", "claudeAgent", "claude-b");
    expect(h.marked.has(h.k("p1", "claudeAgent", "claude-b"))).toBe(true);
    expect(h.marked.has(h.k("p1", "claudeAgent"))).toBe(false);
  });

  it("a failed renew on one account does not hold the other's in cooldown", async () => {
    const h = accountHarness(() => false);
    await h.recheck.refused("p1", "claudeAgent", "primary", "claude-b");
    expect(h.recheck.renewable("p1", "claudeAgent", "primary", "claude-b")).toBe(false);
    expect(h.recheck.renewable("p1", "claudeAgent", "primary")).toBe(true);
  });

  it("heal renews an expired added account and clears its marker", async () => {
    const h = accountHarness((_pid, driver, id) => driver === "claudeAgent" && id === "claude-b");
    h.marked.add(h.k("p1", "claudeAgent", "claude-b"));
    expect(await h.recheck.heal(["p1"])).toBe(1);
    expect(h.marked.size).toBe(0);
    expect(h.deps.onRestored).toHaveBeenCalledWith("p1", "claudeAgent", "claude-b");
  });
});
