import { describe, expect, it } from "vitest";
import { createMintInternalCapability } from "../index-leaves/mintInternalCapability.ts";
import { InactiveTurnCapabilityError, inactiveCapabilityOutcome, isInactiveTurnCapabilityError } from "./inactive-turn-capability.ts";

// #2632: a mint refused because the turn's generation was revoked mid-setup
// (Stop, a superseding send, a provider reload) is never a failed step.
describe("inactive turn capability (#2632)", () => {
  it("a mint for a revoked generation throws the typed refusal", () => {
    const host = {
      activeInternalGenerationByThread: new Map([["t1", "gen-new"]]),
      internalCapabilities: new Map(),
      sessionBearer: () => "bearer",
      INTERNAL_CAPABILITY_ORPHAN_MS: 1_000,
    };
    const mint = createMintInternalCapability(() => host);
    let caught: unknown;
    try { mint({ botId: "b1", threadId: "t1", generation: "gen-old", kind: "agents" }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InactiveTurnCapabilityError);
    expect(isInactiveTurnCapabilityError(caught)).toBe(true);
    expect(mint({ botId: "b1", threadId: "t1", generation: "gen-new", kind: "agents" })).toBe("bearer");
  });

  it("a stopped or replaced turn ends quietly; a reload retries once, then explains", () => {
    expect(inactiveCapabilityOutcome({ claimCurrent: false, stopped: false, retried: false })).toBe("cancelled");
    expect(inactiveCapabilityOutcome({ claimCurrent: true, stopped: true, retried: false })).toBe("cancelled");
    expect(inactiveCapabilityOutcome({ claimCurrent: true, stopped: false, retried: false })).toBe("retry");
    expect(inactiveCapabilityOutcome({ claimCurrent: true, stopped: false, retried: true })).toBe("fail");
  });

  it("only that refusal is recognised", () => {
    expect(isInactiveTurnCapabilityError(new Error("cannot mint an integration capability for an inactive turn"))).toBe(true);
    expect(isInactiveTurnCapabilityError(new Error("grokAgent exited 1 before the prompt result"))).toBe(false);
  });
});
