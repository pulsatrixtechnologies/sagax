// Settings > Usage (2026-10-14): the signed-in person's own usage only. The
// organization's totals, per-person tables, budgets and prices live in its
// admin console (Sagax Business). Pure helpers, so the page is tested
// without a server: the periods asked of GET /api/me/usage, the cost of
// a period, its trend against the period before, the 30-day sparkline and
// the top of a breakdown.
import { activeLocale } from "@/lib/i18n";

export interface PersonalUsageGroup {
  key: string;
  label: string;
  turns: number;
  costUsd: number | null;
  estimatedUsd?: number | null;
}

export interface PersonalUsageSummary {
  groups: PersonalUsageGroup[];
  total: PersonalUsageGroup;
}

const DAY_MS = 24 * 60 * 60_000;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** This month so far, the same days of last month, and the last 30 days
 * (inclusive UTC days, as the ledger stores them). */
export function personalUsagePeriods(now = new Date()): {
  month: { from: string; to: string };
  previous: { from: string; to: string };
  days30: { from: string; to: string };
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const lastDayOfPrevious = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sameDay = Math.min(now.getUTCDate(), lastDayOfPrevious);
  return {
    month: { from: day(new Date(Date.UTC(year, month, 1))), to: day(now) },
    previous: { from: day(new Date(Date.UTC(year, month - 1, 1))), to: day(new Date(Date.UTC(year, month - 1, sameDay))) },
    days30: { from: day(new Date(now.getTime() - 29 * DAY_MS)), to: day(now) },
  };
}

/** The whole of last month (the previous billing cycle: the calendar month,
 * as the ledger counts), first to last day. */
export function previousCyclePeriod(now = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return { from: day(new Date(Date.UTC(year, month - 1, 1))), to: day(new Date(Date.UTC(year, month, 0))) };
}

/** GET /api/me/usage (Sagax 0.5.4 and later); `legacy`: GET /api/usage?mine=1,
 * the same person's own turns on a 0.5.3 server, which lacks the first. */
export function usageQuery(range: { from: string; to: string }, groupBy: "day" | "bot" | "model" | "engine", legacy = false): string {
  const query = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&groupBy=${groupBy}`;
  return legacy ? `/api/usage?mine=1&${query}` : `/api/me/usage?${query}`;
}

export const costOf = (summary: PersonalUsageSummary | null | undefined): number =>
  typeof summary?.total.costUsd === "number" && Number.isFinite(summary.total.costUsd) ? summary.total.costUsd : 0;

/** Percent change against the period before; null when there was nothing before. */
export function costTrend(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** One cost per day of the 30-day range, oldest first; a day with no turn is 0. */
export function dailyCosts(summary: PersonalUsageSummary | null | undefined, range: { from: string; to: string }): number[] {
  // the ledger keys a day "day:YYYY-MM-DD" and labels it "YYYY-MM-DD"
  const byDay = new Map((summary?.groups ?? []).map((group) => [group.key.replace(/^day:/, "").slice(0, 10), typeof group.costUsd === "number" ? group.costUsd : 0]));
  const out: number[] = [];
  for (let at = Date.parse(`${range.from}T00:00:00Z`); at <= Date.parse(`${range.to}T00:00:00Z`); at += DAY_MS) {
    out.push(byDay.get(day(new Date(at))) ?? 0);
  }
  return out;
}

/** The groups with the most cost (then turns) first. */
export function rankedGroups(summary: PersonalUsageSummary | null | undefined): PersonalUsageGroup[] {
  return [...(summary?.groups ?? [])].sort((a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1) || b.turns - a.turns);
}

/** Dates and money as people read them here: Quebec French for French. */
export function usageLocale(): string {
  const locale = activeLocale();
  return locale === "fr" ? "fr-CA" : locale;
}

export function formatCost(usd: number): string {
  try {
    return new Intl.NumberFormat(usageLocale(), { style: "currency", currency: "USD", maximumFractionDigits: usd > 0 && usd < 0.01 ? 3 : 2 }).format(usd);
  } catch {
    return `$${usd.toFixed(2)}`;
  }
}

export function formatDay(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  try {
    return new Intl.DateTimeFormat(usageLocale(), { day: "numeric", month: "long" }).format(at);
  } catch {
    return iso.slice(0, 10);
  }
}

/** The personal monthly spend limit as GET /api/me/spend-cap answers it. */
export interface PersonalSpendCap {
  supported: boolean;
  minUsd: number;
  cap: { month: string; monthlyUsd: number; spentUsd: number; percent: number; warn: boolean; exceeded: boolean } | null;
}

/** What the person typed ("25", "25,50", "$25") as dollars; null when it is
 * not a number or under the minimum. */
export function parseCapInput(text: string, minUsd = 1): number | null {
  const cleaned = text.trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= minUsd ? value : null;
}
