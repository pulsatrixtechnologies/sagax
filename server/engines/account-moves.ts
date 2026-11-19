// Where the bots of an account go when the person removes it or signs out of
// it (2026-11-18, owner rule: no block, it simply works). One plan, shown in
// the one confirmation and then applied as shown:
//
//   1. the person's other account on the same provider, same model;
//   2. else the bot's next engine in its fallback chain that can run;
//   3. else the person's default engine, else any engine that can run;
//   4. else no engine: the account goes anyway and the bot says it has no
//      engine until the person picks one.
//
// A bot that only falls back to the account, or has a conversation on it,
// keeps its own engine: the backup moves to the other account or is
// dropped, the conversation follows its bot. The default model for new bots
// moves the same way. Pure: no store, no registry.
import type { ModelSelection } from "../contracts.ts";
import { liveAccountUser, usesAccount, type AccountUserBot, type AccountUserTask } from "./account-users.ts";

export type AccountMoveVia = "account" | "fallback" | "default" | "stays" | "none";

export interface AccountMove {
  botId: string;
  name: string;
  via: AccountMoveVia;
  /** The bot's engine after the move (its own when via is "stays"); null:
   * no engine at all. */
  to: ModelSelection | null;
  /** The bot's backups after the move. */
  fallback?: ModelSelection[];
  /** What the person reads for `to` (an account or engine name). */
  engine?: string;
}

export interface AccountMovePlan {
  moves: AccountMove[];
  /** The default model for new bots, when it is on the account. */
  defaultModel?: { via: AccountMoveVia; to: ModelSelection | null; engine?: string };
  /** No other engine can run anything: the bots on it get none. */
  noEngine: boolean;
}

export interface AccountMoveEngine {
  instanceId: string;
  /** The model a bot gets there when it brings none of its own. */
  defaultModel: string;
  /** It can run a turn for this person now. */
  usable: boolean;
}

export interface AccountMoveInput {
  bots: readonly AccountUserBot[];
  tasks: (botId: string) => readonly AccountUserTask[];
  /** The account's engines (one sign-in may stand for two). */
  leaving: ReadonlySet<string>;
  /** The person's other accounts on the same provider, first choice first. */
  sameProvider: readonly string[];
  /** Every engine the person has, in the order a new bot would pick one. */
  engines: readonly AccountMoveEngine[];
  /** The person's default engine (the default model for new bots). */
  personDefault?: ModelSelection | null;
  /** Move the default model too when it is on the account. */
  moveDefault?: boolean;
  label?: (selection: ModelSelection) => string;
  /** Whether a bot (null: the default model for new bots) may run on an
   * engine: on an organization server each person's bots only move within
   * that person's own accounts or the organization's shared ones. */
  reachable?: (botId: string | null, instanceId: string) => boolean;
}

export function planAccountMoves(input: AccountMoveInput): AccountMovePlan {
  const { leaving } = input;
  const runs = (instanceId: string) => !leaving.has(instanceId) && input.engines.some((engine) => engine.instanceId === instanceId && engine.usable);
  // per bot: never onto an engine of another person
  const usableFor = (botId: string | null) => (instanceId: string) => runs(instanceId) && (input.reachable?.(botId, instanceId) ?? true);
  const onto = (selection: ModelSelection, instanceId: string): ModelSelection => ({ ...structuredClone(selection), instanceId });
  const anyEngine = (usable: (instanceId: string) => boolean): ModelSelection | null => {
    const engine = input.engines.find((candidate) => candidate.defaultModel && usable(candidate.instanceId));
    return engine ? { instanceId: engine.instanceId, model: engine.defaultModel } : null;
  };
  const fallbackDefault = (usable: (instanceId: string) => boolean): { via: AccountMoveVia; to: ModelSelection | null } => {
    const own = input.personDefault;
    if (own && usable(own.instanceId)) return { via: "default", to: structuredClone(own) };
    const any = anyEngine(usable);
    return any ? { via: "default", to: any } : { via: "none", to: null };
  };
  const named = <T extends { to: ModelSelection | null }>(entry: T): T & { engine?: string } => entry.to && input.label ? { ...entry, engine: input.label(entry.to) } : entry;

  const moves: AccountMove[] = [];
  for (const bot of input.bots) {
    if (!liveAccountUser(bot) || !usesAccount(bot, input.tasks, leaving)) continue;
    const name = bot.name?.trim() || bot.id;
    const backups = bot.fallback ?? [];
    const usable = usableFor(bot.id);
    const sibling = input.sameProvider.find(usable);
    let target: { via: AccountMoveVia; to: ModelSelection | null };
    if (!leaving.has(bot.modelSelection.instanceId)) target = { via: "stays", to: structuredClone(bot.modelSelection) };
    else if (sibling) target = { via: "account", to: onto(bot.modelSelection, sibling) };
    else {
      const next = backups.find((candidate) => usable(candidate.instanceId));
      target = next ? { via: "fallback", to: structuredClone(next) } : fallbackDefault(usable);
    }
    // its backups: one on the account moves to the other account, else goes;
    // the one it now runs on is no longer a backup
    const fallback: ModelSelection[] = [];
    for (const candidate of backups) {
      const kept = leaving.has(candidate.instanceId) ? (sibling ? onto(candidate, sibling) : null) : structuredClone(candidate);
      if (!kept) continue;
      if (target.to && kept.instanceId === target.to.instanceId && kept.model === target.to.model) continue;
      if (fallback.some((entry) => entry.instanceId === kept.instanceId && entry.model === kept.model)) continue;
      fallback.push(kept);
    }
    moves.push(named({ botId: bot.id, name, ...target, ...(bot.fallback ? { fallback } : {}) }));
  }

  let defaultModel: AccountMovePlan["defaultModel"];
  const current = input.personDefault;
  if (input.moveDefault && current && leaving.has(current.instanceId)) {
    const usable = usableFor(null);
    const sibling = input.sameProvider.find(usable);
    defaultModel = named(sibling ? { via: "account" as const, to: onto(current, sibling) } : (() => {
      const any = anyEngine(usable);
      return any ? { via: "default" as const, to: any } : { via: "none" as const, to: null };
    })());
  }
  // every usable engine is in `engines` (the sibling and a backup too)
  const noEngine = !input.engines.some((engine) => runs(engine.instanceId));
  return { moves, ...(defaultModel ? { defaultModel } : {}), noEngine };
}

