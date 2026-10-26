import { describe, expect, it } from "vitest";

import { APPROVAL_SOUND, buildApnsRequest, collapseId, NUDGE_SOUND, pushCategory, type PushMessage } from "./payload.ts";

const message = (patch: Partial<PushMessage> = {}): PushMessage => ({
  kind: "message",
  personId: "pr_bob",
  title: "Alice",
  body: "Are you there?",
  threadId: "t_people_1",
  groupId: "g_people_1",
  at: 1_000,
  ...patch,
});

describe("APNs payload", () => {
  it("carries the alert, the thread and the keys the phone opens it with", () => {
    const request = buildApnsRequest({ message: message(), bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000 });
    const body = JSON.parse(request.body);
    expect(body.aps.alert).toEqual({ title: "Alice", body: "Are you there?" });
    expect(body.aps["thread-id"]).toBe("t_people_1");
    expect(body.aps.sound).toBe("default");
    expect(body.aps["content-available"]).toBe(1);
    expect(body.aps["mutable-content"]).toBeUndefined();
    expect(body.senderName).toBeUndefined();
    expect(body.avatarUrl).toBeUndefined();
    // a conversation between people opens by its group
    expect(body).toMatchObject({ kind: "message", threadId: "t_people_1", botId: "g_people_1", groupId: "g_people_1" });
    expect(request.headers).toMatchObject({
      "apns-push-type": "alert",
      "apns-topic": "ca.pulsatrix.sagax",
      "apns-priority": "5",
      "apns-collapse-id": "sagax.t.t_people_1",
      "apns-expiration": String(2_000 + 24 * 60 * 60),
    });
  });

  it("a nudge is priority 10, time sensitive, with the wizz and the phone's own strings", () => {
    const request = buildApnsRequest({
      message: message({ kind: "nudge", title: "Alice sent you a nudge", body: "Open the conversation to answer.", titleLocKey: "%@ sent you a nudge", titleLocArgs: ["Alice"], bodyLocKey: "Open the conversation to answer.", id: "n1", fromId: "pr_alice" }),
      bundleId: "ca.pulsatrix.sagax",
      nowMs: 2_000_000,
    });
    const body = JSON.parse(request.body);
    expect(request.headers["apns-priority"]).toBe("10");
    expect(request.headers["apns-expiration"]).toBe(String(2_000 + 300));
    expect(body.aps.sound).toBe(NUDGE_SOUND);
    expect(body.aps["interruption-level"]).toBe("time-sensitive");
    expect(body.aps.alert).toMatchObject({ "title-loc-key": "%@ sent you a nudge", "title-loc-args": ["Alice"], "loc-key": "Open the conversation to answer." });
    expect(body).toMatchObject({ kind: "nudge", id: "n1", fromId: "pr_alice" });
  });

  it("follows the device's and the person's sound switches", () => {
    const silent = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", settings: { sound: false }, nowMs: 0 }).body);
    expect(silent.aps.sound).toBeUndefined();
    const personOff = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSound: false, nowMs: 0 }).body);
    expect(personOff.aps.sound).toBeUndefined();
    const nudgeNoWizz = JSON.parse(buildApnsRequest({ message: message({ kind: "nudge" }), bundleId: "x", settings: { nudgeSound: false }, nowMs: 0 }).body);
    expect(nudgeNoWizz.aps.sound).toBe("default");
  });

  it("clips long text and keeps the collapse id within 64 bytes", () => {
    const long = buildApnsRequest({ message: message({ body: "word ".repeat(200) }), bundleId: "x", nowMs: 0 });
    expect(JSON.parse(long.body).aps.alert.body.length).toBeLessThanOrEqual(240);
    const id = collapseId({ kind: "message", threadId: "t_".padEnd(120, "x") });
    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(64);
    expect(id.startsWith("sagax.h.")).toBe(true);
    expect(collapseId({ kind: "achievement" })).toBe("sagax.achievement");
  });

  it("a bot message is a communication notification: mutable-content, sender name, avatar path", () => {
    const request = buildApnsRequest({
      message: message({
        kind: "message",
        title: "Scout finished",
        body: "Pushed the branch.",
        threadId: "t_scout",
        botId: "scout",
        groupId: undefined,
        senderName: "Scout",
        senderId: "scout",
        avatarUrl: "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp",
      }),
      bundleId: "ca.pulsatrix.sagax",
      nowMs: 2_000_000,
    });
    const body = JSON.parse(request.body);
    expect(body.aps["mutable-content"]).toBe(1);
    expect(body.aps.alert).toEqual({ title: "Scout", body: "Pushed the branch." });
    expect(body.aps["thread-id"]).toBe("t_scout");
    expect(body).toMatchObject({
      kind: "message",
      threadId: "t_scout",
      botId: "scout",
      senderName: "Scout",
      senderId: "scout",
      avatarUrl: "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp",
    });
  });

  it("still names the bot when the avatar path is missing or not a stored image", () => {
    const noAvatar = JSON.parse(buildApnsRequest({
      message: message({ botId: "scout", senderName: "Scout", title: "Scout finished" }),
      bundleId: "x",
      nowMs: 0,
    }).body);
    expect(noAvatar.aps["mutable-content"]).toBe(1);
    expect(noAvatar.aps.alert.title).toBe("Scout");
    expect(noAvatar.senderName).toBe("Scout");
    expect(noAvatar.avatarUrl).toBeUndefined();

    const tracker = JSON.parse(buildApnsRequest({
      message: message({
        botId: "scout",
        senderName: "Scout",
        avatarUrl: "https://tracker.example.test/pixel.png",
      }),
      bundleId: "x",
      nowMs: 0,
    }).body);
    expect(tracker.avatarUrl).toBeUndefined();
    expect(tracker.aps["mutable-content"]).toBe(1);
    expect(tracker.senderName).toBe("Scout");
  });

  it("accepts a person's versioned avatar on this server", () => {
    const body = JSON.parse(buildApnsRequest({
      message: message({
        senderName: "Alice",
        senderId: "pr_alice",
        avatarUrl: "/api/people/pr_alice/avatar?v=0a1b2c",
      }),
      bundleId: "x",
      nowMs: 0,
    }).body);
    expect(body.avatarUrl).toBe("/api/people/pr_alice/avatar?v=0a1b2c");
    expect(body.aps["mutable-content"]).toBe(1);
    expect(body.aps.alert.title).toBe("Alice");
  });

  it("an achievement is not a communication notification", () => {
    const body = JSON.parse(buildApnsRequest({
      message: message({ kind: "achievement", title: "Achievement unlocked", body: "First chat", threadId: undefined, groupId: undefined }),
      bundleId: "x",
      nowMs: 0,
    }).body);
    expect(body.aps["mutable-content"]).toBeUndefined();
    expect(body.aps.alert.title).toBe("Achievement unlocked");
    expect(body.senderName).toBeUndefined();
  });
});

