// #5014 (M-20261119-016, D-20261119-048): the simple rule, always available,
// that picks which of a person's accounts of one provider runs a
// conversation's turn. Pure: the host passes each account's windows (the
// account meter, server/usage/account-meter.ts), the holds the limit
// failover keeps (server/usage/limit-failover-host.ts), the setting and the
// clock. The planner (server/usage/account-planner.ts) refines High-water
// and falls back on this rule.
//
//   - High-water: a conversation keeps its account (its prompt cache) while
//     that account is under its threshold in the 5-hour window; it moves
//     earlier only when another account is about to lose a lot of unused
//     quota at a near reset.
//   - The quota that expires first: among the accounts under their
//     threshold, the one whose 5-hour window resets first.
//   - The weekly guard: an account using its week faster than time passes
//     goes last.
//   - Most-free: a new conversation takes the account with the most left.
//   - Fill-up: the first account with room, in the order of Providers.
//   - An account at its limit is never picked here: the limit failover
//     moves the turn at once, ranked by this same rule (rankAccounts).
import type { AccountPickWhy, AccountStrategy } from "../../shared/account-switch.ts";

export const HOUR_MS = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** A reset this close is "near" (High-water's earlier move). */
export const EXPIRING_SOON_MS = HOUR_MS;
/** This much of a window unused at a near reset is "a lot". */
export const EXPIRING_UNUSED_PERCENT = 30;

export interface StrategyAccount {
  instanceId: string;
  /** The account's name for the person (the reasons say it). */
  label: string;
  fiveHour: { usedPercent: number | null; resetsAt: number | null };
  weekly: { usedPercent: number | null; resetsAt: number | null };
  /** A limit or a refusal holds it now (the failover's holds). */
  blocked?: boolean;
}

export interface StrategyInput {
  strategy: AccountStrategy;
  /** High-water's threshold, percent of the 5-hour window. */
  threshold: number;
  now: number;
  /** The eligible accounts, in the order of the Providers list. */
  accounts: readonly StrategyAccount[];
  /** The account the conversation is on. */
  current?: string;
  /** No engine session is open on `current`: nothing in a cache to keep. */
  fresh: boolean;
}

export interface StrategyPick {
  instanceId: string;
  why: AccountPickWhy;
}

const used = (account: StrategyAccount) => account.fiveHour.usedPercent ?? 0;
const weekUsed = (account: StrategyAccount) => account.weekly.usedPercent ?? 0;
/** It can take a turn: not held, its window and its week not used up. */
export function hasRoom(account: StrategyAccount): boolean {
  return account.blocked !== true && used(account) < 100 && weekUsed(account) < 100;
}
export const underThreshold = (account: StrategyAccount, threshold: number) => used(account) < threshold;
/** The weekly guard: more of the week used than of the week passed. */
export function weeklyAhead(account: StrategyAccount, now: number): boolean {
  const { usedPercent, resetsAt } = account.weekly;
  if (usedPercent === null || resetsAt === null) return false;
  const elapsed = Math.max(0, Math.min(1, 1 - (resetsAt - now) / WEEK_MS));
  return usedPercent / 100 > elapsed;
}
/** Percent of the 5-hour window left unused, when its reset is near. */
export function expiringUnused(account: StrategyAccount, now: number): number | null {
  const { usedPercent, resetsAt } = account.fiveHour;
  if (resetsAt === null || resetsAt <= now || resetsAt - now > EXPIRING_SOON_MS) return null;
  return Math.round(100 - (usedPercent ?? 0));
}
const remaining = (account: StrategyAccount) => Math.round(Math.max(0, 100 - Math.max(used(account), weekUsed(account))));

/** The quota that expires first: a known reset before an unopened window,
 * the earlier reset first, then the order of Providers. */
function byExpiry(accounts: readonly StrategyAccount[]): StrategyAccount[] {
  const order = new Map(accounts.map((account, index) => [account.instanceId, index]));
  return [...accounts].sort((left, right) => {
    const a = left.fiveHour.resetsAt ?? Infinity;
    const b = right.fiveHour.resetsAt ?? Infinity;
    return a !== b ? a - b : order.get(left.instanceId)! - order.get(right.instanceId)!;
  });
}

/** Every account with room, best first, as the rule ranks them for this
 * strategy: what the limit failover tries next (#5014). */
export function rankAccounts(input: Omit<StrategyInput, "current" | "fresh">): StrategyAccount[] {
  const open = input.accounts.filter(hasRoom);
  if (input.strategy === "fill-up") return open;
  const order = new Map(input.accounts.map((account, index) => [account.instanceId, index]));
  const guard = (list: StrategyAccount[]) => [
    ...list.filter((account) => !weeklyAhead(account, input.now)),
    ...list.filter((account) => weeklyAhead(account, input.now)),
  ];
  if (input.strategy === "most-free") {
    return guard([...open].sort((left, right) => remaining(right) - remaining(left) || order.get(left.instanceId)! - order.get(right.instanceId)!));
  }
  const under = byExpiry(open.filter((account) => underThreshold(account, input.threshold)));
  const over = open.filter((account) => !underThreshold(account, input.threshold))
    .sort((left, right) => used(left) - used(right) || order.get(left.instanceId)! - order.get(right.instanceId)!);
  return [...guard(under), ...guard(over)];
}

/** Why the rule put a fresh turn on `account`. */
function whyFirst(input: StrategyInput, account: StrategyAccount, ranked: readonly StrategyAccount[], from?: StrategyAccount): AccountPickWhy {
  if (from && from.instanceId !== account.instanceId) {
    if (!hasRoom(from)) return { kind: "full", from: from.label };
    if (input.strategy === "high-water" && !underThreshold(from, input.threshold)) {
      return { kind: "threshold", from: from.label, used: Math.round(used(from)), threshold: input.threshold };
    }
  }
  if (input.strategy === "fill-up") return { kind: "fillUp" };
  if (input.strategy === "high-water" && !underThreshold(account, input.threshold)) return { kind: "mostRoom", threshold: input.threshold };
  const others = ranked.filter((other) => other.instanceId !== account.instanceId);
  if (weeklyAhead(account, input.now) === false && others.length && others.every((other) => weeklyAhead(other, input.now))) return { kind: "weekly" };
  if (input.strategy === "most-free") return { kind: "mostFree", remaining: remaining(account) };
  const unused = expiringUnused(account, input.now);
  if (unused !== null && unused >= EXPIRING_UNUSED_PERCENT && account.fiveHour.resetsAt !== null) {
    return { kind: "expiring", resetsAt: account.fiveHour.resetsAt, unused };
  }
  if (account.fiveHour.resetsAt !== null) return { kind: "expiresFirst", resetsAt: account.fiveHour.resetsAt };
  return { kind: "first" };
}

/** The account the rule puts this turn on, and why; null when no account
 * has room (the limit failover then decides, or the turn waits). */
export function pickAccountByRule(input: StrategyInput): StrategyPick | null {
  const current = input.current ? input.accounts.find((account) => account.instanceId === input.current) : undefined;
  if (current && !input.fresh && hasRoom(current)) {
    if (input.strategy !== "high-water") return { instanceId: current.instanceId, why: { kind: "started" } };
    if (underThreshold(current, input.threshold)) {
      // earlier: another account is about to lose a lot of unused quota,
      // unless this one's own window is about to as well
      const own = expiringUnused(current, input.now);
      if (own === null || own < EXPIRING_UNUSED_PERCENT) {
        const losing = byExpiry(input.accounts.filter((account) => account.instanceId !== current.instanceId && hasRoom(account) &&
          underThreshold(account, input.threshold) && !weeklyAhead(account, input.now) &&
          (expiringUnused(account, input.now) ?? 0) >= EXPIRING_UNUSED_PERCENT))[0];
        if (losing && losing.fiveHour.resetsAt !== null) {
          return { instanceId: losing.instanceId, why: { kind: "expiring", resetsAt: losing.fiveHour.resetsAt, unused: expiringUnused(losing, input.now)! } };
        }
      }
      const usedNow = current.fiveHour.usedPercent;
      return { instanceId: current.instanceId, why: { kind: "keeps", ...(usedNow !== null ? { used: Math.round(usedNow) } : {}), threshold: input.threshold } };
    }
  }
  const ranked = rankAccounts(input);
  const best = ranked[0];
  if (!best) return null;
  return { instanceId: best.instanceId, why: whyFirst(input, best, ranked, current) };
}
