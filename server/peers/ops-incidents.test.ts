import { describe, expect, it } from "vitest";
import { incidentIsOps } from "./ops-incidents.ts";

describe("ops incidents (#2695)", () => {
  it("sends engine and provider noise to Ops incidents", () => {
    expect(incidentIsOps("failed", "429 Too Many Requests")).toBe(true);
    expect(incidentIsOps("failed", "Invalid API key, please log in again")).toBe(true);
    expect(incidentIsOps("stalled", "no output for 10 minutes")).toBe(true);
    expect(incidentIsOps("could-not-start", "claude: command not found")).toBe(true);
  });
  it("keeps business failures and routines in Team incidents", () => {
    expect(incidentIsOps("failed", "The invoice total does not match the agreement")).toBe(false);
    expect(incidentIsOps("routine-failed", "timeout")).toBe(false);
    // #2695: a routine stopped by a provider limit is ops, not business
    expect(incidentIsOps("routine-failed", "429 Too Many Requests: rate limit exceeded")).toBe(true);
    expect(incidentIsOps("routine-failed", "You exceeded your current quota")).toBe(true);
  });
});