describe("an approval push", () => {
  it("shows the bot as sender and, under it, what it would allow; the tap carries the request", () => {
    const request = buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval", title: "Allow Cryptic to run a command?", body: "Run echo hi.", senderName: "Cryptic", botId: "b1", requestId: "req-1" }),
      bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000,
    });
    const body = JSON.parse(request.body);
    expect(body.aps.alert).toEqual({ title: "Cryptic", subtitle: "Allow Cryptic to run a command?", body: "Run echo hi." });
    expect(body.aps.category).toBe("SAGAX_APPROVAL");
    expect(body.aps.sound).toBe(APPROVAL_SOUND);
    expect(body.requestId).toBe("req-1");
    expect(body.prompt).toBe("approval");
  });
  it("a key-protected approval opens the app, and a question has no actions", () => {
    const keyed = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval", needsKey: true, requestId: "req-2", title: "Allow?" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(keyed.aps.category).toBe("SAGAX_APPROVAL_KEY");
    expect(keyed.needsKey).toBe(true);
    expect(pushCategory({ kind: "approval", prompt: "question" })).toBe("SAGAX_UPDATE");
    const question = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "question", requestId: "q1", title: "Which?" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(question.aps.category).toBe("SAGAX_UPDATE");
    expect(question.aps.sound).toBe("default");
    expect(question.needsKey).toBeUndefined();
  });
  it("the approval chime follows the phone's switch, and silence wins", () => {
    const plain = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval" }),
      bundleId: "x", settings: { approvalChime: false }, nowMs: 0,
    }).body);
    expect(plain.aps.sound).toBe("default");
    const quiet = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval" }),
      bundleId: "x", settings: { sound: false }, nowMs: 0,
    }).body);
    expect(quiet.aps.sound).toBeUndefined();
  });
  it("a finished routine names itself under the bot", () => {
    const body = JSON.parse(buildApnsRequest({
      message: message({ kind: "message", routineName: "Morning brief", routineRunId: "run-1", senderName: "Scout", botId: "b1" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(body.aps.alert.subtitle).toBe("Open routine Morning brief");
    expect(body.aps.alert["subtitle-loc-key"]).toBe("Open routine %@");
    expect(body.aps.alert["subtitle-loc-args"]).toEqual(["Morning brief"]);
    expect(body.routineRunId).toBe("run-1");
    expect(body.aps.category).toBe("SAGAX_UPDATE");
  });
  it("adds no subtitle to other pushes", () => {
    const body = JSON.parse(buildApnsRequest({ message: message({ senderName: "Alice" }), bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000 }).body);
    expect(body.aps.alert.subtitle).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });
});
