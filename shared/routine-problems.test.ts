import { describe, expect, it } from "vitest";
import { plainFromMarkdown, readableRoutineProblems } from "./routine-problems.ts";

// production 2026-11-03 00:10 UTC, a catch-up routine: the run's problems as
// stored, cut at 1,000 characters inside Robin's quoted last message.
const STORED = [
  "vérification indépendante et traitement final des courriels bloqués.",
  "Robin's work failed: The turn did not complete (tool_error). Before it stopped it made 8 tool calls: sagax_environment_read_file ×3 (1 failed), tool_search ×2, agents_memory_recall ×1, agents_session_search ×1, agents_run_with_engine ×1 (1 failed).",
  "Its last message, quoted: \"FAIL\\n\\nThe two-message archive plan is **not",
].join("\n");

describe("readableRoutineProblems", () => {
  it("a cut quote reads as plain text: real line breaks, no markdown, an ellipsis, no open quote", () => {
    const text = readableRoutineProblems(STORED);
    expect(text).not.toContain("\\n");
    expect(text).not.toContain("**");
    expect(text).not.toContain("quoted: \"");
    expect(text.endsWith("Its last message:\nFAIL\n\nThe two-message archive plan is not…")).toBe(true);
    expect(text.split("\n")[0]).toBe("vérification indépendante et traitement final des courriels bloqués.");
  });

  it("a whole quote is decoded once, escapes and quotes included, with no ellipsis", () => {
    const said = "PASS\n\n**Both** archives are `done`:\n- \"Inbox\" rule\n# Next";
    const text = readableRoutineProblems(`Robin's work failed: x.\nIts last message, quoted: ${JSON.stringify(said)}`);
    expect(text).toBe("Robin's work failed: x.\nIts last message:\nPASS\n\nBoth archives are done:\n- \"Inbox\" rule\nNext");
  });

  it("a cut inside an escape drops the broken escape", () => {
    expect(readableRoutineProblems("Its last message, quoted: \"a\\nb\\")).toBe("Its last message:\na\nb…");
    expect(readableRoutineProblems("Its last message, quoted: \"caf\\u00e9 \\u00")).toBe("Its last message:\ncafé u00…");
  });

  it("text without a quoted message is left as it was", () => {
    expect(readableRoutineProblems("cw_psa_query failed 3 times and never succeeded after: 404")).toBe("cw_psa_query failed 3 times and never succeeded after: 404");
  });
});

describe("plainFromMarkdown", () => {
  it("drops emphasis, ticks, headings, quotes and link targets; keeps bullets and snake_case", () => {
    expect(plainFromMarkdown("## Title\n> quoted\n*one* and _two_ [doc](https://x.test) cw_psa_query\n1. step")).toBe("Title\nquoted\none and two doc cw_psa_query\n1. step");
  });
});
