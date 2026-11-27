// The usage pill (owner 2026-11-26, M-20261126-096, M-20261126-099, #5406):
// what it reads and what it says. Pure rules; the pill is
// src/components/UsagePill.tsx and its detail
// src/components/UsageAccountsDetail.tsx.
//
// The pill never reads the serving account alone: it sums every account that
// can serve the bot, so one full account says nothing alarming while others
// take the turns over. It renders no verdict of its own (#5421 review): who
// can serve is the server's usage-limit takeover (`serves` of GET
// /api/bots/<id>/auto-model, limitServingPool, which follows the takeover's
// switch), whether an account refuses work is the server's limit report (GET
// /api/limit-resets, `blocked`: a full window with Claude's Extra Usage still
// free is not blocked, a refusal's hold is), and the plan report gives each
// account's windows (GET /api/plan-usage). The pill only adds them up.
//
// The sum, per window (the week, the short session): the mean of the
// percentages of the accounts that have that window. An account the limit
// report blocks brings no room: it counts as 100% in every window it has. An
// account with no such window (Codex has no 5-hour limit) is out of that
// window's sum. An engine with no window at all (a local model, a key) is in
// no sum. The plan's size is not weighed: the plan report names no size (a
// Claude plan reads "max", never "Max 5x" or "Max 20x").
// The pill names the fuller of the windows some free account still has
// ("wk 44%", "5h 20%"), says "back <day> <hour>" only when every account
// refuses work, and names the free engine when the only room left is one with
// no window ("wk 100% · Ollama free"). Until the server has said who can
// serve, nothing is called blocked.
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
  /** The server's limit report says it refuses work now; never a window's figure alone. */
  blocked: boolean;
  /** When it serves again (epoch ms), as the limit report says; null when not blocked or not known. */
  backAt: number | null;
  driver: string;
  /** An engine with no window the plan report reads as such (an API key): it has no limit. */
  unlimited?: boolean;
  /** The plan row behind it (its star, its note), when it has one. */
  row?: PlanRow;
}

const clamp = (percent: number) => Math.min(100, Math.max(0, percent));

function usedOf(window: PlanWindow): number | null {
  if (!window.available) return null;
  const used = window.usedPercent ?? (window.remainingPercent === null ? null : 100 - window.remainingPercent);
  return used === null || !Number.isFinite(used) ? null : clamp(used);
}

const idsOf = (row: PlanRow) => (row.instanceIds?.length ? row.instanceIds : row.instanceId ? [row.instanceId] : []);

/** The latest of the times given, null with none. */
const latest = (times: Array<number | null>) => times.reduce<number | null>((max, at) => (at !== null && (max === null || at > max) ? at : max), null);

function accountOfRow(row: PlanRow, engine: string | undefined, limits: readonly EngineLimit[], now: number): UsageAccount {
  const ids = idsOf(row);
  const fiveHour = row.state === "windows" ? usedOf(row.fiveHour) : null;
  const weekly = row.state === "windows" ? usedOf(row.weekly) : null;
  // the limit report's verdict for this login (#5421 review H1): a window at
  // 100% with Extra Usage left, or one a turn just worked past, is not blocked
  const held = limits.filter((limit) => limit.blocked && ids.includes(limit.engine));
  const blocked = held.length > 0;
  const back = latest(held.map((limit) => limit.resetsAt));
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
    driver: row.driver,
    row,
  };
}

/** An engine the plan report has no window for (a local model, a key the
 * person chose as a backup): it can serve, with no figure. Near its limit or
 * at it, the limit report's own share is its figure, as the limit dot showed
 * it (#5372 review); a refusal with no share reported stays without one. */
function accountOfEngine(engine: string, name: string, serving: boolean, limit: EngineLimit | undefined, now: number, unlimited: boolean): UsageAccount {
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
    driver: limit?.driver ?? "",
    ...(unlimited ? { unlimited: true } : {}),
  };
}

