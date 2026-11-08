import { describe, expect, it } from "vitest";
import { nativeChoiceMismatch } from "./request-opened-present.ts";

// #2909: an engine question tool offering Yes / No on "A or B?" is sent
// back (the person could not answer it by a tap), like ask_choice.
describe("nativeChoiceMismatch", () => {
  const ask = (question: string, labels: string[], multiSelect = false) => [
    { question, multiSelect, options: labels.map((label) => ({ label })) },
  ];

  it("sends back Yes / No on a pick between alternatives", () => {
    expect(nativeChoiceMismatch({}, ask("Je garde la locale ou la distante ?", ["Oui", "Non"]), false)).toMatch(/alternatives/);
    expect(nativeChoiceMismatch({ summary: "Which copy do I keep?", choices: ["Yes", "No"] }, undefined, false)).toMatch(/alternatives/);
  });

  it("keeps real choices, yes / no questions, permissions, forms and multi-select", () => {
    expect(nativeChoiceMismatch({}, ask("Je garde la locale ou la distante ?", ["Locale", "Distante"]), false)).toBeUndefined();
    expect(nativeChoiceMismatch({}, ask("Je continue ?", ["Oui", "Non"]), false)).toBeUndefined();
    expect(nativeChoiceMismatch({ summary: "Which copy?", choices: ["Yes", "No"] }, undefined, true)).toBeUndefined();
    expect(nativeChoiceMismatch({}, ask("Which copy?", ["Yes", "No"], true), false)).toBeUndefined();
    expect(nativeChoiceMismatch({}, [...ask("Which copy?", ["Yes", "No"]), ...ask("Why?", ["A", "B"])], false)).toBeUndefined();
  });
});
