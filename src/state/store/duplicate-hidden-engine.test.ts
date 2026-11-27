// D-20261126-018 (#5351): Dupliquer never starts a copy on a provider the
// organization hid (dispatch-bots.ts). The copy keeps the start createBot gave.
import { describe, expect, it } from "vitest";

import { engineHidden } from "../../../shared/offered-engines";

/** Same gate dispatch-bots uses when building the duplicate profile. */
function duplicateModelSelection(
  sourceInstanceId: string,
  config: { hiddenEngines?: readonly string[] | null } | null,
): { modelSelection?: { instanceId: string; model: string } } {
  const selection = { instanceId: sourceInstanceId, model: "m" };
  return engineHidden({ organization: true, allowedEngines: null, hiddenEngines: config?.hiddenEngines ?? null }, sourceInstanceId)
    ? {}
    : { modelSelection: selection };
}

describe("Dupliquer leaves a hidden provider out of the copy", () => {
  it("omits modelSelection when the source runs on a hidden provider", () => {
    expect(duplicateModelSelection("claude", { hiddenEngines: ["claude"] })).toEqual({});
  });

  it("keeps modelSelection when the provider is shown", () => {
    expect(duplicateModelSelection("claude", { hiddenEngines: ["codex"] })).toEqual({
      modelSelection: { instanceId: "claude", model: "m" },
    });
    expect(duplicateModelSelection("claude", { hiddenEngines: [] })).toEqual({
      modelSelection: { instanceId: "claude", model: "m" },
    });
  });
});
