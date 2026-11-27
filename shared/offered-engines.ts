// The model providers (engines) offered to one person: the one answer every
// list of providers or models reads, on the server (GET /api/instances,
// GET /api/me/engines, the Primary Bot's team setup catalog) and in the app
// (the composer's model menu and window, New bot, a bot's backups and
// recovery, Settings > Models and voice, onboarding). 2026-10-18 : a
// provider the organization hid in Perspicax appears nowhere.
//
// - Solo server (no organization): every engine, nothing changes.
// - Organization server: an engine outside the organization's list
//   (`allowedEngines`, shared/org-allowed-engines.ts: null or absent is
//   every engine, [] is none since Sagax 0.5.12) is "notAllowed" and
//   dropped everywhere, even when the person connected it before.
// - 2026-10-30: what the admin turns off is off for everyone, the admin
//   included, even on the person's own subscription or key. The #1098
//   exception (2026-10-27) comes back only when the organization lets own
//   accounts through (`ownAccountsOutsideList`, off by default, set in
//   Perspicax): then an engine outside the list that the person pays for
//   with their own subscription or key (GET /api/me/engines `myTurns`
//   "subscription" or "key", never "expired") is offered, and the app says
//   "allowed through your own account" (`ownAccountOnly`). Until then it is
//   "notGiven" when the server lists it (`orgNotAllowed`), so Settings
//   shows it to connect their own account.
// - An engine the organization pays for but has not given this person
//   (`sagax_server_engines`, GET /api/me/engines `orgKeyNotGiven`) and that
//   nothing of their own serves is "notGiven": not offered to pick, still
//   listed in Settings, where the person can connect their own account.
// - D-20261126-018: a provider the organization hid (`hiddenEngines`,
//   Perspicax Model providers) is left out of every list a new choice is
//   made from, Settings included; it is not off: what already runs on it
//   keeps it, so the engine a bot or conversation is on stays in its own
//   menu (`keep`) and `engineOffer` still says "offered".
import { engineAllowed, type AllowedEngines } from "./org-allowed-engines.ts";

export type EngineOffer = "offered" | "notAllowed" | "notGiven";

/** A person's own access to one engine, as GET /api/me/engines says it. */
export interface PersonEngineAccess {
  instanceId: string;
  orgKeyNotGiven?: boolean;
  /** #1098: outside the organization's list; only the person's own account
   * or key runs it (listed only with `ownAccountsOutsideList`). */
  orgNotAllowed?: boolean;
  myTurns?: string;
}

export interface EngineOfferContext {
  /** An organization server (Perspicax sign-in). */
  organization: boolean;
  /** The organization's list (`allowedEngines`). */
  allowedEngines: AllowedEngines;
  /** 2026-10-30: the organization lets a person's own subscription or key
   * run an engine outside its list. Absent or false: off for everyone. */
  ownAccountsOutsideList?: boolean;
  /** The person's own access, when known (null while loading). */
  mine?: readonly PersonEngineAccess[] | null;
  /** D-20261126-018: the providers the organization hid. */
  hiddenEngines?: readonly string[] | null;
}

/** D-20261126-018: the organization hid this provider: no new choice of it. */
export function engineHidden(context: EngineOfferContext, instanceId: string): boolean {
  return context.organization && (context.hiddenEngines?.includes(instanceId) ?? false);
}

/** #1098: the person's own subscription or key runs this engine. An expired
 * sign-in ("expired") does not. */
export function personPays(access: Pick<PersonEngineAccess, "myTurns"> | undefined): boolean {
  return access?.myTurns === "subscription" || access?.myTurns === "key";
}

/** Whether this engine is offered to the person, and why not. */
export function engineOffer(context: EngineOfferContext, instanceId: string): EngineOffer {
  if (!context.organization) return "offered";
  const access = context.mine?.find((engine) => engine.instanceId === instanceId);
  if (!engineAllowed(context.allowedEngines, instanceId)) {
    // 2026-10-30: off for everyone unless the organization lets own
    // accounts through.
    if (context.ownAccountsOutsideList !== true) return "notAllowed";
    if (personPays(access)) return "offered";
    return access?.orgNotAllowed === true ? "notGiven" : "notAllowed";
  }
  if (access?.orgKeyNotGiven === true && access.myTurns === "none") return "notGiven";
  return "offered";
}

/**
 * The engines offered, in their order. `pick` (the default) keeps only the
 * ones the person can pick a model from; `settings` also keeps the ones the
 * organization did not give them, so they can connect their own account.
 * A hidden provider is left out unless `keep` names it (the engine a bot is
 * already on, or every hidden one for a caller that keeps each bot's own).
 */
export function offeredEngines<T extends { instanceId: string }>(
  instances: readonly T[],
  context: EngineOfferContext,
  purpose: "pick" | "settings" = "pick",
  keep?: string | readonly string[],
): T[] {
  if (!context.organization) return [...instances];
  const kept = (instanceId: string) => (typeof keep === "string" ? keep === instanceId : keep?.includes(instanceId) ?? false);
  return instances.filter((instance) => {
    if (engineHidden(context, instance.instanceId) && !kept(instance.instanceId)) return false;
    const offer = engineOffer(context, instance.instanceId);
    return offer === "offered" || (purpose === "settings" && offer === "notGiven");
  });
}

/** 2026-10-30: offered only because the organization lets own accounts
 * through and the person's own subscription or key pays for it: the app
 * says "allowed through your own account". */
export function ownAccountOnly(context: EngineOfferContext, instanceId: string): boolean {
  if (!context.organization || engineAllowed(context.allowedEngines, instanceId)) return false;
  return engineOffer(context, instanceId) === "offered";
}

/** A bot moved off an engine the organization no longer allows: the names
 * of the engine it left and of the one Auto now starts on. */
export interface OrgEngineMove {
  from: string;
  to: string;
}

/** The plain line a moved bot's conversation keeps, for a client that does
 * not draw `tool.engineMove` in its own language. */
export function orgEngineMoveLine(move: OrgEngineMove): string {
  return `Your organization no longer offers ${move.from}. This bot now uses Auto, starting on ${move.to}.`;
}