/** The accounts that can serve a bot's conversation. `serves`: the engines
 * the server's takeover may move a turn to; absent (an older server), the
 * accounts of the serving engine's provider answer, the rotation the takeover
 * tries first. `engine`: the one the conversation runs on now, always in the
 * list. */
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
  // a key's row: the plan report says it has no window, so it has no limit
  const keys = new Set(input.rows.filter((row) => row.state === "no-windows").flatMap(idsOf));
  const unmetered = (engine: string) => {
    const limit = limits.find((candidate) => candidate.engine === engine);
    return accountOfEngine(engine, limit?.name ?? input.engineName?.(engine) ?? engine, engine === input.engine, limit, now, keys.has(engine));
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

export interface UsageWindowSum {
  /** The share used, every account with this window together, 0 to 100. */
  used: number;
  /** A free account has this window: the sum bounds the room still offered. */
  live: boolean;
}

export interface UsageCumul {
  /** Null: no account has that window. */
  weekly: UsageWindowSum | null;
  fiveHour: UsageWindowSum | null;
}

/** The share used of what every account together offers, per window: the
 * mean of the accounts that have it, a blocked one counted as full (#5421
 * review M1: a blocked account brings no room in any window). */
export function usageCumul(accounts: readonly UsageAccount[]): UsageCumul {
  const sum = (read: (account: UsageAccount) => number | null): UsageWindowSum | null => {
    const part = accounts.filter((account) => read(account) !== null);
    if (!part.length) return null;
    const used = part.reduce((total, account) => total + (account.blocked ? 100 : read(account)!), 0) / part.length;
    return { used: clamp(used), live: part.some((account) => !account.blocked) };
  };
  return { weekly: sum((account) => account.weekly), fiveHour: sum((account) => account.fiveHour) };
}

export type UsageWindowName = "weekly" | "five-hour";
export type MeasureTone = "quiet" | "warning" | "danger";

export const WARNING_FROM = 75;

/** A usage measure's colour: danger only when what it measures refuses work
 * (the server's verdict, `blocked`), never on a figure alone; else warning
 * from 75%, quiet below. */
export function measureTone(percent: number | null, blocked = false): MeasureTone {
  if (blocked) return "danger";
  if (percent === null) return "quiet";
  return percent >= WARNING_FROM ? "warning" : "quiet";
}

/** The context measure's colour: warning from 75%, danger once the window is full. */
export function contextTone(percent: number | null): MeasureTone {
  if (percent === null) return "quiet";
  return percent >= 100 ? "danger" : percent >= WARNING_FROM ? "warning" : "quiet";
}

/** What the pill shows: its three measures and its text. Everything a place
 * outside the chat bar needs to draw it (the menu bar draws it as an image). */
export interface UsagePillValues {
  /** The week, every account together, 0 to 100; null: not read. */
  week: number | null;
  /** The short session, every account together. */
  fiveHour: number | null;
  /** The share of the model's window this conversation uses. */
  context: number | null;
  /** The named figure: the fuller of the windows a free account still has. */
  named: { window: UsageWindowName; percent: number; hours: number } | null;
  /** Every account that can serve refuses work now, as the server says. */
  blocked: boolean;
  /** When the first account serves again; null when not blocked or not known. */
  backAt: number | null;
  /** Accounts free to serve, of all that can. */
  free: number;
  total: number;
  /** The only room left is an engine with no window: its name; else null. */
  freeEngine: string | null;
  tone: MeasureTone;
  /** "back Sat 9 PM", only when every account is blocked and a return is known; else empty. */
  back: string;
  /** "wk 44%", "5h 20%", "wk 100% · back Sat 9 PM", "wk 100% · Ollama free"; empty with no figure. */
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

/** A sum as the pill writes it: 100 only when it is full; a rounding of a
 * sum under 100 never says 100. */
const shown = (sum: UsageWindowSum | null) => (sum === null ? null : sum.used >= 100 ? 100 : Math.min(99, Math.round(sum.used)));

/** The pure function of the pill: the three values and the text. `context`:
 * the conversation's share of its model's window, null when not shown or not
 * measured. `poolKnown` false: the server has not said yet who can serve the
 * bot, so nothing is called blocked (#5421 review H2). */
export function usagePill(input: { accounts: readonly UsageAccount[]; context?: number | null; now?: number; locale?: string; timeZone?: string; poolKnown?: boolean }): UsagePillValues {
  const { accounts } = input;
  const cumul = usageCumul(accounts);
  const total = accounts.length;
  const free = accounts.filter((account) => !account.blocked).length;
  const blocked = input.poolKnown !== false && total > 0 && free === 0;
  const week = shown(cumul.weekly);
  const fiveHour = shown(cumul.fiveHour);
  const hours = accounts.find((account) => account.fiveHour !== null)?.hours ?? 5;
  const windows = [
    ...(cumul.weekly ? [{ window: "weekly" as const, percent: week!, hours, live: cumul.weekly.live }] : []),
    ...(cumul.fiveHour ? [{ window: "five-hour" as const, percent: fiveHour!, hours, live: cumul.fiveHour.live }] : []),
  ];
  // the fuller of the windows a free account still has (the week on a tie);
  // with none, the fuller of all
  const live = windows.filter((entry) => entry.live);
  const fullest = (live.length ? live : windows).reduce<(typeof windows)[number] | null>((best, entry) => (best === null || entry.percent > best.percent ? entry : best), null);
  const named = fullest ? { window: fullest.window, percent: fullest.percent, hours: fullest.hours } : null;
  // #5421 review M2: every account with a window is blocked, yet an engine
  // with none is free (a local model, a key chosen as a backup): no figure is
  // made up for it, the pill names it
  const freeAccount = windows.length && !live.length && free > 0
    ? accounts.find((account) => !account.blocked && account.serving) ?? accounts.find((account) => !account.blocked)
    : undefined;
  const freeEngine = freeAccount?.name ?? null;
  const backs = accounts.map((account) => account.backAt).filter((at): at is number => at !== null);
  const backAt = blocked && backs.length ? Math.min(...backs) : null;
  const context = input.context === null || input.context === undefined || !Number.isFinite(input.context) ? null : Math.max(0, Math.round(input.context));
  const back = backAt !== null ? t("usagePill.back", { time: backText(backAt, input.locale, input.timeZone) }) : "";
  const figure = named ? windowFigure(named.window, named.percent, named.hours) : "";
  const freeText = freeEngine ? t("usagePill.freeEngine", { name: freeEngine }) : "";
  return {
    week, fiveHour, context, named, blocked, backAt, free, total, freeEngine,
    tone: blocked ? "danger" : freeEngine ? "warning" : measureTone(named?.percent ?? null),
    back,
    text: [figure, back || freeText].filter(Boolean).join(" · "),
  };
}

/** Every signed-in account together, for a place that names no bot: the
 * account menu's Usage, and the menu bar's icon (#5410). */
export function accountsUsage(rows: readonly PlanRow[], limits: readonly EngineLimit[] = [], now = Date.now()): UsagePillValues {
  return usagePill({ accounts: allAccounts(rows, limits, now), now });
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
