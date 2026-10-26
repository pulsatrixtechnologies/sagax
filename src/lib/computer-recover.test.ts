import { describe, expect, it } from "vitest";

import { computerAction, needsRecover } from "./computer-recover";

describe("computer recover (parity R7, system 6)", () => {
  it("is offered for a real failure only, as on the phone (ComputerCare.needsRecover)", () => {
    expect(needsRecover({ configured: false, state: "unavailable" })).toBe(false);
    expect(needsRecover({ configured: true, state: "running" })).toBe(false);
    expect(needsRecover({ configured: true, state: "ready", problem: "  " })).toBe(false);
    expect(needsRecover({ configured: true, state: "running", problem: "unreachable" })).toBe(true);
    expect(needsRecover({ configured: true, state: "unavailable" })).toBe(true);
    expect(needsRecover({ configured: true, state: "exploded" })).toBe(true);
  });

  it("leaves a computer that sleeps or wakes on purpose alone (GOX off hours)", () => {
    for (const state of ["stopped", "paused", "missing"]) expect(needsRecover({ configured: true, state })).toBe(false);
    expect(needsRecover({ configured: true, state: "stopped", waking: { since: 1, elapsedMs: 2 } })).toBe(false);
  });

  it("names the one action the row offers: recover when broken, update now when running, nothing asleep", () => {
    expect(computerAction(null)).toBeNull();
    expect(computerAction({ configured: false, state: "missing" })).toBeNull();
    expect(computerAction({ configured: true, state: "running" })).toBe("update");
    expect(computerAction({ configured: true, state: "unavailable" })).toBe("recover");
    expect(computerAction({ configured: true, state: "stopped" })).toBeNull();
    expect(computerAction({ configured: true, state: "paused" })).toBeNull();
    expect(computerAction({ configured: true, state: "running", waking: { since: 1, elapsedMs: 2 } })).toBeNull();
  });
});
