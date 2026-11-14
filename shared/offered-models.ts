// Which models are on, per model (2026-10-30, "Providers, models and voice",
// lot 2). Two levels, in this order:
//
// 1. The organization (Perspicax, Sagax > Configuration > Policies > Model
//    providers): `disabledModels`, a list of stable ids `<engine>/<model>`
//    the organization's admin turned off. Off for everyone, admins included.
//    Set through `POST /api/org/admin/settings` (docs/org-admin-api.md).
// 2. The person (Settings > Models): their own `disabledModels`, the models
//    they turned off for their own bots, Auto and voice. On a solo server
//    the person is the installation.
//
// A model nobody turned off is on: a new model an engine lists arrives on.
// The engine level (`allowedEngines`, shared/offered-engines.ts) still
// applies first: offeredModels = offeredEngines, then this filter.
import { offeredEngines, type EngineOfferContext } from "./offered-engines.ts";

/** The stable id of a model: `<engine instance id>/<model id>`. A model id
 * may itself hold a slash (OpenRouter's "vendor/model"): only the first
 * slash splits. */
export function modelKey(instanceId: string, model: string): string {
  return `${instanceId}/${model}`;
}

export function parseModelKey(key: string): { instanceId: string; model: string } | null {
  const at = key.indexOf("/");
  if (at <= 0 || at === key.length - 1) return null;
  return { instanceId: key.slice(0, at), model: key.slice(at + 1) };
}

/** At most this many ids in one list: a bound, not a quota. */
export const MAX_DISABLED_MODELS = 2_000;

/** A clean list: strings of the `<engine>/<model>` form, once each. */
export function cleanDisabledModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length > 300 || !parseModelKey(id) || seen.has(id)) continue;
    seen.add(id);
    if (seen.size >= MAX_DISABLED_MODELS) break;
  }
  return [...seen];
}

/** #2050: at most this many favorite models per person (a star list, not
 * a catalog). */
export const MAX_FAVORITE_MODELS = 40;

/** A clean favorites list: `<engine>/<model>` strings, once each, in the
 * order given; the last entries win when there are too many. */
export function cleanFavoriteModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length > 300 || !parseModelKey(id) || seen.has(id)) continue;
    seen.add(id);
  }
  return [...seen].slice(-MAX_FAVORITE_MODELS);
}

export interface ModelSwitches {
  /** Turned off by the organization (null or absent: none). */
  org?: readonly string[] | null;
  /** Turned off by the person (null or absent: none). */
  mine?: readonly string[] | null;
}

export type ModelOffer = "on" | "adminOff" | "personOff";

/** Whether one model is on, and who turned it off. */
export function modelOffer(switches: ModelSwitches | null | undefined, instanceId: string, model: string): ModelOffer {
  const key = modelKey(instanceId, model);
  if (switches?.org?.includes(key)) return "adminOff";
  if (switches?.mine?.includes(key)) return "personOff";
  return "on";
}

export function modelOn(switches: ModelSwitches | null | undefined, instanceId: string, model: string): boolean {
  return modelOffer(switches, instanceId, model) === "on";
}

/** #4329 lot 4: every stored key of one model, whatever engine runs it
 * (shared/provider-catalog.ts lists the engines of a canonical model), once
 * each, in the engines' order. */
export function modelKeys(engines: ReadonlyArray<{ instanceId: string; model: string }>): string[] {
  return [...new Set(engines.map((engine) => modelKey(engine.instanceId, engine.model)))];
}

/** Whether one model is on across the engines that run it: on while one
 * engine still offers it, greyed only when the organization turned it off
 * on every one of them. */
export function modelOfferAcross(switches: ModelSwitches | null | undefined, engines: ReadonlyArray<{ instanceId: string; model: string }>): ModelOffer {
  const offers = engines.map((engine) => modelOffer(switches, engine.instanceId, engine.model));
  if (!offers.length || offers.includes("on")) return "on";
  return offers.every((offer) => offer === "adminOff") ? "adminOff" : "personOff";
}

/** The person's list after one switch of a model: all its keys at once,
 * the storage format unchanged (an older app still reads each key). */
export function switchedModelKeys(mine: readonly string[], keys: readonly string[], on: boolean): string[] {
  const drop = new Set(keys);
  const rest = mine.filter((entry) => !drop.has(entry));
  return on ? rest : [...rest, ...drop];
}

interface ModelsOf { default: string; options: ReadonlyArray<{ id: string }> }

/**
 * The engines offered and, on each, only the models that are on. `pick`
 * (the default) also drops an engine whose every listed model is off; an
 * engine that lists no model yet stays (its list is on its way). The
 * engine's default moves to its first model on when its own is off.
 * `settings` keeps every model, for the page that switches them.
 */
export function offeredModels<T extends { instanceId: string; models: ModelsOf }>(
  instances: readonly T[],
  context: EngineOfferContext,
  switches: ModelSwitches | null | undefined,
  purpose: "pick" | "settings" = "pick",
): T[] {
  const engines = offeredEngines(instances, context, purpose);
  if (purpose === "settings" || (!switches?.org?.length && !switches?.mine?.length)) return engines;
  const out: T[] = [];
  for (const instance of engines) {
    const all = instance.models?.options ?? [];
    const options = all.filter((option) => modelOn(switches, instance.instanceId, option.id));
    if (all.length > 0 && options.length === 0) continue;
    if (options.length === all.length) { out.push(instance); continue; }
    const fallback = options.some((option) => option.id === instance.models.default) ? instance.models.default : options[0]?.id ?? instance.models.default;
    out.push({ ...instance, models: { ...instance.models, default: fallback, options } });
  }
  return out;
}
