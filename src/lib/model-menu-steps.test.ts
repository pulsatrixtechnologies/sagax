// #3116: the chat-bar model picker in three steps (harness, provider,
// model). Each step offers only what the step before allows.
import { describe, expect, it } from "vitest";

import { favoriteKey } from "./model-favorites";
import { CURRENT_KEY_PREFIX, FAVORITE_KEY_PREFIX, type ModelMenuRow, type ModelMenuSection } from "./model-menu";
import {
  modelMenuHarnesses,
  modelMenuStepView,
  stepCrumbs,
  stepPathBack,
  stepPathInto,
  stepPathOfCurrent,
} from "./model-menu-steps";

const model = (instanceId: string, id: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({
  key: favoriteKey(instanceId, id), kind: "model", instanceId, modelId: id, label, current: false, ...extra,
});
const top: ModelMenuSection = { key: "top", rows: [
  { key: "auto", kind: "auto", label: "Auto", detail: "the best model per task", current: false },
] };
const claudeSub: ModelMenuSection = { key: "claude", label: "Claude", harness: "claudeAgent", harnessLabel: "Claude Code", rows: [
  model("claude", "opus", "Opus 5.5", { current: true }), model("claude", "sonnet", "Sonnet 5"),
] };
const claudeApi: ModelMenuSection = { key: "claudeApi", label: "Anthropic (API key)", harness: "claudeAgent", harnessLabel: "Claude Code", rows: [
  model("claudeApi", "opus", "Opus 5.5"), model("claudeApi", "haiku", "Haiku 5.5", { unavailable: "sign in" }),
] };
const grok: ModelMenuSection = { key: "grok", label: "Grok", harness: "grokAgent", harnessLabel: "Grok", rows: [
  model("grok", "grok-4.7", "Grok 4.7"),
] };
const local: ModelMenuSection = { key: "local:this-computer", label: "Local", harness: "local", harnessLabel: "Local", rows: [
  model("claude", "dwarfstar::qwen", "Qwen"),
] };
const sections = [top, claudeSub, claudeApi, grok, local];

describe("modelMenuHarnesses", () => {
  it("groups the provider sections by harness, in menu order, and counts their models", () => {
    const harnesses = modelMenuHarnesses(sections);
    expect(harnesses.map((harness) => harness.harness)).toEqual(["claudeAgent", "grokAgent", "local"]);
    expect(harnesses[0]).toMatchObject({ key: "harness:claudeAgent", label: "Claude Code", current: true, models: 4 });
    expect(harnesses[0]!.sections.map((section) => section.key)).toEqual(["claude", "claudeApi"]);
    expect(harnesses[1]).toMatchObject({ current: false, models: 1 });
  });

  it("takes a section without a harness as a harness of its own (older callers)", () => {
    const plain: ModelMenuSection = { key: "codex", label: "OpenAI", rows: [model("codex", "gpt", "GPT")] };
    expect(modelMenuHarnesses([top, plain])).toMatchObject([{ key: "harness:codex", harness: "codex", label: "OpenAI" }]);
  });

  it("leaves out the top rows, Favorites and an empty section", () => {
    const empty: ModelMenuSection = { key: "pi", label: "pi", rows: [] };
    const favorites: ModelMenuSection = { key: "favorites", label: "Favorites", rows: [model("grok", "grok-4.7", "Grok 4.7")] };
    expect(modelMenuHarnesses([top, favorites, empty, grok]).map((harness) => harness.harness)).toEqual(["grokAgent"]);
  });
});

describe("modelMenuStepView", () => {
  it("step 1: the top rows, the current model, the favorites, then one entry per harness", () => {
    const view = modelMenuStepView(sections, {}, [favoriteKey("grok", "grok-4.7")]);
    expect(view.level).toBe("harness");
    expect(view.skipped).toBe(false);
    expect(view.current?.label).toBe("Opus 5.5");
    expect(view.favorites.map((row) => row.label)).toEqual(["Grok 4.7"]);
    expect(view.entries.map((entry) => entry.key)).toEqual([
      "auto", `${CURRENT_KEY_PREFIX}${favoriteKey("claude", "opus")}`, `${FAVORITE_KEY_PREFIX}${favoriteKey("grok", "grok-4.7")}`,
      "harness:claudeAgent", "harness:grokAgent", "harness:local",
    ]);
    // no model of a harness shows before its step
    expect(view.rows).toEqual([]);
    expect(view.providers).toEqual([]);
  });

  it("step 2: the providers of the chosen harness, nothing of the others", () => {
    const view = modelMenuStepView(sections, { harness: "claudeAgent" }, []);
    expect(view.level).toBe("provider");
    expect(view.harness?.harness).toBe("claudeAgent");
    expect(view.providers.map((provider) => provider.section.key)).toEqual(["claude", "claudeApi"]);
    expect(view.entries.map((entry) => entry.key)).toEqual(["provider:claude", "provider:claudeApi"]);
    expect(view.providers[0]!.current).toBe(true);
  });

  it("step 3: the provider's models; an unavailable one is drawn but not reachable", () => {
    const view = modelMenuStepView(sections, { harness: "claudeAgent", provider: "claudeApi" }, []);
    expect(view.level).toBe("model");
    expect(view.provider?.section.key).toBe("claudeApi");
    expect(view.rows.map((row) => row.label)).toEqual(["Opus 5.5", "Haiku 5.5"]);
    expect(view.entries.map((entry) => entry.row?.label)).toEqual(["Opus 5.5"]);
  });

  it("a harness with one provider skips step 2", () => {
    const view = modelMenuStepView(sections, { harness: "grokAgent" }, []);
    expect(view.level).toBe("model");
    expect(view.provider?.section.key).toBe("grok");
    expect(view.entries.map((entry) => entry.key)).toEqual([favoriteKey("grok", "grok-4.7")]);
  });

  it("a lone harness opens on its content with the top rows kept, and marks the step skipped", () => {
    const view = modelMenuStepView([top, grok], {}, []);
    expect(view.level).toBe("model");
    expect(view.skipped).toBe(true);
    expect(view.entries.map((entry) => entry.key)).toEqual(["auto", favoriteKey("grok", "grok-4.7")]);
  });

  it("a path that names nothing known falls back to the harnesses", () => {
    expect(modelMenuStepView(sections, { harness: "nope" }, []).level).toBe("harness");
    expect(modelMenuStepView(sections, { harness: "claudeAgent", provider: "nope" }, []).level).toBe("provider");
  });
});

describe("the path", () => {
  const at = (path: Parameters<typeof modelMenuStepView>[1]) => modelMenuStepView(sections, path, []);

  it("goes into a harness, then a provider; a model entry leaves it alone", () => {
    const harness = at({}).entries.find((entry) => entry.harness?.harness === "claudeAgent")!;
    expect(stepPathInto({}, harness)).toEqual({ harness: "claudeAgent" });
    const provider = at({ harness: "claudeAgent" }).entries[1]!;
    expect(stepPathInto({ harness: "claudeAgent" }, provider)).toEqual({ harness: "claudeAgent", provider: "claudeApi" });
    const row = at({ harness: "claudeAgent", provider: "claudeApi" }).entries[0]!;
    expect(stepPathInto({ harness: "claudeAgent", provider: "claudeApi" }, row)).toEqual({ harness: "claudeAgent", provider: "claudeApi" });
  });

  it("goes back one step at a time, to nothing before the first step", () => {
    const models = { harness: "claudeAgent", provider: "claudeApi" };
    expect(stepPathBack(at(models), models)).toEqual({ harness: "claudeAgent" });
    expect(stepPathBack(at({ harness: "claudeAgent" }), { harness: "claudeAgent" })).toEqual({});
    // a skipped provider step goes back to the harnesses
    expect(stepPathBack(at({ harness: "grokAgent" }), { harness: "grokAgent" })).toEqual({});
    expect(stepPathBack(at({}), {})).toBeNull();
    const lone = modelMenuStepView([top, grok], {}, []);
    expect(stepPathBack(lone, {})).toBeNull();
  });

  it("finds the current model's step", () => {
    expect(stepPathOfCurrent(sections)).toEqual({ harness: "claudeAgent", provider: "claude" });
    expect(stepPathOfCurrent([top, grok, { ...local, rows: [model("claude", "dwarfstar::qwen", "Qwen", { current: true })] }])).toEqual({ harness: "local" });
    expect(stepPathOfCurrent([top])).toEqual({});
  });

  it("reads the crumbs of a step", () => {
    expect(stepCrumbs(at({}))).toEqual([]);
    expect(stepCrumbs(at({ harness: "claudeAgent" }))).toEqual(["Claude Code"]);
    expect(stepCrumbs(at({ harness: "claudeAgent", provider: "claudeApi" }))).toEqual(["Claude Code", "Anthropic (API key)"]);
    // a lone provider is the harness itself
    expect(stepCrumbs(at({ harness: "grokAgent" }))).toEqual(["Grok"]);
    expect(stepCrumbs(modelMenuStepView([top, grok], {}, []))).toEqual([]);
  });
});
