// Regression, incident 2026-11-03: Perspicax held the organization
// Flow install back (flow_guard_uncovered), the bot's own GitHub copy is an
// alias Sagax hides, and the routine bot found no Flow skill and no hint.
import { describe, expect, it } from "vitest";

import { flowSkillsNote } from "./org-flow-plugins.ts";
import type { FlowPluginsDeclaration } from "../perspicax/perspicax-link.ts";

const held: FlowPluginsDeclaration = {
  enabled: false,
  guard: "enforce",
  reason: "flow_guard_uncovered",
  name: "pulsatrix-flow",
  url: "https://px.example.test/flow/marketplace/marketplace.json",
  resource: "https://px.example.test/flow/marketplace",
  plugins: [
    { name: "pulsatrix-flow", version: "0.20.22", tenant: false },
    { name: "pulsatrix-flow-acme", version: "0.1.36", tenant: true },
  ],
};
const base = { declaration: held, loadedDirs: [] as string[], member: true };

describe("flowSkillsNote", () => {
  it("tells an active member to read the Flow skills through flow_run read doc", () => {
    const note = flowSkillsNote(base);
    expect(note).toContain("using-px-flow, running-px-flow");
    expect(note).toContain("flow_guard_uncovered");
    expect(note).toContain("after flow_run run.init");
    expect(note).toContain('"argv": ["doc", "product:skills/using-px-flow/SKILL.md"]');
    expect(note).toContain("never stops the pass");
    expect(note).not.toContain("__");
  });

  it("names a guard that is not enforced and an install not ready yet", () => {
    expect(flowSkillsNote({ ...base, declaration: { ...held, enabled: true, guard: "shadow", reason: undefined } })).toContain("does not declare its Flow guard as enforced");
    expect(flowSkillsNote({ ...base, declaration: { ...held, enabled: true, reason: undefined } })).toContain("not ready on this server yet");
  });

  it("says nothing when the product plugin is loaded for the turn", () => {
    expect(flowSkillsNote({ ...base, declaration: { ...held, enabled: true, reason: undefined }, loadedDirs: ["/data/org-flow-plugins/load/pulsatrix-flow", "/data/org-flow-plugins/load/pulsatrix-flow-acme"] })).toBe("");
  });

  it("still speaks when only the tenant plugin is loaded", () => {
    expect(flowSkillsNote({ ...base, loadedDirs: ["/data/org-flow-plugins/load/pulsatrix-flow-acme"] })).not.toBe("");
  });

  it("says nothing without a declaration or an active member", () => {
    expect(flowSkillsNote({ ...base, declaration: undefined })).toBe("");
    expect(flowSkillsNote({ ...base, member: false })).toBe("");
  });
});
