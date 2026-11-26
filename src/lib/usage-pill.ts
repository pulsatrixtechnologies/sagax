// The usage pill (owner 2026-11-26, M-20261126-096, M-20261126-099, #5406):
// what it reads and what it says. Pure rules; the pill is
// src/components/UsagePill.tsx and its detail
// src/components/UsageAccountsDetail.tsx.
//
// The pill never reads the serving account alone: it sums every account that
// can serve the bot, so one full account says nothing alarming while others
// take the turns over. Which accounts those are is no new verdict: the
// server's usage-limit takeover names the engines it may move a turn to
// (`serves` of GET /api/bots/<id>/auto-model, limitServingPool), the plan
// report gives each account's windows (GET /api/plan-usage), and the limit
// report says which engine refuses work now (GET /api/limit-resets).
//
// The sum, per window (the week, the short session):
//   - weighted by plan when the app knows every account's plan size, on one
//     scale (accounts of one provider whose plans name their size: Claude
//     Pro 1, Max 5x 5, Max 20x 20); else the mean of the percentages;
//   - an account with no such window (no 5-hour limit) counts as 0% used of
//     it: that window never stops it;
//   - an engine with no window at all (a local model, a key) is in no sum,
//     but it can serve, so nothing is "blocked" while it is free.
// The pill names the fuller of the two sums ("wk 44%", "5h 20%"), and says
// "back <day> <hour>" only when every account refuses work.
import { t } from "@/lib/i18n";
import { clockLocale } from "@/lib/limit-failover";
import { accountRowName, type PlanRow, type PlanWindow } from "@/lib/plan-usage";
import { nearLimit, type EngineLimit } from "../../shared/limit-reset";

/** One account (or engine) that can serve the bot. */
export interface UsageAccount {
  id: string;
  /** "Claude · ada@acme.example": the provider, then the account's own name. */
  name: string;
  plan: string | null;
  /** The share used, 0 to 100; null when the account has no such window. */
  fiveHour: number | null;
  weekly: number | null;
  /** The short window's length in hours, as the vendor sets it. */
  hours: number;
  /** It runs this conversation's turns now. */
  serving: boolean;
  /** It refuses work now: a window at its limit, or a hold of the limit report. */
  blocked: boolean;
  /** When it serves again (epoch ms); null when not blocked or not known. */
  backAt: number | null;
  /** Its plan's size on its provider's scale; null when the app does not know it. */
  weight: number | null;
  driver: string;
  /** The plan row behind it (its star, its note), when it has one. */
  row?: PlanRow;
}

/** Plans whose name says their size, per provider (an agent's choice, #5406):
 * the multiples the vendor publishes. A plan not listed has no known size. */
const PLAN_WEIGHTS: Record<string, Record<string, number>> = {
  claude: { "Pro": 1, "Max 5x": 5, "Max 20x": 20 },
};

export function planWeight(driver: string, plan: string | null): number | null {
  return plan ? PLAN_WEIGHTS[driver]?.[plan] ?? null : null;
}

const clamp = (percent: number) => Math.min(100, Math.max(0, percent));

function usedOf(window: PlanWindow): number | null {
  if (!window.available) return null;
  const used = window.usedPercent ?? (window.remainingPercent === null ? null : 100 - window.remainingPercent);
  return used === null || !Number.isFinite(used) ? null : clamp(used);
}

function stamp(resetsAt: string | null): number | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  return Number.isFinite(at) ? at : null;
}

const idsOf = (row: PlanRow) => (row.instanceIds?.length ? row.instanceIds : row.instanceId ? [row.instanceId] : []);

/** The latest of the times given, null with none. */
const latest = (times: Array<number | null>) => times.reduce<number | null>((max, at) => (at !== null && (max === null || at > max) ? at : max), null);

function accountOfRow(row: PlanRow, engine: string | undefined, limits: readonly EngineLimit[], now: number): UsageAccount {
  const ids = idsOf(row);
  const fiveHour = row.state === "windows" ? usedOf(row.fiveHour) : null;
  const weekly = row.state === "windows" ? usedOf(row.weekly) : null;
  const held = limits.filter((limit) => limit.blocked && ids.includes(limit.engine));
  const full = [
    fiveHour !== null && fiveHour >= 100 ? stamp(row.fiveHour.resetsAt) : null,
    weekly !== null && weekly >= 100 ? stamp(row.weekly.resetsAt) : null,
  ];
  const blocked = held.length > 0 || (fiveHour !== null && fiveHour >= 100) || (weekly !== null && weekly >= 100);
  const back = latest([...full, ...held.map((limit) => limit.resetsAt)]);
  return {
    id: row.id,
    name: accountRowName(row),
    plan: row.plan,
    fiveHour,
    weekly,
    hours: row.fiveHour.hours ?? 5,
    serving: Boolean(engine) && ids.includes(engine!),
    blocked,
    backAt: blocked && back !== null && back > now ? back : null,
    weight: planWeight(row.driver, row.plan),
    driver: row.driver,
    row,
  };
}

