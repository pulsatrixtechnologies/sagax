// The conversation's header shows no token figure (owner 2026-11-25,
// M-20261125-076, #5372): "966k uncached" in grey text left the header; the
// context reads in the meter under the message box (ComposerMeter.tsx). The
// count itself stays where it serves (the conversation picker, Usage pages).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = import.meta.dirname;
const read = (path: string) => readFileSync(join(dir, path), "utf8");

describe("the conversation's header", () => {
  it("draws no usage chip", () => {
    expect(read("ChatViewHeader.tsx")).not.toMatch(/UsageChip|usage-chip/);
    expect(existsSync(join(dir, "../UsageChip.tsx"))).toBe(false);
  });

  it("leaves no rule for the chip in a skin and none of its labels in the catalogs", () => {
    expect(read("../../styles/retro98.css")).not.toContain("usage-chip");
    const english = JSON.parse(read("../../locales/en.json")) as Record<string, string>;
    for (const key of ["chat.usage.costAria", "chat.usage.cardHint", "chat.usage.cardThread"]) expect(english[key], key).toBeUndefined();
  });
});
