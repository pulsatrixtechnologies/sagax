// M-20261119-016, D-20261119-048, D-20261119-050 (#5014): how Sagax picks
// among a person's accounts of one provider when a model is offered by
// several of them and no account is forced on the model menu's Account line
// (#5002). One setting per provider, the person's own, never per bot:
//
//   - High-water (the default): a conversation keeps its account, for its
//     prompt cache, until that account reaches its threshold in the 5-hour
//     window, or earlier when another account is about to lose a lot of
//     unused quota at a near reset.
//   - Most-free: each new conversation takes the account with the most
//     quota left; a conversation already started keeps its account.
//   - Fill-up: fill the accounts in the order of the Providers list.
//
// The rules live on the server (server/usage/account-strategy.ts and the
// planner, server/usage/account-planner.ts); this file holds the shapes the
// apps read: the setting, and why a conversation's turn took its account,
// in one line (the model chip's tooltip, the turn's activity).

export const ACCOUNT_STRATEGIES = ["high-water", "most-free", "fill-up"] as const;
export type AccountStrategy = (typeof ACCOUNT_STRATEGIES)[number];

/** D-20261119-048: High-water unless the person chose another. */
export const DEFAULT_ACCOUNT_STRATEGY: AccountStrategy = "high-water";
/** High-water's threshold in the 5-hour window, in percent (adjustable). */
export const DEFAULT_ACCOUNT_THRESHOLD = 80;
export const ACCOUNT_THRESHOLD_MIN = 10;
export const ACCOUNT_THRESHOLD_MAX = 100;

/** One provider's setting, for one person. */
export interface AccountSwitchSetting {
  strategy: AccountStrategy;
  /** High-water's threshold, percent of the 5-hour window. */
  threshold: number;
}

export const DEFAULT_ACCOUNT_SWITCH: AccountSwitchSetting = { strategy: DEFAULT_ACCOUNT_STRATEGY, threshold: DEFAULT_ACCOUNT_THRESHOLD };

export function isAccountStrategy(value: unknown): value is AccountStrategy {
  return typeof value === "string" && (ACCOUNT_STRATEGIES as readonly string[]).includes(value);
}

/** A threshold as typed: a whole percent within bounds, else null. */
export function cleanAccountThreshold(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return null;
  const whole = Math.round(number);
  return whole >= ACCOUNT_THRESHOLD_MIN && whole <= ACCOUNT_THRESHOLD_MAX ? whole : null;
}

/** A stored or sent setting, read with the defaults for what it lacks. */
export function accountSwitchSettingOf(raw: unknown): AccountSwitchSetting {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    strategy: isAccountStrategy(value.strategy) ? value.strategy : DEFAULT_ACCOUNT_STRATEGY,
    threshold: cleanAccountThreshold(value.threshold) ?? DEFAULT_ACCOUNT_THRESHOLD,
  };
}

/** `{ <provider id>: setting }` as stored (GET/PUT /api/me/models
 * `accountSwitchByProvider`): unknown entries dropped, each setting cleaned. */
export function cleanAccountSwitchDefaults(raw: unknown): Record<string, AccountSwitchSetting> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, AccountSwitchSetting> = {};
  for (const [provider, setting] of Object.entries(raw as Record<string, unknown>)) {
    if (provider && provider.length <= 120 && setting && typeof setting === "object" && !Array.isArray(setting)) out[provider] = accountSwitchSettingOf(setting);
  }
  return out;
}

/** Why the turn took its account. Times are epoch ms; percents whole. */
export type AccountPickWhy =
  /** High-water: the conversation stays on its account, under the threshold. */
  | { kind: "keeps"; used?: number; threshold: number }
  /** Most-free and Fill-up: a conversation already started keeps its account. */
  | { kind: "started" }
  /** The account it was on (`from`) reached the threshold in its 5-hour window. */
  | { kind: "threshold"; from: string; used: number; threshold: number }
  /** This account's window resets soon with this much unused: used before it is lost. */
  | { kind: "expiring"; resetsAt: number; unused: number }
  /** Among the accounts under their threshold, its 5-hour window resets first. */
  | { kind: "expiresFirst"; resetsAt: number }
  /** No account has a window open yet: the first one of the Providers list. */
  | { kind: "first" }
  /** Most-free: the most quota left. */
  | { kind: "mostFree"; remaining: number }
  /** Fill-up: the first account with room, in the order of the Providers list. */
  | { kind: "fillUp" }
  /** The other accounts use their week faster than time passes. */
  | { kind: "weekly" }
  /** High-water: every account is past its threshold; this one has the most room. */
  | { kind: "mostRoom"; threshold: number }
  /** `from` has no room left (its window or its week is used up). */
  | { kind: "full"; from: string }
  /** The planner over the next hours put the conversation here; `resetsAt`
   * and `unused` when the reason is a window about to reset. */
  | { kind: "planned"; resetsAt?: number; unused?: number };

