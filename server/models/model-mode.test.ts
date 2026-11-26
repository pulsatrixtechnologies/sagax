// Composer modes (#4900): what Fast, Expert and Heavy run for a person
// with one provider, several providers, and only local models.
import { describe, expect, it } from "vitest";

import { FORCED_MODEL_MODES, HEAVY_MAX_AGENTS, isForcedModelMode } from "../../shared/model-mode.ts";
import { bareModelId, modelForTier, type AutoEngine, type AutoRequest, type CatalogFacts, type CatalogLookup } from "./model-auto.ts";
import { MODE_TIER, bestPerProvider, heavySeats, localSize, pickModeModel, rankForMode, resolveModes } from "./model-mode.ts";

const FACTS: Record<string, CatalogFacts> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 4, costOutput: 20, releaseDate: "2026-09-22" },
  "claude-fable-5-1": { name: "Claude Fable 5.1", reasoning: true, vision: true, context: 1_000_000, costInput: 10, costOutput: 50, releaseDate: "2026-09-01" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 2, costOutput: 10, releaseDate: "2026-09-28" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", reasoning: true, vision: true, context: 200_000, costInput: 1, costOutput: 5, releaseDate: "2025-10-16" },
  "gpt-6-astra": { name: "GPT-6 Astra", reasoning: true, vision: true, context: 1_050_000, costInput: 10, costOutput: 50, releaseDate: "2026-09-04" },
  "gpt-5.6-luna": { name: "GPT-5.6 Luna", reasoning: true, vision: true, context: 1_050_000, costInput: 0.2, costOutput: 1.2, releaseDate: "2026-07-09" },
  "gpt-5.5-codex": { name: "GPT-5.5 Codex", reasoning: true, vision: false, context: 400_000, costInput: 1.25, costOutput: 10, releaseDate: "2026-05-01" },
  "grok-4.7": { name: "Grok 4.7", reasoning: true, vision: true, context: 500_000, costInput: 2, costOutput: 6, releaseDate: "2026-09-21" },
  "grok-4-fast": { name: "Grok 4 Fast", reasoning: true, vision: true, context: 2_000_000, costInput: 0.2, costOutput: 0.5, releaseDate: "2025-09-23" },
  "gemini-3-pro": { name: "Gemini 3 Pro", reasoning: true, vision: true, context: 1_000_000, costInput: 2, costOutput: 12, releaseDate: "2026-06-01" },
  "gemini-3-flash": { name: "Gemini 3 Flash", reasoning: true, vision: true, context: 1_000_000, costInput: 0.3, costOutput: 2.5, releaseDate: "2026-06-01" },
  k3: { name: "Kimi K3", reasoning: true, vision: true, context: 256_000, costInput: 1, costOutput: 3, releaseDate: "2026-08-01" },
  "k3-256k": { name: "Kimi K3 256K", reasoning: true, vision: true, context: 256_000, costInput: 1, costOutput: 3, releaseDate: "2026-08-02" },
  "kimi-for-coding": { name: "Kimi for Coding", reasoning: true, vision: false, context: 256_000, costInput: 0.5, costOutput: 2, releaseDate: "2026-08-03" },
  "kimi-for-coding-highspeed": { name: "Kimi for Coding Highspeed", reasoning: true, vision: false, context: 256_000, costInput: 0.5, costOutput: 2, releaseDate: "2026-08-03" },
};
const catalog: CatalogLookup = (_driver, id) => FACTS[bareModelId(id)];