/** An engine the plan report has no window for (a local model, a key the
 * person chose as a backup): it can serve, with no figure. Near its limit or
 * at it, the limit report's own share is its figure, as the limit dot showed
 * it (#5372 review); a refusal with no share reported stays without one. */
function accountOfEngine(engine: string, name: string, serving: boolean, limit: EngineLimit | undefined, now: number): UsageAccount {
  const blocked = Boolean(limit?.blocked);
  const used = limit && nearLimit(limit) && limit.usedPercent !== null && Number.isFinite(limit.usedPercent) ? clamp(limit.usedPercent) : null;
  return {
    id: `engine:${engine}`,
    name,
    plan: null,
    fiveHour: limit?.window === "5-hour" ? used : null,
    weekly: limit?.window === "5-hour" ? null : used,
    hours: 5,
    serving,
    blocked,
    backAt: blocked && limit?.resetsAt != null && limit.resetsAt > now ? limit.resetsAt : null,
    weight: null,
    driver: limit?.driver ?? "",
  };
}

/** The accounts that can serve a bot's conversation. `serves`: the engines
 * the server's takeover may move a turn to; absent (an older server, not read
 * yet), the accounts of the serving engine's provider answer, the rotation
 * the takeover tries first. `engine`: the one the conversation runs on now,
 * always in the list. */
export function servingAccounts(input: {
  rows: readonly PlanRow[];
  serves?: readonly string[];
  engine?: string;
  /** The serving engine's provider, for a report with no instance ids. */
  driver?: string;
  limits?: readonly EngineLimit[];
  engineName?: (engine: string) => string;
  now?: number;
}): UsageAccount[] {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? [];
  const metered = input.rows.filter((row) => row.state === "windows");
  const own = metered.filter((row) => {
    const ids = idsOf(row);
    return ids.length ? Boolean(input.engine) && ids.includes(input.engine!) : Boolean(input.driver) && row.driver === input.driver;
  });
  const pool = input.serves?.length ? [...new Set([...(input.engine ? [input.engine] : []), ...input.serves])] : null;
  let rows: PlanRow[];
  if (pool) rows = metered.filter((row) => own.includes(row) || idsOf(row).some((id) => pool.includes(id)));
  else {
    const drivers = new Set([...own.map((row) => row.driver), ...(input.driver ? [input.driver] : [])]);
    rows = metered.filter((row) => own.includes(row) || drivers.has(row.driver));
  }
  const accounts = rows.map((row) => accountOfRow(row, input.engine, limits, now));
  const covered = new Set(rows.flatMap(idsOf));
  const unmetered = (engine: string) => {
    const limit = limits.find((candidate) => candidate.engine === engine);
    return accountOfEngine(engine, limit?.name ?? input.engineName?.(engine) ?? engine, engine === input.engine, limit, now);
  };
  if (pool) {
    for (const engine of pool) if (!covered.has(engine)) accounts.push(unmetered(engine));
  } else if (input.engine && !own.length) {
    // the pool is not known and the plan report has no window for the serving
    // engine: its own limit answers once it is near (no data, no account)
    const account = unmetered(input.engine);
    if (account.blocked || account.fiveHour !== null || account.weekly !== null) accounts.push(account);
  }
  return accounts;
}

/** Every signed-in account with a window, for a place that names no bot (the
 * account menu's Usage). */
export function allAccounts(rows: readonly PlanRow[], limits: readonly EngineLimit[] = [], now = Date.now()): UsageAccount[] {
  return rows.filter((row) => row.state === "windows").map((row) => accountOfRow(row, undefined, limits, now));
}

export interface UsageCumul {
  /** The week used, every account together, 0 to 100; null with no week read. */
  weekly: number | null;
  fiveHour: number | null;
  /** The sum is weighted by plan; false: the mean of the percentages. */
  weighted: boolean;
}

/** The share used of what every account together offers, per window. */
export function usageCumul(accounts: readonly UsageAccount[]): UsageCumul {
  const metered = accounts.filter((account) => account.weekly !== null || account.fiveHour !== null);
  const weighted = metered.length > 1 && metered.every((account) => account.weight !== null && account.driver === metered[0]!.driver);
  const sum = (read: (account: UsageAccount) => number | null): number | null => {
    if (!metered.some((account) => read(account) !== null)) return null;
    let used = 0;
    let room = 0;
    for (const account of metered) {
      const weight = weighted ? account.weight! : 1;
      used += weight * (read(account) ?? 0);
      room += weight;
    }
    return room > 0 ? clamp(used / room) : null;
  };
  return { weekly: sum((account) => account.weekly), fiveHour: sum((account) => account.fiveHour), weighted };
}

export type UsageWindowName = "weekly" | "five-hour";
export type MeasureTone = "quiet" | "warning" | "danger";

/** A measure's colour: quiet while there is room, warning from 75%, danger when full. */
export function measureTone(percent: number | null): MeasureTone {
  if (percent === null) return "quiet";
  return percent >= 100 ? "danger" : percent >= WARNING_FROM ? "warning" : "quiet";
}
export const WARNING_FROM = 75;

/** What the pill shows: its three measures and its text. Everything a place
 * outside the chat bar needs to draw it (the menu bar draws it as an image). */
