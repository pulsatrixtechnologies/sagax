// The Team Bot copy's choices (JC 2026-10-21: persona, rules, plugins and
// the team's memory, never a conversation nor the bot's private memory).
import { describe, expect, it } from "vitest";

import { initialCarryChoices, pluginConfigCarry, ruleCopies, startingInstructions } from "./TeamBotFromThreadDialog";

const plugins = [
  { key: "a@m", name: "a", marketplace: "m", enabled: true },
  { key: "b@m", name: "b", marketplace: "m", enabled: false },
];

describe("Team Bot from a conversation", () => {
  it("ticks enabled plugins, every connector and the rules, and has no memory choice at all", () => {
    const choices = initialCarryChoices({ plugins, connectors: ["linear"] });
    expect([...choices.plugins]).toEqual(["a@m"]);
    expect([...choices.connectors]).toEqual(["linear"]);
    expect(choices.rules).toBe(true);
    expect(Object.keys(choices)).not.toContain("includeMemory");
  });

  it("starts from the bot's own persona, else from the draft", () => {
    expect(startingInstructions("Be precise.", "Drafted.")).toBe("Be precise.");
    expect(startingInstructions("  ", "Drafted.")).toBe("Drafted.");
    expect(startingInstructions(undefined, "Drafted.")).toBe("Drafted.");
  });

  it("copies a plugin's saved values and never a secret", () => {
    expect(pluginConfigCarry({
      config: {
        fields: [{ key: "team", sensitive: false }, { key: "token", sensitive: true }],
        values: { team: "Platform", token: "sk" },
      },
    })).toEqual({ team: "Platform" });
    expect(pluginConfigCarry({})).toBeNull();
    expect(pluginConfigCarry({ config: { fields: [{ key: "team", sensitive: false }], values: { team: "" } } })).toBeNull();
  });

  it("copies each rule set with text: the same set's text and switch, a new one added", () => {
    const source = [
      { id: "rules", name: null, enabled: true, text: "# Rules\n- Be brief\n", hash: "s1" },
      { id: "clients", name: "Clients", enabled: false, text: "# Clients\n- Never call\n", hash: "s2" },
      { id: "empty", name: "Empty", enabled: true, text: "  ", hash: "s3" },
    ];
    const target = [{ id: "rules", name: null, enabled: false, text: "", hash: "t1" }];
    expect(ruleCopies(source, target)).toEqual([
      { kind: "update", id: "rules", text: "# Rules\n- Be brief\n", hash: "t1", enabled: true, changeSwitch: true },
      { kind: "add", name: "Clients", text: "# Clients\n- Never call\n", enabled: false },
    ]);
  });
});
