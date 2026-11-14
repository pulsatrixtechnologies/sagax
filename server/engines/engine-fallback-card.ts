// #4233: an engine that is signed out or out of credit, with a backup
// running in its place, is told to the person who can fix it once, as an
// action: one keyed fix card per person and engine (the existing access card
// with its reconnect action, server/engines/sign-in-cards.ts), saying which
// engine runs meanwhile. A routine's readiness and an interactive turn's
// failover raise it the same way; while the card is open, nothing more is
// said (the key finds it, after a restart too). It closes when the engine
// works again (onEngineWorksAgain, SignInCards.retireKeyed). The notice
// ahead of due routines on an expired login engine (checkEngineReconnectAhead)
// is the same state for the same person and engine: it is the same keyed
// card, so whichever comes first is the only one (raiseAhead).
import type { WireAccessCard } from "../../shared/wire.ts";
import { keyedCardPerson } from "./sign-in-cards.ts";

export const ENGINE_FALLBACK_KEY_PREFIX = "engine-sign-in:";
export const engineFallbackKey = (engine: string): string => `${ENGINE_FALLBACK_KEY_PREFIX}${engine}`;

export interface EngineFallback {
  botId: string;
  botName?: string;
  ownerPrincipalId: string;
  /** The conversation the card goes to. */
  threadId: string;
  /** The engine that cannot run: its instance id, display name and the
   * refusal account it was refused on (refusalAccount). */
  engine: { engine: string; name: string; account?: string };
  backupName: string;
  cause: "signed_out" | "credits";
  /** A server engine on an organization server: the administrators
   * reconnect it, so the card goes to them, in a conversation each one can
   * read (adminCardHomes), never to the payer. Absent: the payer's card. */
  adminHomes?: EngineFallbackHome[];
  /** The routine run that ran on the backup, for the people who cannot read
   * its conversation (routineAccessNotifications). */
  routineRunId?: string;
}

/** Where a server engine's card goes: a conversation, its bot, and the
 * administrators who read the card there (its audience). */
export interface EngineFallbackHome {
  threadId: string;
  botId: string;
  botName?: string;
  /** The home bot's owner. */
  ownerPrincipalId: string;
  audience: string[];
}

/** A conversation and its bot, as adminCardHomes sees them. */
export interface EngineFallbackPlace { threadId: string; botId: string; botName?: string; ownerPrincipalId: string }

/** #4233: a server engine's card is for the administrators, who may not be
 * able to read the conversation the backup ran in (a member's private
 * thread). Each administrator gets it where they can read it: that
 * conversation when they can, else their own bot's conversation (their
 * Primary Bot first). One card per conversation, its audience the
 * administrators there. An administrator with no conversation of their own
 * gets nothing (there is no place to show it). */
export function adminCardHomes(admins: readonly string[], ran: EngineFallbackPlace, deps: {
  readable(admin: string, place: EngineFallbackPlace): boolean;
  ownPlace(admin: string): EngineFallbackPlace | undefined;
}): EngineFallbackHome[] {
  const homes = new Map<string, EngineFallbackHome>();
  for (const admin of admins) {
    if (!admin.trim()) continue;
    let place: EngineFallbackPlace | undefined = deps.readable(admin, ran) ? ran : undefined;
    if (!place) {
      const own = deps.ownPlace(admin);
      if (own && deps.readable(admin, own)) place = own;
    }
    if (!place) continue;
    const home = homes.get(place.threadId) ?? { ...place, audience: [] };
    if (!home.audience.includes(admin)) home.audience.push(admin);
    homes.set(place.threadId, home);
  }
  return [...homes.values()];
}

export interface EngineFallbackCardsDeps {
  pendingKeyed(key: string, person: string): unknown;
  append(threadId: string, access: WireAccessCard, text: string): void;
  notify(access: WireAccessCard, threadId: string, text: string, title: string, routineRunId?: string): void;
}

/** The refusal account's person (refusalAccount: [via, principal, slot]). */
function accountPerson(account: string | undefined): string | undefined {
  if (!account) return undefined;
  try {
    const principal = (JSON.parse(account) as unknown[])[1];
    return typeof principal === "string" && principal && principal !== "organization" ? principal : undefined;
  } catch {
    return undefined;
  }
}

