import { describe, expect, it } from "vitest";
import { DISCOVERY_MAX_BYTES, skillDiscoveryAvailable, skillDiscoveryIndex, skillDiscoveryPage, type DiscoveredSkill } from "./skill-discovery.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";

const row = (id: number, extra: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  id: `person:skill:skill-${String(id).padStart(2, "0")}`, name: `skill-${id}`, scope: "person", source: "Me", kind: "skill",
  enabled: true, description: "Vérifie les colis 🐈 ".repeat(100), path: `capability-skills/me/skills/skill-${id}/SKILL.md`, ...extra,
});

describe("one skills discovery contract", () => {
  it("bounds the combined prompt, reports omissions and keeps every reference discoverable", () => {
    const rows = Array.from({ length: 65 }, (_, id) => row(id));
    const index = skillDiscoveryIndex(rows);
    expect(Buffer.byteLength(index.text, "utf8")).toBeLessThanOrEqual(DISCOVERY_MAX_BYTES);
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

  it("shortens descriptions before omitting names and handles oversized paths honestly", () => {
    const small = skillDiscoveryIndex([row(1), row(2)]);
    expect(small.metrics.skills).toBe(2);
    expect(small.metrics.omitted).toBe(0);
    expect(small.text).toContain("Descriptions shortened");
    const large = skillDiscoveryIndex([row(1, { path: "p".repeat(6000) })]);
    expect(large.metrics.bytes).toBeLessThanOrEqual(DISCOVERY_MAX_BYTES);
    expect(large.metrics.omitted).toBe(1);
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
    expect(partial.metrics.bytes).toBeLessThanOrEqual(DISCOVERY_MAX_BYTES);
  });
});
