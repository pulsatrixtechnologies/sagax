// #4329 lots 5 and 6: which engines ("Runs with", the harness) may run a
// bot's model, and a person's default per provider, read off the provider
// catalog (shared/provider-catalog.ts) through the compatibility matrix
// (shared/harness-matrix.ts). Pure, one place: the server's resolver
// (server/models/resolve-harness.ts) writes with it, the app's "Runs with"
// control (src/components/RunsWith.tsx) lists with it.
import { harnessPairs, HARNESS_TOOL_NAME, type HarnessPair, type HarnessPlace } from "./harness-matrix.ts";
import type { ModelSelection } from "./model-selection.ts";
import { splitEngine } from "./model-provider.ts";
import type { CatalogConnection, CatalogEngine, CatalogModel, CatalogProvider, ProviderCatalog } from "./provider-catalog.ts";

export interface LocatedSelection {
  provider: CatalogProvider;
  model: CatalogModel;
  engine: CatalogEngine;
}

/** Where the bot's model sits in the catalog: its provider, the model and
 * the engine row it runs on now. */
export function locateSelection(catalog: ProviderCatalog, selection: Pick<ModelSelection, "instanceId" | "model">): LocatedSelection | null {
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const engine = model.engines.find((entry) => entry.instanceId === selection.instanceId && entry.model === selection.model);
      if (engine) return { provider, model, engine };
    }
  }
  return null;
}

export const worksPairs = (pairs: readonly HarnessPair[]): HarnessPair[] => pairs.filter((pair) => pair.mark === "works");
export const modelConnections = (provider: CatalogProvider): CatalogConnection[] => provider.connections.filter((connection) => connection.kind !== "botsLink");

/** pi and OpenCode hold their own way in to a vendor (its key, or a
 * sign-in made inside them): one that lists the vendor's models runs them,
 * whatever else the person signed in with. The owner, 2026-11-14 (#4329):
 * every provider, subscriptions included, may run under the other engines.
 * `listed`: the engines that list the model (or, for a provider, one of its
 * models). Only the matrix's "works" pairs of the vendor's key. */
function ownWayPairs(provider: CatalogProvider, place: HarnessPlace, listed: ReadonlySet<string>): HarnessPair[] {
  if (provider.kind !== "account" && provider.kind !== "key") return [];
  return worksPairs(harnessPairs({ kind: "key", vendor: provider.id }, place)).filter((pair) => splitEngine(pair.harness) && listed.has(pair.harness));
}

/** A connection's pairs, then the engines with their own way in it does not already offer. */
function withOwnWay(pairs: readonly HarnessPair[], extra: readonly HarnessPair[]): HarnessPair[] {
  const offered = new Set(worksPairs(pairs).map((pair) => pair.harness));
  return [...pairs, ...extra.filter((pair) => !offered.has(pair.harness))];
}

/** The connection the bot's model comes through: the engine's own account,
 * key or address; for a row of pi or OpenCode (which hold no account of
 * their own), the provider's connection that offers that engine, else the
 * provider's key as the matrix states it. Its pairs add the engines that
 * run the model with their own way in (ownWayPairs). */
export function connectionInUse(located: LocatedSelection, place: HarnessPlace): { connection: CatalogConnection | null; pairs: HarnessPair[] } {
  const { provider, engine } = located;
  const connections = modelConnections(provider);
  const extra = ownWayPairs(provider, place, new Set(located.model.engines.map((entry) => entry.harness)));
  const own = connections.find((connection) => connection.instanceId === engine.instanceId);
  if (own) return { connection: own, pairs: withOwnWay(own.harnesses, extra) };
  const offering = connections.find((connection) => worksPairs(connection.harnesses).some((pair) => pair.harness === engine.harness));
  if (offering) return { connection: offering, pairs: withOwnWay(offering.harnesses, extra) };
  if (splitEngine(engine.harness) && (provider.kind === "account" || provider.kind === "key")) {
    return { connection: null, pairs: harnessPairs({ kind: "key", vendor: provider.id }, place) };
  }
  // A provider with no connection the matrix knows (another tool's models):
  // its own engine only.
  return { connection: null, pairs: [{ harness: engine.harness, role: "tool", mark: "works" }] };
}

