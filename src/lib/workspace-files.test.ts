// The client half of the bot workspace: the rules counter, document names,
// and the starter template, kept equal to the server's.
import { describe, expect, it } from "vitest";

import { RULES_MAX_BYTES as SERVER_MAX_BYTES, RULES_MAX_LINES as SERVER_MAX_LINES, RULES_TEMPLATE as SERVER_TEMPLATE, effectiveRulesText as serverEffective } from "../../server/workspace/workspace-files.ts";
import { RULES_TEMPLATE } from "../components/bot-settings/RulesSection";
import { RULES_MAX_BYTES, RULES_MAX_LINES, docPathFromName, isRulesOrDoc, effectiveRulesText, entryAncestors, entryDepth, entryName, entryParent, entryVisible, rulesCount } from "./workspace-files";

describe("workspace files (client)", () => {
  it("keeps the starter template and the budget equal to the server's", () => {
    expect(RULES_TEMPLATE).toBe(SERVER_TEMPLATE);
    expect(RULES_MAX_LINES).toBe(SERVER_MAX_LINES);
    expect(RULES_MAX_BYTES).toBe(SERVER_MAX_BYTES);
  });

  it("counts what loads: comments never count, so the template alone is empty", () => {
    expect(rulesCount(RULES_TEMPLATE)).toMatchObject({ lines: 1, over: false });
    const raw = "# Rules\n\n<!-- note -->\n- Never quote a price.\n- Always ask first.\n";
    expect(effectiveRulesText(raw)).toBe(serverEffective(raw));
    expect(rulesCount(raw)).toMatchObject({ lines: 4, maxLines: 100, maxBytes: 12000, over: false });
  });

  it("says when the rules are over budget, by lines or by bytes", () => {
    expect(rulesCount(Array.from({ length: 101 }, (_, i) => `- rule ${i}`).join("\n")).over).toBe(true);
    expect(rulesCount(`- ${"x".repeat(12_001)}`).over).toBe(true);
  });

  it("serves RULES.md, rule sets and documents through /workspace/file, nothing else", () => {
    expect(isRulesOrDoc("RULES.md")).toBe(true);
    expect(isRulesOrDoc("rules/emails.md")).toBe(true);
    expect(isRulesOrDoc("docs/a.md")).toBe(true);
    expect(isRulesOrDoc("rules/.sets.json")).toBe(false);
    expect(isRulesOrDoc("MEMORY.md")).toBe(false);
  });

  it("turns a typed name into a docs/ path, or refuses it", () => {
    expect(docPathFromName("Onboarding procedure")).toBe("docs/Onboarding procedure.md");
    expect(docPathFromName("docs/price list.md")).toBe("docs/price list.md");
    expect(docPathFromName("../../etc/passwd")).toBe("docs/etc-passwd.md");
    expect(docPathFromName("   ")).toBeNull();
    expect(docPathFromName("...")).toBeNull();
  });

  it("indents the tree by folder depth", () => {
    expect(entryDepth("MEMORY.md")).toBe(0);
    expect(entryDepth("memory/log/2026-10-09.md")).toBe(2);
    expect(entryName("docs/a.md")).toBe("a.md");
  });

  it("hides a file until every listed ancestor folder is expanded", () => {
    expect(entryParent("MEMORY.md")).toBeNull();
    expect(entryParent("memory/log/2026-10-09.md")).toBe("memory/log");
    expect(entryAncestors("memory/log/2026-10-09.md")).toEqual(["memory", "memory/log"]);
    const dirs = new Set(["docs", "memory", "memory/log"]);
    expect(entryVisible("MEMORY.md", new Set(), dirs)).toBe(true);
    expect(entryVisible("memory", new Set(), dirs)).toBe(true);
    expect(entryVisible("memory/boards.md", new Set(), dirs)).toBe(false);
    expect(entryVisible("memory/boards.md", new Set(["memory"]), dirs)).toBe(true);
    expect(entryVisible("memory/log/2026-10-09.md", new Set(["memory"]), dirs)).toBe(false);
    expect(entryVisible("memory/log/2026-10-09.md", new Set(["memory", "memory/log"]), dirs)).toBe(true);
    expect(entryVisible("memory/log/2026-10-09.md", new Set(["memory"]), new Set(["memory"]))).toBe(true);
  });
});
