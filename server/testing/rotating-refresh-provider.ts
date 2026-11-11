// #3661: a provider stand-in for unit tests of the two refresh paths
// (server/auth/idp-session.ts, server/org/org-routine-consent.ts). It rotates
// refresh tokens like the organization's provider: a rotated token presented
// again inside the reuse grace gets the pair already issued; later, the whole
// family is revoked and every token of it answers invalid_grant. It can lose
// the answer of a refresh after rotating (a timeout on the client's side) or
// refuse a connection before anything is sent. In-process only; imported by
// tests.
import type { RefreshOutcome } from "../auth/oidc-rp.ts";

export interface RotatingRefreshProvider {
  refresh(token: string, expect: { sub: string }): Promise<RefreshOutcome>;
  revokeToken(token: string): Promise<boolean>;
  /** Every refresh token presented, in order. */
  calls: string[];
  /** The refresh token the family holds now. */
  current(): string;
  /** The family was revoked (a reuse outside the grace). */
  revoked(): boolean;
  /** The next `count` refreshes rotate, then their answer is lost. */
  loseNextAnswers(count: number): void;
  /** The next refresh is refused before anything is sent (nothing rotates). */
  refuseNextConnection(): void;
}

export function rotatingRefreshProvider(options: { first: string; graceMs: number; now: () => number }): RotatingRefreshProvider {
  let current = options.first;
  let dead = false;
  let lose = 0;
  let refuse = false;
  let n = 0;
  const calls: string[] = [];
  const rotated = new Map<string, { at: number; answer: RefreshOutcome }>();
  const refused: RefreshOutcome = { ok: false, kind: "rejected", error: "the identity provider refused the refresh (invalid_grant)" };
  return {
    calls,
    current: () => current,
    revoked: () => dead,
    loseNextAnswers(count) {
      lose = count;
    },
    refuseNextConnection() {
      refuse = true;
    },
    async revokeToken() {
      return true;
    },
    async refresh(token) {
      calls.push(token);
      if (refuse) {
        refuse = false;
        return { ok: false, kind: "transient", error: "The identity provider could not be reached: connect ECONNREFUSED" };
      }
      if (dead) return refused;
      let answer: RefreshOutcome;
      const earlier = rotated.get(token);
      if (earlier) {
        if (options.now() - earlier.at > options.graceMs) {
          dead = true;
          return refused;
        }
        answer = earlier.answer;
      } else if (token !== current) {
        return refused;
      } else {
        n += 1;
        current = `pxlr1.rot${n}`;
        answer = { ok: true, refreshToken: current, accessToken: `pxlo1.acc${n}`, expiresIn: 3600 };
        rotated.set(token, { at: options.now(), answer });
      }
      if (lose > 0) {
        lose -= 1;
        return { ok: false, kind: "transient", answerLost: true, error: "The identity provider could not be reached: The operation was aborted due to timeout" };
      }
      return answer;
    },
  };
}
