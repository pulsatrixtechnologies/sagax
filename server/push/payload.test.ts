import { describe, expect, it } from "vitest";

import { APNS_PAYLOAD_MAX, APPROVAL_SOUND, buildApnsRequest, collapseId, NUDGE_SOUND, pushCategory, pushSenderLook, senderLookVersion, type PushMessage } from "./payload.ts";

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

  it("plays the person's chosen notification tone, bundled on the phone", () => {
    const tone = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSoundChoice: "chime-b", nowMs: 0 }).body);
    expect(tone.aps.sound).toBe("notify-chime-b.caf");
    const system = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSoundChoice: "system", nowMs: 0 }).body);
    expect(system.aps.sound).toBe("default");
    const unknown = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSoundChoice: "__proto__", nowMs: 0 }).body);
    expect(unknown.aps.sound).toBe("default");
    const muted = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSound: false, personSoundChoice: "tick", nowMs: 0 }).body);
    expect(muted.aps.sound).toBeUndefined();
    const nudge = JSON.parse(buildApnsRequest({ message: message({ kind: "nudge" }), bundleId: "x", personSoundChoice: "tick", nowMs: 0 }).body);
    expect(nudge.aps.sound).toBe(NUDGE_SOUND);
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
  it("shows the bot as sender, nothing added to its name, and the question first; the tap carries the request", () => {
    const request = buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval", title: "Allow Quasar to run a command?", ask: "Allow Quasar to run a command?", body: "Run echo hi.", senderName: "Quasar", botId: "b1", requestId: "req-1", threadId: "t1" }),
      bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000,
    });
    const body = JSON.parse(request.body);
    // no subtitle: a communication notification and the watch bury it
    expect(body.aps.alert).toEqual({ title: "Quasar", body: "Allow Quasar to run a command?\nRun echo hi." });
    // its own notification, at once, never replaced by the next line of t1
    expect(request.headers["apns-collapse-id"]).toBe("sagax.r.t1.req-1");
    expect(request.headers["apns-priority"]).toBe("10");
    expect(body.aps["interruption-level"]).toBe("time-sensitive");
    expect(body.aps.category).toBe("SAGAX_APPROVAL");
    expect(body.aps.sound).toBe(APPROVAL_SOUND);
    expect(body.requestId).toBe("req-1");
    expect(body.prompt).toBe("approval");
  });
  it("a key-protected approval opens the app, and a question offers Reply", () => {
    const keyed = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "approval", needsKey: true, requestId: "req-2", title: "Allow?" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(keyed.aps.category).toBe("SAGAX_APPROVAL_KEY");
    expect(keyed.needsKey).toBe(true);
    expect(pushCategory({ kind: "approval", prompt: "question" })).toBe("SAGAX_UPDATE");
    expect(pushCategory({ kind: "approval", prompt: "question", requestId: "q1" })).toBe("SAGAX_QUESTION");
    const question = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "question", requestId: "q1", title: "Which?" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(question.aps.category).toBe("SAGAX_QUESTION");
    expect(question.aps.sound).toBe("default");
    expect(question.needsKey).toBeUndefined();
  });
  it("a takeover rides approval priority with no Allow or Deny", () => {
    // no requestId: same wire kind as an approval so the phone wakes at once,
    // but the category stays plain (ios NotificationApproval.category)
    expect(pushCategory({ kind: "approval" })).toBe("SAGAX_UPDATE");
    const body = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", title: "Scout needs your hands", body: "the login page wants a code", senderName: "Scout", botId: "b1", threadId: "t1" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(body.aps.category).toBe("SAGAX_UPDATE");
    expect(body.aps["interruption-level"]).toBe("time-sensitive");
    expect(body.requestId).toBeUndefined();
    expect(body.prompt).toBeUndefined();
  });
  it("a needs-you with no request offers Approve and Deny; one with a request stays an approval (#2697)", () => {
    expect(pushCategory({ kind: "approval", needsYou: true })).toBe("SAGAX_NEEDS_YOU");
    expect(pushCategory({ kind: "approval", needsYou: true, requestId: "r1" })).toBe("SAGAX_APPROVAL");
    const body = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", needsYou: true, title: "Scout needs you", body: "sign the renewal", senderName: "Scout", botId: "b1", threadId: "t1" }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(body.aps.category).toBe("SAGAX_NEEDS_YOU");
    expect(body.needsYou).toBe(true);
    expect(body.threadId).toBe("t1");
    expect(body.botId).toBe("b1");
  });
  it("a proactive proposal offers Do it and Not now, names its proposal and keeps its own banner (#2697)", () => {
    expect(pushCategory({ kind: "message", proposalId: "p1" })).toBe("SAGAX_PROPOSAL");
    const request = buildApnsRequest({
      message: message({ kind: "message", proposalId: "p-123", title: "Renew the domain", body: "Shall I handle it?", senderName: "Scout", botId: "b1", threadId: "t1" }),
      bundleId: "x", nowMs: 0,
    });
    const body = JSON.parse(request.body);
    expect(body.aps.category).toBe("SAGAX_PROPOSAL");
    expect(body.proposalId).toBe("p-123");
    expect(body.botId).toBe("b1");
    // a card, not an ask: priority 5, and never collapsed into the thread's next line
    expect(request.headers["apns-priority"]).toBe("5");
    expect(request.headers["apns-collapse-id"]).toBe("sagax.p.p-123");
  });
  it("never says the question twice, and a plain ask keeps its line", () => {
    const same = JSON.parse(buildApnsRequest({ message: message({ kind: "approval", prompt: "approval", ask: "Publish 2.4?", body: "Publish 2.4?", requestId: "r" }), bundleId: "x", nowMs: 0 }).body);
    expect(same.aps.alert.body).toBe("Publish 2.4?");
    const none = JSON.parse(buildApnsRequest({ message: message({ kind: "approval", prompt: "approval", body: "Publish 2.4?", requestId: "r" }), bundleId: "x", nowMs: 0 }).body);
    expect(none.aps.alert.body).toBe("Publish 2.4?");
  });
  it("a question carries its choices for the banner's buttons, clipped and without repeats", () => {
    const body = JSON.parse(buildApnsRequest({
      message: message({ kind: "approval", prompt: "question", requestId: "q1", body: "Which color?", choices: ["Red", " Red ", "Blue", "x".repeat(200)] }),
      bundleId: "x", nowMs: 0,
    }).body);
    expect(body.choices).toHaveLength(3);
    expect(body.choices.slice(0, 2)).toEqual(["Red", "Blue"]);
    expect(body.choices[2].length).toBeLessThanOrEqual(60);
    expect(body.aps.category).toBe("SAGAX_QUESTION");
    // an approval never carries choices
    const approval = JSON.parse(buildApnsRequest({ message: message({ kind: "approval", prompt: "approval", requestId: "r", choices: ["A"] }), bundleId: "x", nowMs: 0 }).body);
    expect(approval.choices).toBeUndefined();
  });
  it("one id per ask, the conversation's for the rest; the phone uses the same", () => {
    expect(collapseId({ kind: "approval", threadId: "t1", requestId: "r1" })).toBe("sagax.r.t1.r1");
    expect(collapseId({ kind: "message", threadId: "t1", requestId: "r1" })).toBe("sagax.t.t1");
    expect(collapseId({ kind: "approval", threadId: "t1" })).toBe("sagax.t.t1");
    expect(Buffer.byteLength(collapseId({ kind: "approval", threadId: "t".repeat(80), requestId: "r".repeat(80) }))).toBeLessThanOrEqual(64);
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

  describe("a bot's mascot on the banner", () => {
    const scout = (patch: Partial<PushMessage> = {}) => message({
      title: "Scout finished", body: "Pushed the branch.", threadId: "t_scout", botId: "scout", groupId: undefined,
      senderName: "Scout", senderId: "scout",
      senderLook: { color: "teal", mascotLook: { character: "shape", shape: "bean", skins: { shape: "glossy" } }, avatarCrop: "mascot" },
      ...patch,
    });

    it("carries the bot's id, name, look, look version and thread for grouping", () => {
      const request = buildApnsRequest({ message: scout(), bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000 });
      const body = JSON.parse(request.body);
      expect(body.aps["mutable-content"]).toBe(1);
      expect(body.aps["thread-id"]).toBe("t_scout");
      expect(body).toMatchObject({ senderId: "scout", senderName: "Scout", botId: "scout", threadId: "t_scout" });
      expect(body.senderLook).toEqual({ color: "teal", mascotLook: { character: "shape", shape: "bean", skins: { shape: "glossy" } }, avatarCrop: "mascot" });
      expect(body.senderLookVersion).toMatch(/^[0-9a-f]{16}$/);
      // nothing more than before: the look is cosmetic, the text is the same
      expect(Object.keys(body).sort()).toEqual(["aps", "at", "botId", "kind", "senderId", "senderLook", "senderLookVersion", "senderName", "threadId"]);
      expect(Buffer.byteLength(request.body)).toBeLessThanOrEqual(APNS_PAYLOAD_MAX);
    });

    it("changes the look version when the look or the picture changes, not otherwise", () => {
      const look = pushSenderLook({ color: "teal", mascotLook: { character: "owl" } })!;
      expect(senderLookVersion(look)).toBe(senderLookVersion({ ...look }));
      expect(senderLookVersion(look)).not.toBe(senderLookVersion({ ...look, color: "red" }));
      expect(senderLookVersion(look)).not.toBe(senderLookVersion({ ...look, mascotSkin: "gold" }));
      expect(senderLookVersion(look)).not.toBe(senderLookVersion(look, "/api/attachments/a.png"));
    });

    it("cleans a look it cannot trust and never gives a person one", () => {
      expect(pushSenderLook({ color: "javascript:alert(1)" })).toBeUndefined();
      expect(pushSenderLook(null)).toBeUndefined();
      expect(pushSenderLook({ color: "blue", mascotSkin: "none", avatarCrop: "weird", extra: "secret", soul: "instructions" })).toEqual({ color: "blue" });
      const person = JSON.parse(buildApnsRequest({ message: scout({ senderName: undefined }), bundleId: "x", nowMs: 0 }).body);
      expect(person.senderLook).toBeUndefined();
      expect(person.senderLookVersion).toBeUndefined();
    });

    it("drops the look, never the push, when the payload would pass 4 KB", () => {
      const big = buildApnsRequest({ message: scout({ body: "x".repeat(200), titleLocArgs: Array.from({ length: 40 }, () => "y".repeat(100)), titleLocKey: "%@" }), bundleId: "x", nowMs: 0 });
      const body = JSON.parse(big.body);
      expect(body.senderLook).toBeUndefined();
      expect(body.senderLookVersion).toBeUndefined();
      expect(body.senderName).toBe("Scout");
      expect(body.aps["mutable-content"]).toBe(1);
    });
  });
});
