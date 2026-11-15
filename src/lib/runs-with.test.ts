// #4384 (#4329 lot 6): "Runs with", the values, their words and where they
// come from: the provider catalog, read through the functions the server's
// resolver writes with.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";
import { setLocale } from "./i18n";
import { botRunsWith, providerRunsWith, runsWithChoices, runsWithOptionLabel, runsWithShown } from "./runs-with";

const instance = (instanceId: string, driverKind: string, access: InstanceInfo["access"], models: string[], over: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName: instanceId, access,
  snapshot: { state: "available", authenticated: true },
  models: { default: models[0] ?? "", options: models.map((id) => ({ id, label: id })) },
  ...over,
} as InstanceInfo);

const claudeSubscription = instance("claude", "claudeAgent", "subscription", ["claude-opus-5"]);
const openaiKey = instance("openai", "openai-compat", "api", ["gpt-6"]);
const pi = instance("pi", "piAgent", "custom", ["anthropic/claude-opus-5", "openai/gpt-6"]);

beforeEach(() => setLocale("en"));

describe("the words", () => {
  it("never names a tool on the first level; the opened list's grey line does", () => {
    const choices = runsWithChoices({ harnesses: ["piAgent", "opencodeGo", "openai-compat", "codex"], current: "codex", recommended: "openai-compat", vendor: "openai", onPick: () => {} });
    expect(choices.map((choice) => [choice.key, choice.label, choice.hint, choice.current, choice.recommended])).toEqual([
      ["codex", "Its own tool", "Codex, made by the provider", true, false],
      ["openai-compat", "Built in", "Sagax talks to the provider directly", false, true],
      ["piAgent", "pi", "An open engine that works with many providers", false, false],
      ["opencodeGo", "OpenCode", "An open engine that works with many providers", false, false],
    ]);
    expect(runsWithOptionLabel(choices[1]!)).toBe("Built in (recommended)");
    expect(runsWithOptionLabel(choices[0]!)).toBe("Its own tool");
  });

  it("speaks Quebec French", () => {
    setLocale("fr");
    const [own] = runsWithChoices({ harnesses: ["claudeAgent"], current: "claudeAgent", recommended: "claudeAgent", vendor: "anthropic", onPick: () => {} });
    expect(runsWithOptionLabel(own!)).toBe("Son propre outil (recommandé)");
    expect(own!.hint).toBe("Claude Code, fait par le fournisseur");
  });

  it("is hidden where one value is possible", () => {
    expect(runsWithShown(undefined)).toBe(false);
    expect(runsWithShown(runsWithChoices({ harnesses: ["claudeAgent"], current: "claudeAgent", recommended: null, vendor: "anthropic", onPick: () => {} }))).toBe(false);
    expect(runsWithShown(runsWithChoices({ harnesses: ["claudeAgent", "piAgent"], current: "claudeAgent", recommended: null, vendor: "anthropic", onPick: () => {} }))).toBe(true);
  });
});

describe("a bot's Runs with", () => {
  it("offers pi for a subscription's model pi lists (the owner: every provider, subscriptions included), and a pick names the engine", () => {
    const onPick = vi.fn();
    const choices = botRunsWith({ instances: [claudeSubscription, pi], place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, onPick });
    expect(choices.map((choice) => [choice.key, choice.current])).toEqual([["claudeAgent", true], ["piAgent", false]]);
    choices[1]!.onPick();
    expect(onPick).toHaveBeenCalledWith("piAgent");
  });

  it("has one value, so nothing to draw, when no other engine lists the model", () => {
    expect(runsWithShown(botRunsWith({ instances: [claudeSubscription], place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, onPick: () => {} }))).toBe(false);
  });

  it("leaves out an engine that cannot run now, and draws nothing on Auto", () => {
    const signedOut = { ...pi, snapshot: { state: "available" as const, authenticated: false } };
    expect(botRunsWith({ instances: [claudeSubscription, signedOut], place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, onPick: () => {} }).map((choice) => choice.key)).toEqual(["claudeAgent"]);
    expect(botRunsWith({ instances: [claudeSubscription, pi], place: "solo", selection: { instanceId: "claude", model: "claude-opus-5", auto: true }, onPick: () => {} })).toEqual([]);
  });

  it("checks the bot's own choice while the server writes it", () => {
    const choices = botRunsWith({ instances: [openaiKey, pi], place: "solo", selection: { instanceId: "openai", model: "gpt-6" }, chosen: "piAgent", onPick: () => {} });
    expect(choices.find((choice) => choice.current)?.key).toBe("piAgent");
    expect(choices.find((choice) => choice.recommended)?.key).toBe("openai-compat");
  });
});

describe("a provider's Runs with", () => {
  it("lists every engine its connections run that lists its models, the person's default checked, else the recommended one", () => {
    const fresh = providerRunsWith({ instances: [openaiKey, pi], place: "solo", providerId: "openai", defaults: {}, onPick: () => {} });
    expect(fresh.map((choice) => [choice.key, choice.current, choice.recommended])).toEqual([["openai-compat", true, true], ["piAgent", false, false]]);
    const saved = providerRunsWith({ instances: [openaiKey, pi], place: "solo", providerId: "openai", defaults: { openai: "piAgent" }, onPick: () => {} });
    expect(saved.find((choice) => choice.current)?.key).toBe("piAgent");
  });

  it("answers 'how do I use pi with this provider' for a signed-in account too", () => {
    expect(providerRunsWith({ instances: [claudeSubscription, pi], place: "solo", providerId: "anthropic", defaults: {}, onPick: () => {} }).map((choice) => choice.key)).toEqual(["claudeAgent", "piAgent"]);
  });
});
