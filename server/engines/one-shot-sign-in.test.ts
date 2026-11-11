import { describe, expect, it, vi } from "vitest";
import type { TurnAccessInput } from "../contracts.ts";
import { createOneShotSignIn, type OneShotAccount } from "./one-shot-sign-in.ts";

const bot = { id: "b1" };
const instance = { instanceId: "claude", driverKind: "claudeAgent" };
const personAccount: TurnAccessInput = { via: "subscription", identity: "subscription:p1", claudeConfigDir: "/data/principals/p1/claude" };
const REFUSED = "Failed to authenticate: OAuth session expired and could not be refreshed";

function fixture(overrides: { account?: () => Promise<OneShotAccount>; renew?: boolean } = {}) {
  const tell = vi.fn();
  const renew = vi.fn(async () => overrides.renew === true);
  const account = vi.fn(overrides.account ?? (async () => ({ access: personAccount, ranOn: { via: "subscription", payerPrincipalId: "p1" } })));
  const signIn = createOneShotSignIn<typeof bot, typeof instance, { cause: string; payerPrincipalId: string }>({
    account,
    refusalCard: (_bot, _instance, error) => (error as { card?: { cause: string; payerPrincipalId: string } }).card ?? null,
    signInCard: (_bot, _instance, ranOn, message) => ranOn?.via === "subscription" && ranOn.payerPrincipalId && /OAuth session expired/.test(message)
      ? { cause: "sign_in_expired", payerPrincipalId: ranOn.payerPrincipalId }
      : null,
    renew,
    tell,
  });
  return { signIn, tell, renew, account };
}

describe("one-shot sign-in (#3519)", () => {
  it("makes the one-shot call with the account the bot's turn resolves", async () => {
    const { signIn, account } = fixture();
    const call = vi.fn(async (access: TurnAccessInput | undefined) => access?.claudeConfigDir ?? "server");
    await expect(signIn.run(bot, instance, call)).resolves.toBe("/data/principals/p1/claude");
    expect(account).toHaveBeenCalledWith(bot, instance);
    expect(call).toHaveBeenCalledWith(personAccount);
  });

  it("tells the owner once when the person's sign-in is refused, never once per call", async () => {
    const { signIn, tell, renew } = fixture();
    const refused = async () => { throw new Error(REFUSED); };
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    expect(renew).toHaveBeenCalledWith(bot, instance, "p1");
    expect(tell).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenCalledWith(bot, { cause: "sign_in_expired", payerPrincipalId: "p1" });
    // signed in again: a later refusal is a new one, told again once
    await expect(signIn.run(bot, instance, async () => "ok")).resolves.toBe("ok");
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    expect(tell).toHaveBeenCalledTimes(2);
  });

  it("tells nobody for a passing failure: a renewed sign-in sends the call once more", async () => {
    const { signIn, tell, account } = fixture({ renew: true });
    let calls = 0;
    const flaky = async () => { calls += 1; if (calls === 1) throw new Error(REFUSED); return "done"; };
    await expect(signIn.run(bot, instance, flaky)).resolves.toBe("done");
    expect(calls).toBe(2);
    expect(account).toHaveBeenCalledTimes(2);
    // any other failure (a timeout, the provider busy) is never told
    await expect(signIn.run(bot, instance, async () => { throw new Error("Claude review timed out"); })).rejects.toThrow("timed out");
    expect(tell).not.toHaveBeenCalled();
  });

  it("tells once when the turn's resolution refuses the account, and never calls the engine", async () => {
    const lost = Object.assign(new Error("no engine access for this turn"), { card: { cause: "no_credentials", payerPrincipalId: "p1" } });
    const { signIn, tell } = fixture({ account: async () => { throw lost; } });
    const call = vi.fn(async () => "never");
    await expect(signIn.run(bot, instance, call)).rejects.toBe(lost);
    await expect(signIn.run(bot, instance, call)).rejects.toBe(lost);
    expect(call).not.toHaveBeenCalled();
    expect(tell).toHaveBeenCalledTimes(1);
    // the organization server unreachable is passing: no card
    const passing = fixture({ account: async () => { throw new Error("unreachable"); } });
    await expect(passing.signIn.run(bot, instance, call)).rejects.toThrow("unreachable");
    expect(passing.tell).not.toHaveBeenCalled();
  });
});
