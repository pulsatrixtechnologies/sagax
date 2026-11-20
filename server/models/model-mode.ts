// Composer modes (#4900, #5088): Fast, Expert and Heavy each map, every turn,
// to the best models this person can use. The owner's rules, verbatim: choose
// automatically the best models available for the interface; in Expert,
// prioritize the best model of each provider; when there is only one, take the
// strongest one with agents, as Grok does.
//
// The ranking stays the one Auto uses (model-auto.ts: TIER_TABLE per family,
// the catalogue's facts, ENGINE_ORDER); this module only adds what a mode
// needs on top of it:
//   - the best model of EACH provider (an engine that serves several vendors,
//     pi or OpenCode, is split by vendor first), then the providers ranked
//     against each other by what the catalogue says a model costs, the one
//     measure that compares a Claude, an OpenAI and a Grok model;
//   - the rows the catalogue never lists (a local model, a model server's
//     row), ranked by their own size, after everything the catalogue knows.
// Pure: the engines, their rows and the catalogue are passed in, as for Auto.
import type { EffortLevel, ModelSelection } from "../../shared/model-selection.ts";
import { effortAcceptedByEngine } from "../../shared/ultracode-effort.ts";
import {
  FORCED_MODEL_MODES, HEAVY_MAX_AGENTS, HEAVY_SINGLE_PROVIDER_AGENTS,
  type ForcedModelMode, type ModeModel, type ModeResolution, type ModelMode,
} from "../../shared/model-mode.ts";
import { providerOfModel } from "../../shared/model-provider.ts";
import {
  ENGINE_ORDER, candidatePrice, modelForTier, newestFirst, orderEngines, pickFast, pickOrchestrationModel,
  type AutoChainEntry, type AutoEngine, type AutoPick, type AutoRequest, type Candidate, type Tier,
} from "./model-auto.ts";

/** The tier each mode reads in TIER_TABLE (Heavy's Leader is the Expert pick). */
export const MODE_TIER: Readonly<Record<ForcedModelMode, Tier>> = { fast: "fast", expert: "top", heavy: "top" };

/** The reasoning level each mode asks for, best first: the first one the
 * engine offers. */
const MODE_EFFORT: Readonly<Record<ForcedModelMode, readonly EffortLevel[]>> = {
  fast: ["low", "medium"],
  expert: ["high", "xhigh", "medium"],
  heavy: ["high", "xhigh", "medium"],
};

/** Heavy's agents think a step lighter than the Leader, so the team answers in seconds. */
const AGENT_EFFORT: readonly EffortLevel[] = ["medium", "high", "low"];

export function effortForMode(wanted: readonly EffortLevel[], levels: readonly EffortLevel[] | undefined): EffortLevel | undefined {
  return wanted.find((level) => effortAcceptedByEngine(level, levels ?? []));
}

/** One model a mode may run, with the provider it belongs to. */
export interface Contender {
  engine: AutoEngine;
  id: string;
  label: string;
  providerId: string;
  /** The catalogue ranked it; absent for a local or server row. */
  candidate?: Candidate;
  /** A row's size in billions of parameters, read from its name (local rows only). */
  size?: { total?: number; active?: number; context: number };
}

// ── the best model of each provider ──────────────────────────────────────

type Row = AutoEngine["models"]["options"][number];

function providerIdOf(engine: AutoEngine, row: { id: string; custom?: boolean }): string {
  return providerOfModel(engine, { id: row.id, ...(row.custom ? { custom: true } : {}) }).id;
}

/** An engine's rows, one slice per provider they belong to. */
function sliceByProvider(engine: AutoEngine, rows: readonly Row[], custom: boolean): Array<{ providerId: string; engine: AutoEngine; rows: Row[] }> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const id = providerIdOf(engine, { id: row.id, custom });
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups].map(([providerId, list]) => ({ providerId, engine: { ...engine, models: { ...engine.models, options: list } }, rows: list }));
}

/** Parameters in billions, read from the name of a local row ("Qwen3.5-122B-A10B":
 * 122 in all, 10 active). Rows that say nothing keep only their context. */
export function localSize(row: { id: string; label: string; contextWindow?: number }): NonNullable<Contender["size"]> {
  const text = `${row.id} ${row.label}`.toLowerCase();
  const active = /(?<![a-z0-9.])a(\d+(?:\.\d+)?)b(?![a-z])/.exec(text);
  const totals = [...text.matchAll(/(?<![a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z])/g)].map((match) => Number(match[1]));
  return {
    ...(totals.length ? { total: Math.max(...totals) } : {}),
    ...(active ? { active: Number(active[1]) } : {}),
    context: row.contextWindow ?? 0,
  };
}

