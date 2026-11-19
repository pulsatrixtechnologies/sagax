// #5014 (M-20261119-016, D-20261119-048, D-20261119-050): which of a
// person's accounts of one provider runs a conversation's turn, when the
// model is offered by several of them and no account is forced on the model
// menu's Account line. The limit failover calls it before a turn
// (server/usage/limit-failover-host.ts beforeTurn) and ranks its backups with
// it (rank). Everything about the server comes in through deps:
//
//   - the person's setting for the provider (GET/PUT /api/me/models
//     `accountSwitchByProvider`: their person settings, the installation's
//     config when solo);
//   - each account's windows (account-meter.ts), from what Sagax already reads;
//   - the holds the failover keeps (an account a limit refused);
//   - the forecast (usage-forecast.ts) for the planner (account-planner.ts),
//     which High-water uses once it has about 7 days of history, else the
//     simple rule (account-strategy.ts) answers;
//   - isolation: only the person's own accounts and the organization's,
//     never another person's (`open`).
import type { AccountPick, AccountStrategy, AccountSwitchSetting } from "../../shared/account-switch.ts";
import type { AccountMeter } from "./account-meter.ts";
import { PLAN_BUDGET_MS, PLAN_HORIZON_HOURS, planAccounts, type PlannerAccount, type PlannerResult } from "./account-planner.ts";
import { hasRoom, pickAccountByRule, rankAccounts, underThreshold, type StrategyAccount, type StrategyPick } from "./account-strategy.ts";
import type { UsageForecast } from "./usage-forecast.ts";

/** A cached plan is reused for this long by the same conversation. */
export const PLAN_REFRESH_MS = 5 * 60_000;

export interface AccountSwitchDeps {
  now: () => number;
  meter: AccountMeter;
  forecast: UsageForecast;
  /** The person's setting for this provider, with the defaults. */
  setting: (person: string | null, provider: string) => AccountSwitchSetting;
  /** The person whose plan pays (the payer key's person), null when unknown. */
  person: (payer: string) => string | null;
  /** Isolation: this person may run turns on this account (their own or the organization's). */
  open: (person: string | null, instanceId: string) => boolean;
  /** The account's name for the person, as the model menu says it. */
  label: (person: string | null, instanceId: string, index: number, total: number) => string;
  /** A limit or a refusal holds this account for this payer now. */
  held: (payer: string, instanceId: string) => boolean;
  /** The provider id of an account, as the setting is keyed (shared/model-provider.ts). */
  provider: (instanceId: string) => string;
  /** A monotonic clock in ms for the planner's budget. */
  clock?: () => number;
  budgetMs?: number;
}

export interface AccountChoiceInput {
  payer: string;
  threadId: string;
  driverKind: string;
  /** The account the conversation is on now. */
  current: string;
  /** The accounts of the same provider that offer the model, in the order of Providers. */
  pool: readonly string[];
  /** No engine session is open on `current` (a new conversation). */
  fresh: boolean;
}

export interface AccountChoice {
  instanceId: string;
  pick: AccountPick;
  /** How the choice was made: the planner, or the simple rule and why. */
  by: "planner" | "rule";
  fallback?: Extract<PlannerResult, { status: "fallback" }>["reason"];
}

export interface AccountSwitch {
  choose(input: AccountChoiceInput): AccountChoice | null;
  /** The accounts with room, best first, for the limit failover. */
  rank(payer: string, driverKind: string, pool: readonly string[]): string[];
}

/** Sagax has read something of this account's windows. */
const measured = (account: StrategyAccount) => account.fiveHour.usedPercent !== null || account.fiveHour.resetsAt !== null
  || account.weekly.usedPercent !== null || account.weekly.resetsAt !== null;

