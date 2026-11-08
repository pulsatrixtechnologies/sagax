import { describe, expect, it } from "vitest";
import { installedPluginChoices, previewModelLine } from "./PluginTeamImportDialog";

// #2669: the Team map imports an installed plugin as a team.
describe("PluginTeamImportDialog", () => {
  it("offers only installed plugins, with their marketplace", () => {
    expect(installedPluginChoices([
      { name: "pulsatrix", plugins: [{ name: "pulsatrix-dev", installed: true }, { name: "other" }] },
      { name: "gox", plugins: [{ name: "pulsatrix-flow-gox", installed: true }] },
      { name: "empty" },
    ])).toEqual([{ marketplace: "pulsatrix", plugin: "pulsatrix-dev" }, { marketplace: "gox", plugin: "pulsatrix-flow-gox" }]);
  });

  it("shows each bot's model, never an instance id", () => {
    expect(previewModelLine({ name: "a", model: "claude-fable-5-1", tools: [], toolsEnforced: false, notes: [] })).toBe("claude-fable-5-1");
    expect(previewModelLine({ name: "b", modelAsked: "haiku", tools: [], toolsEnforced: false, notes: [] })).toContain("haiku");
  });
});
