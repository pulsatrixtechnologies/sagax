import { describe, expect, it } from "vitest";
import { capabilityPrompt, CAPABILITY_PROMPT_MAX_BYTES, type CapabilityPromptFile } from "./capability-prompt.ts";
const file = (name: string, text = "Verify the package."): CapabilityPromptFile => ({ kind: "skill", name, description: "Verify packing", path: `/workspace/sagax-plugins/packing/skills/${name}/SKILL.md`, read: () => text });

describe("the same instructions for every engine, budgeted per capability", () => {
  it("gives file engines exact paths and chat-only engines the actual file", () => {
    for (const engine of ["codex", "piAgent", "opencodeGo"]) {
      const prompt = capabilityPrompt(engine, [{ key: "packing", name: "Packing", files: [file("ship")] }]);
      expect(prompt.text).toContain("/workspace/sagax-plugins/packing/skills/ship/SKILL.md");
      expect(prompt.text).not.toContain("Verify the package.");
    }
    for (const engine of ["grok", "openai-compat", "minimax", "mistral", "cerebras", "groq"]) {
      const prompt = capabilityPrompt(engine, [{ key: "packing", name: "Packing", files: [file("ship")] }]);
      expect(prompt.text).toContain("Verify the package.");
      expect(prompt.text).not.toContain("/workspace/");
      expect(prompt.byCapability.packing).toMatchObject({ skills: 1, omitted: 0 });
    }
  });
  it("inlines whole files only without managed reads, otherwise publishes an index", () => {
    for (const managedTools of [false, true]) {
      const prompt = capabilityPrompt("grok", [{ key: "packing", name: "Packing", files: [file("ship")] }], { managedTools });
      expect(prompt.text.includes("Verify the package.")).toBe(!managedTools);
      expect(prompt.text).toContain("1/1 references; 0 omitted.");
      expect(prompt.text.includes('skill "ship"')).toBe(!managedTools);
      expect(prompt.text).not.toContain("/workspace/sagax-plugins/packing/skills/ship/SKILL.md");
      expect(prompt.text.includes("skills_list")).toBe(managedTools);
    }
  });
  it("keeps files whole and names what passes the count/byte budget without starving the next capability", () => {
    const prompt = capabilityPrompt("grok", [
      { key: "many", name: "Many", files: Array.from({ length: 35 }, (_, i) => file(`s${i}`)) },
      { key: "large", name: "Large", files: [file("big", "é".repeat(4_000)), file("small")] },
      { key: "other", name: "Other", files: [file("independent")] },
    ]);
    expect(prompt.byCapability.many).toMatchObject({ skills: 30, named: 5, omitted: 0 });
    expect(prompt.byCapability.large).toMatchObject({ skills: 1, named: 1, omitted: 0 });
    expect(prompt.byCapability.other).toMatchObject({ skills: 1, omitted: 0 });
    expect(prompt.text).toContain('skill "small"');
    expect(prompt.text).not.toContain('skill "big"');
    expect(prompt.text).toContain("skills: big.");
    expect(prompt.text).toContain("skills: s30, s31, s32, s33, s34.");
    expect(Object.values(prompt.byCapability).every((row) => row.bytes <= CAPABILITY_PROMPT_MAX_BYTES)).toBe(true);
    expect(prompt.index).toMatchObject({ omitted: 0, named: 6 });
    expect(prompt.index.bytes).toBe(Buffer.byteLength(prompt.text, "utf8"));
  });
  it("never opens instruction files just to build a file-engine index", () => {
    const input = file("ship");
    input.read = () => { throw new Error("must not open"); };
    expect(capabilityPrompt("codex", [{ key: "packing", name: "Packing", files: [input] }]).byCapability.packing.skills).toBe(1);
  });
  it("keeps chat engines on the index for a cold turn (indexOnly)", () => {
    const input = file("ship");
    input.read = () => { throw new Error("must not open on cold"); };
    const prompt = capabilityPrompt("grok", [{ key: "packing", name: "Packing", files: [input] }], { managedTools: true, indexOnly: true });
    expect(prompt.text).toContain("- skill ship: Verify packing");
    expect(prompt.text).not.toContain("Verify the package.");
    expect(prompt.text).toContain("file index");
  });
  it.each(["grok", "openai-compat", "minimax", "mistral", "cerebras", "groq"])("%s never opens bodies for an index, and keeps the tools-off fallback even on cold turns", engine => {
    const input = file("ship");
    input.read = () => { throw new Error("index must not read"); };
    expect(capabilityPrompt(engine, [{ key: "packing", name: "Packing", files: [input] }], { managedTools: true }).text).toContain("- skill ship:");
    expect(capabilityPrompt(engine, [{ key: "packing", name: "Packing", files: [file("ship")] }], { managedTools: false, indexOnly: true }).text).toContain("Verify the package.");
  });
  it("uses one-line discovery copy, distinct capability headings, and one shared read rule", () => {
    const input = { ...file("ship"), description: "Verify packing.\n" + "Extra discovery detail. ".repeat(40) };
    const prompt = capabilityPrompt("grok", [
      { key: "one", name: "Osprey", files: [input] },
      { key: "two", name: "Wren", files: [{ ...input, path: "plugins/wren/ship/SKILL.md" }] },
    ], { managedTools: true });
    expect(prompt.text).toContain("- skill ship: Verify packing.\n");
    expect(prompt.text).not.toContain("Extra discovery detail");
    expect(prompt.text).toContain('Capability "Osprey"');
    expect(prompt.text).toContain('Capability "Wren"');
    expect(prompt.text.split("Before matching work,")).toHaveLength(2);
    expect(prompt.text).toContain("exact scoped path");
    // #2577: a single read never starts with a skill lookup
    expect(prompt.text).toContain("A single read or lookup is not matching work: call the tool directly");
    expect(prompt.index.skills).toBe(2);
  });
  it("counts only the kinds that reached the prompt when another part is omitted", () => {
    const prompt = capabilityPrompt("grok", [{ key: "mixed", name: "Mixed", files: [
      file("small"), { ...file("large-agent", "x".repeat(4_000)), kind: "agent" },
      { ...file("run"), kind: "command" },
    ] }]);
    expect(prompt.byCapability.mixed).toMatchObject({ skills: 2, named: 1, omitted: 0, parts: { skills: 1, commands: 1, agents: 0 } });
    expect(prompt.index.parts).toEqual({ skills: 1, commands: 1, agents: 0 });
  });
  // #3295: a pack larger than the old cap (30 files, 4,000 bytes) keeps every
  // enabled reference reachable: what does not fit in full is named, with the
  // route to its instructions, never dropped in silence.
  it("names every reference of a pack past the full-entry budget, with how to reach it", () => {
    const pack = Array.from({ length: 80 }, (_, i) => ({ ...file(`pack-skill-${String(i).padStart(2, "0")}`), description: "Handles one packing step. ".repeat(6) }));
    const names = pack.map((entry) => entry.name);
    const managed = capabilityPrompt("grok", [{ key: "pack", name: "Pack", files: pack }], { managedTools: true });
    for (const name of names) expect(managed.text).toMatch(new RegExp(`\\b${name}\\b`));
    expect(managed.text).toContain("skills_list with the name");
    expect(managed.byCapability.pack.omitted).toBe(0);
    expect(managed.byCapability.pack.named).toBe(80 - managed.byCapability.pack.skills);
    expect(managed.byCapability.pack.bytes).toBeLessThanOrEqual(CAPABILITY_PROMPT_MAX_BYTES);
    expect(managed.index.bytes).toBe(Buffer.byteLength(managed.text, "utf8"));
    expect(managed.index.bytes).toBeLessThanOrEqual(managed.index.maxBytes);
    const files = capabilityPrompt("codex", [{ key: "pack", name: "Pack", files: pack }]);
    for (const entry of pack) expect(files.text).toContain(entry.path);
    expect(files.byCapability.pack.omitted).toBe(0);
    const inline = capabilityPrompt("grok", [{ key: "pack", name: "Pack", files: pack }]);
    for (const name of names) expect(inline.text).toMatch(new RegExp(`\\b${name}\\b`));
    expect(inline.text).toContain("not in this prompt");
    expect(inline.byCapability.pack.omitted).toBe(0);
  });
});
