import { describe, expect, it, vi } from "vitest";
import type { TurnAccessInput } from "../contracts.ts";
import { classifyRoutineFailure } from "../routines/routine-recovery.ts";
import { signInExpiredCard } from "./engine-access.ts";
import { createOneShotSignIn, type OneShotAccount, type OneShotRanOn } from "./one-shot-sign-in.ts";

const bot = { id: "b1" };
const instance = { instanceId: "claude", driverKind: "claudeAgent" };
const personAccount: TurnAccessInput = { via: "subscription", identity: "subscription:p1", claudeConfigDir: "/data/principals/p1/claude" };
const REFUSED = "Failed to authenticate: OAuth session expired and could not be refreshed";
const USAGE_LIMIT = "Claude AI usage limit reached. You've hit your limit, resets 3am";
const EXTRA_USAGE = "This model runs on extra usage for your account, and those credits are used up.";

/** The card a turn would show (subscriptionExpiredCard), by its own rule. */
function signInRefusal(_bot: { id: string }, _instance: unknown, ranOn: OneShotRanOn | undefined, message: string) {
  return signInExpiredCard({
    identity: "perspicax", via: ranOn?.via, subscriptionDriver: true, message, payerPrincipalId: ranOn?.payerPrincipalId,
    botId: "b1", ownerPrincipalId: "p1", engine: "Claude",
  });
}

function fixture(overrides: { account?: () => Promise<OneShotAccount>; renew?: boolean | (() => Promise<boolean>) } = {}) {
  // What #3533 had: a card in the chat and a notification. Nothing may reach it.
  const tell = vi.fn();
  const notify = vi.fn();
  const log = vi.fn();
  const signedIn = vi.fn();
  const renew = vi.fn(typeof overrides.renew === "function" ? overrides.renew : async () => overrides.renew === true);
  const account = vi.fn(overrides.account ?? (async () => ({ access: personAccount, ranOn: { via: "subscription", payerPrincipalId: "p1" } })));
  const deps = {
    account,
    verdict: (message: string) => classifyRoutineFailure(message),
    signInRefusal,
    renew,
    signedIn,
    log,
    redact: (text: string) => text.replace(/sk-[\w-]+/g, "[redacted]"),
    // #3533's own surfaces, kept here so a path that still used them shows red
    signInCard: (b: { id: string }, i: unknown, ranOn: OneShotRanOn | undefined, message: string) => signInRefusal(b, i, ranOn, message),
    refusalCard: (_b: unknown, _i: unknown, error: unknown) => (error as { card?: unknown }).card ?? null,
    tell: (...args: unknown[]) => { tell(...args); notify(...args); },
  };
  const signIn = createOneShotSignIn<typeof bot, typeof instance>(deps as never);
  return { signIn, tell, notify, renew, account, log, signedIn };
}

describe("one-shot sign-in (#3519, #3551)", () => {
  it("makes the one-shot call with the account the bot's turn resolves", async () => {
    const { signIn, account } = fixture();
    const call = vi.fn(async (access: TurnAccessInput | undefined) => access?.claudeConfigDir ?? "server");
    await expect(signIn.run(bot, instance, call)).resolves.toBe("/data/principals/p1/claude");
    expect(account).toHaveBeenCalledWith(bot, instance);
    expect(call).toHaveBeenCalledWith(personAccount);
  });

  it("#3551: a usage limit tells nobody, renews nothing and is logged once per account and cause", async () => {
    const { signIn, tell, notify, renew, log } = fixture();
    const limited = async () => { throw new Error(`${USAGE_LIMIT} sk-ant-secret-token`); };
    for (let i = 0; i < 3; i += 1) await expect(signIn.run(bot, instance, limited)).rejects.toThrow("usage limit");
    expect(tell).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("usage_limit");
    expect(line).toContain("Claude AI usage limit reached");
    expect(line).not.toContain("sk-ant-secret-token");
    expect(line).not.toContain("p1");
  });

  it("#3551: used-up extra-usage credit is a limit, not a refused sign-in", async () => {
    const { signIn, tell, notify, renew } = fixture();
    await expect(signIn.run(bot, instance, async () => { throw new Error(EXTRA_USAGE); })).rejects.toThrow("extra usage");
    // the canonical sign-in sentence wrapping a limit is still a limit (the turn's order)
    await expect(signIn.run(bot, instance, async () => {
      throw new Error(`Claude's sign-in has expired. Reconnect Claude in Settings. Claude said: ${USAGE_LIMIT}`);
    })).rejects.toThrow("sign-in");
    expect(tell).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
  });

  it("#3551: 34 bots of one person and one refused sign-in: one renew (one record), no chat card", async () => {
    let release: (ok: boolean) => void = () => {};
    const { signIn, tell, notify, renew, log } = fixture({ renew: () => new Promise<boolean>((resolve) => { release = resolve; }) });
    const bots = Array.from({ length: 34 }, (_, i) => ({ id: `b${i}` }));
    const refused = async () => { throw new Error(REFUSED); };
    const runs = bots.map((b) => signIn.run(b, instance, refused));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(false);
    for (const run of runs) await expect(run).rejects.toThrow(REFUSED);
    // a later pass on the same account records nothing more
    await expect(signIn.run(bots[0]!, instance, refused)).rejects.toThrow(REFUSED);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(bots[0], instance, "p1");
    expect(tell).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a renewed sign-in sends the call once more and tells nobody", async () => {
    const { signIn, tell, account, signedIn } = fixture({ renew: true });
    let calls = 0;
    const flaky = async () => { calls += 1; if (calls === 1) throw new Error(REFUSED); return "done"; };
    await expect(signIn.run(bot, instance, flaky)).resolves.toBe("done");
    expect(calls).toBe(2);
    expect(account).toHaveBeenCalledTimes(2);
    expect(signedIn).toHaveBeenCalledWith(bot, instance, { via: "subscription", payerPrincipalId: "p1" });
    await expect(signIn.run(bot, instance, async () => { throw new Error("Claude review timed out"); })).rejects.toThrow("timed out");
    expect(tell).not.toHaveBeenCalled();
  });

  it("a call that signs in again lets a later refusal renew once more", async () => {
    const { signIn, renew } = fixture();
    const refused = async () => { throw new Error(REFUSED); };
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    expect(renew).toHaveBeenCalledTimes(1);
    await expect(signIn.run(bot, instance, async () => "ok")).resolves.toBe("ok");
    await expect(signIn.run(bot, instance, refused)).rejects.toThrow(REFUSED);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("an account the turn's resolution refuses tells nobody and never calls the engine", async () => {
    const lost = Object.assign(new Error("no engine access for this turn"), { detail: "no_credentials", card: { cause: "no_credentials", payerPrincipalId: "p1" } });
    const { signIn, tell, notify, log } = fixture({ account: async () => { throw lost; } });
    const call = vi.fn(async () => "never");
    await expect(signIn.run(bot, instance, call)).rejects.toBe(lost);
    await expect(signIn.run(bot, instance, call)).rejects.toBe(lost);
    expect(call).not.toHaveBeenCalled();
    expect(tell).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
