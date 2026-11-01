import { describe, expect, it } from "vitest";
import { skillDiscoveryAvailable, skillDiscoveryPage, type DiscoveredSkill } from "./skill-discovery.ts";
import { CAPABILITY_PROMPT_MAX_BYTES, capabilityPrompt, capabilityPromptGroups } from "./capability-prompt.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";

const row = (id: number, extra: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  id: `person:skill:skill-${String(id).padStart(2, "0")}`, name: `skill-${id}`, scope: "person", source: "Me", kind: "skill",
  enabled: true, description: "Vérifie les colis 🐈 ".repeat(100), path: `capability-skills/me/skills/skill-${id}/SKILL.md`,
  capability: { key: "plugin:me:packing@catalog", name: "packing" }, ...extra,
});
// The per-capability prompt over the same rows a file engine would index.
const skillDiscoveryIndex = (rows: DiscoveredSkill[], incomplete = false, managedTools = true) => {
  const prompt = capabilityPrompt("codex", capabilityPromptGroups("codex", rows, { managedTools, read: () => null }), { managedTools, incomplete });
  return { text: prompt.text, metrics: prompt.index };
};

describe("one skills discovery contract", () => {
  it("bounds each capability's prompt, reports omissions and keeps every reference discoverable", () => {
    const rows = Array.from({ length: 65 }, (_, id) => row(id, { description: "Vérifie les colis 🐈" }));
    const index = skillDiscoveryIndex(rows);
    expect(index.metrics.bytes).toBe(Buffer.byteLength(index.text, "utf8"));
    expect(index.metrics.skills).toBeLessThanOrEqual(30);
    expect(index.metrics.omitted + index.metrics.skills).toBe(65);
    expect(index.text).toContain("omitted");
    expect(index.text).toContain("skills_list");
    expect(index.text).not.toContain("�");
    const found = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = skillDiscoveryPage(rows, "", offset);
      expect(page.total).toBe(65);
      found.push(...page.skills);
      offset = page.nextOffset;
    }
    expect(new Set(found.map((entry) => entry.id)).size).toBe(65);
    expect(found.find((entry) => entry.name === "skill-64")?.description).toBe(rows[64]!.description);
  });

  it("omits an oversized reference whole and keeps the smaller ones of the same capability", () => {
    const index = skillDiscoveryIndex([row(1, { path: "p".repeat(6000) }), row(2, { description: "Short" })]);
    expect(index.metrics).toMatchObject({ skills: 1, omitted: 1 });
    expect(index.text).toContain("skill-2");
    expect(index.text).not.toContain("p".repeat(6000));
    expect(Buffer.byteLength(index.text, "utf8")).toBeLessThanOrEqual(CAPABILITY_PROMPT_MAX_BYTES + 400);
  });

  it("filters before paging, preserves plugin namespaces and hides disabled metadata", () => {
    const rows = [row(0, { enabled: false, description: "UNREVIEWED", path: "PRIVATE" }),
      row(1, { id: "bot:plugin:alpha:skill:review", name: "review", source: "alpha" }),
      row(2, { id: "bot:plugin:beta:skill:review", name: "review", source: "beta" })];
    expect(skillDiscoveryPage(rows, "review").skills).toHaveLength(2);
    expect(skillDiscoveryPage(rows, "UNREVIEWED").total).toBe(0);
    const disabled = skillDiscoveryPage(rows, "skill-0").skills[0];
    expect(disabled).not.toHaveProperty("description");
    expect(disabled).not.toHaveProperty("path");
    const native = skillDiscoveryIndex([row(3, { native: true })]);
    expect(native.text).toBe("");
    expect(native.metrics).toMatchObject({ skills: 0, omitted: 0, bytes: 0 });
    expect(skillDiscoveryPage([row(3, { native: true })]).total).toBe(1);
  });

  it("offers discovery in direct and room turns independently of authoring", () => {
    for (const room of ["0", "1"]) {
      const tools = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "fixture", SAGAX_GROUP_TURN: room, SAGAX_SKILL_AUTHORING_ENABLED: "0" }));
      expect(tools.map((tool) => tool.name)).toContain("skills_list");
      expect(tools.map((tool) => tool.name)).not.toContain("skill_manage");
    }
  });

  it("honors explicit tool choices and preserves native file-tool references", () => {
    expect(skillDiscoveryAvailable(true, undefined)).toBe(true);
    expect(skillDiscoveryAvailable(false, undefined)).toBe(false);
    for (const name of ["skills_list", "workspace_read"]) expect(skillDiscoveryAvailable(true, { deny: [`mcp:agents:${name}`] })).toBe(false);
    expect(skillDiscoveryAvailable(true, { allow: ["mcp:agents:skills_list"] })).toBe(false);
    const index = skillDiscoveryIndex([row(0, { filePath: "/native/skills/skill-0/SKILL.md" })], false, false);
    expect(index.text).toContain('Read "/native/skills/skill-0/SKILL.md"');
    expect(index.text).not.toContain("workspace_read");
    expect(index.text).not.toContain("skills_list");
    const partial = skillDiscoveryIndex([], true);
    expect(partial.metrics.incomplete).toBe(true);
    expect(partial.text).toContain("Plugin discovery is partial");
    expect(partial.metrics.bytes).toBe(Buffer.byteLength(partial.text, "utf8"));
  });
});
