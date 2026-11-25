// The person's own modes (owner 2026-11-25, M-20261125-074, M-20261125-075,
// #5372): in Settings > Modes a person chooses the model (and the reasoning)
// Fast and Expert use, and Heavy's experts. Per person. While a person sets
// nothing every mode runs exactly what it ran before (D-20261119-031).
import { describe, expect, it } from "vitest";

import { cleanModeModels } from "../../shared/mode-models.ts";
import { bareModelId, type AutoEngine, type AutoRequest, type CatalogFacts, type CatalogLookup } from "./model-auto.ts";
import { pickModeModel, resolveModes } from "./model-mode.ts";

const FACTS: Record<string, CatalogFacts> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 4, costOutput: 20, releaseDate: "2026-09-22" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 2, costOutput: 10, releaseDate: "2026-09-28" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", reasoning: true, vision: true, context: 200_000, costInput: 1, costOutput: 5, releaseDate: "2025-10-16" },
  "gpt-6-astra": { name: "GPT-6 Astra", reasoning: true, vision: true, context: 1_050_000, costInput: 10, costOutput: 50, releaseDate: "2026-09-04" },
  "gpt-5.6-luna": { name: "GPT-5.6 Luna", reasoning: true, vision: true, context: 1_050_000, costInput: 0.2, costOutput: 1.2, releaseDate: "2026-07-09" },
};
const catalog: CatalogLookup = (_driver, id) => FACTS[bareModelId(id)];
const claude: AutoEngine = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude Code", via: "subscription", effortLevels: ["low", "medium", "high", "xhigh"],
  models: { default: "claude-sonnet-5-5", options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }] },
};
const codex: AutoEngine = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", via: "speaker-key", effortLevels: ["low", "medium", "high"],
  models: { default: "gpt-6-astra", options: [{ id: "gpt-6-astra", label: "GPT-6 Astra" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }] },
};
const request = (over: Partial<AutoRequest> = {}): AutoRequest => ({ base: { instanceId: "claude", model: "claude-sonnet-5-5", auto: true }, engines: [claude, codex], catalog, ...over });

describe("a person's own modes", () => {
  it("D-20261119-031: with nothing set, and with an empty setting, every mode runs what it ran before", () => {
    const before = resolveModes(request());
    expect(resolveModes(request({ modeModels: {} }))).toEqual(before);
    expect(resolveModes(request({ modeModels: cleanModeModels(null) }))).toEqual(before);
    for (const mode of ["fast", "expert", "heavy"] as const) expect(pickModeModel(request({ modeModels: {} }), mode)).toEqual(pickModeModel(request(), mode));
  });

  it("Fast and Expert run the model the person chose, at the reasoning they chose", () => {
    const modeModels = { fast: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" as const }, expert: { instanceId: "claude", model: "claude-sonnet-5-5", effort: "xhigh" as const } };
    const fast = pickModeModel(request({ modeModels }), "fast")!;
    expect(fast.selection).toEqual({ instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" });
    expect(fast.modelLabel).toBe("Claude Haiku 4.5");
    expect(fast.reason).toBe("mode");
    const expert = pickModeModel(request({ modeModels }), "expert")!;
    expect(expert.selection).toEqual({ instanceId: "claude", model: "claude-sonnet-5-5", effort: "xhigh" });
    // the menu's tooltip names it
    expect(resolveModes(request({ modeModels })).expert).toMatchObject({ pick: { instanceId: "claude", model: "claude-sonnet-5-5" }, effort: "xhigh" });
  });

  it("a chosen model with no reasoning chosen keeps the mode's own level", () => {
    const fast = pickModeModel(request({ modeModels: { fast: { instanceId: "codex", model: "gpt-6-astra" } } }), "fast")!;
    expect(fast.selection).toEqual({ instanceId: "codex", model: "gpt-6-astra", effort: "low" });
  });

  it("a refusal still climbs: what the mode would have run by itself follows the person's model in the chain", () => {
    const usual = pickModeModel(request(), "expert")!;
    const chosen = pickModeModel(request({ modeModels: { expert: { instanceId: "claude", model: "claude-haiku-4-5" } } }), "expert")!;
    expect(chosen.chain[0]).toEqual({ instanceId: "claude", model: "claude-haiku-4-5" });
    expect(chosen.chain).toContainEqual(usual.chain[0]);
  });

  it("a chosen model that cannot run now (its engine gone, turned off, refused) leaves the mode on what it runs by itself", () => {
    const usual = pickModeModel(request(), "expert")!;
    expect(pickModeModel(request({ modeModels: { expert: { instanceId: "gone", model: "x" } } }), "expert")).toEqual(usual);
    expect(pickModeModel(request({ modeModels: { expert: { instanceId: "claude", model: "claude-retired" } } }), "expert")).toEqual(usual);
    const refused = request({ skip: [{ instanceId: "claude", model: "claude-haiku-4-5" }] });
    expect(pickModeModel({ ...refused, modeModels: { expert: { instanceId: "claude", model: "claude-haiku-4-5" } } }, "expert")).toEqual(pickModeModel(refused, "expert"));
  });

  it("Heavy seats the experts the person chose, in their order; those that cannot run are left out, and with none left the usual team sits", () => {
    const usual = pickModeModel(request(), "heavy")!;
    const heavy = pickModeModel(request({ modeModels: { heavy: [{ instanceId: "codex", model: "gpt-5.6-luna" }, { instanceId: "gone", model: "x" }, { instanceId: "claude", model: "claude-haiku-4-5" }] } }), "heavy")!;
    expect(heavy.team).toEqual([
      { instanceId: "codex", model: "gpt-5.6-luna", engineLabel: "Codex", modelLabel: "GPT-5.6 Luna" },
      { instanceId: "claude", model: "claude-haiku-4-5", engineLabel: "Claude Code", modelLabel: "Claude Haiku 4.5" },
    ]);
    // the leader is unchanged
    expect(heavy.selection).toEqual(usual.selection);
    expect(pickModeModel(request({ modeModels: { heavy: [{ instanceId: "gone", model: "x" }] } }), "heavy")).toEqual(usual);
  });
});

describe("the stored setting", () => {
  it("keeps only well formed choices: a model per mode, a known level, at most five experts, no duplicate", () => {
    expect(cleanModeModels({
      fast: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium", extra: 1 },
      expert: { instanceId: "", model: "x" },
      heavy: [{ instanceId: "a", model: "1" }, { instanceId: "a", model: "1" }, "junk", { instanceId: "b", model: "2" }, { instanceId: "c", model: "3" }, { instanceId: "d", model: "4" }, { instanceId: "e", model: "5" }, { instanceId: "f", model: "6" }],
      build: { instanceId: "a", model: "1" },
    })).toEqual({
      fast: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" },
      heavy: [{ instanceId: "a", model: "1" }, { instanceId: "b", model: "2" }, { instanceId: "c", model: "3" }, { instanceId: "d", model: "4" }, { instanceId: "e", model: "5" }],
    });
    expect(cleanModeModels({ fast: { instanceId: "claude", model: "m", effort: "ludicrous" } })).toEqual({ fast: { instanceId: "claude", model: "m" } });
    expect(cleanModeModels("x")).toEqual({});
  });
});