function localOrder(tier: Tier): (a: Contender, b: Contender) => number {
  const total = (c: Contender) => c.size?.total ?? 0;
  const speed = (c: Contender) => c.size?.active ?? c.size?.total ?? Number.POSITIVE_INFINITY;
  // a model under 7B is quick but rarely good: it only leads when nothing larger exists
  const good = (c: Contender) => (c.size?.total ?? Number.POSITIVE_INFINITY) >= 7;
  const byId = (a: Contender, b: Contender) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const strongest = (a: Contender, b: Contender) => total(b) - total(a) || (b.size?.context ?? 0) - (a.size?.context ?? 0) || byId(a, b);
  if (tier === "fast") return (a, b) => Number(good(b)) - Number(good(a)) || speed(a) - speed(b) || strongest(a, b);
  return strongest;
}

const engineRank = (engine: AutoEngine, baseInstanceId: string): number => {
  if (engine.instanceId === baseInstanceId) return -1;
  const index = ENGINE_ORDER.indexOf(engine.driverKind);
  return index >= 0 ? index : ENGINE_ORDER.length;
};

/** The best model of each provider for one tier: the catalogue's pick on the
 * provider's best engine, else (a provider with no ranked model) its best
 * local or server row. Unordered between providers. */
export function bestPerProvider(request: AutoRequest, tier: Tier): Contender[] {
  const skip = request.skip ?? [];
  const skipped = (engine: AutoEngine, id: string) => skip.some((entry: AutoChainEntry) => entry.instanceId === engine.instanceId && entry.model === id);
  const engines = orderEngines(request.engines, request.base.instanceId);
  const ranked = new Map<string, Contender>();
  const unranked = new Map<string, Contender>();
  for (const engine of engines) {
    for (const slice of sliceByProvider(engine, engine.models.options, false)) {
      const candidate = modelForTier(slice.engine, tier, request.catalog, skip);
      // engines come in the bot's own first, then ENGINE_ORDER: the first one of a provider stays
      if (candidate && !ranked.has(slice.providerId)) {
        ranked.set(slice.providerId, { engine, id: candidate.id, label: candidate.label, providerId: slice.providerId, candidate });
      }
    }
    const rows: Row[] = (engine.unranked ?? [])
      .filter((row) => !skipped(engine, row.id) && !/unverified/i.test(row.label))
      .map((row) => ({ id: row.id, label: row.label, ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}) }));
    for (const slice of sliceByProvider(engine, rows, true)) {
      const found = slice.rows.map((row): Contender => ({ engine, id: row.id, label: row.label, providerId: slice.providerId, size: localSize(row) }));
      const kept = unranked.get(slice.providerId);
      const best = [...(kept ? [kept] : []), ...found].toSorted(localOrder(tier))[0];
      if (best) unranked.set(slice.providerId, best);
    }
  }
  return [...ranked.values(), ...[...unranked].filter(([providerId]) => !ranked.has(providerId)).map(([, contender]) => contender)];
}

// ── ranking the providers against each other ─────────────────────────────

/** Strongest first: what the catalogue says the model costs, then how new it
 * is, then the engine order. Everything the catalogue ranks leads a local row. */
function strongerFirst(base: string): (a: Contender, b: Contender) => number {
  return (a, b) => {
    if (Boolean(a.candidate) !== Boolean(b.candidate)) return a.candidate ? -1 : 1;
    if (a.candidate && b.candidate) {
      return candidatePrice(b.candidate) - candidatePrice(a.candidate) || newestFirst(a.candidate, b.candidate)
        || engineRank(a.engine, base) - engineRank(b.engine, base);
    }
    return localOrder("top")(a, b);
  };
}

/** Quickest first: the cheapest model of the fast tier (a smaller model costs less and answers sooner). */
function fasterFirst(base: string): (a: Contender, b: Contender) => number {
  const price = (c: Contender) => (c.candidate ? candidatePrice(c.candidate) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY);
  return (a, b) => {
    if (Boolean(a.candidate) !== Boolean(b.candidate)) return a.candidate ? -1 : 1;
    if (!a.candidate || !b.candidate) return localOrder("fast")(a, b);
    const left = price(a);
    const right = price(b);
    if (left !== right) return left < right ? -1 : 1;
    return engineRank(a.engine, base) - engineRank(b.engine, base) || newestFirst(a.candidate, b.candidate);
  };
}

/** The providers' best models for a mode, the one that answers first. */
export function rankForMode(request: AutoRequest, mode: ForcedModelMode): Contender[] {
  const base = request.base.instanceId;
  const order = mode === "fast" ? fasterFirst(base) : strongerFirst(base);
  return bestPerProvider(request, MODE_TIER[mode]).toSorted(order);
}

