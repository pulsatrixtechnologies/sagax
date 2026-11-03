// The client-side budget of token and revocation calls (slice 6, fix 2),
// on a fake clock.
import { describe, expect, it } from "vitest";

import { revokeReserve, TOKEN_BUDGET_DEFAULT, TokenCallPacer, tokenBudget } from "./idp-token-pacer.ts";

function clocked(budget: number) {
  const clock = { now: 1_000_000 };
  const pacer = new TokenCallPacer({ budget, now: () => clock.now, sleep: async (ms) => { clock.now += ms; }, log: () => {} });
  return { clock, pacer };
}

describe("TokenCallPacer", () => {
  it("logs a 429 pause once and a deferred refresh (e2e S6-14c)", async () => {
    const clock = { now: 1_000_000 };
    const logs: string[] = [];
    const pacer = new TokenCallPacer({ budget: 45, now: () => clock.now, sleep: async (ms) => { clock.now += ms; }, log: (line) => logs.push(line) });
    pacer.noteRateLimited(60_000);
    pacer.noteRateLimited(30_000);
    expect(logs).toEqual(["perspicax token budget: Perspicax rate limited this server; refreshes and revocations wait 60 s"]);
    expect((await pacer.acquire("refresh")).ok).toBe(false);
    expect(logs[1]).toBe("perspicax token budget: a refresh is deferred without a call (Perspicax rate limit pause; next slot in 60 s)");
  });

  it("reads SAGAX_PERSPICAX_TOKEN_BUDGET as a whole number from 1 to 60, 45 otherwise", () => {
    expect(tokenBudget(undefined)).toBe(TOKEN_BUDGET_DEFAULT);
    expect(tokenBudget("")).toBe(45);
    expect(tokenBudget("20")).toBe(20);
    expect(tokenBudget("1")).toBe(1);
    expect(tokenBudget("60")).toBe(60);
    expect(tokenBudget("61")).toBe(45);
    expect(tokenBudget("0")).toBe(45);
    expect(tokenBudget("12.5")).toBe(45);
    expect(revokeReserve(45)).toBe(10);
    expect(revokeReserve(11)).toBe(10);
    expect(revokeReserve(10)).toBe(1);
  });

  it("with a budget of 5, defers the sixth refresh without a call once its 5 s wait runs out", async () => {
    const { clock, pacer } = clocked(5);
    for (let i = 0; i < 5; i += 1) expect(await pacer.acquire("refresh")).toEqual({ ok: true });
    const start = clock.now;
    const sixth = await pacer.acquire("refresh");
    expect(sixth.ok).toBe(false);
    expect(sixth.ok ? 0 : sixth.retryAfterMs).toBeGreaterThan(5_000);
    // It did not wait: the slot is a minute away, past the 5 s it may wait.
    expect(clock.now).toBe(start);
    expect(pacer.used()).toBe(5);
    // A slot that frees within 5 s is waited for.
    clock.now += 56_000;
    expect(await pacer.acquire("refresh")).toEqual({ ok: true });
    expect(clock.now).toBe(start + 60_000);
  });

  it("pauses refreshes and revocations on a 429, never a code exchange", async () => {
    const { clock, pacer } = clocked(45);
    pacer.noteRateLimited(60_000);
    expect(await pacer.acquire("refresh")).toMatchObject({ ok: false, retryAfterMs: 60_000 });
    expect(pacer.tryAcquire("revoke")).toMatchObject({ ok: false });
    expect(await pacer.acquire("exchange")).toEqual({ ok: true });
    clock.now += 60_000;
    expect(await pacer.acquire("refresh")).toEqual({ ok: true });
    expect(pacer.tryAcquire("revoke")).toEqual({ ok: true });
  });

  it("keeps the reserve free of revocations: 35 of 45, and 1 on a budget below 11", () => {
    const big = clocked(45).pacer;
    let sent = 0;
    while (big.tryAcquire("revoke").ok) sent += 1;
    expect(sent).toBe(35);
    // Sign-ins and refreshes still have the reserve.
    for (let i = 0; i < 10; i += 1) expect(big.tryAcquire("refresh").ok).toBe(true);
    expect(big.tryAcquire("refresh").ok).toBe(false);
    const small = clocked(5).pacer;
    sent = 0;
    while (small.tryAcquire("revoke").ok) sent += 1;
    expect(sent).toBe(4);
  });

  it("counts an exchange past the budget, which then holds refreshes back", async () => {
    const { pacer } = clocked(2);
    expect(await pacer.acquire("exchange")).toEqual({ ok: true });
    expect(await pacer.acquire("exchange")).toEqual({ ok: true });
    expect(await pacer.acquire("exchange")).toEqual({ ok: true });
    expect(pacer.used()).toBe(3);
    expect((await pacer.acquire("refresh", 0)).ok).toBe(false);
  });
});
