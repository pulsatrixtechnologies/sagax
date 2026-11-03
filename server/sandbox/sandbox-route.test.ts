import { describe, expect, it } from "vitest";

import { sandboxBackendFor, sandboxCanaryBotIds, sandboxCanaryPeople, sandboxRouteFromEnv } from "./sandbox-route.ts";

const ALICE = "pr_00000000-0000-4000-8000-000000000001";
const BOB = "pr_00000000-0000-4000-8000-000000000002";

describe("sandbox canary route", () => {
  it("sends everyone to docker until a list or a forced route says otherwise", () => {
    const route = sandboxRouteFromEnv({});
    expect(route.forced).toBeNull();
    expect(route.bots).toEqual([]);
    expect(route.people).toEqual([]);
    expect(sandboxBackendFor(route, ALICE, "bot-a")).toBe("docker");
  });

  it("routes a listed person and a listed bot, and lets docker force a revert", () => {
    expect(sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: "bot-a, bot-a, bot_b" })).toEqual(["bot-a", "bot_b"]);
    expect(sandboxCanaryPeople({ SAGAX_SANDBOX_CANARY_PEOPLE: `${ALICE.toUpperCase()}, ${ALICE}` })).toEqual([ALICE]);
    const route = sandboxRouteFromEnv({
      SAGAX_SANDBOX_CANARY_BOTS: "bot-a",
      SAGAX_SANDBOX_CANARY_PEOPLE: BOB,
    });
    expect(sandboxBackendFor(route, ALICE, "bot-a")).toBe("kubernetes");
    expect(sandboxBackendFor(route, ALICE, "bot-b")).toBe("docker");
    expect(sandboxBackendFor(route, BOB)).toBe("kubernetes");
    expect(sandboxBackendFor(route, ALICE)).toBe("docker");
    const reverted = sandboxRouteFromEnv({
      SAGAX_SANDBOX_ROUTE: "docker",
      SAGAX_SANDBOX_CANARY_BOTS: "bot-a",
      SAGAX_SANDBOX_CANARY_PEOPLE: BOB,
    });
    expect(sandboxBackendFor(reverted, BOB, "bot-a")).toBe("docker");
    expect(sandboxBackendFor(sandboxRouteFromEnv({ SAGAX_SANDBOX_ROUTE: "kubernetes" }), ALICE)).toBe("kubernetes");
  });

  it("rejects a bad id, a bad route, and a list that is too long", () => {
    expect(() => sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: "has space" })).toThrow(/invalid id/);
    expect(() => sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: Array.from({ length: 33 }, (_, i) => `b${i}`).join(",") })).toThrow(/32/);
    expect(() => sandboxCanaryPeople({ SAGAX_SANDBOX_CANARY_PEOPLE: "alice" })).toThrow(/invalid id/);
    expect(() => sandboxCanaryPeople({ SAGAX_SANDBOX_CANARY_PEOPLE: Array.from({ length: 129 }, () => ALICE).join(",") })).toThrow(/128/);
    expect(() => sandboxRouteFromEnv({ SAGAX_SANDBOX_ROUTE: "k3s" })).toThrow(/docker or kubernetes/);
  });
});