/** The account a conversation's turn took and why (WireTask.accountPick). */
export interface AccountPick {
  instanceId: string;
  /** The account's name for the person (accountWords), else "Account N". */
  account: string;
  why: AccountPickWhy;
  strategy: AccountStrategy;
  at: number;
}

/** "40 min", "2 h 10", or "1 h": the same in English and French. */
export function accountDelayText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

/** Which `accountSwitch.why.*` locale key says `pick`, with its words. The
 * app (src/lib/account-pick.ts) and the server's English line
 * (accountPickText) both word a pick through this one choice. */
export function accountPickWords(pick: Pick<AccountPick, "account" | "why">, now: number): { key: string; vars: Record<string, string> } {
  const account = pick.account;
  const why = pick.why;
  switch (why.kind) {
    case "keeps":
      return why.used !== undefined
        ? { key: "accountSwitch.why.keeps", vars: { account, used: String(why.used), threshold: String(why.threshold) } }
        : { key: "accountSwitch.why.keepsUnknown", vars: { account, threshold: String(why.threshold) } };
    case "started":
      return { key: "accountSwitch.why.started", vars: { account } };
    case "threshold":
      return { key: "accountSwitch.why.threshold", vars: { account, from: why.from, used: String(why.used), threshold: String(why.threshold) } };
    case "expiring":
      return { key: "accountSwitch.why.expiring", vars: { account, in: accountDelayText(why.resetsAt - now), unused: String(why.unused) } };
    case "expiresFirst":
      return { key: "accountSwitch.why.expiresFirst", vars: { account, in: accountDelayText(why.resetsAt - now) } };
    case "first":
      return { key: "accountSwitch.why.first", vars: { account } };
    case "mostFree":
      return { key: "accountSwitch.why.mostFree", vars: { account, remaining: String(why.remaining) } };
    case "fillUp":
      return { key: "accountSwitch.why.fillUp", vars: { account } };
    case "weekly":
      return { key: "accountSwitch.why.weekly", vars: { account } };
    case "mostRoom":
      return { key: "accountSwitch.why.mostRoom", vars: { account, threshold: String(why.threshold) } };
    case "full":
      return { key: "accountSwitch.why.full", vars: { account, from: why.from } };
    case "planned":
      return why.resetsAt !== undefined && why.unused !== undefined
        ? { key: "accountSwitch.why.plannedExpiring", vars: { account, in: accountDelayText(why.resetsAt - now), unused: String(why.unused) } }
        : { key: "accountSwitch.why.planned", vars: { account } };
    default:
      return { key: "accountSwitch.why.planned", vars: { account } };
  }
}

/** The English source of each line (src/locales/en.json carries the same). */
export const ACCOUNT_PICK_ENGLISH: Readonly<Record<string, string>> = {
  "accountSwitch.why.keeps": "{account}: this conversation stays on it, {used}% of its 5-hour window used, under {threshold}%",
  "accountSwitch.why.keepsUnknown": "{account}: this conversation stays on it, under {threshold}% of its 5-hour window",
  "accountSwitch.why.started": "{account}: this conversation stays on the account it started on",
  "accountSwitch.why.threshold": "{account}: {from} reached {used}% of its 5-hour window (threshold {threshold}%)",
  "accountSwitch.why.expiring": "{account}: its window resets in {in} with {unused}% unused",
  "accountSwitch.why.expiresFirst": "{account}: its 5-hour window resets first, in {in}",
  "accountSwitch.why.first": "{account}: no window open yet, first account of the Providers list",
  "accountSwitch.why.mostFree": "{account}: the most quota left, {remaining}%",
  "accountSwitch.why.fillUp": "{account}: first account with room, in the order of the Providers list",
  "accountSwitch.why.weekly": "{account}: the other accounts use their week faster than time passes",
  "accountSwitch.why.mostRoom": "{account}: every account is past {threshold}% of its 5-hour window, this one has the most room",
  "accountSwitch.why.full": "{account}: {from} has no room left",
  "accountSwitch.why.planned": "{account}: the plan for the next hours puts this conversation here",
  "accountSwitch.why.plannedExpiring": "{account}: its window resets in {in} with {unused}% unused",
};

/** The pick in English, for the server log and the Events lens. */
export function accountPickText(pick: Pick<AccountPick, "account" | "why">, now: number): string {
  const { key, vars } = accountPickWords(pick, now);
  const template = ACCOUNT_PICK_ENGLISH[key] ?? "{account}";
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}
