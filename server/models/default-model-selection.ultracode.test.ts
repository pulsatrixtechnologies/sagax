import { describe, expect, it } from "vitest";
import { ULTRACODE_EFFORT } from "../../shared/ultracode-effort.ts";
import { selectDefaultModelSelection, withNewBotEffort } from "./default-model-selection.ts";

const claude = {
  instanceId: "claude",
  driverKind: "claudeAgent",
  snapshot: { state: "available" as const, authenticated: true },
  models: { default: "opus", options: [{ id: "opus", label: "Opus" }] },
  capabilities: { effortLevels: ["low", "medium", "high", "max", "ultracode"] as const },
};

describe("ultracode in default model selection", () => {
  it("keeps ultracode on a saved selection when the engine offers effort", () => {
    const selection = selectDefaultModelSelection([claude], {
      instanceId: "claude",
      model: "opus",
      effort: ULTRACODE_EFFORT,
    });
    expect(selection.effort).toBe(ULTRACODE_EFFORT);
  });

  it("applies ultracode from new-bot defaults", () => {
    const selection = withNewBotEffort(
      { instanceId: "claude", model: "opus" },
      ULTRACODE_EFFORT,
      claude.capabilities.effortLevels,
    );
    expect(selection.effort).toBe(ULTRACODE_EFFORT);
  });
});
