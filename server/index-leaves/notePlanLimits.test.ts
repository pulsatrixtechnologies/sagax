import { describe, expect, it } from "vitest";

import { createNotePlanLimits } from "./notePlanLimits.ts";

describe("notePlanLimits (#0867)", () => {
  it("marks every instance folded on a spent login, so the quick pick skips them all", () => {
    const until = Date.now() + 3_600_000;
    const host = {
      spentPlans: new Map<string, number>(),
      planUsedPercents: new Map<string, number>(),
      spentPlanUntil: (row: { id: string }) => (row.id === "claude" ? until : null),
      planUsedPercent: (row: { id: string }) => (row.id === "claude" ? 100 : 12),
    };
    const note = createNotePlanLimits(() => host);
    note({
      fetchedAt: new Date().toISOString(),
      providers: [
        { id: "claude", instanceId: "claude", instanceIds: ["claude", "claude-opus"] },
        { id: "codex", instanceId: "codex", instanceIds: ["codex", "chatgpt"] },
        { id: "grok", instanceId: "grok" },
      ],
    }, "Person:P1");
    expect(host.spentPlans.get("person:p1\u0000claude")).toBe(until);
    expect(host.spentPlans.get("person:p1\u0000claude-opus")).toBe(until);
    expect(host.spentPlans.has("person:p1\u0000codex")).toBe(false);
    expect(host.planUsedPercents.get("person:p1\u0000claude-opus")).toBe(100);
    expect(host.planUsedPercents.get("person:p1\u0000chatgpt")).toBe(12);
    expect(host.planUsedPercents.get("person:p1\u0000grok")).toBe(12);
  });
});