// ── Heavy: the team ──────────────────────────────────────────────────────

const toModel = (contender: Contender): ModeModel => ({
  instanceId: contender.engine.instanceId, model: contender.id, engineLabel: contender.engine.displayName, modelLabel: contender.label,
});

/** The agents of a Team of Experts (the owner's rules): with several
 * providers the team is the best model of each, strongest first, at most
 * HEAVY_MAX_AGENTS; with one provider it is its strongest model, several
 * agents on it, as Grok does with its own. `ranked` is rankForMode(heavy). */
export function composeHeavyTeam(ranked: readonly Contender[]): ModeModel[] {
  const [first] = ranked;
  if (!first) return [];
  if (ranked.length >= 2) return ranked.slice(0, HEAVY_MAX_AGENTS).map(toModel);
  return Array.from({ length: HEAVY_SINGLE_PROVIDER_AGENTS }, () => toModel(first));
}

// ── the pick ─────────────────────────────────────────────────────────────

/** The turn's model for a mode, as an Auto pick (so a refusal climbs the same
 * chain), or null when no model is usable (the caller falls back on Auto). */
export function pickModeModel(request: AutoRequest, mode: ForcedModelMode): AutoPick | null {
  const { base } = request;
  // the person's own fast model (#1209) leads Fast, wherever it runs
  if (mode === "fast") {
    const own = pickFast(request, "orchestration", "fast");
    if (own) {
      const engine = request.engines.find((candidate) => candidate.instanceId === own.selection.instanceId);
      const effort = effortForMode(MODE_EFFORT.fast, engine?.effortLevels);
      return { ...own, reason: "mode", mode, selection: { ...own.selection, ...(effort ? { effort } : {}) } };
    }
  }
  const ranked = rankForMode(request, mode);
  const first = ranked[0];
  if (!first) return null;
  const selection: ModelSelection = { instanceId: first.engine.instanceId, model: first.id };
  const effort = effortForMode(MODE_EFFORT[mode], first.engine.effortLevels);
  if (effort) selection.effort = effort;
  else if (first.engine.instanceId === base.instanceId && base.effort && effortAcceptedByEngine(base.effort, first.engine.effortLevels ?? [])) selection.effort = base.effort;
  const own = request.engines.find((engine) => engine.instanceId === base.instanceId);
  const chain: AutoChainEntry[] = ranked.slice(0, 3).map((contender) => ({ instanceId: contender.engine.instanceId, model: contender.id }));
  const baseEntry: AutoChainEntry = { instanceId: base.instanceId, model: base.model };
  const baseUsable = Boolean(own?.models.options.some((option) => option.id === base.model));
  if (baseUsable && !chain.some((entry) => entry.instanceId === baseEntry.instanceId && entry.model === baseEntry.model)) chain.push(baseEntry);
  return {
    role: "orchestration",
    selection,
    engineLabel: first.engine.displayName,
    modelLabel: first.label,
    tier: MODE_TIER[mode],
    reason: "mode",
    mode,
    ...(first.engine.via ? { via: first.engine.via } : {}),
    ...(first.engine.instanceId !== base.instanceId ? { fromEngineLabel: own?.displayName ?? base.instanceId } : {}),
    chain,
    ...(mode === "heavy" ? { team: composeHeavyTeam(ranked) } : {}),
  };
}

/** The effort Heavy's agents run at on their engine. */
export function agentEffort(engine: Pick<AutoEngine, "effortLevels"> | undefined): EffortLevel | undefined {
  return effortForMode(AGENT_EFFORT, engine?.effortLevels);
}

/** What every mode would run for this person now (the picker's tooltips). */
export function resolveModes(request: AutoRequest): Record<ModelMode, ModeResolution> {
  const asModel = (pick: AutoPick): ModeModel => ({ instanceId: pick.selection.instanceId, model: pick.selection.model, engineLabel: pick.engineLabel, modelLabel: pick.modelLabel });
  const auto = pickOrchestrationModel(request);
  const out: Partial<Record<ModelMode, ModeResolution>> = {
    auto: { mode: "auto", pick: auto.reason === "base" && !auto.chain.length ? null : asModel(auto) },
  };
  for (const mode of FORCED_MODEL_MODES) {
    const pick = pickModeModel(request, mode);
    out[mode] = pick
      ? { mode, pick: asModel(pick), ...(pick.selection.effort ? { effort: pick.selection.effort } : {}), ...(pick.team ? { team: pick.team } : {}) }
      : { mode, pick: null };
  }
  return out as Record<ModelMode, ModeResolution>;
}