/** The engine that runs this model with this harness: the connection's own
 * instance when it is that engine, else another engine of the provider
 * listing the same model, whose own connection (when it has one) offers the
 * harness too. */
export function engineFor(located: LocatedSelection, connection: CatalogConnection | null, harness: string): CatalogEngine | null {
  const { provider, model } = located;
  const candidates = model.engines.filter((engine) => engine.harness === harness);
  if (!candidates.length) return null;
  const mine = connection?.instanceId ? candidates.find((engine) => engine.instanceId === connection.instanceId) : undefined;
  if (mine) return mine;
  if (located.engine.harness === harness) return located.engine;
  const connections = modelConnections(provider);
  return candidates.find((engine) => {
    const own = connections.find((entry) => entry.instanceId === engine.instanceId);
    return !own || worksPairs(own.harnesses).some((pair) => pair.harness === harness);
  }) ?? null;
}

/** The tool's own name for a harness (opened choice and refusals only). */
export function harnessName(harness: string): string {
  return HARNESS_TOOL_NAME[harness] ?? harness;
}

/** The harnesses the bot may pick for its model here (the opened "Runs
 * with" list): the matrix's "works" pairs for the connection in use whose
 * engine lists the model. */
export function harnessChoices(catalog: ProviderCatalog, place: HarnessPlace, selection: Pick<ModelSelection, "instanceId" | "model">): string[] {
  const located = locateSelection(catalog, selection);
  if (!located) return [];
  const { connection, pairs } = connectionInUse(located, place);
  return worksPairs(pairs).map((pair) => pair.harness).filter((harness) => engineFor(located, connection, harness) !== null);
}

/** What "Runs with" shows for a bot: the provider of its model, the engine
 * that runs it now, the recommended one, and every engine it may pick
 * (the one in use always among them). Null when its model is in no
 * provider (Auto, a model gone). */
export interface BotHarnessView {
  provider: CatalogProvider;
  current: string;
  recommended: string | null;
  choices: string[];
}

export function botHarnessView(catalog: ProviderCatalog, place: HarnessPlace, selection: Pick<ModelSelection, "instanceId" | "model">): BotHarnessView | null {
  const located = locateSelection(catalog, selection);
  if (!located) return null;
  const { connection, pairs } = connectionInUse(located, place);
  const choices = worksPairs(pairs).map((pair) => pair.harness).filter((harness) => engineFor(located, connection, harness) !== null);
  const current = located.engine.harness;
  return {
    provider: located.provider,
    current,
    recommended: connection?.recommended ?? null,
    choices: choices.includes(current) ? choices : [current, ...choices],
  };
}

/** Every pair the matrix states for a provider's model connections here
 * (its key's, for a provider with none), and the engines that run its
 * models with their own way in (ownWayPairs). */
export function providerHarnessPairs(provider: CatalogProvider, place: HarnessPlace): HarnessPair[] {
  const connections = modelConnections(provider);
  const pairs = connections.length
    ? connections.flatMap((connection) => connection.harnesses)
    : provider.kind === "account" || provider.kind === "key" ? harnessPairs({ kind: "key", vendor: provider.id }, place) : [];
  return withOwnWay(pairs, ownWayPairs(provider, place, new Set(provider.models.flatMap((model) => model.engines.map((engine) => engine.harness)))));
}

/** What "Runs with" offers on a provider's page (the person's default for
 * it): every engine one of its connections runs that lists one of its
 * models here, and the recommended one (its first connection's). */
export function providerHarnessView(catalog: ProviderCatalog, place: HarnessPlace, providerId: string): { provider: CatalogProvider; recommended: string | null; choices: string[] } | null {
  const provider = catalog.providers.find((entry) => entry.id === providerId);
  if (!provider) return null;
  const listed = new Set(provider.models.flatMap((model) => model.engines.map((engine) => engine.harness)));
  const choices: string[] = [];
  for (const pair of worksPairs(providerHarnessPairs(provider, place))) {
    if (listed.has(pair.harness) && !choices.includes(pair.harness)) choices.push(pair.harness);
  }
  const recommended = modelConnections(provider).map((connection) => connection.recommended).find((harness) => harness && choices.includes(harness)) ?? null;
  return { provider, recommended, choices };
}
