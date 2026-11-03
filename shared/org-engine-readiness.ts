// Whether a person on an organization server has at least one engine that
// can answer them, and what they can do when they have none (2026-10-18: 
// "Si aucun LLM/moteur fonctionnel n'est présent lors de la première
// connexion en organisation, il faut que le setup de ton premier compte soit
// dans le setup initial, comme on fait en mode sans serveur").
//
// Built on shared/offered-engines.ts, the one answer for what is offered:
//
// - "ready": an engine offered to pick, admitted on an organization server
//   (it withholds its own host tools), installed, and paid for by something
//   (the person's own subscription or key, or the organization's key given
//   to them). The organization's xAI key alone does not count (the maintainer,
//   2026-10-16: it pays for voice only), so a Grok engine served only by it
//   is not a chat engine here. Nothing changes for this person.
// - "connect": none of that, but the organization allows at least one
//   engine the person can connect with their own account (a subscription
//   sign-in the server finishes, or a key they keep in Perspicax). The
//   first-run step lists those, and only those: an engine the admin hid is
//   never one of them.
// - "blocked": the organization allows nothing the person can connect.
//   They are told to ask their admin, never left with a silent chat.
// - "loading": the person's engines (GET /api/me/engines) or the engine
//   list are not known yet. No decision is drawn on a guess.
//
// Solo servers are always "ready" here: the no-engines screen and the
// welcome flow's engines beat stay theirs, unchanged.
import { engineOffer, offeredEngines, type EngineOfferContext } from "./offered-engines.ts";

/** Drivers whose provider key a person can keep in Perspicax
 * (server/engines/engine-credentials.ts providersOfDriver). */
export const PERSONAL_KEY_DRIVERS: readonly string[] = ["claudeAgent", "codex", "grokAgent", "geminiAgent", "kimiAgent", "piAgent"];

/** xAI engines: the organization's xAI key is voice only for chat purposes. */
export const XAI_DRIVERS: readonly string[] = ["grok", "grokAgent"];

/** One engine as the app lists it (GET /api/instances). */
export interface ReadinessInstance {
  instanceId: string;
  driverKind?: string;
  /** "api": a pasted-key instance of a driver (Claude (API key)). */
  access?: string;
  capabilities?: { withholdsHostTools?: boolean };
}

/** The person's own access to one engine (GET /api/me/engines). */
export interface ReadinessAccess {
  instanceId: string;
  driver: string;
  installed: boolean;
  subscription: { supported: boolean; signedIn: boolean; expired?: boolean };
  orgKeyNotGiven?: boolean;
  myTurns: "subscription" | "key" | "org-key" | "expired" | "none";
}

/** 2026-10-30: the person's turns on this engine have something that works
 * to pay with. "expired" (a sign-in the provider refused since, nothing
 * else to pay) is not ready; nor is "subscription" from an older server
 * that still says so for an expired sign-in. */
export function myTurnsReady(access: { myTurns: string; subscription?: { expired?: boolean } }): boolean {
  if (access.myTurns === "none" || access.myTurns === "expired") return false;
  return !(access.myTurns === "subscription" && access.subscription?.expired === true);
}

export type OrgEngineReadinessState = "loading" | "ready" | "connect" | "blocked";

export interface OrgEngineReadiness<I extends ReadinessInstance = ReadinessInstance, A extends ReadinessAccess = ReadinessAccess> {
  state: OrgEngineReadinessState;
  /** The engines that answer this person today ("ready" only). */
  working: I[];
  /** The engines the person may connect with their own account ("connect"). */
  connectable: Array<{ instance: I; access: A }>;
}

/** On an organization server an engine runs a turn only when it withholds
 * its own host tools (server/org/org-engine-admission.ts, 409 host_tools). */
export function admittedOnOrg(instance: ReadinessInstance): boolean {
  return instance.capabilities?.withholdsHostTools === true;
}

/** Whether the person's turns on this engine have something to pay with,
 * for chat: the organization's xAI key alone is voice only. */
export function accessWorksForChat(access: ReadinessAccess): boolean {
  if (!access.installed || !myTurnsReady(access)) return false;
  if (access.myTurns === "org-key" && XAI_DRIVERS.includes(access.driver)) return false;
  return true;
}

/** Whether the person can connect their own account on this engine here. */
export function accessConnectable(access: ReadinessAccess): boolean {
  return access.installed && (access.subscription.supported || PERSONAL_KEY_DRIVERS.includes(access.driver));
}

export function orgEngineReadiness<I extends ReadinessInstance, A extends ReadinessAccess>(
  instances: readonly I[],
  context: Omit<EngineOfferContext, "mine"> & { mine: readonly A[] | null | undefined },
): OrgEngineReadiness<I, A> {
  if (!context.organization) return { state: "ready", working: [...instances], connectable: [] };
  const mine = context.mine;
  if (!mine) return { state: "loading", working: [], connectable: [] };
  const accessOf = (instanceId: string) => mine.find((row) => row.instanceId === instanceId);
  const allowed = mine.filter((row) => engineOffer(context, row.instanceId) !== "notAllowed");
  // The person has engines to look at, but the list itself has not come yet.
  if (allowed.length > 0 && instances.length === 0) return { state: "loading", working: [], connectable: [] };
  const working = offeredEngines(instances, context, "pick").filter((instance) => {
    const access = accessOf(instance.instanceId);
    return admittedOnOrg(instance) && access !== undefined && accessWorksForChat(access);
  });
  if (working.length > 0) return { state: "ready", working, connectable: [] };
  const candidates = offeredEngines(instances, context, "settings").flatMap((instance) => {
    const access = accessOf(instance.instanceId);
    return admittedOnOrg(instance) && access && accessConnectable(access) ? [{ instance, access }] : [];
  });
  // One row per account to connect: Claude and Claude (API key), Codex and
  // the ChatGPT plan sign in to the same account, so the first non-API
  // instance of a driver stands for it.
  const connectable = candidates.filter((row, index) => {
    const first = candidates.find((other) => other.access.driver === row.access.driver && other.instance.access !== "api") ?? candidates.find((other) => other.access.driver === row.access.driver);
    return first === candidates[index];
  });
  return { state: connectable.length > 0 ? "connect" : "blocked", working: [], connectable };
}

/** The admins a person is told to contact: active, real people, by name. */
export function orgAdminNames(people: Iterable<{ name: string; login: string; role: string; disabled: boolean; service?: true }>): string[] {
  const names: string[] = [];
  for (const person of people) {
    if (person.role !== "admin" || person.disabled || person.service) continue;
    const name = (person.name || person.login).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
