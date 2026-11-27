/** #5367: how full the last measured context is, as a percent of its window.
 * Undefined when the turn has not reported tokens or a window yet. */

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function contextUsagePercent(context: { tokens?: number; window?: number } | null | undefined): number | undefined {
  if (!positive(context?.tokens) || !positive(context?.window)) return undefined;
  return Math.min(100, Math.round((100 * context.tokens) / context.window));
}
