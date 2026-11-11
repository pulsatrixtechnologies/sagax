// #3519: a bot's one-shot model calls (the skill review, memory upkeep, the
// session summaries, thread titles, the permission review) sign in exactly as
// that bot's turn does. The account comes from the turn's own resolution
// (orgTurnAccess's resolveBotEngineAccess), never the sign-in this server
// keeps for itself, which may have expired while the person's account works.
//
// #3551: background work tells nobody. A one-shot call that fails (a usage
// limit, used-up credit, a rate limit, an overload, an account the turn's
// resolution refuses) fails for its caller as any call does, is tried again
// at its next pass and is written once to the server log per account and
// cause. Whether a failure is a refused sign-in is the turn's own verdict
// (classifyRoutineFailure, the order a refused turn reads it in: a limit or
// credit first, a sign-in after), never a second copy of that rule. A truly
// refused sign-in gets the single renew a refused turn gets
// (sign-in-recheck.ts), once per account however many bots call on it; a
// renew that fails marks the sign-in expired on the person's engine card,
// where that state already lives, and the card a person reads is the one a
// refused turn shows when they talk to the bot. No chat card and no
// notification of its own, ever.
import type { TurnAccessInput } from "../contracts.ts";

/** What a turn records of the account it ran on (turnAccessByThread). */
export interface OneShotRanOn {
  via: string;
  payerPrincipalId?: string;
  routine?: true;
}

export interface OneShotAccount {
  access?: TurnAccessInput;
  ranOn?: OneShotRanOn;
}

export interface OneShotBot { id: string }
export interface OneShotInstance { instanceId: string; driverKind: string }

/** The turn's verdict on a failure (routine-recovery.ts classifyRoutineFailure). */
export interface OneShotVerdict { kind: string; cause?: string }

/** How much of the provider's own words the log keeps. */
export const ONE_SHOT_LOG_WORDS = 200;

export interface OneShotSignInDeps<B extends OneShotBot, I extends OneShotInstance> {
  /** The account the bot's turn signs in with, by the turn's own
   * resolution. Throws when nothing may serve (EngineAccessLost). */
  account(bot: B, instance: I): Promise<OneShotAccount>;
  /** The turn's own verdict on a failure's words (classifyRoutineFailure). */
  verdict(message: string): OneShotVerdict;
  /** The refused sign-in a turn would show a card for (the person's own
   * subscription refused, subscriptionExpiredCard), or null for anything
   * else. Read only once the verdict is not a limit, credit or retry. */
  signInRefusal(bot: B, instance: I, ranOn: OneShotRanOn | undefined, message: string): { payerPrincipalId: string } | null;
  /** One renew of that sign-in, as a refused turn gets; true when it works
   * again. Marks the sign-in expired on the person's engine card otherwise. */
  renew(bot: B, instance: I, payerPrincipalId: string): Promise<boolean>;
  /** A call on this account signed in: what waited on its sign-in closes. */
  signedIn?(bot: B, instance: I, ranOn: OneShotRanOn | undefined): void;
  /** One server log line. */
  log(line: string): void;
  /** Takes tokens out of the provider's words before they are logged. */
  redact?(text: string): string;
}

export interface OneShotSignIn<B extends OneShotBot, I extends OneShotInstance> {
  /** Run one call on the bot's account. `call` gets the access to pass to
   * the driver (undefined: the instance's own configuration, as a solo
   * turn). The call's own error is what the caller gets. */
  run<T>(bot: B, instance: I, call: (access: TurnAccessInput | undefined) => Promise<T>): Promise<T>;
}

/** A failure the turn reads as a limit, used-up credit or a passing one
 * (rate limit, overload, stall): never a refused sign-in. */
function limitOrPassing(verdict: OneShotVerdict): boolean {
  return verdict.kind === "retry" || verdict.kind === "busy" || (verdict.kind === "owner" && verdict.cause !== "signed_out");
}

export function createOneShotSignIn<B extends OneShotBot, I extends OneShotInstance>(deps: OneShotSignInDeps<B, I>): OneShotSignIn<B, I> {
  /** Accounts whose sign-in was refused after its renew: no renew again and
   * nothing recorded again until a call on them signs in. */
  const refused = new Set<string>();
  /** One renew per account at a time, however many bots fail on it. */
  const renewing = new Map<string, Promise<boolean>>();
  /** Account and cause already in the log. */
  const logged = new Set<string>();

  const accountKey = (instance: I, ranOn: OneShotRanOn | undefined) =>
    `${ranOn?.payerPrincipalId?.trim().toLowerCase() ?? ""}\u0000${instance.driverKind}\u0000${instance.instanceId}`;
  const logOnce = (key: string, cause: string, instance: I, words: string) => {
    const id = `${key}\u0000${cause}`;
    if (logged.has(id)) return;
    if (logged.size >= 5_000) logged.clear();
    logged.add(id);
    const said = (deps.redact ? deps.redact(words) : words).replace(/\s+/g, " ").trim().slice(0, ONE_SHOT_LOG_WORDS);
    try { deps.log(`[one-shot] ${instance.instanceId}: a one-shot call failed (${cause}), tried again at its next pass: ${said}`); } catch { /* the call's own error still reaches its caller */ }
  };
  const settled = (key: string) => {
    refused.delete(key);
    for (const id of logged) if (id.startsWith(`${key}\u0000`)) logged.delete(id);
  };
  const renewOnce = (bot: B, instance: I, key: string, payer: string): Promise<boolean> => {
    const pending = renewing.get(key);
    if (pending) return pending;
    const flight = deps.renew(bot, instance, payer).catch(() => false).then((ok) => {
      if (!ok) refused.add(key);
      return ok;
    }).finally(() => { renewing.delete(key); });
    renewing.set(key, flight);
    return flight;
  };

  return {
    async run(bot, instance, call) {
      const resolve = async (): Promise<OneShotAccount> => {
        try {
          return await deps.account(bot, instance);
        } catch (error) {
          const detail = (error as { detail?: unknown } | null)?.detail;
          logOnce(accountKey(instance, undefined), typeof detail === "string" && detail ? detail : "no_access", instance,
            error instanceof Error ? error.message : String(error));
          throw error;
        }
      };
      let account = await resolve();
      for (let attempt = 0; ; attempt += 1) {
        const key = accountKey(instance, account.ranOn);
        try {
          const result = await call(account.access);
          settled(key);
          try { deps.signedIn?.(bot, instance, account.ranOn); } catch { /* the call's result still reaches its caller */ }
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const verdict = deps.verdict(message);
          const refusal = limitOrPassing(verdict) ? null : deps.signInRefusal(bot, instance, account.ranOn, message);
          if (!refusal) {
            logOnce(key, verdict.cause ?? verdict.kind, instance, message);
            throw error;
          }
          logOnce(key, "sign_in_refused", instance, message);
          // Refused after its renew already: recorded once, nothing more.
          if (refused.has(key) || attempt > 0) throw error;
          // The single renew a refused turn gets: renewed, the same call goes
          // once more on the account as it is now.
          if (await renewOnce(bot, instance, key, refusal.payerPrincipalId)) {
            account = await resolve();
            continue;
          }
          throw error;
        }
      }
    },
  };
}
