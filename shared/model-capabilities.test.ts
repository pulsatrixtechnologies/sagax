import { describe, expect, it } from "vitest";

import {
  effectiveEffort, effortAcceptedByModel, effortForModel, fastBaseOf, fastTwinOf, modelDefaultEffort,
  modelEffortLevels, modelNativeEffortLevels, parseModelEffortFacts,
} from "./model-capabilities.ts";
import { STATIC_GROK_MODELS, GROK_EFFORT_LEVELS } from "../server/drivers/acp/grok.ts";
import { STATIC_CLAUDE_MODELS } from "../server/drivers/claude.ts";

const grok = (id: string) => STATIC_GROK_MODELS.options.find((option) => option.id === id);
const claude = (id: string) => STATIC_CLAUDE_MODELS.options.find((option) => option.id === id);
const CLAUDE_ENGINE = ["low", "medium", "high", "xhigh", "max"] as const;

describe("each model offers only the levels it takes", () => {
  it("Grok: 4.7 and 4.6 go to X-High, 4.5 stops at High", () => {
    expect(modelNativeEffortLevels(grok("grok-4.7"), GROK_EFFORT_LEVELS)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(modelNativeEffortLevels(grok("grok-4.6"), GROK_EFFORT_LEVELS)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(modelNativeEffortLevels(grok("grok-4.5"), GROK_EFFORT_LEVELS)).toEqual(["low", "medium", "high"]);
    expect(effortAcceptedByModel("xhigh", grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBe(false);
    expect(modelDefaultEffort(grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBe("high");
  });

  it("Claude: the 5.x models take low to max, Haiku 4.5 none at all", () => {
    for (const option of STATIC_CLAUDE_MODELS.options.filter((candidate) => candidate.id !== "claude-haiku-4-5")) {
      expect(modelNativeEffortLevels(option, CLAUDE_ENGINE)).toEqual([...CLAUDE_ENGINE]);
    }
    expect(modelEffortLevels(claude("claude-haiku-4-5"), CLAUDE_ENGINE)).toEqual([]);
  });

  it("never offers more than the engine's driver can pass", () => {
    expect(modelNativeEffortLevels({ effortLevels: ["low", "max"] }, ["low", "medium"])).toEqual(["low"]);
    expect(modelEffortLevels({ effortLevels: ["low"] }, undefined)).toEqual([]);
  });

  it("falls back to the engine's levels for a model nothing is known about", () => {
    expect(modelNativeEffortLevels({}, GROK_EFFORT_LEVELS)).toEqual([...GROK_EFFORT_LEVELS]);
    expect(modelNativeEffortLevels(undefined, GROK_EFFORT_LEVELS)).toEqual([...GROK_EFFORT_LEVELS]);
  });

  it("offers Ultracode only on Claude Code, never on Grok", () => {
    expect(modelEffortLevels(grok("grok-4.5"), GROK_EFFORT_LEVELS)).toEqual(["low", "medium", "high"]);
    expect(effortAcceptedByModel("ultracode", grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBe(false);
    const claudeLevels = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;
    expect(modelEffortLevels({}, claudeLevels)).toEqual(["low", "medium", "high", "xhigh", "max", "ultracode"]);
    expect(effortAcceptedByModel("ultracode", {}, claudeLevels)).toBe(true);
    expect(modelEffortLevels({ effortLevels: [] }, claudeLevels)).toEqual([]);
    expect(modelEffortLevels({ effortLevels: [] }, GROK_EFFORT_LEVELS)).toEqual([]);
  });
});

describe("switching model adjusts the effort", () => {
  it("keeps a level the new model takes", () => {
    expect(effortForModel("medium", grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBe("medium");
  });

  it("drops one it does not take, so the new model's default runs", () => {
    expect(effortForModel("xhigh", grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBeUndefined();
    expect(effectiveEffort("xhigh", grok("grok-4.5"), GROK_EFFORT_LEVELS)).toBe("high");
    expect(effortForModel("high", claude("claude-haiku-4-5"), CLAUDE_ENGINE)).toBeUndefined();
    expect(effectiveEffort(undefined, claude("claude-haiku-4-5"), CLAUDE_ENGINE)).toBeUndefined();
  });
});

describe("reading an engine's per-model levels", () => {
  it("takes Grok's records, the default marked, sorted ascending", () => {
    expect(parseModelEffortFacts([
      { id: "xhigh", value: "xhigh", default: false }, { id: "high", value: "high", default: true }, { id: "low", value: "low" },
    ], "xhigh")).toEqual({ effortLevels: ["low", "high", "xhigh"], defaultEffort: "high" });
  });

  it("takes Codex's records and its separate default", () => {
    expect(parseModelEffortFacts([{ reasoningEffort: "medium" }, { reasoningEffort: "low" }, { reasoningEffort: "minimal" }], "medium"))
      .toEqual({ effortLevels: ["low", "medium"], defaultEffort: "medium" });
  });

  it("says none when the engine says the model takes none, unknown when it says nothing", () => {
    expect(parseModelEffortFacts(undefined, undefined, false)).toEqual({ effortLevels: [] });
    expect(parseModelEffortFacts(undefined)).toEqual({});
    expect(parseModelEffortFacts(["low", "ultracode", "bogus"])).toEqual({ effortLevels: ["low"] });
  });
});

describe("fast twins", () => {
  const options = STATIC_GROK_MODELS.options;
  it("pairs grok-4.7 with grok-4.7-build-fast and nothing else", () => {
    expect(fastTwinOf(options, "grok-4.7")).toBe("grok-4.7-build-fast");
    expect(fastBaseOf(options, "grok-4.7-build-fast")).toBe("grok-4.7");
    expect(fastTwinOf(options, "grok-4.7-build-fast")).toBeUndefined();
    expect(fastTwinOf(options, "grok-4.5")).toBeUndefined();
    expect(fastBaseOf([{ id: "solo-fast" }], "solo-fast")).toBeUndefined();
  });
});
