import { describe, expect, it } from "vitest";
import { allowedFallbackSelection, engineAllowed } from "./org-allowed-engines.ts";

const engines = [
  { instanceId: "claude", installed: true, defaultModel: "claude-opus-5-5" },
  { instanceId: "codex", installed: true, defaultModel: "gpt-5.6" },
  { instanceId: "grok", installed: false, defaultModel: "grok-4.7" },
];

describe("the organization's allowed model providers", () => {
  it("allows every engine while no list is set, and only the listed ones after", () => {
    for (const none of [null, undefined]) expect(engineAllowed(none, "codex")).toBe(true);
    expect(engineAllowed(["claude"], "claude")).toBe(true);
    expect(engineAllowed(["claude"], "codex")).toBe(false);
  });

  it("2026-10-17: an empty list allows no engine (Perspicax saves none as [])", () => {
    for (const id of ["claude", "codex", "grok"]) expect(engineAllowed([], id)).toBe(false);
    // no engine can take the bot: it keeps its model and its turns are refused
    expect(allowedFallbackSelection({ instanceId: "codex", model: "gpt-5.6" }, [], engines, { instanceId: "claude", model: "claude-sonnet-5" })).toBeNull();
  });

  it("leaves a bot on an allowed engine alone", () => {
    expect(allowedFallbackSelection({ instanceId: "claude", model: "claude-sonnet-5" }, ["claude"], engines)).toBeNull();
    expect(allowedFallbackSelection({ instanceId: "codex", model: "gpt-5.6" }, null, engines)).toBeNull();
  });

  it("moves a bot off an engine no longer allowed to Auto, on the New bot default when it is allowed", () => {
    const current = { instanceId: "codex", model: "gpt-5.6", effort: "high" as const };
    expect(allowedFallbackSelection(current, ["claude", "grok"], engines, { instanceId: "claude", model: "claude-sonnet-5" }))
      .toEqual({ instanceId: "claude", model: "claude-sonnet-5", auto: true });
  });

  it("else takes the first allowed engine installed here, at its default model", () => {
    const current = { instanceId: "codex", model: "gpt-5.6" };
    // The New bot default is on a refused engine; grok is allowed but not installed.
    expect(allowedFallbackSelection(current, ["grok", "claude"], engines, { instanceId: "codex", model: "gpt-5.6" }))
      .toEqual({ instanceId: "claude", model: "claude-opus-5-5", auto: true });
  });

  it("keeps the model when no allowed engine can take the bot", () => {
    expect(allowedFallbackSelection({ instanceId: "codex", model: "gpt-5.6" }, ["grok"], engines)).toBeNull();
  });
});
