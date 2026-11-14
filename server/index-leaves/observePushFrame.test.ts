import { describe, expect, it, vi } from "vitest";

import { PersonSignalGate } from "../../shared/signal-levels.ts";
import { ruleNotifyFrame } from "../notify.ts";
import { pushesForFrame } from "../push/frames.ts";
import { createObservePushFrame, decideNotifyPushes, type DecidedPushes } from "./observePushFrame.ts";

// #3719: the phone follows the one rule (server/notify.ts), and a frame sent
// to the admins only reaches the admins' phones, never the bot's owner.
function host(patch: Record<string, unknown> = {}) {
  const submit = vi.fn();
  const value = {
    IDENTITY: { kind: "perspicax" },
    store: { bot: () => ({ id: "b1", name: "Nova", ownerPrincipalId: "pr_member" }), botByThread: () => undefined, taskByThread: () => undefined },
    effectiveBotOwner: (bot: { ownerPrincipalId: string }) => bot.ownerPrincipalId,
    privateThreadOwner: (_task: unknown, owner: string) => owner,
    moderationAdminAudience: () => ["pr_admin"],
    pushesForFrame,
    viewerNotificationMuted: () => false,
    pushHub: { submit },
    pushSenderLook: () => undefined,
    now: () => 1,
    ...patch,
  };
  return { value, submit };
}

describe("observePushFrame (#3719)", () => {
  it("an admins-only ask goes to the admins' phones, never to the bot's owner", () => {
    const { value, submit } = host();
    const frame = { kind: "notify", notification: { kind: "admin-action", botId: "b1", botName: "Nova", threadId: "t1", title: "Refused", body: "x" } };
    createObservePushFrame(() => value)(frame, { adminOnly: true });
    expect(submit.mock.calls.map(([message]) => message.personId)).toEqual(["pr_admin"]);
  });

  it("the same ask for everyone goes to the bot's person", () => {
    const { value, submit } = host();
    const frame = { kind: "notify", notification: { kind: "admin-action", botId: "b1", botName: "Nova", threadId: "t1", title: "Stopped", body: "x" } };
    createObservePushFrame(() => value)(frame);
    expect(submit.mock.calls.map(([message]) => message.personId)).toEqual(["pr_member"]);
  });

  it("a frame the rule made silent sends no push", () => {
    const { value, submit } = host();
    createObservePushFrame(() => value)({ kind: "notify", notification: { kind: "done", botId: "b1", botName: "Nova", threadId: "t1", title: "Nova finished", body: "x", notify: false } });
    expect(submit).not.toHaveBeenCalled();
  });
});

// #4233: the gate decides once, on the frame's way out; the phone reuses it.
describe("one signal verdict for the desktop and the phone (#4233)", () => {
  const proposal = (id: string) => ({ kind: "notify", notification: { kind: "proposal", botId: "b1", botName: "Nova", threadId: "t1", title: "Renew", body: "x", proposalId: id } });
  const out = (value: Record<string, unknown>, frame: Record<string, unknown>) => {
    let decided: DecidedPushes | undefined;
    const ruled = ruleNotifyFrame(frame, { signal: () => { decided = decideNotifyPushes(value, frame); return decided.messages.map((message, index) => ({ person: message.personId, decision: decided!.decisions[index] })); } });
    createObservePushFrame(() => value)(ruled, {}, decided);
    return ruled;
  };

  it("counts the day's budget once per frame and holds the rest on every device", () => {
    const signalGate = new PersonSignalGate(() => ({ budget: 1, quiet: null }), () => Date.UTC(2026, 10, 13, 15, 0));
    const cardRaised = vi.fn();
    const { value, submit } = host({ signalGate, reachMeService: { allowsPush: () => true, cardRaised } });
    const first = out(value, proposal("p1"));
    expect((first.notification as { notify?: boolean }).notify).toBeUndefined();
    expect(signalGate.sentToday("pr_member")).toBe(1);
    const second = out(value, proposal("p2"));
    expect((second.notification as { notify?: boolean }).notify).toBe(false);
    expect(submit.mock.calls.map(([message]) => message.proposalId)).toEqual(["p1"]);
    // "Me joindre" still hears the held card, as before
    expect(cardRaised).toHaveBeenCalledTimes(2);
    expect(signalGate.takeHeld("pr_member")).toHaveLength(1);
  });
});
