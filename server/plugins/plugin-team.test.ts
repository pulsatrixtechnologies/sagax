import { describe, expect, it } from "vitest";
import type { SelectableInstance } from "../models/default-model-selection.ts";
import { resolvePluginAgentModel, resolvePluginTeamModels } from "./plugin-team.ts";

const CLAUDE_IDS = [
  "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-haiku-4-5",
];

function instance(instanceId: string, driverKind: string, ids: string[], over: Partial<SelectableInstance> = {}): SelectableInstance {
  return {
    instanceId,
    driverKind,
    snapshot: { status: "ready", installed: true, auth: { status: "authenticated" } },
    models: { default: ids[0] ?? null, options: ids.map((id) => ({ id })) },
    ...over,
  } as unknown as SelectableInstance;
}

const claude = instance("claude", "claudeAgent", CLAUDE_IDS);
const codex = instance("codex", "codex", ["gpt-6"]);

describe("resolvePluginAgentModel (I1)", () => {
  it("accepts the exact id claude-fable-5-1 the Claude engine offers", () => {
    expect(resolvePluginAgentModel("claude-fable-5-1", [codex, claude])).toEqual({ instanceId: "claude", model: "claude-fable-5-1" });
  });

  it("maps a Claude Code alias to the newest model of that family", () => {
    expect(resolvePluginAgentModel("sonnet", [claude])).toEqual({ instanceId: "claude", model: "claude-sonnet-5-5" });
    expect(resolvePluginAgentModel("opus", [claude])).toEqual({ instanceId: "claude", model: "claude-opus-5-5" });
    expect(resolvePluginAgentModel("Haiku", [claude])).toEqual({ instanceId: "claude", model: "claude-haiku-5-5" });
  });

  it("keeps the team's model for inherit, an empty value, an unknown id, a refused or disabled engine", () => {
    expect(resolvePluginAgentModel("inherit", [claude])).toBeNull();
    expect(resolvePluginAgentModel("", [claude])).toBeNull();
    expect(resolvePluginAgentModel("claude-fable-9", [claude])).toBeNull();
    expect(resolvePluginAgentModel("sonnet", [claude], () => "not allowed")).toBeNull();
    expect(resolvePluginAgentModel("sonnet", [instance("claude", "claudeAgent", CLAUDE_IDS, { enabled: false })])).toBeNull();
  });

  it("lists the agents whose model no engine offers", () => {
    const result = resolvePluginTeamModels([
      { key: "px-architect", name: "px-architect", model: "claude-fable-5-1" },
      { key: "flow-dev", name: "flow-dev", model: "sonnet" },
      { key: "free", name: "free", model: "inherit" },
      { key: "odd", name: "odd", model: "gpt-9" },
    ], [claude]);
    expect(result.models).toEqual({
      "px-architect": { instanceId: "claude", model: "claude-fable-5-1" },
      "flow-dev": { instanceId: "claude", model: "claude-sonnet-5-5" },
    });
    expect(result.unmatched).toEqual(["model gpt-9 of odd (no engine offers it; the team's model is used)"]);
  });
});