export interface AccountMovesInput {
  /** Whose bots move: one person's (their own list), or null for every bot
   * on the server (the server's account). */
  person: string | null;
  leaving: readonly string[];
  sameProvider: readonly string[];
  moveDefault: boolean;
}

/** What the routes call: the plan the confirmation shows, then the same plan
 * applied in the gesture that removes the account or signs out of it. */
export interface AccountMovesHost {
  plan(input: AccountMovesInput): Promise<AccountMovePlan>;
  apply(plan: AccountMovePlan, leaving: readonly string[], options: { forget: boolean; moveDefault: boolean }): void;
}

export interface AccountMovesHostDeps {
  bots(person: string | null): readonly AccountUserBot[];
  tasks(botId: string, person: string | null): readonly AccountUserTask[];
  engines(person: string | null): Promise<readonly AccountMoveEngine[]>;
  personDefault(): ModelSelection | null | undefined;
  label(selection: ModelSelection, person: string | null): string;
  /** Store.moveAccountUsers. */
  moveBots(leaving: ReadonlySet<string>, moves: readonly AccountMove[], forget: boolean): void;
  /** Saves a new default model for new bots. */
  setDefault(selection: ModelSelection): void;
  /** Organization server: the person a bot belongs to, and the person an
   * engine is the own account (or server) of, undefined for the
   * organization's shared ones. Absent: one person, every engine is theirs. */
  botOwner?(botId: string): string | null | undefined;
  engineOwner?(instanceId: string): string | undefined;
}

/** A bot may run on an engine shared by the organization or owned by the
 * bot's own person, never on another person's own account. The default model
 * for new bots (null) is everyone's: only a shared engine. */
export function ownerReachable(deps: Pick<AccountMovesHostDeps, "botOwner" | "engineOwner">) {
  const key = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  return (botId: string | null, instanceId: string): boolean => {
    const engine = deps.engineOwner?.(instanceId);
    if (engine === undefined) return true;
    if (botId === null) return false;
    const whose = key(deps.botOwner?.(botId));
    return whose !== "" && whose === key(engine);
  };
}

export function createAccountMovesHost(deps: AccountMovesHostDeps): AccountMovesHost {
  return {
    async plan(input) {
      return planAccountMoves({
        bots: deps.bots(input.person),
        tasks: (botId) => deps.tasks(botId, input.person),
        leaving: new Set(input.leaving),
        sameProvider: input.sameProvider,
        engines: await deps.engines(input.person),
        personDefault: deps.personDefault() ?? null,
        moveDefault: input.moveDefault,
        label: (selection) => deps.label(selection, input.person),
        reachable: ownerReachable(deps),
      });
    },
    apply(plan, leaving, options) {
      deps.moveBots(new Set(leaving), plan.moves, options.forget);
      if (options.moveDefault && plan.defaultModel?.to) deps.setDefault(plan.defaultModel.to);
    },
  };
}
