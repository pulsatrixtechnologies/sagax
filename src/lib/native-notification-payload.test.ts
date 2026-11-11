import { describe, expect, it } from "vitest";

import {
  buildNativeNotificationPayload,
  notificationBodyPreview,
  notificationGroupKey,
  notificationTypeEnabled,
  notificationTypeFor,
  type NotificationTypeSettings,
} from "./native-notification-payload";

const typesOn: NotificationTypeSettings = {
  bots: true,
  people: true,
  groups: true,
  approvals: true,
};

describe("notificationTypeFor", () => {
  it("maps bot replies, people, groups and approvals", () => {
    expect(notificationTypeFor("done")).toBe("bots");
    expect(notificationTypeFor("done", "room-1")).toBe("groups");
    expect(notificationTypeFor("message")).toBe("people");
    expect(notificationTypeFor("message", "room-1")).toBe("people");
    expect(notificationTypeFor("approval")).toBe("approvals");
    expect(notificationTypeFor("question")).toBe("approvals");
    expect(notificationTypeFor("needs-you")).toBe("approvals");
    // #3719: a routine that failed or waits never interrupts: no switch
    expect(notificationTypeFor("routine-failed")).toBeNull();
    expect(notificationTypeFor("routine-deferred")).toBeNull();
    expect(notificationTypeFor("spend")).toBeNull();
    expect(notificationTypeFor("report")).toBeNull();
  });
});

describe("notificationTypeEnabled", () => {
  it("follows the matching switch and always allows spend", () => {
    expect(notificationTypeEnabled("done", null, { ...typesOn, bots: false })).toBe(false);
    expect(notificationTypeEnabled("done", "g1", { ...typesOn, groups: false })).toBe(false);
    expect(notificationTypeEnabled("message", null, { ...typesOn, people: false })).toBe(false);
    expect(notificationTypeEnabled("approval", null, { ...typesOn, approvals: false })).toBe(false);
    expect(notificationTypeEnabled("spend", null, { ...typesOn, bots: false })).toBe(true);
  });
});

describe("notificationGroupKey", () => {
  it("groups by chat thread so one banner replaces the previous", () => {
    expect(notificationGroupKey({ kind: "done", threadId: "t-1", botId: "b" })).toBe("sagax:chat:t-1");
    expect(notificationGroupKey({ kind: "done", threadId: "t-2", botId: "b" })).toBe("sagax:chat:t-2");
    expect(notificationGroupKey({ kind: "spend", threadId: "t-1" })).toBe("sagax:spend");
  });
});

describe("notificationBodyPreview", () => {
  it("strips markdown and caps length", () => {
    expect(notificationBodyPreview("**Hello** [x](https://x.test)")).toBe("Hello x");
    expect(notificationBodyPreview("x".repeat(200)).length).toBe(140);
    expect(notificationBodyPreview("x".repeat(200)).endsWith("…")).toBe(true);
  });
});

describe("buildNativeNotificationPayload", () => {
  const base = {
    kind: "done" as const,
    senderName: "Scout",
    body: "All **done** with the report",
    threadId: "thread-1",
    botId: "bot-1",
    windowFocused: false,
    activeThreadId: null as string | null,
    platform: "darwin",
    typeSettings: typesOn,
  };

  it("uses the sender as title and a plain body on macOS", () => {
    const payload = buildNativeNotificationPayload(base);
    expect(payload).toMatchObject({
      show: true,
      title: "Scout",
      subtitle: "",
      body: "All done with the report",
      groupKey: "sagax:chat:thread-1",
      replaceId: "sagax:chat:thread-1",
      hasReply: false,
      type: "bots",
      count: 1,
    });
  });

  it("puts the group name in the macOS subtitle and folds it on Windows", () => {
    const mac = buildNativeNotificationPayload({ ...base, groupName: "Ops", groupId: "ops" });
    expect(mac).toMatchObject({ title: "Scout", subtitle: "Ops", type: "groups" });
    const win = buildNativeNotificationPayload({
      ...base,
      groupName: "Ops",
      groupId: "ops",
      platform: "win32",
    });
    expect(win).toMatchObject({ title: "Scout · Ops", subtitle: "" });
  });

  it("suppresses when the focused window already shows that chat", () => {
    expect(
      buildNativeNotificationPayload({
        ...base,
        windowFocused: true,
        activeThreadId: "thread-1",
      }).show,
    ).toBe(false);
    expect(
      buildNativeNotificationPayload({
        ...base,
        kind: "spend",
        windowFocused: true,
        activeThreadId: "thread-1",
      }).show,
    ).toBe(true);
  });

  it("still shows when another conversation is focused", () => {
    expect(
      buildNativeNotificationPayload({
        ...base,
        windowFocused: true,
        activeThreadId: "other",
      }).show,
    ).toBe(true);
  });

  it("stacks a count into the body for a replaced chat banner", () => {
    const payload = buildNativeNotificationPayload({ ...base, pendingCount: 2, body: "Third" });
    expect(payload.count).toBe(3);
    expect(payload.body).toBe("3 messages: Third");
  });

  it("offers hasReply when the chat can take a reply", () => {
    expect(buildNativeNotificationPayload({ ...base, canReply: true }).hasReply).toBe(true);
    expect(
      buildNativeNotificationPayload({
        ...base,
        canReply: true,
        windowFocused: true,
        activeThreadId: "thread-1",
      }).hasReply,
    ).toBe(false);
  });

  it("hides when the type switch is off", () => {
    expect(
      buildNativeNotificationPayload({
        ...base,
        typeSettings: { ...typesOn, bots: false },
      }).show,
    ).toBe(false);
  });
});

describe("buildNativeNotificationPayload: the bot's notify choice", () => {
  const base = {
    kind: "done" as const,
    senderName: "Scout",
    body: "Step 2 of 5 done",
    threadId: "t-1",
    botId: "b-1",
    windowFocused: false,
    activeThreadId: null,
    platform: "darwin",
    typeSettings: typesOn,
  };
  it("notify false writes no banner, even unfocused on another chat", () => {
    expect(buildNativeNotificationPayload({ ...base, notify: false }).show).toBe(false);
    expect(buildNativeNotificationPayload({ ...base, kind: "message", notify: false }).show).toBe(false);
  });
  it("notify true or absent keeps the banner", () => {
    expect(buildNativeNotificationPayload({ ...base, notify: true }).show).toBe(true);
    expect(buildNativeNotificationPayload(base).show).toBe(true);
  });
});
