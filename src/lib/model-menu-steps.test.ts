// #3116, #4329 (lot 3): the chat-bar model picker in two steps (provider,
// then model). Each step offers only what the step before allows.
import { describe, expect, it } from "vitest";

import { favoriteKey } from "./model-favorites";
import { CURRENT_KEY_PREFIX, FAVORITE_KEY_PREFIX, type ModelMenuRow, type ModelMenuSection } from "./model-menu";
import {
  currentProvider,
  modelMenuProviders,
  modelMenuStepView,
  runsWithEntries,
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
// Claude's sign-in, its key and pi, pooled: one row per model
const claude: ModelMenuSection = { key: "anthropic", label: "Claude", rows: [
  model("claude", "opus", "Opus 5.5", { current: true, harness: "claudeAgent", alternatives: [
    model("claudeApi", "opus", "Opus 5.5", { harness: "claudeAgent" }),
    model("pi", "anthropic/opus", "Opus 5.5", { harness: "piAgent" }),
  ] }),
  model("claude", "sonnet", "Sonnet 5", { harness: "claudeAgent" }),
  model("claudeApi", "haiku", "Haiku 5.5", { unavailable: "sign in", harness: "claudeAgent" }),
] };
const xai: ModelMenuSection = { key: "xai", label: "SpaceXAI", rows: [model("grok", "grok-4.7", "Grok 4.7", { harness: "grokAgent" })] };
const computer: ModelMenuSection = { key: "computer", label: "This computer", rows: [model("claude", "dwarfstar::qwen", "Qwen", { harness: "claudeAgent" })] };
const sections = [top, claude, xai, computer];

describe("modelMenuProviders", () => {
  it("lists the provider sections in menu order, the one holding the current model marked", () => {
    const providers = modelMenuProviders(sections);
    expect(providers.map((provider) => provider.key)).toEqual(["provider:anthropic", "provider:xai", "provider:computer"]);
    expect(providers.map((provider) => provider.current)).toEqual([true, false, false]);
    expect(currentProvider(sections)?.section.label).toBe("Claude");
  });

  it("leaves out the top rows, Favorites and an empty section", () => {
    const empty: ModelMenuSection = { key: "google", label: "Gemini", rows: [] };
    const favorites: ModelMenuSection = { key: "favorites", label: "Favorites", rows: [model("grok", "grok-4.7", "Grok 4.7")] };
    expect(modelMenuProviders([top, favorites, empty, xai]).map((provider) => provider.section.key)).toEqual(["xai"]);
  });
});

describe("modelMenuStepView", () => {
  it("step 1: the top rows, the current model, the favorites, then one entry per provider", () => {
    const view = modelMenuStepView(sections, {}, [favoriteKey("grok", "grok-4.7")]);
    expect(view.level).toBe("provider");
    expect(view.skipped).toBe(false);
    expect(view.current?.label).toBe("Opus 5.5");
    expect(view.favorites.map((row) => row.label)).toEqual(["Grok 4.7"]);
    expect(view.entries.map((entry) => entry.key)).toEqual([
      "auto", `${CURRENT_KEY_PREFIX}${favoriteKey("claude", "opus")}`, `${FAVORITE_KEY_PREFIX}${favoriteKey("grok", "grok-4.7")}`,
      "provider:anthropic", "provider:xai", "provider:computer",
    ]);
    // no model of a provider shows before its step
    expect(view.rows).toEqual([]);
  });

  it("step 2: the provider's models, one row per model; an unavailable one is drawn but not reachable", () => {
    const view = modelMenuStepView(sections, { provider: "anthropic" }, []);
    expect(view.level).toBe("model");
    expect(view.provider?.section.key).toBe("anthropic");
    expect(view.rows.map((row) => row.label)).toEqual(["Opus 5.5", "Sonnet 5", "Haiku 5.5"]);
    expect(view.entries.map((entry) => entry.row?.label)).toEqual(["Opus 5.5", "Sonnet 5"]);
  });

  it("a lone provider opens on its models with the top rows kept, and marks the step skipped", () => {
    const view = modelMenuStepView([top, xai], {}, []);
    expect(view.level).toBe("model");
    expect(view.skipped).toBe(true);
    expect(view.entries.map((entry) => entry.key)).toEqual(["auto", favoriteKey("grok", "grok-4.7")]);
  });

  it("a path that names nothing known falls back to the providers", () => {
    expect(modelMenuStepView(sections, { provider: "nope" }, []).level).toBe("provider");
  });
});

describe("the path", () => {
  const at = (path: Parameters<typeof modelMenuStepView>[1]) => modelMenuStepView(sections, path, []);

  it("goes into a provider; a model entry leaves it alone", () => {
    const provider = at({}).entries.find((entry) => entry.provider?.section.key === "xai")!;
    expect(stepPathInto({}, provider)).toEqual({ provider: "xai" });
    const row = at({ provider: "xai" }).entries[0]!;
    expect(stepPathInto({ provider: "xai" }, row)).toEqual({ provider: "xai" });
  });

  it("goes back to the providers, to nothing before the first step", () => {
    expect(stepPathBack(at({ provider: "anthropic" }))).toEqual({});
    expect(stepPathBack(at({}))).toBeNull();
    expect(stepPathBack(modelMenuStepView([top, xai], {}, []))).toBeNull();
  });

  it("finds the current model's step", () => {
    expect(stepPathOfCurrent(sections)).toEqual({ provider: "anthropic" });
    expect(stepPathOfCurrent([top])).toEqual({});
  });

  it("reads the crumbs of a step: the provider, when there was a choice", () => {
    expect(stepCrumbs(at({}))).toEqual([]);
    expect(stepCrumbs(at({ provider: "anthropic" }))).toEqual(["Claude"]);
    expect(stepCrumbs(modelMenuStepView([top, xai], {}, []))).toEqual([]);
  });
});

describe("runsWithEntries (#4329)", () => {
  it("offers one entry per engine that can run the model in use, the vendor's own tool first", () => {
    const entries = runsWithEntries(sections);
    // the two Claude accounts are one engine: they stay pooled
    expect(entries.map((entry) => [entry.harness, entry.role, entry.current])).toEqual([
      ["claudeAgent", "own", true],
      ["piAgent", "pi", false],
    ]);
    expect(entries[1]!.row).toMatchObject({ instanceId: "pi", modelId: "anthropic/opus" });
  });

  it("has a single entry when one engine runs the model, and none without a current model", () => {
    const onGrok = [top, claude, { ...xai, rows: [{ ...xai.rows[0]!, current: true }] }].map((section) =>
      section.key === "anthropic" ? { ...section, rows: section.rows.map((row) => ({ ...row, current: false })) } : section);
    expect(runsWithEntries(onGrok).map((entry) => entry.harness)).toEqual(["grokAgent"]);
    expect(runsWithEntries([top, { ...xai }])).toEqual([]);
  });
});
