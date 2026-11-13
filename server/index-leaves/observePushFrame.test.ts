import { describe, expect, it, vi } from "vitest";

import { pushesForFrame } from "../push/frames.ts";
import { createObservePushFrame } from "./observePushFrame.ts";

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
