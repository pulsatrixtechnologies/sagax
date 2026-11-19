import { describe, expect, it } from "vitest";

import { createNotePlanLimits, createPlanWorked } from "./notePlanLimits.ts";

describe("notePlanLimits (#0867)", () => {
  it("notes the used percent on every instance folded on a login, so the same-provider rotation reads them all", () => {
    const host = {
      planUsedPercents: new Map<string, number>(),
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
    expect(host.planUsedPercents.get("person:p1\u0000claude")).toBe(100);
    expect(host.planUsedPercents.get("person:p1\u0000claude-opus")).toBe(100);
    expect(host.planUsedPercents.get("person:p1\u0000chatgpt")).toBe(12);
    expect(host.planUsedPercents.get("person:p1\u0000grok")).toBe(12);
  });

  it("a turn that works on one folded instance clears the used percent on every instance of that login", () => {
    const host = {
      planUsedPercents: new Map<string, number>(),
      planSiblings: new Map<string, string[]>(),
      planUsedPercent: () => 100,
    };
    const note = createNotePlanLimits(() => host);
    const worked = createPlanWorked(() => host);
    note({
      fetchedAt: new Date().toISOString(),
      providers: [
        { id: "claude", instanceId: "claude", instanceIds: ["claude", "claude-opus"] },
        { id: "grok", instanceId: "grok" },
      ],
    }, "person:p1");
    note({ fetchedAt: new Date().toISOString(), providers: [{ id: "claude", instanceId: "claude", instanceIds: ["claude", "claude-opus"] }] }, "person:p2");
    worked("person:p1", "claude");
    expect(host.planUsedPercents.has("person:p1\u0000claude")).toBe(false);
    expect(host.planUsedPercents.has("person:p1\u0000claude-opus")).toBe(false);
    // Another login and another payer keep theirs.
    expect(host.planUsedPercents.get("person:p1\u0000grok")).toBe(100);
    expect(host.planUsedPercents.get("person:p2\u0000claude-opus")).toBe(100);
    // From the folded sibling too.
    worked("person:p2", "claude-opus");
    expect(host.planUsedPercents.has("person:p2\u0000claude")).toBe(false);
    expect(host.planUsedPercents.size).toBe(1);
  });
});