/** The fix card; `home`: a server engine's card for the administrators there. */
export function engineFallbackCard(input: EngineFallback, home?: EngineFallbackHome): WireAccessCard {
  const payer = home ? undefined : accountPerson(input.engine.account) ?? input.ownerPrincipalId;
  const botName = (home ? home.botName : input.botName)?.trim();
  return {
    reason: "no_access",
    cause: input.cause === "credits" ? "out_of_credit" : "sign_in_expired",
    engine: input.engine.name,
    instanceId: input.engine.engine,
    botId: home ? home.botId : input.botId,
    ...(botName ? { botName: botName.slice(0, 200) } : {}),
    ownerPrincipalId: home ? home.ownerPrincipalId : input.ownerPrincipalId,
    ...(payer ? { payerPrincipalId: payer } : {}),
    ...(home ? { audiencePrincipalIds: home.audience } : {}),
    ...(input.cause === "signed_out" ? { subscriptionSignIn: true as const } : {}),
    key: engineFallbackKey(input.engine.engine),
    meanwhile: input.backupName,
  };
}

export function engineFallbackWords(input: Pick<EngineFallback, "engine" | "backupName" | "cause">): { text: string; title: string } {
  const { name } = input.engine;
  return input.cause === "credits"
    ? { text: `${name}'s account is out of credit, so ${input.backupName} runs in its place meanwhile. Add credit with the provider to go back to ${name}.`, title: `${name} is out of credit` }
    : { text: `${name} is signed out, so ${input.backupName} runs in its place meanwhile. Reconnect ${name} to go back to it.`, title: `Reconnect ${name}` };
}

/** The notice ahead of due routines: a person's login engine expired. */
export interface EngineReconnectAheadCard {
  botId: string;
  botName?: string;
  ownerPrincipalId: string;
  /** The person whose sign-in expired. */
  payerPrincipalId: string;
  threadId: string;
  /** The engine instance the due routines run on, and its display name. */
  engine: { engine: string; name: string };
  /** The card's line, and the notification's text and title. */
  detail: string;
  text: string;
  title: string;
}

export function engineReconnectAheadCard(input: EngineReconnectAheadCard): WireAccessCard {
  return {
    reason: "no_access",
    cause: "sign_in_expired",
    engine: input.engine.name,
    instanceId: input.engine.engine,
    botId: input.botId,
    ...(input.botName?.trim() ? { botName: input.botName.trim().slice(0, 200) } : {}),
    ownerPrincipalId: input.ownerPrincipalId,
    payerPrincipalId: input.payerPrincipalId,
    subscriptionSignIn: true,
    routine: true,
    key: engineFallbackKey(input.engine.engine),
  };
}

export interface EngineFallbackCards {
  /** Raise the fix card unless one is open for this person and engine.
   * Whether a card was raised. */
  raise(input: EngineFallback): boolean;
  /** The notice ahead of due routines, as the same keyed card: nothing
   * when one is open for this person and engine. Whether it was raised. */
  raiseAhead(input: EngineReconnectAheadCard): boolean;
}

export function createEngineFallbackCards(deps: EngineFallbackCardsDeps): EngineFallbackCards {
  return {
    raise(input) {
      const { text, title } = engineFallbackWords(input);
      if (input.adminHomes) {
        // a server engine: one card per administrators' conversation, all
        // under the one "server" key, so the first open one covers the rest
        if (deps.pendingKeyed(engineFallbackKey(input.engine.engine), keyedCardPerson({}))) return false;
        const homes = input.adminHomes.filter((home) => home.audience.length);
        for (const home of homes) {
          const access = engineFallbackCard(input, home);
          deps.append(home.threadId, access, text);
          // the administrators read this conversation: the ring opens it
          deps.notify(access, home.threadId, text, title);
        }
        return homes.length > 0;
      }
      const access = engineFallbackCard(input);
      if (deps.pendingKeyed(access.key!, keyedCardPerson(access))) return false;
      deps.append(input.threadId, access, text);
      deps.notify(access, input.threadId, text, title, input.routineRunId);
      return true;
    },
    raiseAhead(input) {
      const access = engineReconnectAheadCard(input);
      if (deps.pendingKeyed(access.key!, keyedCardPerson(access))) return false;
      deps.append(input.threadId, access, input.detail);
      deps.notify(access, input.threadId, input.text, input.title);
      return true;
    },
  };
}
