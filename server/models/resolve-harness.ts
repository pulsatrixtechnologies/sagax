// #4329 lot 5: the engine a bot runs with ("Runs with", the harness), in the
// data. One resolver, used when the choice is written (the bot's own value,
// the person's default for a provider, or the bot's model), never per turn,
// so no pooled engine relaunches between turns.
//
// It maps (the connection in use, the harness) to the engine instance that
// runs, through the compatibility matrix (shared/harness-matrix.ts) as the
// provider catalog (shared/provider-catalog.ts) states it. `instanceId` stays
// the routing key: the resolver only writes another one, with that engine's
// own id for the same model. A pair the matrix does not offer is never
// invented: an explicit choice is refused by name, a default is skipped.
//
// Order: the bot's own value when the matrix allows it for the connection in
// use, else the person's default for the provider, else the recommended
// engine when the one in use cannot run that connection. With no choice at
// all (every bot before this lot), the selection is returned as it is: an
// existing bot keeps running on its vendor's own tool until someone chooses.
// A default taken off puts the bots that followed it (no choice of their own,
// still on that engine for that provider) back on the recommended engine.
import {
  harnessPairs,
  HARNESS_TOOL_NAME,
  type HarnessPair,
  type HarnessPlace,
} from "../../shared/harness-matrix.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { splitEngine } from "../../shared/model-provider.ts";
import type { CatalogConnection, CatalogEngine, CatalogModel, CatalogProvider, ProviderCatalog } from "../../shared/provider-catalog.ts";
import { harnessPairRefusal, harnessModelRefusal, harnessUnknownProviderRefusal, harnessUnlistedRefusal } from "./model-access-refusals.ts";

/** The person's default harness per provider id (shared/model-provider.ts). */
export type HarnessDefaults = Readonly<Record<string, string>>;

export interface ResolveHarnessInput {
  catalog: ProviderCatalog;
  place: HarnessPlace;
  /** The bot's model as written (its engine and that engine's model id). */
  selection: Pick<ModelSelection, "instanceId" | "model">;
  /** The bot's own choice, a driver kind; absent or null for none. */
  bot?: string | null;
  /** The person's default per provider. */
  defaults?: HarnessDefaults;
  /** Providers whose default was just taken off, with the engine it named:
   * a bot with no choice of its own still on that engine for that provider
   * followed the default, so it goes back to the recommended engine. */
  cleared?: HarnessDefaults;
  /** The bot's own choice was just written: a pair the matrix does not offer
   * is refused with its sentence instead of skipped. */
  strict?: boolean;
}

export type ResolveHarnessResult =
  | {
    ok: true;
    /** The engine and its model id; the same as given when nothing moves. */
    selection: { instanceId: string; model: string };
    /** The driver kind that runs it, when the model is in the catalog. */
    harness: string | null;
    /** The provider id the model belongs to, when known. */
    provider: string | null;
  }
  | { ok: false; error: string };

interface Located {
  provider: CatalogProvider;
  model: CatalogModel;
  engine: CatalogEngine;
}

/** Where the bot's model sits in the catalog: its provider, the model and
 * the engine row it runs on now. */
export function locateSelection(catalog: ProviderCatalog, selection: Pick<ModelSelection, "instanceId" | "model">): Located | null {
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const engine = model.engines.find((entry) => entry.instanceId === selection.instanceId && entry.model === selection.model);
      if (engine) return { provider, model, engine };
    }
  }
  return null;
}

const works = (pairs: readonly HarnessPair[]) => pairs.filter((pair) => pair.mark === "works");
const modelConnections = (provider: CatalogProvider) => provider.connections.filter((connection) => connection.kind !== "botsLink");

/** The connection the bot's model comes through: the engine's own account,
 * key or address; for a row of pi or OpenCode (which hold no account of
 * their own), the provider's connection that offers that engine, else the
 * provider's key as the matrix states it. */
