import { describe, expect, it } from "vitest";

import { harnessAllowed, harnessPairs, type HarnessPlace } from "../../shared/harness-matrix.ts";
import { providerCatalog, type CatalogInstance } from "../../shared/provider-catalog.ts";
import { createHarnessChoice, harnessChoices, harnessDefaultRefusal, movedSelection, resolveHarness } from "./resolve-harness.ts";

const instance = (fields: Partial<CatalogInstance> & Pick<CatalogInstance, "instanceId" | "driverKind">, models: string[] = []): CatalogInstance => ({
  displayName: fields.instanceId,
  snapshot: { state: "available" },
  models: { options: models.map((id) => ({ id, label: id })) },
  ...fields,
});

const catalogOf = (instances: CatalogInstance[], place: HarnessPlace = "solo") => providerCatalog({ instances, place });

describe("#4329 lot 5: the engine a bot runs with, resolved when it is written", () => {
  const instances = [
    instance({ instanceId: "claude", driverKind: "claudeAgent", access: "subscription" }, ["claude-opus-5"]),
    instance({ instanceId: "claudeApi", driverKind: "claudeAgent", access: "api" }, ["claude-opus-5"]),
    instance({ instanceId: "codex", driverKind: "codex", access: "subscription" }, ["gpt-6"]),
    instance({ instanceId: "openai", driverKind: "openai-compat", access: "api" }, ["gpt-6"]),
    instance({ instanceId: "pi", driverKind: "piAgent", access: "custom" }, ["anthropic/claude-opus-5", "openai/gpt-6"]),
  ];
  const catalog = catalogOf(instances);

  it("leaves a bot with no choice exactly where it runs (every bot before this lot)", () => {
    for (const selection of [{ instanceId: "claude", model: "claude-opus-5" }, { instanceId: "pi", model: "openai/gpt-6" }, { instanceId: "gone", model: "x" }]) {
      const result = resolveHarness({ catalog, place: "solo", selection });
      expect(result.ok && result.selection).toEqual(selection);
    }
  });

  it("moves a key-paid model to the chosen engine, with that engine's own id for the model", () => {
    const result = resolveHarness({ catalog, place: "solo", selection: { instanceId: "claudeApi", model: "claude-opus-5" }, bot: "piAgent", strict: true });
    expect(result).toEqual({ ok: true, selection: { instanceId: "pi", model: "anthropic/claude-opus-5" }, harness: "piAgent", provider: "anthropic" });
    // and back to the vendor's own tool on the same key
    const back = resolveHarness({ catalog, place: "solo", selection: { instanceId: "pi", model: "anthropic/claude-opus-5" }, bot: "claudeAgent", strict: true });
    expect(back.ok && back.selection.instanceId).toMatch(/^claude/);
  });

  // the same catalog with no engine of its own way in listing Claude's model
  const subscriptionOnly = catalogOf(instances.map((entry) => entry.instanceId === "pi" ? instance({ instanceId: "pi", driverKind: "piAgent", access: "custom" }, ["openai/gpt-6"]) : entry));

  it("refuses by name a pair the matrix does not offer, with its reason", () => {
    // built-in openai-compat stays "no" on a Claude subscription (SUBSCRIPTION_KEPT)
    const result = resolveHarness({ catalog: subscriptionOnly, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "openai-compat", strict: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^OpenAI-compatible cannot run Claude here\. The vendor keeps subscription use to its own tools/);
  });

  it("#4410 lot 1: a Claude account runs under pi when pi lists the model for its payer, and is refused only for the model", () => {
    for (const place of ["solo", "organization"] as const) {
      const here = catalogOf(instances, place);
      expect(resolveHarness({ catalog: here, place, selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "piAgent", strict: true }))
        .toEqual({ ok: true, selection: { instanceId: "pi", model: "anthropic/claude-opus-5" }, harness: "piAgent", provider: "anthropic" });
      expect(harnessDefaultRefusal(here, place, "anthropic", "piAgent")).toBeNull();
    }
    // pi lists no Claude model for this payer (no sign-in, no key): the model, not the pair
    const result = resolveHarness({ catalog: subscriptionOnly, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "piAgent", strict: true });
    expect(!result.ok && result.error).toBe("pi does not offer claude-opus-5. Pick a model it offers first, then choose pi.");
  });

  it("#5523: a Claude account runs under OpenCode when OpenCode lists the model for its payer, and is refused only for the model", () => {
    for (const place of ["solo", "organization"] as const) {
      const here = catalogOf([
        ...instances,
        instance({ instanceId: "oc", driverKind: "opencodeGo", access: "custom" }, ["anthropic/claude-opus-5"]),
      ], place);
      expect(resolveHarness({ catalog: here, place, selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "opencodeGo", strict: true }))
        .toEqual({ ok: true, selection: { instanceId: "oc", model: "anthropic/claude-opus-5" }, harness: "opencodeGo", provider: "anthropic" });
      expect(harnessDefaultRefusal(here, place, "anthropic", "opencodeGo")).toBeNull();
    }
    // OpenCode lists no Claude model for this payer: the model, not the pair
    const result = resolveHarness({ catalog: subscriptionOnly, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "opencodeGo", strict: true });
    expect(!result.ok && result.error).toBe("OpenCode does not offer claude-opus-5. Pick a model it offers first, then choose OpenCode.");
  });

  it("#5524: an OpenAI/Codex account runs under pi and OpenCode when they list the model for its payer", () => {
    for (const place of ["solo", "organization"] as const) {
      const here = catalogOf([
        ...instances,
        instance({ instanceId: "oc", driverKind: "opencodeGo", access: "custom" }, ["openai/gpt-6"]),
      ], place);
      expect(resolveHarness({ catalog: here, place, selection: { instanceId: "codex", model: "gpt-6" }, bot: "piAgent", strict: true }))
        .toEqual({ ok: true, selection: { instanceId: "pi", model: "openai/gpt-6" }, harness: "piAgent", provider: "openai" });
      expect(resolveHarness({ catalog: here, place, selection: { instanceId: "codex", model: "gpt-6" }, bot: "opencodeGo", strict: true }))
        .toEqual({ ok: true, selection: { instanceId: "oc", model: "openai/gpt-6" }, harness: "opencodeGo", provider: "openai" });
      expect(harnessDefaultRefusal(here, place, "openai", "piAgent")).toBeNull();
      expect(harnessDefaultRefusal(here, place, "openai", "opencodeGo")).toBeNull();
    }
  });

  it("refuses an engine that does not list the model, never another model", () => {
    const narrow = catalogOf([
      instance({ instanceId: "claudeApi", driverKind: "claudeAgent", access: "api" }, ["claude-opus-5"]),
      instance({ instanceId: "pi", driverKind: "piAgent", access: "custom" }, ["anthropic/claude-sonnet-5"]),
    ]);
    const result = resolveHarness({ catalog: narrow, place: "solo", selection: { instanceId: "claudeApi", model: "claude-opus-5" }, bot: "piAgent", strict: true });
    expect(!result.ok && result.error).toBe("pi does not offer claude-opus-5. Pick a model it offers first, then choose pi.");
  });

  it("#4384: a subscription's model runs under pi when pi lists it with its own way in (the owner: every provider, subscriptions included)", () => {
    const result = resolveHarness({ catalog, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "piAgent", strict: true });
    expect(result).toEqual({ ok: true, selection: { instanceId: "pi", model: "anthropic/claude-opus-5" }, harness: "piAgent", provider: "anthropic" });
    expect(harnessDefaultRefusal(catalog, "solo", "anthropic", "piAgent")).toBeNull();
    // OpenCode lists none of them here: refused for the model, not the pair (#5523)
    expect(resolveHarness({ catalog, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "opencodeGo", strict: true }).ok).toBe(false);
  });

  it("keeps a stored choice that cannot run a newly picked model's connection without refusing the pick", () => {
    const result = resolveHarness({ catalog: subscriptionOnly, place: "solo", selection: { instanceId: "claude", model: "claude-opus-5" }, bot: "piAgent" });
    expect(result).toEqual({ ok: true, selection: { instanceId: "claude", model: "claude-opus-5" }, harness: "claudeAgent", provider: "anthropic" });
  });

  it("uses the person's default for the provider when the bot has none, and the bot's own value first", () => {
    const viaDefault = resolveHarness({ catalog, place: "solo", selection: { instanceId: "openai", model: "gpt-6" }, defaults: { openai: "piAgent" } });
    expect(viaDefault.ok && viaDefault.selection).toEqual({ instanceId: "pi", model: "openai/gpt-6" });
    // #5524: pi on an OpenAI model is attributed to the subscription when it
    // offers pi; openai-compat stays "no" on a plan, so the bot's choice is
    // skipped and the default (pi) keeps the selection
    const botFirst = resolveHarness({ catalog, place: "solo", selection: { instanceId: "pi", model: "openai/gpt-6" }, bot: "openai-compat", defaults: { openai: "piAgent" } });
    expect(botFirst.ok && botFirst.selection).toEqual({ instanceId: "pi", model: "openai/gpt-6" });
    // from the key row, the bot can still pick the built-in runtime
    const fromKey = resolveHarness({ catalog, place: "solo", selection: { instanceId: "openai", model: "gpt-6" }, bot: "openai-compat" });
    expect(fromKey.ok && fromKey.selection).toEqual({ instanceId: "openai", model: "gpt-6" });
    // the subscription's model moves to pi too, pi listing it (#4384)
    const onSubscription = resolveHarness({ catalog, place: "solo", selection: { instanceId: "codex", model: "gpt-6" }, defaults: { openai: "piAgent" } });
    expect(onSubscription.ok && onSubscription.selection).toEqual({ instanceId: "pi", model: "openai/gpt-6" });
    // a default with no engine listing the model is skipped, never refused
    const skipped = resolveHarness({ catalog, place: "solo", selection: { instanceId: "codex", model: "gpt-6" }, defaults: { openai: "opencodeGo" } });
    expect(skipped.ok && skipped.selection).toEqual({ instanceId: "codex", model: "gpt-6" });
  });

  it("says why a default cannot be saved for a provider, by the matrix", () => {
    expect(harnessDefaultRefusal(catalog, "solo", "openai", "piAgent")).toBeNull();
    expect(harnessDefaultRefusal(catalog, "solo", "openai", "claudeAgent")).toMatch(/^Claude Code cannot run OpenAI here\./);
    // a provider id the person does not have: a sentence about the provider, not a model
    expect(harnessDefaultRefusal(catalog, "solo", "nowhere", "piAgent")).toBe("nowhere is not one of your providers, so pi cannot run it. Connect it first.");
  });

  it("a cleared default puts the bots that followed it back on the recommended engine, and leaves the others", () => {
    // #5524: followed "OpenAI runs with pi" on the subscription connection:
    // back on Codex (the subscription's recommended own tool)
    const back = resolveHarness({ catalog, place: "solo", selection: { instanceId: "pi", model: "openai/gpt-6" }, cleared: { openai: "piAgent" } });
    expect(back.ok && back.selection).toEqual({ instanceId: "codex", model: "gpt-6" });
    // never followed it (already on its own tool, or another provider's model): stays
    const own = resolveHarness({ catalog, place: "solo", selection: { instanceId: "openai", model: "gpt-6" }, cleared: { openai: "piAgent" } });
    expect(own.ok && own.selection).toEqual({ instanceId: "openai", model: "gpt-6" });
    const other = resolveHarness({ catalog, place: "solo", selection: { instanceId: "pi", model: "anthropic/claude-opus-5" }, cleared: { openai: "piAgent" } });
    expect(other.ok && other.selection).toEqual({ instanceId: "pi", model: "anthropic/claude-opus-5" });
    // a bot with its own engine keeps it
    const kept = resolveHarness({ catalog, place: "solo", selection: { instanceId: "pi", model: "openai/gpt-6" }, bot: "piAgent", cleared: { openai: "piAgent" } });
    expect(kept.ok && kept.selection).toEqual({ instanceId: "pi", model: "openai/gpt-6" });
  });

  it("the write path moves a bot back when its provider's default is cleared, with no default left", async () => {
    const choice = createHarnessChoice({
      catalog: async () => catalog, place: () => "solo", defaultsFor: () => ({}), effortAccepted: () => true,
    });
    const back = await choice.selectionFor({}, "pr_a", { instanceId: "pi", model: "openai/gpt-6" }, { stored: null, cleared: { openai: "piAgent" } });
    expect(back).toEqual({ ok: true, selection: { instanceId: "codex", model: "gpt-6" } });
  });

  it("lists the engines the bot may pick for its model, only where the engine lists it", () => {
    expect(harnessChoices(catalog, "solo", { instanceId: "claudeApi", model: "claude-opus-5" }).sort()).toEqual(["claudeAgent", "piAgent"]);
    expect(harnessChoices(catalog, "solo", { instanceId: "claude", model: "claude-opus-5" })).toEqual(["claudeAgent", "piAgent"]);
    expect(harnessChoices(subscriptionOnly, "solo", { instanceId: "claude", model: "claude-opus-5" })).toEqual(["claudeAgent"]);
  });

  it("upgrade: with no choice anywhere the write path reads nothing and returns the selection as given", async () => {
    let reads = 0;
    const choice = createHarnessChoice({
      catalog: async () => { reads += 1; return catalog; }, place: () => "solo", defaultsFor: () => ({}), effortAccepted: () => true,
    });
    const selection = { instanceId: "claudeApi", model: "claude-opus-5", effort: "high" };
    const result = await choice.selectionFor({}, "pr_a", selection, { stored: null });
    expect(result).toEqual({ ok: true, selection });
    expect(result.ok && result.selection).toBe(selection);
    expect(reads).toBe(0);
  });

  it("the write path moves the model, keeps the effort the new engine takes, and refuses an impossible choice", async () => {
    const choice = createHarnessChoice({
      catalog: async () => catalog, place: () => "solo", defaultsFor: () => ({}), effortAccepted: (_id, effort) => effort === "high",
    });
    const moved = await choice.selectionFor({}, "pr_a", { instanceId: "claudeApi", model: "claude-opus-5", effort: "high", variant: "x" }, { harness: "piAgent" });
    expect(moved).toEqual({ ok: true, selection: { instanceId: "pi", model: "anthropic/claude-opus-5", effort: "high" } });
    const refused = await choice.selectionFor({}, "pr_a", { instanceId: "claude", model: "claude-opus-5" }, { harness: "opencodeGo" });
    expect(refused.ok).toBe(false);
    expect(movedSelection({ instanceId: "a", model: "m", effort: "max", auto: true }, { instanceId: "b", model: "n" }, () => false)).toEqual({ instanceId: "b", model: "n", auto: true });
  });

  describe("over the whole matrix", () => {
    // The key instance of each vendor (its connection), and the engines of
    // every pair the matrix states for that key, each listing model m1.
    const KEY_INSTANCE: Record<string, CatalogInstance> = {
      anthropic: instance({ instanceId: "k-anthropic", driverKind: "claudeAgent", access: "api" }, ["m1"]),
      openai: instance({ instanceId: "openai", driverKind: "openai-compat", access: "api" }, ["m1"]),
      xai: instance({ instanceId: "k-xai", driverKind: "grok" }, ["m1"]),
      google: instance({ instanceId: "k-google", driverKind: "geminiAgent", access: "api" }, ["m1"]),
      openrouter: instance({ instanceId: "openrouter", driverKind: "openai-compat", access: "api" }, ["m1"]),
      mistral: instance({ instanceId: "k-mistral", driverKind: "mistral" }, ["m1"]),
      cerebras: instance({ instanceId: "k-cerebras", driverKind: "cerebras" }, ["m1"]),
      groq: instance({ instanceId: "k-groq", driverKind: "groq" }, ["m1"]),
      minimax: instance({ instanceId: "k-minimax", driverKind: "minimax" }, ["m1"]),
      meta: instance({ instanceId: "k-meta", driverKind: "meta" }, ["m1"]),
      opencode: instance({ instanceId: "k-opencode", driverKind: "opencodeGo" }, ["opencode/m1"]),
    };
    const engineListing = (vendor: string, harness: string): CatalogInstance | null => {
      if (harness === KEY_INSTANCE[vendor]!.driverKind) return null;
      if (harness === "piAgent" || harness === "opencodeGo") return instance({ instanceId: `e-${harness}`, driverKind: harness }, [`${vendor}/m1`]);
      // the vendor's own tool, or a tool its key pays (Hermes for OpenRouter)
      return instance({ instanceId: `e-${harness}`, driverKind: harness, access: "api" }, ["m1"]);
    };

    for (const place of ["solo", "organization"] as const) {
      for (const vendor of Object.keys(KEY_INSTANCE)) {
        it(`${vendor} key, ${place}: every "works" pair moves there, every other pair is refused`, () => {
          const key = KEY_INSTANCE[vendor]!;
          const pairs = harnessPairs({ kind: "key", vendor }, place);
          const engines = pairs.map((pair) => engineListing(vendor, pair.harness)).filter((entry): entry is CatalogInstance => entry !== null);
          const catalog = catalogOf([key, ...engines], place);
          const selection = { instanceId: key.instanceId, model: key.models.options[0]!.id };
          for (const pair of pairs) {
            const result = resolveHarness({ catalog, place, selection, bot: pair.harness, strict: true });
            if (pair.mark === "works") {
              expect(result.ok, `${vendor} ${pair.harness}`).toBe(true);
              expect(result.ok && result.harness, `${vendor} ${pair.harness}`).toBe(pair.harness);
            } else {
              expect(result.ok, `${vendor} ${pair.harness}`).toBe(false);
            }
          }
          // a harness the matrix does not state for it is never invented
          const result = resolveHarness({ catalog, place, selection, bot: "cursorAgent", strict: true });
          expect(result.ok).toBe(false);
        });
      }
    }

    for (const [vendor, driver] of [["anthropic", "claudeAgent"], ["openai", "codex"], ["xai", "grokAgent"]] as const) {
      it(`${vendor} subscription: what the matrix offers runs it, and pi or OpenCode listing its model with their own way in`, () => {
        const sub = instance({ instanceId: `s-${vendor}`, driverKind: driver, access: "subscription" }, ["m1"]);
        const catalog = catalogOf([sub, instance({ instanceId: "pi", driverKind: "piAgent" }, [`${vendor}/m1`]), instance({ instanceId: "oc", driverKind: "opencodeGo" }, [`${vendor}/m1`])]);
        for (const pair of harnessPairs({ kind: "subscription", vendor, driver }, "solo")) {
          const result = resolveHarness({ catalog, place: "solo", selection: { instanceId: sub.instanceId, model: "m1" }, bot: pair.harness, strict: true });
          const ownWay = (pair.harness === "piAgent" || pair.harness === "opencodeGo") && harnessAllowed({ kind: "key", vendor }, "solo", pair.harness);
          expect(result.ok, `${vendor} ${pair.harness}`).toBe(pair.mark === "works" || ownWay);
          if (result.ok) expect(result.selection.instanceId).toBe(ownWay ? (pair.harness === "piAgent" ? "pi" : "oc") : sub.instanceId);
        }
      });
    }
  });
});
