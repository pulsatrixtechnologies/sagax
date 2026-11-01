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
  it("gives chat-only engines the whole file by name with tools off, and by alias with tools on (Q8 C)", () => {
    for (const managedTools of [false, true]) {
      const prompt = capabilityPrompt("grok", [{ key: "packing", name: "Packing", files: [file("ship")] }], { managedTools });
      expect(prompt.text).toContain("Verify the package.");
      expect(prompt.text).toContain("Prompt budget: 1/1 files, at most 30 files and 4000 bytes per capability; 0 omitted.");
      expect(prompt.text.includes('skill "ship"')).toBe(!managedTools);
      expect(prompt.text.includes("/workspace/sagax-plugins/packing/skills/ship/SKILL.md")).toBe(managedTools);
      expect(prompt.text.includes("skills_list")).toBe(false);
    }
  });
  it("keeps files whole and reports count/byte omissions without starving the next capability", () => {
    const prompt = capabilityPrompt("grok", [
      { key: "many", name: "Many", files: Array.from({ length: 35 }, (_, i) => file(`s${i}`)) },
      { key: "large", name: "Large", files: [file("big", "é".repeat(4_000)), file("small")] },
      { key: "other", name: "Other", files: [file("independent")] },
    ]);
    expect(prompt.byCapability.many).toMatchObject({ skills: 30, omitted: 5 });
    expect(prompt.byCapability.large).toMatchObject({ skills: 1, omitted: 1 });
    expect(prompt.byCapability.other).toMatchObject({ skills: 1, omitted: 0 });
    expect(prompt.text).toContain('skill "small"');
    expect(prompt.text).not.toContain('skill "big"');
    expect(Object.values(prompt.byCapability).every((row) => row.bytes <= CAPABILITY_PROMPT_MAX_BYTES)).toBe(true);
    expect(prompt.index.omitted).toBe(6);
    expect(prompt.index.bytes).toBe(Buffer.byteLength(prompt.text, "utf8"));
  });
  it("never opens instruction files just to build a file-engine index", () => {
    const input = file("ship");
    input.read = () => { throw new Error("must not open"); };
    expect(capabilityPrompt("codex", [{ key: "packing", name: "Packing", files: [input] }]).byCapability.packing.skills).toBe(1);
  });
  it("counts only the kinds that reached the prompt when another part is omitted", () => {
    const prompt = capabilityPrompt("grok", [{ key: "mixed", name: "Mixed", files: [
      file("small"), { ...file("large-agent", "x".repeat(4_000)), kind: "agent" },
      { ...file("run"), kind: "command" },
    ] }]);
    expect(prompt.byCapability.mixed).toMatchObject({ skills: 2, omitted: 1, parts: { skills: 1, commands: 1, agents: 0 } });
    expect(prompt.index.parts).toEqual({ skills: 1, commands: 1, agents: 0 });
  });
});