export interface UsagePillValues {
  /** The week, every account together, 0 to 100; null: not read. */
  week: number | null;
  /** The short session, every account together. */
  fiveHour: number | null;
  /** The share of the model's window this conversation uses. */
  context: number | null;
  /** The named figure: the fuller of the two account limits. */
  named: { window: UsageWindowName; percent: number; hours: number } | null;
  /** Every account that can serve refuses work now. */
  blocked: boolean;
  /** When the first account serves again; null when not blocked or not known. */
  backAt: number | null;
  /** Accounts free to serve, of all that can. */
  free: number;
  total: number;
  tone: MeasureTone;
  /** "back Sat 9 PM", only when every account is blocked and a return is known; else empty. */
  back: string;
  /** "wk 44%", "5h 20%", "wk 100% · back Sat 9 PM"; empty with no figure. */
  text: string;
}

/** A return time as the pill says it: the day, then the hour ("Sat 9 PM",
 * "sam. 21 h"), the minutes only when there are some. */
export function backText(at: number, locale = clockLocale(), timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  try {
    const day = new Intl.DateTimeFormat(locale, { weekday: "short", ...zone }).format(at);
    const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...zone }).format(at);
    // "21 h 00" reads "21 h", "9:00 PM" reads "9 PM"; other minutes stay
    return `${day} ${clock.replace(/[:\s]00(?!\d)/, "")}`;
  } catch {
    return `${new Date(at).toISOString().slice(11, 16)} UTC`;
  }
}

/** "wk 44%", "5h 20%": a window's figure with its short name. */
export function windowFigure(window: UsageWindowName, percent: number, hours = 5): string {
  return window === "weekly" ? t("usagePill.week", { percent }) : t("usagePill.session", { hours, percent });
}

/** The pure function of the pill: the three values and the text. `context`:
 * the conversation's share of its model's window, null when not shown or not
 * measured. */
export function usagePill(input: { accounts: readonly UsageAccount[]; context?: number | null; now?: number; locale?: string; timeZone?: string }): UsagePillValues {
  const { accounts } = input;
  const cumul = usageCumul(accounts);
  const total = accounts.length;
  const free = accounts.filter((account) => !account.blocked).length;
  const blocked = total > 0 && free === 0;
  // a sum of every account: full only when every account is; a rounding never says so before
  const shown = (percent: number | null) => (percent === null ? null : blocked ? Math.round(percent) : Math.min(99, Math.round(percent)));
  const week = shown(cumul.weekly);
  const fiveHour = shown(cumul.fiveHour);
  const hours = accounts.find((account) => account.fiveHour !== null)?.hours ?? 5;
  const named = week === null && fiveHour === null ? null
    : (week ?? -1) >= (fiveHour ?? -1) ? { window: "weekly" as const, percent: week!, hours }
      : { window: "five-hour" as const, percent: fiveHour!, hours };
  const backs = accounts.map((account) => account.backAt).filter((at): at is number => at !== null);
  const backAt = blocked && backs.length ? Math.min(...backs) : null;
  const context = input.context === null || input.context === undefined || !Number.isFinite(input.context) ? null : Math.max(0, Math.round(input.context));
  const back = backAt !== null ? t("usagePill.back", { time: backText(backAt, input.locale, input.timeZone) }) : "";
  const figure = named ? windowFigure(named.window, named.percent, named.hours) : "";
  return {
    week, fiveHour, context, named, blocked, backAt, free, total,
    tone: blocked ? "danger" : measureTone(named?.percent ?? null),
    back,
    text: [figure, back].filter(Boolean).join(" · "),
  };
}

/** How many account rows the detail shows before it folds. */
export const DETAIL_ROWS = 3;

export interface UsageDetailLayout {
  /** The free accounts in sight: the serving one first, then the most room. */
  free: UsageAccount[];
  /** The free accounts past the third row, folded. */
  moreFree: UsageAccount[];
  /** The accounts at their limit, folded below (open when nothing is free). */
  limited: UsageAccount[];
}

const fuller = (account: UsageAccount) => Math.max(account.weekly ?? 0, account.fiveHour ?? 0);

/** The detail's rows: the free accounts first (the serving one, then the one
 * with the most room), the accounts at their limit below (the first back
 * first), a fold past `max` rows. */
export function usageDetailLayout(accounts: readonly UsageAccount[], max = DETAIL_ROWS): UsageDetailLayout {
  const order = accounts.map((account, index) => ({ account, index }));
  const free = order.filter((entry) => !entry.account.blocked)
    .sort((a, b) => Number(b.account.serving) - Number(a.account.serving) || fuller(a.account) - fuller(b.account) || a.index - b.index)
    .map((entry) => entry.account);
  const limited = order.filter((entry) => entry.account.blocked)
    .sort((a, b) => Number(b.account.serving) - Number(a.account.serving) || (a.account.backAt ?? Infinity) - (b.account.backAt ?? Infinity) || a.index - b.index)
    .map((entry) => entry.account);
  return { free: free.slice(0, max), moreFree: free.slice(max), limited };
}
