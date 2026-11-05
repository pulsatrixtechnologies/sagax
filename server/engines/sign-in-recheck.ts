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

/** Engines whose sign-in Sagax can renew itself (subscription-access.ts). */
const RENEWABLE = new Set(["claudeAgent", "codex"]);

/** A failed renew is trusted this long: refusals right after it mark at once. */
export const SIGN_IN_RECHECK_COOLDOWN_MS = 60_000;

export interface SignInRecheckDeps {
  /** One renew of this person's sign-in; true when it left a usable token. */
  renew(principalId: string, driver: string): Promise<boolean>;
  markExpired(principalId: string, driver: string, slot: LoginSlot): void;
  clearExpired(principalId: string, driver: string, slot: LoginSlot): void;
  expired(principalId: string, driver: string, slot: LoginSlot): boolean;
  /** The sign-in works again: resume what waited on a reconnect. */
  onRestored?(principalId: string, driver: string): void;
  now?: () => number;
}

export interface SignInRecheck {
  /** The provider refused this sign-in: renew once, mark only on failure. */
  refused(principalId: string, driver: string, slot?: LoginSlot): Promise<void>;
  /** At start: one renew for each person whose sign-in is marked expired. */
  heal(people: readonly string[]): Promise<number>;
}

export function createSignInRecheck(deps: SignInRecheckDeps): SignInRecheck {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<boolean>>();
  const failedAt = new Map<string, number>();

  const renewOnce = (principalId: string, driver: string): Promise<boolean> => {
    const key = `${principalId}/${driver}`;
    const existing = inflight.get(key);
    if (existing) return existing;
    const flight = deps.renew(principalId, driver).catch(() => false).then((ok) => {
      if (ok) {
        failedAt.delete(key);
        deps.clearExpired(principalId, driver, "primary");
        deps.onRestored?.(principalId, driver);
      } else {
        failedAt.set(key, now());
      }
      return ok;
    }).finally(() => { inflight.delete(key); });
    inflight.set(key, flight);
    return flight;
  };

  return {
    async refused(principalId, driver, slot = "primary") {
      // No renew path (Grok, Kimi, a second sign-in): the refusal stands.
      if (slot !== "primary" || !RENEWABLE.has(driver)) {
        deps.markExpired(principalId, driver, slot);
        return;
      }
      const last = failedAt.get(`${principalId}/${driver}`);
      if (last !== undefined && now() - last < SIGN_IN_RECHECK_COOLDOWN_MS && !inflight.has(`${principalId}/${driver}`)) {
        deps.markExpired(principalId, driver, slot);
        return;
      }
      if (!(await renewOnce(principalId, driver))) deps.markExpired(principalId, driver, slot);
    },
    async heal(people) {
      let restored = 0;
      for (const principalId of people) {
        for (const driver of RENEWABLE) {
          if (!deps.expired(principalId, driver, "primary")) continue;
          if (await renewOnce(principalId, driver)) restored += 1;
        }
      }
      return restored;
    },
  };
}
