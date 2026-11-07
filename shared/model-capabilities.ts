// What one model of an engine accepts (2026-10-13): its reasoning
// efforts and its default effort, and its fast twin. The engines say it per
// model (Grok's initialize `reasoningEfforts`, Codex's model/list
// `supportedReasoningEfforts`, Claude Code's initialize
// `supportedEffortLevels`); each driver copies it onto its catalog rows
// (ModelCatalog option `effortLevels`, `defaultEffort`) and every surface,
// server and app, reads it through these functions only.
import { isEffortLevel, type EffortLevel } from "./wire.ts";
import { effortAcceptedByEngine, engineOffersUltracode, NATIVE_EFFORT_LEVELS, ULTRACODE_EFFORT } from "./ultracode-effort.ts";

export interface ModelEffortFacts {
  /** Native levels this model takes, ascending. `[]`: the model has no
   * effort control. Absent: unknown, the engine's levels apply. */
  effortLevels?: readonly EffortLevel[];
  /** The level the engine uses when none is sent. */
  defaultEffort?: EffortLevel;
}

/** Native levels for this model, ascending, within what the engine's driver
 * can pass (`capabilities.effortLevels`). Never includes Ultracode. */
export function modelNativeEffortLevels(option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): EffortLevel[] {
  const engine = (engineLevels ?? []).filter((level) => level !== ULTRACODE_EFFORT);
  if (!option?.effortLevels) return engine;
  return engine.filter((level) => option.effortLevels!.includes(level));
}

/** The levels a picker offers for this model: its native levels, plus
 * Ultracode only when the engine offers it (Claude Code). Empty: no control. */
export function modelEffortLevels(option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): EffortLevel[] {
  const native = modelNativeEffortLevels(option, engineLevels);
  if (native.length === 0) return [];
  return engineOffersUltracode(engineLevels) ? [...native, ULTRACODE_EFFORT] : native;
}

/** The level this model runs at when the selection sends none, if known. */
export function modelDefaultEffort(option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): EffortLevel | undefined {
  const effort = option?.defaultEffort;
  return effort && modelNativeEffortLevels(option, engineLevels).includes(effort) ? effort : undefined;
}

/** Whether a stored level is valid for this model on this engine. */
export function effortAcceptedByModel(effort: EffortLevel, option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): boolean {
  if (effort === ULTRACODE_EFFORT) return engineOffersUltracode(engineLevels) && modelNativeEffortLevels(option, engineLevels).length > 0;
  return effortAcceptedByEngine(effort, modelNativeEffortLevels(option, engineLevels));
}

/** The level kept when moving onto this model: the same one when the model
 * takes it, else none (the model's own default runs). */
export function effortForModel(effort: EffortLevel | undefined, option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): EffortLevel | undefined {
  return effort && effortAcceptedByModel(effort, option, engineLevels) ? effort : undefined;
}

/** What a turn runs at: the level asked, else the model's default. */
export function effectiveEffort(effort: EffortLevel | undefined, option: ModelEffortFacts | undefined, engineLevels: readonly EffortLevel[] | undefined): EffortLevel | undefined {
  return effortForModel(effort, option, engineLevels) ?? modelDefaultEffort(option, engineLevels);
}

/** Read an engine's per-model effort list and default into facts. Accepts
 * strings or `{ id | value | reasoningEffort, default }` records; levels
 * Sagax does not know are dropped and the rest sorted ascending. `supported`
 * false means the model takes no effort. */
export function parseModelEffortFacts(levels: unknown, defaultEffort?: unknown, supported?: unknown): ModelEffortFacts {
  if (supported === false) return { effortLevels: [] };
  if (!Array.isArray(levels)) return {};
  const found = new Set<EffortLevel>();
  let marked: EffortLevel | undefined;
  for (const entry of levels) {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : undefined;
    const raw = typeof entry === "string" ? entry : record?.value ?? record?.id ?? record?.reasoningEffort;
    if (!isEffortLevel(raw) || raw === ULTRACODE_EFFORT) continue;
    found.add(raw);
    if (record?.default === true) marked = raw;
  }
  const effortLevels = NATIVE_EFFORT_LEVELS.filter((level) => found.has(level));
  const fallback = isEffortLevel(defaultEffort) && found.has(defaultEffort) ? defaultEffort : undefined;
  const chosen = marked ?? fallback;
  return { effortLevels, ...(chosen ? { defaultEffort: chosen } : {}) };
}

// ── fast twins ───────────────────────────────────────────────────────────
// An engine that sells a faster copy of a model lists it as its own id
// (Grok: `grok-4.7-build-fast`, "Fast variant. 2x the price."). The picker
// folds the twin into its model's row and offers a Fast switch.

const FAST_SUFFIXES = ["-build-fast", "-fast"] as const;

type IdRow = { id: string };

/** The base model of a fast twin listed in the same catalog, if any. */
export function fastBaseOf(options: readonly IdRow[], id: string): string | undefined {
  for (const suffix of FAST_SUFFIXES) {
    if (!id.endsWith(suffix)) continue;
    const base = id.slice(0, -suffix.length);
    if (base && options.some((option) => option.id === base)) return base;
  }
  return undefined;
}

/** The fast twin of a model listed in the same catalog, if any. */
export function fastTwinOf(options: readonly IdRow[], id: string): string | undefined {
  if (fastBaseOf(options, id)) return undefined;
  for (const suffix of FAST_SUFFIXES) {
    const twin = `${id}${suffix}`;
    if (options.some((option) => option.id === twin)) return twin;
  }
  return undefined;
}
