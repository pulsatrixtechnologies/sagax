import { describe, expect, it, vi } from "vitest";

import { createSignInRecheck, SIGN_IN_RECHECK_COOLDOWN_MS, type SignInRecheckDeps } from "./sign-in-recheck.ts";

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
    expect(h.deps.onRestored).toHaveBeenCalledWith("p1", "claudeAgent");
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

  it("a renew that throws counts as a failure", async () => {
    const h = harness([]);
    (h.deps.renew as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("cli"));
    await h.recheck.refused("p1", "claudeAgent");
    expect(h.marked.has("p1/claudeAgent")).toBe(true);
  });
});
