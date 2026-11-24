// list_agent_models names each model's provider, account and reasoning levels
// (M-20261123-045, M-20261123-047): the facts a client's All models cascade reads.
import { describe, expect, it } from "vitest";

import { engineCascadeFacts, modelCascadeFacts } from "./agent-model-cascade.ts";

const claude = { instanceId: "claude-2", driverKind: "claudeAgent", displayName: "Claude Code", email: "ada@example.com" };

describe("engineCascadeFacts", () => {
  it("names the engine's provider and the account by its address, never by a tool's name", () => {
    expect(engineCascadeFacts(claude)).toEqual({ provider: { id: "anthropic", label: "Claude" }, account: "ada@example.com" });
  });

  it("an engine with neither a name of its own nor an address has no account words", () => {
    expect(engineCascadeFacts({ ...claude, email: undefined }).account).toBeUndefined();
  });
});

describe("modelCascadeFacts", () => {
  it("a model of the engine's own provider adds nothing but its reasoning levels", () => {
    expect(modelCascadeFacts(claude, { id: "claude-opus-5-5", effortLevels: ["high", "low", "bogus"], defaultEffort: "high" }, "anthropic")).toEqual({
      effort_levels: ["low", "high"], default_effort: "high",
    });
    expect(modelCascadeFacts(claude, { id: "claude-opus-5-5" }, "anthropic")).toEqual({});
  });

  it("a local model is the Local provider, under its server or the person who shares it", () => {
    expect(modelCascadeFacts(claude, { id: "studio::flash", local: true, server: "Studio" }, "anthropic")).toEqual({ provider: { id: "local", label: "Local" }, server: "Studio" });
    expect(modelCascadeFacts(claude, { id: "studio::flash", sharedBy: "Ada", server: "Studio" }, "anthropic").server).toBe("Ada");
  });

  it("a model with no reasoning control says so with an empty list", () => {
    expect(modelCascadeFacts(claude, { id: "claude-haiku-4-5", effortLevels: [] }, "anthropic")).toEqual({ effort_levels: [] });
  });
});
