// M-20261119-015: the composer's chip names the account the model runs on
// while the provider has several (the menu's own words for it).
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { InstanceInfo } from "@/state/store";
import { modelPickerComposerLabel } from "./labels";

setLocale("en");

const team = { instanceId: "claude-team", driverKind: "claudeAgent", displayName: "Team", snapshot: { state: "available" },
  models: { default: "claude-mythos-5-2", options: [{ id: "claude-mythos-5-2", label: "Claude Mythos 5.2" }] } } as unknown as InstanceInfo;

describe("modelPickerComposerLabel", () => {
  it("adds the account after the model", () => {
    expect(modelPickerComposerLabel({ autoOn: false, autoRecord: null, active: team, selection: { instanceId: "claude-team", model: "claude-mythos-5-2" },
      selectedVariantLabel: undefined, providerLabel: "Claude", accountLabel: "Team" })).toBe("Claude Mythos 5.2 · Team");
  });

  it("says no account with one", () => {
    expect(modelPickerComposerLabel({ autoOn: false, autoRecord: null, active: team, selection: { instanceId: "claude-team", model: "claude-mythos-5-2" },
      selectedVariantLabel: undefined, providerLabel: "Claude" })).toBe("Claude Mythos 5.2");
  });
});