const claude = (over: Partial<AutoEngine> = {}): AutoEngine => ({
  instanceId: "claude",
  driverKind: "claudeAgent",
  displayName: "Claude Code",
  via: "subscription",
  effortLevels: ["low", "medium", "high", "xhigh"],
  models: {
    default: "claude-sonnet-5-5",
    options: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  ...over,
});
/** Claude without Fable: Opus is its strongest model. */
const claudeOpus = () => claude({ models: { default: "claude-sonnet-5-5", options: claude().models.options.filter((option) => option.id !== "claude-fable-5-1") } });
const codex: AutoEngine = {
  instanceId: "codex",
  driverKind: "codex",
  displayName: "Codex",
  via: "speaker-key",
  effortLevels: ["low", "medium", "high"],
  models: {
    default: "gpt-6-astra",
    options: [{ id: "gpt-6-astra", label: "GPT-6 Astra" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }, { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" }],
  },
};
const grok: AutoEngine = {
  instanceId: "grok-build",
  driverKind: "grokAgent",
  displayName: "Grok Build",
  via: "org-key",
  effortLevels: ["low", "medium", "high"],
  models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4-fast", label: "Grok 4 Fast" }] },
};
const gemini: AutoEngine = {
  instanceId: "gemini",
  driverKind: "geminiAgent",
  displayName: "Gemini",
  models: { default: "gemini-3-pro", options: [{ id: "gemini-3-pro", label: "Gemini 3 Pro" }, { id: "gemini-3-flash", label: "Gemini 3 Flash" }] },
};
const kimi: AutoEngine = {
  instanceId: "kimi",
  driverKind: "kimiAgent",
  displayName: "Kimi",
  models: {
    default: "k3",
    options: [
      { id: "k3", label: "Kimi K3" }, { id: "k3-256k", label: "Kimi K3 256K" },
      { id: "kimi-for-coding", label: "Kimi for Coding" }, { id: "kimi-for-coding-highspeed", label: "Kimi for Coding Highspeed" },
    ],
  },
};
/** The person's own model server: rows the catalogue never lists. */
const server = (over: Partial<AutoEngine> = {}): AutoEngine => ({
  instanceId: "px-own-incoai",
  driverKind: "openai-compat",
  displayName: "Local server",
  models: { default: "", options: [] },
  unranked: [
    { id: "incoai--Qwen3.5-122B-A10B", label: "Qwen3.5 122B A10B", contextWindow: 262_144 },
    { id: "incoai--Qwen3.6-27B", label: "Qwen3.6 27B", contextWindow: 131_072 },
    { id: "incoai--Qwen3-Coder-30B-A3B", label: "Qwen3 Coder 30B A3B", contextWindow: 131_072 },
    { id: "incoai--Qwen3-1.7B", label: "Qwen3 1.7B", contextWindow: 32_768 },
  ],
  ...over,
});

const request = (engines: AutoEngine[], base: AutoRequest["base"] = { instanceId: engines[0]!.instanceId, model: engines[0]!.models.default, auto: true }): AutoRequest =>
  ({ base, engines, catalog });
const models = (list: ReadonlyArray<{ model: string }> | undefined) => (list ?? []).map((entry) => entry.model);

describe("modes with one provider", () => {
  const one = request([claude()]);

  it("Fast is the provider's quick model at low effort", () => {
    const pick = pickModeModel(one, "fast")!;
    expect(pick.selection).toEqual({ instanceId: "claude", model: "claude-haiku-4-5", effort: "low" });
    expect(pick).toMatchObject({ reason: "mode", mode: "fast", tier: "fast", modelLabel: "Claude Haiku 4.5" });
  });

  it("Expert is the strongest model at high effort", () => {
    expect(pickModeModel(one, "expert")!.selection).toEqual({ instanceId: "claude", model: "claude-fable-5-1", effort: "high" });
  });


  it("Heavy's leader is the strongest model; one account seats its two strongest models (#5089)", () => {
    const pick = pickModeModel(one, "heavy")!;
    expect(pick.selection.model).toBe("claude-fable-5-1");
    expect(models(pick.team)[0]).toBe("claude-fable-5-1");
    expect(new Set(models(pick.team)).size).toBe(pick.team!.length);
    expect(pick.team!.length).toBe(2);
  });

  it("two accounts of one provider each get a seat before a second model does (#5089)", () => {
    const second = claude({ instanceId: "claude-work", displayName: "Claude Code (work)" });
    const pick = pickModeModel(request([claude(), second]), "heavy")!;
    expect(pick.team!.slice(0, 2).map((seat) => seat.instanceId).toSorted()).toEqual(["claude", "claude-work"]);
    // then the second models, on each account
    expect(pick.team!.length).toBe(4);
    expect(new Set(pick.team!.slice(2).map((seat) => seat.model)).has("claude-fable-5-1")).toBe(false);
  });

  it("takes the effort the engine offers, and none when it offers none", () => {
    const noHigh = claude({ effortLevels: ["low", "medium"] });
    expect(pickModeModel(request([noHigh]), "expert")!.selection.effort).toBe("medium");
    const none = claude({ effortLevels: undefined });
    expect(pickModeModel(request([none]), "expert")!.selection.effort).toBeUndefined();
  });

  it("Fast leads with the bot's own fast model when it has one", () => {
    const withFast = claude({ fast: { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" } });
    const pick = pickModeModel(request([withFast], { instanceId: "claude", model: "claude-fable-5-1", auto: true, fast: { instanceId: "claude", model: "claude-sonnet-5-5" } }), "fast")!;
    expect(pick.selection).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    expect(pick.reason).toBe("mode");
  });

  it("skips a model a recent refusal took out", () => {
    const pick = pickModeModel({ ...one, skip: [{ instanceId: "claude", model: "claude-fable-5-1" }] }, "expert")!;
    expect(pick.selection.model).toBe("claude-opus-5-5");
  });
});

describe("modes with several providers", () => {
  const all = request([claudeOpus(), codex, grok, gemini, kimi]);

  it("Expert ranks the best model of each provider and takes the top one", () => {
    const ranked = rankForMode(all, "expert");
    expect(ranked.map((contender) => contender.id)).toEqual(["gpt-6-astra", "claude-opus-5-5", "gemini-3-pro", "grok-4.7", "k3"]);
    expect(pickModeModel(all, "expert")!.selection).toEqual({ instanceId: "codex", model: "gpt-6-astra", effort: "high" });
  });

  it("does not depend on which engine the bot runs on", () => {
    const onGrok = request([claudeOpus(), codex, grok], { instanceId: "grok-build", model: "grok-4.7", auto: true });
    expect(pickModeModel(onGrok, "expert")!.selection.model).toBe("gpt-6-astra");
  });

  it("Fast is the quickest good model across providers", () => {
    expect(pickModeModel(all, "fast")!.selection).toMatchObject({ instanceId: "grok-build", model: "grok-4-fast", effort: "low" });
  });


  it("Heavy's seats are each account's strongest model first, the strongest leading", () => {
    const pick = pickModeModel(all, "heavy")!;
    expect(models(pick.team)).toEqual(["gpt-6-astra", "claude-opus-5-5", "gemini-3-pro", "grok-4.7", "k3"]);
    expect(pick.selection.model).toBe("gpt-6-astra");
  });

  it("Heavy keeps at most HEAVY_MAX_AGENTS providers", () => {
    const many = [claudeOpus(), codex, grok, gemini, kimi, server()];
    expect(pickModeModel(request(many), "heavy")!.team).toHaveLength(HEAVY_MAX_AGENTS);
  });

  it("two accounts seat their strongest models first, then their second ones, never padded", () => {
    const seats = heavySeats(request([claudeOpus(), grok]));
    expect(models(seats).slice(0, 2)).toEqual(["claude-opus-5-5", "grok-4.7"]);
    expect(new Set(seats.map((seat) => `${seat.instanceId}/${seat.model}`)).size).toBe(seats.length);
  });

  it("an engine that serves several vendors counts once per vendor", () => {
    const pi: AutoEngine = {
      instanceId: "pi", driverKind: "piAgent", displayName: "pi", models: {
        default: "anthropic/claude-opus-5-5",
        options: [{ id: "anthropic/claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "xai/grok-4.7", label: "Grok 4.7" }],
      },
    };
    expect(bestPerProvider(request([pi]), "top").map((contender) => contender.id).toSorted()).toEqual(["anthropic/claude-opus-5-5", "xai/grok-4.7"]);
  });

  it("a mode picked for another engine's turn leaves the chain a refusal climbs", () => {
    const pick = pickModeModel(all, "expert")!;
    expect(pick.chain.map((entry) => entry.model).slice(0, 3)).toEqual(["gpt-6-astra", "claude-opus-5-5", "gemini-3-pro"]);
    expect(pick.fromEngineLabel).toBe("Claude Code");
  });
});

describe("modes with only local models", () => {
  const onlyLocal = request([server()], { instanceId: "px-own-incoai", model: "incoai--Qwen3.6-27B", auto: true });

  it("reads a row's size from its name", () => {
    expect(localSize({ id: "incoai--Qwen3.5-122B-A10B", label: "Qwen3.5 122B A10B" })).toMatchObject({ total: 122, active: 10 });
    expect(localSize({ id: "incoai--Qwen3.6-27B", label: "Qwen3.6 27B", contextWindow: 9 })).toEqual({ total: 27, context: 9 });
    expect(localSize({ id: "mystery", label: "Mystery" })).toEqual({ context: 0 });
  });

  it("Expert is the largest model", () => {
    expect(pickModeModel(onlyLocal, "expert")!.selection.model).toBe("incoai--Qwen3.5-122B-A10B");
  });

  it("Fast is the lightest model that is still good, never a tiny one", () => {
    expect(pickModeModel(onlyLocal, "fast")!.selection.model).toBe("incoai--Qwen3-Coder-30B-A3B");
  });


  it("Heavy with only local models seats the strongest one (the experts share it)", () => {
    const pick = pickModeModel(onlyLocal, "heavy")!;
    expect(models(pick.team)).toEqual(["incoai--Qwen3.5-122B-A10B"]);
  });

  it("a local model never outranks a model the catalogue knows", () => {
    const mixed = request([claudeOpus(), server()]);
    expect(pickModeModel(mixed, "expert")!.selection.model).toBe("claude-opus-5-5");
    // ranked models seat first; a local one only when nothing ranked is usable
    expect(models(pickModeModel(mixed, "heavy")!.team)[0]).toBe("claude-opus-5-5");
  });

  it("a mode with nothing usable returns null so Auto reads the request as before", () => {
    expect(pickModeModel(request([{ ...claude(), models: { default: "x", options: [] } }]), "expert")).toBeNull();
  });
});

describe("the ranking Auto and the modes share", () => {
  it("Google's Pro is its strongest model, not a variant dropped while Flash is listed", () => {
    // red before #4900: "-pro" was a variant, Flash stayed alone, and Google had no top model
    expect(modelForTier(gemini, "top", catalog)?.id).toBe("gemini-3-pro");
    expect(modelForTier(gemini, "fast", catalog)?.id).toBe("gemini-3-flash");
  });
});

describe("Build (D-20261126-005)", () => {
  it("is no mode the server knows: nothing picks it and no table names it", () => {
    expect(FORCED_MODEL_MODES).toEqual(["fast", "expert", "heavy"]);
    expect(isForcedModelMode("build")).toBe(false);
    expect(Object.keys(MODE_TIER)).toEqual(["fast", "expert", "heavy"]);
  });
});

describe("resolveModes", () => {
  it("says what every mode runs, for the picker's tooltips", () => {
    const modes = resolveModes(request([claudeOpus(), grok]));
    // D-20261126-005: Build is not answered, so no menu can offer it
    expect(Object.keys(modes)).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(modes.expert.pick).toMatchObject({ model: "claude-opus-5-5", modelLabel: "Claude Opus 5.5", engineLabel: "Claude Code" });
    expect(modes.expert.effort).toBe("high");
    expect(modes.heavy.team!.slice(0, 2).map((seat) => seat.model)).toEqual(["claude-opus-5-5", "grok-4.7"]);
    expect(modes.fast.pick?.model).toBe("grok-4-fast");
  });

  it("heavySeats of nothing is no seat", () => {
    expect(heavySeats(request([], { instanceId: "none", model: "none", auto: true }))).toEqual([]);
  });
});
