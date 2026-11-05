import { describe, expect, it } from "vitest";

import { cleanDisabledModels, cleanFavoriteModels, MAX_FAVORITE_MODELS, modelKey, modelOffer, offeredModels, parseModelKey } from "./offered-models.ts";

const engine = (instanceId: string, ids: string[], def = ids[0] ?? "") => ({ instanceId, models: { default: def, options: ids.map((id) => ({ id })) } });
const solo = { organization: false, allowedEngines: null };

describe("model switches", () => {
  it("names a model <engine>/<model>, a slash in the model kept", () => {
    expect(modelKey("openrouter", "vendor/model")).toBe("openrouter/vendor/model");
    expect(parseModelKey("openrouter/vendor/model")).toEqual({ instanceId: "openrouter", model: "vendor/model" });
    expect(parseModelKey("nothing")).toBeNull();
    expect(cleanDisabledModels(["a/b", "a/b", "bad", 3, " c/d "])).toEqual(["a/b", "c/d"]);
  });

  // #2050: favorites keep their star order and the last stars win
  it("cleans a favorites list in order, capped to the newest stars", () => {
    expect(cleanFavoriteModels(["c/d", "a/b", "c/d", "bad", 3, " e/f "])).toEqual(["c/d", "a/b", "e/f"]);
    expect(cleanFavoriteModels("c/d")).toEqual([]);
    const many = Array.from({ length: MAX_FAVORITE_MODELS + 5 }, (_, i) => `e/m${i}`);
    const kept = cleanFavoriteModels(many);
    expect(kept).toHaveLength(MAX_FAVORITE_MODELS);
    expect(kept[0]).toBe("e/m5");
    expect(kept.at(-1)).toBe(`e/m${MAX_FAVORITE_MODELS + 4}`);
  });

  it("says who turned a model off: the organization first, then the person", () => {
    const switches = { org: ["claude/opus"], mine: ["claude/opus", "claude/haiku"] };
    expect(modelOffer(switches, "claude", "opus")).toBe("adminOff");
    expect(modelOffer(switches, "claude", "haiku")).toBe("personOff");
    expect(modelOffer(switches, "claude", "sonnet")).toBe("on");
    expect(modelOffer(null, "claude", "sonnet")).toBe("on");
  });

  it("drops the models off from every list, moves the default, and drops an engine with none left", () => {
    const instances = [engine("claude", ["opus", "sonnet"], "opus"), engine("grok", ["fast"]), engine("pending", [])];
    const out = offeredModels(instances, solo, { org: ["claude/opus"], mine: ["grok/fast"] });
    expect(out.map((row) => row.instanceId)).toEqual(["claude", "pending"]);
    expect(out[0]?.models).toEqual({ default: "sonnet", options: [{ id: "sonnet" }] });
    // Settings keeps every model, to switch them
    expect(offeredModels(instances, solo, { org: ["claude/opus"] }, "settings")).toHaveLength(3);
    // nothing off: the same rows
    expect(offeredModels(instances, solo, null)).toEqual(instances);
  });

  it("applies the organization's engine list first", () => {
    const instances = [engine("claude", ["opus"]), engine("grok", ["fast"])];
    expect(offeredModels(instances, { organization: true, allowedEngines: ["grok"] }, null).map((row) => row.instanceId)).toEqual(["grok"]);
  });
});