function connectionInUse(located: Located, place: HarnessPlace): { connection: CatalogConnection | null; pairs: HarnessPair[] } {
  const { provider, engine } = located;
  const connections = modelConnections(provider);
  const own = connections.find((connection) => connection.instanceId === engine.instanceId);
  if (own) return { connection: own, pairs: own.harnesses };
  const offering = connections.find((connection) => works(connection.harnesses).some((pair) => pair.harness === engine.harness));
  if (offering) return { connection: offering, pairs: offering.harnesses };
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
function engineFor(located: Located, connection: CatalogConnection | null, harness: string): CatalogEngine | null {
  const { provider, model } = located;
  const candidates = model.engines.filter((engine) => engine.harness === harness);
  if (!candidates.length) return null;
  const mine = connection?.instanceId ? candidates.find((engine) => engine.instanceId === connection.instanceId) : undefined;
  if (mine) return mine;
  if (located.engine.harness === harness) return located.engine;
  const connections = modelConnections(provider);
  return candidates.find((engine) => {
    const own = connections.find((entry) => entry.instanceId === engine.instanceId);
    return !own || works(own.harnesses).some((pair) => pair.harness === harness);
  }) ?? null;
}

/** The tool's own name for a harness (opened choice and refusals only). */
export function harnessName(harness: string): string {
  return HARNESS_TOOL_NAME[harness] ?? harness;
}

/** See the header. */
export function resolveHarness(input: ResolveHarnessInput): ResolveHarnessResult {
  const unchanged = (harness: string | null, provider: string | null): ResolveHarnessResult => ({
    ok: true, selection: { instanceId: input.selection.instanceId, model: input.selection.model }, harness, provider,
  });
  const located = locateSelection(input.catalog, input.selection);
  const chosen = input.bot?.trim() || null;
  if (!located) {
    if (input.strict && chosen) return { ok: false, error: harnessUnlistedRefusal(harnessName(chosen)) };
    return unchanged(null, null);
  }
  const { provider, model } = located;
  const { connection, pairs } = connectionInUse(located, input.place);
  const offered = works(pairs);
  const fallback = input.defaults?.[provider.id]?.trim() || null;
  const choices: Array<{ harness: string; strict: boolean }> = [
    ...(chosen ? [{ harness: chosen, strict: input.strict === true }] : []),
    ...(fallback && fallback !== chosen ? [{ harness: fallback, strict: false }] : []),
  ];
  const moved = (engine: CatalogEngine): ResolveHarnessResult => ({
    ok: true, selection: { instanceId: engine.instanceId, model: engine.model }, harness: engine.harness, provider: provider.id,
  });
  for (const choice of choices) {
    const allowed = offered.some((pair) => pair.harness === choice.harness);
    const engine = allowed ? engineFor(located, connection, choice.harness) : null;
    if (engine) return moved(engine);
    if (!choice.strict) continue;
    if (!allowed) return { ok: false, error: harnessPairRefusal(harnessName(choice.harness), provider.label, pairs.find((pair) => pair.harness === choice.harness)?.reason) };
    return { ok: false, error: harnessModelRefusal(harnessName(choice.harness), model.label) };
  }
  // A choice exists but none can run here: the engine in use stays when the
  // matrix allows it, else the recommended one. A cleared default the bot
  // followed: the recommended one too.
  const followedCleared = !choices.length && input.cleared?.[provider.id] === located.engine.harness;
  if (followedCleared || (choices.length && !offered.some((pair) => pair.harness === located.engine.harness))) {
    const recommended = connection?.recommended ?? null;
    const engine = recommended ? engineFor(located, connection, recommended) : null;
    if (engine) return moved(engine);
  }
  return unchanged(located.engine.harness, provider.id);
}

/** Why a person's default harness for this provider cannot be saved, or
 * null when one of the provider's connections runs it. */
export function harnessDefaultRefusal(catalog: ProviderCatalog, place: HarnessPlace, providerId: string, harness: string): string | null {
  const provider = catalog.providers.find((entry) => entry.id === providerId);
  if (!provider) return harnessUnknownProviderRefusal(harnessName(harness), providerId);
  const connections = modelConnections(provider);
  const pairs = connections.length
    ? connections.flatMap((connection) => connection.harnesses)
    : provider.kind === "account" || provider.kind === "key" ? harnessPairs({ kind: "key", vendor: provider.id }, place) : [];
  if (pairs.some((pair) => pair.harness === harness && pair.mark === "works")) return null;
  return harnessPairRefusal(harnessName(harness), provider.label, pairs.find((pair) => pair.harness === harness)?.reason);
}

/** The harnesses the bot may pick for its model here (the opened "Runs
 * with" list): the matrix's "works" pairs for the connection in use whose
 * engine lists the model. */
export function harnessChoices(catalog: ProviderCatalog, place: HarnessPlace, selection: Pick<ModelSelection, "instanceId" | "model">): string[] {
  const located = locateSelection(catalog, selection);
  if (!located) return [];
  const { connection, pairs } = connectionInUse(located, place);
  return works(pairs).map((pair) => pair.harness).filter((harness) => engineFor(located, connection, harness) !== null);
}

/** The bot's selection on the engine the resolver chose: the engine's own
 * model id; the effort only when the new engine takes it; a variant or a
 * second sign-in belongs to the engine left, so neither follows. Auto and
 * its preferences stay as they were. */
export function movedSelection(
  from: Record<string, unknown>,
  to: { instanceId: string; model: string },
  effortAccepted: (effort: string) => boolean,
): Record<string, unknown> {
  const { effort, variant: _variant, account: _account, ...rest } = from;
  return {
    ...rest,
    instanceId: to.instanceId,
    model: to.model,
    ...(typeof effort === "string" && effortAccepted(effort) ? { effort } : {}),
  };
}

export interface HarnessChoiceDeps {
  /** The caller's provider catalog (GET /api/me/providers/catalog). */
  catalog(auth: unknown): Promise<ProviderCatalog>;
  place(): HarnessPlace;
  /** The default engine per provider of the person who owns the bot (or of
   * the caller, for a bot not made yet). */
  defaultsFor(principalId: string | null | undefined): HarnessDefaults;
  /** Whether this engine takes this effort level. */
  effortAccepted(instanceId: string, effort: string): boolean;
}

export type HarnessSelectionResult = { ok: true; selection: unknown } | { ok: false; status: number; error: string };

/** The write-time side of the resolver, for the routes. */
export function createHarnessChoice(deps: HarnessChoiceDeps) {
  return {
    /**
     * A bot's model as it will be saved: on the engine its own choice (or,
     * without one, the owner's default for the provider) names. `harness`
     * undefined keeps the bot's stored choice; a string or null is the choice
     * being written now, and a string is checked strictly. `cleared`: the
     * defaults just taken off (see resolveHarness). With no choice at all the
     * raw selection is returned untouched, without reading anything.
     */
    async selectionFor(auth: unknown, owner: string | null | undefined, raw: unknown,
      choice: { stored?: string | null; harness?: string | null; cleared?: HarnessDefaults; catalog?: Promise<ProviderCatalog> }): Promise<HarnessSelectionResult> {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: true, selection: raw };
      const value = raw as Record<string, unknown>;
      if (typeof value.instanceId !== "string" || !value.instanceId.trim() || typeof value.model !== "string" || !value.model.trim()) return { ok: true, selection: raw };
      const writing = choice.harness !== undefined;
      const harness = writing ? choice.harness ?? null : choice.stored ?? null;
      const defaults = deps.defaultsFor(owner);
      const cleared = harness ? undefined : choice.cleared;
      if (!harness && !Object.keys(defaults).length && !Object.keys(cleared ?? {}).length) return { ok: true, selection: raw };
      const selection = { instanceId: value.instanceId.trim(), model: value.model.trim() };
      const resolved = resolveHarness({
        catalog: await (choice.catalog ?? deps.catalog(auth)), place: deps.place(), selection, bot: harness, defaults, cleared, strict: writing && Boolean(harness),
      });
      if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
      if (resolved.selection.instanceId === selection.instanceId && resolved.selection.model === selection.model) return { ok: true, selection: raw };
      return { ok: true, selection: movedSelection(value, resolved.selection, (effort) => deps.effortAccepted(resolved.selection.instanceId, effort)) };
    },
    /** Why this engine cannot be the caller's default for this provider. */
    async defaultRefusal(auth: unknown, provider: string, harness: string): Promise<string | null> {
      return harnessDefaultRefusal(await deps.catalog(auth), deps.place(), provider, harness);
    },
  };
}

export type HarnessChoice = ReturnType<typeof createHarnessChoice>;
