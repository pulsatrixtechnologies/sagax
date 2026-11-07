import { EFFORT_LEVELS, type EffortLevel } from "./wire.ts";

/** Claude Code's dynamic workflow mode (`--effort ultracode`). Stored on the
 * wire like any other effort; non-Claude engines map it at turn time. */
export const ULTRACODE_EFFORT = "ultracode" as const satisfies EffortLevel;

export function isUltracodeEffort(effort: EffortLevel | undefined): boolean {
  return effort === ULTRACODE_EFFORT;
}

/** Levels a driver natively advertises (never includes ultracode). */
export const NATIVE_EFFORT_LEVELS = EFFORT_LEVELS.filter((level) => level !== ULTRACODE_EFFORT);

/** Whether the engine itself offers Ultracode: only a driver that lists it
 * in `capabilities.effortLevels` (Claude Code) and has a native level too. */
export function engineOffersUltracode(levels: readonly EffortLevel[] | undefined): boolean {
  const all = levels ?? [];
  return all.includes(ULTRACODE_EFFORT) && all.some((level) => level !== ULTRACODE_EFFORT);
}

/** Picker rows: native levels, plus Ultracode only when the engine offers it. */
export function pickerEffortLevels(levels: readonly EffortLevel[]): EffortLevel[] {
  const native = levels.filter((level) => level !== ULTRACODE_EFFORT);
  if (native.length === 0) return [];
  return engineOffersUltracode(levels) ? [...native, ULTRACODE_EFFORT] : native;
}

/** Whether a stored selection is valid for this engine's offered levels. */
export function effortAcceptedByEngine(effort: EffortLevel, levels: readonly EffortLevel[]): boolean {
  if (isUltracodeEffort(effort)) return engineOffersUltracode(levels);
  return levels.includes(effort);
}

/** A stored Ultracode on an engine that does not offer it (a bot set before
 * Ultracode was reserved to Claude, or moved to another engine) runs at the
 * engine's highest native level instead of failing the turn. */
export function effortForEngine(effort: EffortLevel | undefined, levels: readonly EffortLevel[] | undefined): EffortLevel | undefined {
  if (!effort || !isUltracodeEffort(effort) || engineOffersUltracode(levels)) return effort;
  return maxNativeEffort(levels ?? []);
}

/** Highest reasoning level the engine offers (for ultracode on non-Claude). */
export function maxNativeEffort(levels: readonly EffortLevel[]): EffortLevel | undefined {
  const native = levels.filter((level) => level !== ULTRACODE_EFFORT);
  if (native.includes("max")) return "max";
  if (native.includes("xhigh")) return "xhigh";
  if (native.includes("high")) return "high";
  return native.at(-1);
}

/** What the engine driver receives for this turn. */
export function resolveEngineTurnEffort(
  effort: EffortLevel | undefined,
  driverKind: string,
  levels: readonly EffortLevel[] | undefined,
): EffortLevel | undefined {
  if (!effort) return undefined;
  if (!isUltracodeEffort(effort)) return effort;
  if (driverKind === "claudeAgent") return ULTRACODE_EFFORT;
  return maxNativeEffort(levels ?? []);
}
