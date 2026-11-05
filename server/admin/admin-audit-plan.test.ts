import { describe, expect, it, vi } from "vitest";

import { adminAuditPlan } from "./admin-audit-plan.ts";

const deps = {
  requiredScope: vi.fn(() => null as string | null | undefined),
  lendingEnabled: () => false,
};

describe("adminAuditPlan", () => {
  it("ignores reads and harness paths", () => {
    expect(adminAuditPlan("GET", "/api/bots", deps)).toBeNull();
    expect(adminAuditPlan("POST", "/api/internal/ask-bot", deps)).toBeNull();
    expect(adminAuditPlan("POST", "/api/testing/org-library", deps)).toBeNull();
  });

  it("flags bot create and config when requiredScope says admin", () => {
    deps.requiredScope.mockReturnValueOnce("admin");
    const plan = adminAuditPlan("POST", "/api/bots", deps);
    expect(plan).toMatchObject({ createsBots: true, config: true });
  });

  it("names a bot PATCH and an instance install", () => {
    expect(adminAuditPlan("PATCH", "/api/bots/b1", deps)?.botId).toBe("b1");
    expect(adminAuditPlan("POST", "/api/instances/claude/install", deps)?.engineAction).toEqual({
      id: "claude",
      action: "install",
    });
  });
});
