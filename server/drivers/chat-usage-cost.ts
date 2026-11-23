/** xAI reports a request's cost as integer ticks, 10_000_000_000 per dollar. */
export const USD_TICKS_PER_DOLLAR = 10_000_000_000;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Dollars for one chat-completions usage object. A provider's own `cost`
 * wins. xAI's `cost_in_usd_ticks` is the fallback. Anything else is unpriced. */
export function chatUsageCostUsd(usage: { cost?: unknown; cost_in_usd_ticks?: unknown } | null | undefined): number | undefined {
  if (!usage) return undefined;
  if (finite(usage.cost)) return usage.cost;
  if (finite(usage.cost_in_usd_ticks)) return usage.cost_in_usd_ticks / USD_TICKS_PER_DOLLAR;
  return undefined;
}