export function createAccountSwitch(deps: AccountSwitchDeps): AccountSwitch {
  const clock = deps.clock ?? (() => performance.now());
  const plans = new Map<string, { at: number; current: string; result: Extract<PlannerResult, { status: "planned" }> }>();
  const accountsOf = (payer: string, pool: readonly string[]): { person: string | null; accounts: PlannerAccount[] } => {
    const person = deps.person(payer);
    // isolation first: never another person's account, whatever the pool says
    const open = [...new Set(pool)].filter((instanceId) => deps.open(person, instanceId));
    const accounts = open.map((instanceId, index): PlannerAccount => {
      const windows = deps.meter.windows(payer, instanceId);
      return {
        instanceId,
        label: deps.label(person, instanceId, index, open.length),
        fiveHour: windows.fiveHour,
        weekly: windows.weekly,
        blocked: deps.held(payer, instanceId),
        scale: deps.meter.scale(payer, instanceId),
        weekScale: deps.meter.weekScale(payer, instanceId),
      };
    });
    return { person, accounts };
  };
  const pickOf = (strategy: AccountStrategy, accounts: readonly StrategyAccount[], pick: StrategyPick): AccountPick => ({
    instanceId: pick.instanceId,
    account: accounts.find((account) => account.instanceId === pick.instanceId)?.label ?? pick.instanceId,
    why: pick.why,
    strategy,
    at: deps.now(),
  });

  return {
    choose(input) {
      const { person, accounts } = accountsOf(input.payer, input.pool);
      // one account (or none open to this person): nothing to choose
      if (accounts.length < 2 || !accounts.some((account) => account.instanceId === input.current)) return null;
      // no account has a reading yet (no report, no limit header): nothing to
      // switch on, the conversation stays where it is
      if (!accounts.some(measured)) return null;
      const setting = deps.setting(person, deps.provider(input.current));
      const now = deps.now();
      const rule = { strategy: setting.strategy, threshold: setting.threshold, now, accounts, current: input.current, fresh: input.fresh };
      let fallback: AccountChoice["fallback"];
      if (setting.strategy === "high-water") {
        const cached = plans.get(input.threadId);
        // a cached plan stands only while the conversation's account is still
        // under its threshold with room: a reading past it plans again now
        const own = accounts.find((account) => account.instanceId === input.current)!;
        const stands = hasRoom(own) && underThreshold(own, setting.threshold);
        let planned = !input.fresh && stands && cached && cached.current === input.current && now - cached.at < PLAN_REFRESH_MS ? cached.result : null;
        if (!planned) {
          const result = planAccounts({
            now, threshold: setting.threshold, accounts, current: input.current, fresh: input.fresh,
            demand: deps.forecast.demand(input.payer, PLAN_HORIZON_HOURS), history: deps.forecast.history(input.payer),
          }, { clock, budgetMs: deps.budgetMs ?? PLAN_BUDGET_MS });
          if (result.status === "planned") {
            planned = result;
            plans.set(input.threadId, { at: now, current: input.current, result });
            while (plans.size > 1_000) plans.delete(plans.keys().next().value as string);
          } else {
            fallback = result.reason;
            plans.delete(input.threadId);
          }
        }
        // a plan made before an account filled up or was held is not applied
        const target = planned ? accounts.find((account) => account.instanceId === planned!.pick.instanceId) : undefined;
        if (planned && target && hasRoom(target)) {
          const pick = planned.pick.instanceId === input.current && planned.pick.why.kind !== "keeps" && !input.fresh
            ? pickAccountByRule(rule) ?? planned.pick
            : planned.pick;
          return { instanceId: pick.instanceId, pick: pickOf(setting.strategy, accounts, pick), by: "planner" };
        }
      }
      const pick = pickAccountByRule(rule);
      if (!pick) return null;
      return { instanceId: pick.instanceId, pick: pickOf(setting.strategy, accounts, pick), by: "rule", ...(fallback ? { fallback } : {}) };
    },
    rank(payer, _driverKind, pool) {
      const { person, accounts } = accountsOf(payer, pool);
      if (!accounts.length) return [];
      const setting = deps.setting(person, deps.provider(accounts[0]!.instanceId));
      return rankAccounts({ strategy: setting.strategy, threshold: setting.threshold, now: deps.now(), accounts }).map((account) => account.instanceId);
    },
  };
}
