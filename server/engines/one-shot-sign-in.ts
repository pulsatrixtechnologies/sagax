// #3519: a bot's one-shot model calls (the skill review, memory upkeep, the
// session summaries, thread titles, the permission review) sign in exactly as
// that bot's turn does. The account comes from the turn's own resolution
// (orgTurnAccess's resolveBotEngineAccess), never the sign-in this server
// keeps for itself, which may have expired while the person's account works.
//
// When such a call cannot sign in, the person who owns the bot is told once,
// on the same access card a refused turn shows, after the same single renew
// a refused turn gets (sign-in-recheck.ts): a sign-in that renews is a
// passing failure and nobody is told. The card is not shown again until a
// one-shot of that bot on that engine has signed in again.
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

export interface OneShotSignInDeps<B extends OneShotBot, I extends OneShotInstance, C> {
  /** The account the bot's turn signs in with, by the turn's own
   * resolution. Throws when nothing may serve (EngineAccessLost). */
  account(bot: B, instance: I): Promise<OneShotAccount>;
  /** The card a turn shows for that refusal, or null for a passing one (the
   * organization server unreachable) or anything else. */
  refusalCard(bot: B, instance: I, error: unknown): C | null;
  /** The card a turn shows when the provider refused the person's own
   * sign-in, or null when the failure is anything else. */
  signInCard(bot: B, instance: I, ranOn: OneShotRanOn | undefined, message: string): (C & { payerPrincipalId: string }) | null;
  /** One renew of that sign-in, as a refused turn gets; true when it works
   * again. Marks the sign-in expired on the person's engine card otherwise. */
  renew(bot: B, instance: I, payerPrincipalId: string): Promise<boolean>;
  /** Show the card in the bot's own chat and notify its owner. */
  tell(bot: B, card: C): void;
}

export interface OneShotSignIn<B extends OneShotBot, I extends OneShotInstance> {
  /** Run one call on the bot's account. `call` gets the access to pass to
   * the driver (undefined: the instance's own configuration, as a solo
   * turn). The call's own error is what the caller gets. */
  run<T>(bot: B, instance: I, call: (access: TurnAccessInput | undefined) => Promise<T>): Promise<T>;
}

export function createOneShotSignIn<B extends OneShotBot, I extends OneShotInstance, C>(deps: OneShotSignInDeps<B, I, C>): OneShotSignIn<B, I> {
  const told = new Set<string>();
  const keyOf = (bot: B, instance: I) => `${bot.id}\u0000${instance.instanceId}`;
  const tellOnce = (bot: B, instance: I, card: C) => {
    const key = keyOf(bot, instance);
    if (told.has(key)) return;
    told.add(key);
    try { deps.tell(bot, card); } catch { /* the call's own error still reaches its caller */ }
  };

  return {
    async run(bot, instance, call) {
      const resolve = async (): Promise<OneShotAccount> => {
        try {
          return await deps.account(bot, instance);
        } catch (error) {
          const card = deps.refusalCard(bot, instance, error);
          if (card) tellOnce(bot, instance, card);
          throw error;
        }
      };
      let account = await resolve();
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await call(account.access);
          told.delete(keyOf(bot, instance));
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const card = deps.signInCard(bot, instance, account.ranOn, message);
          if (!card) throw error;
          // A refusal renews once before anyone is told: renewed, the same
          // call goes once more on the account as it is now.
          if (attempt === 0 && await deps.renew(bot, instance, card.payerPrincipalId).catch(() => false)) {
            account = await resolve();
            continue;
          }
          tellOnce(bot, instance, card);
          throw error;
        }
      }
    },
  };
}
