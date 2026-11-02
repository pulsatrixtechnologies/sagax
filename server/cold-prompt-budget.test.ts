import { expect, it, describe } from "vitest";
import {
  applyColdPromptBudgets,
  coldSectionAllowance,
  COLD_PROMPT_SECTION_BUDGETS,
  COLD_PROMPT_TOTAL_BUDGET,
  COLD_RICH_OUTPUT_PROMPT,
  EMAIL_WATCH_PAYLOAD_MAX_CHARS,
  EMAIL_WATCH_RAW_EXCERPT_MAX,
  enforceColdPromptTotal,
  eventPayloadMaxChars,
  eventRawExcerptMaxChars,
  isEmailWatchSource,
  lightenColdPrompt,
  measureColdPrompt,
  syntheticColdPromptParts,
  truncateSectionText,
} from "./cold-prompt-budget.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

describe("cold prompt section budgets", () => {
  it("pins every budgeted section of a synthetic cold turn under its cap and the total", () => {
    const before = measureColdPrompt(syntheticColdPromptParts());
    expect(before.totalBytes).toBeGreaterThan(88_000);
    expect(before.sections.some((row) => row.over)).toBe(true);

    const light = lightenColdPrompt(syntheticColdPromptParts());
    const after = measureColdPrompt(light);
    expect(after.totalBytes).toBeLessThanOrEqual(COLD_PROMPT_TOTAL_BUDGET);
    expect(after.overTotal).toBe(false);
    for (const row of after.sections) {
      const allowance = coldSectionAllowance(row.id);
      if (allowance === null) continue;
      expect(row.bytes, `${row.id} bytes=${row.bytes} allowance=${allowance}`).toBeLessThanOrEqual(allowance);
      expect(row.over, row.id).toBe(false);
    }
    // Scorecard V1/R3: production cold prompts were 88k to 101k chars.
    expect(before.totalBytes, `before=${before.totalBytes} after=${after.totalBytes} budget=${COLD_PROMPT_TOTAL_BUDGET}`).toBeGreaterThan(88_000);
    expect(after.totalBytes).toBeLessThan(before.totalBytes / 2);
  });

  it("replaces rich-output with the short automation paragraph", () => {
    const parts = applyColdPromptBudgets([
      { id: "rich-output", label: "Rich output", text: ` chart kit `.repeat(2_000) },
    ]);
    expect(parts[0]!.text).toBe(COLD_RICH_OUTPUT_PROMPT);
    expect(Buffer.byteLength(parts[0]!.text, "utf8")).toBeLessThanOrEqual(COLD_PROMPT_SECTION_BUDGETS["rich-output"]!);
  });

  it("drops zero-budget sections and keeps a truncation notice on oversized ones", () => {
    const parts = applyColdPromptBudgets([
      { id: "threads", label: "Threads", text: " start_thread ".repeat(200) },
      { id: "reactions", label: "Reactions", text: " emoji ".repeat(200) },
      { id: "memory", label: "Memory", text: `\nMemory:\n${"note ".repeat(5_000)}` },
    ]);
    expect(parts.find((part) => part.id === "reactions")!.text).toBe("");
    expect(parts.find((part) => part.id === "threads")!.text).toContain("sagax_help");
    const memory = parts.find((part) => part.id === "memory")!.text;
    expect(Buffer.byteLength(memory, "utf8")).toBeLessThanOrEqual(COLD_PROMPT_SECTION_BUDGETS.memory!);
    expect(memory).toMatch(/Cold prompt budget|MEMORY\.md|memory tools/);
  });

  it("enforces the total ceiling after per-section caps", () => {
    const fat = Array.from({ length: 20 }, (_, i) => ({
      id: "perspicax",
      label: `P${i}`,
      text: `\nblock ${i}\n${"y".repeat(3_000)}`,
    }));
    // perspicax budget is 1500; after section caps still many copies can sum high
    // if we used unique ids under the total trim list:
    const parts = [
      { id: "memory", label: "Memory", text: `\n${"m".repeat(20_000)}` },
      { id: "skills", label: "Skills", text: `\n${"s".repeat(10_000)}` },
      { id: "docs", label: "Docs", text: `\n${"d".repeat(10_000)}` },
      { id: "recent", label: "Recent", text: `\n${"r".repeat(10_000)}` },
      { id: "browser", label: "Browser", text: `\n${"b".repeat(10_000)}` },
      { id: "coordination", label: "Team", text: `\n${"c".repeat(10_000)}` },
      { id: "misuse-policy", label: "Security", text: " Keep the security policy." },
      ...fat,
    ];
    const capped = enforceColdPromptTotal(applyColdPromptBudgets(parts));
    const measure = measureColdPrompt(capped);
    expect(measure.totalBytes).toBeLessThanOrEqual(COLD_PROMPT_TOTAL_BUDGET);
    expect(capped.find((part) => part.id === "misuse-policy")!.text).toContain("security policy");
  });

  it("keeps buildSystemPrompt under the cold total for a synthetic automation turn", () => {
    const light = lightenColdPrompt(syntheticColdPromptParts());
    const built = buildSystemPrompt("You are Scout.", "Be brief.", light);
    expect(Buffer.byteLength(built.text, "utf8")).toBeLessThanOrEqual(COLD_PROMPT_TOTAL_BUDGET + 8_000);
    for (const section of built.sections) {
      const allowance = coldSectionAllowance(section.id);
      if (allowance === null) continue;
      expect(section.bytes, section.id).toBeLessThanOrEqual(allowance);
    }
  });

  it("cuts on a UTF-8 boundary and leaves a notice", () => {
    const text = "é".repeat(500);
    const out = truncateSectionText("docs", text, 200);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(200);
    expect(out).toContain("Cold prompt budget");
    expect(out).toMatch(/é+\n\[Cold prompt budget/);
  });
});

describe("email-watch payload bounds", () => {
  it("uses the tight budget for email and botmail only", () => {
    expect(isEmailWatchSource("email")).toBe(true);
    expect(isEmailWatchSource("botmail")).toBe(true);
    expect(isEmailWatchSource("github")).toBe(false);
    expect(eventPayloadMaxChars("email")).toBe(EMAIL_WATCH_PAYLOAD_MAX_CHARS);
    expect(eventPayloadMaxChars("botmail")).toBe(EMAIL_WATCH_PAYLOAD_MAX_CHARS);
    expect(eventPayloadMaxChars("github")).toBe(48_000);
    expect(eventRawExcerptMaxChars("email")).toBe(EMAIL_WATCH_RAW_EXCERPT_MAX);
    expect(eventRawExcerptMaxChars("github")).toBe(12_000);
    expect(EMAIL_WATCH_PAYLOAD_MAX_CHARS).toBeLessThanOrEqual(8_000);
    expect(EMAIL_WATCH_PAYLOAD_MAX_CHARS + COLD_PROMPT_TOTAL_BUDGET).toBeLessThan(88_000);
  });
});
