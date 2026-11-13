// #2040: a passing refusal never signs a person out.
//
// A turn cut during a server update, a refresh race or a `claude auth
// status` that answers too early used to write the expired marker
// (#1533) at once. Once written, access resolution skips the subscription,
// no turn runs, nothing renews, and the person has to reconnect by hand.
// Here a refusal first tries one renew (the same single flight turns use
// for Claude); the marker is written only when that renew fails. At start,
// every person who already carries a marker gets one renew, so an update
// heals them instead of leaving them out.
import type { LoginSlot } from "./principal-engine-logins.ts";
import { reportBackgroundError } from "../background-error.ts";

/** Engines whose sign-in Sagax can renew itself (subscription-access.ts). */
const RENEWABLE = new Set(["claudeAgent", "codex"]);

/** A failed renew is trusted this long: refusals right after it mark at once. */
export const SIGN_IN_RECHECK_COOLDOWN_MS = 60_000;

export interface SignInRecheckDeps {
  /** One renew of this person's sign-in; true when it left a usable token. */
  /** #2384: `instanceId` is the account (an added `<prefix>-<uuid>` has its
   * own folder); undefined is the provider's own account. */
  renew(principalId: string, driver: string, instanceId?: string): Promise<boolean>;
  markExpired(principalId: string, driver: string, slot: LoginSlot, instanceId?: string): void;
  clearExpired(principalId: string, driver: string, slot: LoginSlot, instanceId?: string): void;
  expired(principalId: string, driver: string, slot: LoginSlot, instanceId?: string): boolean;
  /** #2384: every account folder of this person for a driver (heal walks
   * each); without it, the provider's own account only. */
  accounts?(principalId: string, driver: string): Array<string | undefined>;
  /** The sign-in works again: resume what waited on a reconnect. */
  onRestored?(principalId: string, driver: string, instanceId?: string): void;
  now?: () => number;
}

export interface SignInRecheck {
  /** The provider refused this sign-in: renew once, mark only on failure.
   * True when the sign-in works again (the renew left a usable token). */
  refused(principalId: string, driver: string, slot?: LoginSlot, instanceId?: string): Promise<boolean>;
  /** Whether a refusal now gets a renew (a renewable engine, its primary
   * sign-in, no failed renew in the cooldown). False: it marks at once. */
  renewable(principalId: string, driver: string, slot?: LoginSlot, instanceId?: string): boolean;
  /** At start: one renew for each person whose sign-in is marked expired. */
  heal(people: readonly string[]): Promise<number>;
  /** #4192: one renew of this sign-in on demand (any engine `renew` knows,
   * Grok included), in the same single flight; when it works, the same
   * restore as a refusal's renew (marker cleared, held runs resumed, open
   * sign-in cards closed). A failure marks nothing. */
  restore(principalId: string, driver: string, instanceId?: string): Promise<boolean>;
}

export function createSignInRecheck(deps: SignInRecheckDeps): SignInRecheck {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<boolean>>();
  const failedAt = new Map<string, number>();

  const keyOf = (principalId: string, driver: string, instanceId?: string): string =>
    instanceId ? `${principalId}/${driver}/${instanceId}` : `${principalId}/${driver}`;

  const renewOnce = (principalId: string, driver: string, instanceId?: string): Promise<boolean> => {
    const key = keyOf(principalId, driver, instanceId);
    const existing = inflight.get(key);
    if (existing) return existing;
    const flight = deps.renew(principalId, driver, instanceId).catch(() => false).then((ok) => {
      if (ok) {
        failedAt.delete(key);
        deps.clearExpired(principalId, driver, "primary", instanceId);
        deps.onRestored?.(principalId, driver, instanceId);
      } else {
        failedAt.set(key, now());
      }
      return ok;
    }).finally(() => { inflight.delete(key); });
    inflight.set(key, flight);
    return flight;
  };

  const renewable = (principalId: string, driver: string, slot: LoginSlot = "primary", instanceId?: string): boolean => {
    // No renew path (Grok, Kimi, a second sign-in): the refusal stands.
    if (slot !== "primary" || !RENEWABLE.has(driver)) return false;
    const key = keyOf(principalId, driver, instanceId);
    const last = failedAt.get(key);
    return !(last !== undefined && now() - last < SIGN_IN_RECHECK_COOLDOWN_MS && !inflight.has(key));
  };

  return {
    renewable,
    restore: renewOnce,
    async refused(principalId, driver, slot = "primary", instanceId) {
      if (!renewable(principalId, driver, slot, instanceId)) {
        deps.markExpired(principalId, driver, slot, instanceId);
        return false;
      }
      if (await renewOnce(principalId, driver, instanceId)) return true;
      deps.markExpired(principalId, driver, slot, instanceId);
      return false;
    },
    async heal(people) {
      let restored = 0;
      for (const principalId of people) {
        for (const driver of RENEWABLE) {
          for (const instanceId of deps.accounts?.(principalId, driver) ?? [undefined]) {
            if (!deps.expired(principalId, driver, "primary", instanceId)) continue;
            if (await renewOnce(principalId, driver, instanceId)) restored += 1;
          }
        }
      }
      return restored;
    },
  };
}

/** How long a refused turn waits for its one renew before the person sees
 * the card anyway (the CLI renew gives up after 20 s; two flights can chain). */
export const SIGN_IN_REFUSAL_HOLD_MS = 45_000;

export interface SignInRefusalInput {
  principalId: string;
  driver: string;
  slot?: LoginSlot;
  /** #2384: the account refused (an added account has its own folder). */
  instanceId?: string;
  /** Show the expired card (and its notice): the renew really failed. */
  show(): void;
  /** The renew worked: run the refused turn again. False when it cannot
   * run again (already retried once, a routine, the person moved on). */
  retry(): boolean;
  /** The renew worked but the turn is not run again: the failure, plainly. */
  fail(): void;
  holdMs?: number;
  /** Test seam for the hold's bound. */
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** #2057: a sign-in refusal waits for its one renew before anything reaches
 * the person. The renew works: no card, the turn runs again once. It fails
 * (or outlasts the hold): the card. True when the refusal is held, so the
 * caller leaves its failure bookkeeping (incident, notice) to this. */
export function settleSignInRefusal(recheck: SignInRecheck | null | undefined, input: SignInRefusalInput): boolean {
  const slot = input.slot ?? "primary";
  if (!recheck || !recheck.renewable(input.principalId, input.driver, slot, input.instanceId)) {
    input.show();
    void recheck?.refused(input.principalId, input.driver, slot, input.instanceId).catch(() => false);
    return false;
  }
  let settled = false;
  const settle = (restored: boolean) => {
    if (settled) return;
    settled = true;
    if (!restored) input.show();
    else if (!input.retry()) input.fail();
  };
  const setTimer = input.setTimer ?? ((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    (timer as { unref?: () => void }).unref?.();
    return timer;
  });
  setTimer(() => settle(false), input.holdMs ?? SIGN_IN_REFUSAL_HOLD_MS);
  void recheck.refused(input.principalId, input.driver, slot, input.instanceId).then(settle, () => settle(false)).catch(reportBackgroundError);
  return true;
}
