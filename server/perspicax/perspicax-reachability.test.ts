import { describe, expect, it, vi } from "vitest";

import { PerspicaxReachability, gatewayAnswered, observedFetch } from "./perspicax-reachability.ts";

function tracker(probe: () => Promise<boolean>) {
  let now = 1_000;
  const changes: string[] = [];
  const reach = new PerspicaxReachability({ probe, now: () => now, onChange: (status) => changes.push(status.state), debounceMs: 5_000 });
  return { reach, changes, advance: (ms: number) => { now += ms; } };
}

describe("PerspicaxReachability (#2013)", () => {
  it("says nothing for a blip shorter than the debounce", () => {
    const h = tracker(async () => true);
    h.reach.observe(false);
    h.advance(2_000);
    h.reach.observe(true);
    expect(h.changes).toEqual([]);
    expect(h.reach.status().state).toBe("ok");
  });

  it("is unreachable once failures last past the debounce, and ok again on the first answer", async () => {
    const h = tracker(async () => false);
    h.reach.observe(false);
    h.advance(5_000);
    await h.reach.probeNow();
    expect(h.changes).toEqual(["unreachable"]);
    expect(h.reach.status()).toEqual({ state: "unreachable", since: 1_000 });
    h.reach.observe(true);
    expect(h.changes).toEqual(["unreachable", "ok"]);
    h.reach.stop();
  });

  it("counts a 5xx or a network error, never a refused token or a caller's abort", async () => {
    expect(gatewayAnswered(401)).toBe(true);
    expect(gatewayAnswered(503)).toBe(false);
    const observe = vi.fn();
    await observedFetch(async () => new Response(null, { status: 502 }), { observe })("https://x.test");
    await expect(observedFetch(async () => { throw new TypeError("fetch failed"); }, { observe })("https://x.test")).rejects.toThrow();
    await expect(observedFetch(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, { observe })("https://x.test")).rejects.toThrow();
    expect(observe.mock.calls).toEqual([[false], [false]]);
  });
});
