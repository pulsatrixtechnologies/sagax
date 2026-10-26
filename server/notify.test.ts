// What is worth interrupting someone for. The policy is small, so the
// tests are mostly about the cases where the answer is "stay quiet".
import { describe, expect, it } from "vitest";

import { buildNotification, buildSpendNotification, CALL_QUIET_MS, quietForCall, summarize } from "./notify.ts";

const bot = { id: "bot-1", name: "Scout", threadId: "thread-1" };

describe("buildNotification", () => {
  it("names the bot and carries the detail, per kind", () => {
    expect(buildNotification("approval", bot, "thread-1", "rm -rf ./build")).toMatchObject({
      kind: "approval",
      botId: "bot-1",
      threadId: "thread-1",
      title: "Scout needs approval",
      body: "rm -rf ./build",
    });
    expect(buildNotification("question", bot, "thread-1", "which branch?")?.title).toBe("Scout has a question");
    expect(buildNotification("done", bot, "thread-1", "pushed the branch")?.title).toBe("Scout finished");
    expect(buildNotification("routine-failed", bot, "thread-1", "boom")?.title).toBe("Scout's routine failed");
    expect(buildNotification("routine-deferred", bot, "thread-1", "target busy for 30 minutes")?.title)
      .toBe("Scout's routine is waiting");
    expect(buildNotification("incident", bot, "thread-1", "the run stopped: exit_before_result")?.title).toBe("Scout hit a problem");
    expect(buildNotification("turn-failed", bot, "thread-1", "the Local VM is not ready")?.title)
      .toBe("Scout couldn't start");
  });

  it("announces a delegation settle as a resume with results", () => {
    expect(buildNotification("delegation-settled", bot, "thread-1", "Results in from Atlas")).toMatchObject({
      kind: "delegation-settled",
      botId: "bot-1",
      threadId: "thread-1",
      title: "Scout resumed with results",
      body: "Results in from Atlas",
    });
    // the toggle rules this frame like every other
    expect(buildNotification("delegation-settled", { ...bot, notifications: false }, "thread-1", "Results in from Atlas")).toBeNull();
  });

  it("stays silent for a bot whose notifications are off", () => {
    const quiet = { ...bot, notifications: false };
    for (const kind of ["approval", "question", "done", "routine-failed", "turn-failed"] as const) {
      expect(buildNotification(kind, quiet, "thread-1", "anything")).toBeNull();
    }
    // absent means "not turned off" — older bot records predate the flag
    expect(buildNotification("approval", { ...bot, notifications: undefined }, "thread-1", "x")).not.toBeNull();
    expect(buildNotification("approval", { ...bot, notifications: true }, "thread-1", "x")).not.toBeNull();
  });

  it("does not buzz for a finish with nothing to say", () => {
    expect(buildNotification("done", bot, "thread-1", "   ")).toBeNull();
    expect(buildNotification("done", bot, "thread-1", "")).toBeNull();
    // ...but a blocked bot is worth knowing about even with a thin summary
    expect(buildNotification("approval", bot, "thread-1", "")).not.toBeNull();
    expect(buildNotification("turn-failed", bot, "thread-1", "")).not.toBeNull();
  });

  it("uses the thread it was raised on, not the bot's current one", () => {
    // a routine runs a bot in a detached task; the notification has to open
    // that conversation, not whatever the bot happens to be showing
    expect(buildNotification("done", bot, "other-thread", "done")?.threadId).toBe("other-thread");
  });

  it("carries the bot's avatar when one is given", () => {
    const avatarUrl = "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp";
    const frame = buildNotification("done", bot, "thread-1", "pushed the branch", { avatarUrl });
    expect(frame).toMatchObject({ botId: "bot-1", body: "pushed the branch", avatarUrl });

    // no profile image → the frame stays exactly as before
    expect(buildNotification("done", bot, "thread-1", "pushed")?.avatarUrl).toBeUndefined();
  });
});

describe("an approval notification", () => {
  it("takes the card's plain title and carries its request", () => {
    const n = buildNotification("approval", { id: "b", name: "Cryptic", threadId: "t" }, "t", "Run echo hi.", { title: "Allow Cryptic to run a command?", requestId: "r1", avatarUrl: "/api/bots/b/avatar" });
    expect(n).toMatchObject({ kind: "approval", title: "Allow Cryptic to run a command?", body: "Run echo hi.", requestId: "r1", avatarUrl: "/api/bots/b/avatar" });
    expect(n?.needsKey).toBeUndefined();
    const keyed = buildNotification("approval", { id: "b", name: "Cryptic", threadId: "t" }, "t", "rm x", { requestId: "r2", needsKey: true });
    expect(keyed?.needsKey).toBe(true);
  });
  it("names a finished routine so the phone can say which one", () => {
    const n = buildNotification("done", { id: "b", name: "Scout", threadId: "t" }, "t", "report ready", { routineRunId: "run-1", routineName: "Morning brief" });
    expect(n).toMatchObject({ kind: "done", routineRunId: "run-1", routineName: "Morning brief", body: "report ready" });
  });
  it("keeps the old title without one", () => {
    expect(buildNotification("approval", { id: "b", name: "Cryptic", threadId: "t" }, "t", "x")?.title).toBe("Cryptic needs approval");
  });
});

describe("sign-in requests", () => {
  it("names the room in the title and carries its id for grouping", () => {
    // the card is in the room the bot asked from, so that is what opens
    expect(buildNotification("sign-in", bot, "room-thread", "the dashboard is behind a login", {
      group: { id: "room-1", name: "Launch" }, site: "example.com",
    })).toMatchObject({
      kind: "sign-in",
      threadId: "room-thread",
      groupId: "room-1",
      title: "Scout in Launch needs you to sign in to example.com",
      body: "the dashboard is behind a login",
    });
    // a 1:1 request is untouched — no room to name, nothing to group under
    const direct = buildNotification("sign-in", bot, bot.threadId, "the dashboard is behind a login", { site: "example.com" });
    expect(direct?.title).toBe("Scout needs you to sign in to example.com");
    expect(direct?.groupId).toBeUndefined();
  });
});

describe("summarize", () => {
  it("flattens a model's answer into one lock-screen line", () => {
    expect(summarize("line one\n\nline two")).toBe("line one line two");
    expect(summarize("before\n```js\nconst x = 1;\n```\nafter")).toBe("before after");
    expect(summarize("   padded   ")).toBe("padded");
  });

  it("clamps long text with an ellipsis", () => {
    const long = summarize("x".repeat(400));
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
    expect(summarize("short")).toBe("short");
  });
});

describe("buildSpendNotification", () => {
  it("opens the thread whose turn crossed the line, and a bot's own toggle does not silence it", () => {
    const quiet = { ...bot, notifications: false };
    expect(buildSpendNotification(quiet, "thread-9", { title: "Monthly spend limit reached", body: "$100.00 of $100.00 spent this month (2026-09)." })).toEqual({
      kind: "spend", botId: "bot-1", botName: "Scout", threadId: "thread-9",
      title: "Monthly spend limit reached", body: "$100.00 of $100.00 spent this month (2026-09).",
    });
  });
});

describe("a conversation on a live voice call", () => {
  const now = 1_800_000_000_000;
  const done = { kind: "done" as const };
  it("does not buzz while the person's latest words were said on the call", () => {
    expect(quietForCall(done, { at: now - 60_000, voiceCall: { callId: "call-12345678" } }, now)).toBe(true);
    expect(quietForCall({ kind: "approval" }, { at: now - 5_000, voiceCall: { callId: "call-12345678", interrupted: true } }, now)).toBe(true);
  });
  it("stays quiet while the page says the thread is on a call, whatever was sent", () => {
    expect(quietForCall(done, { at: now - 60_000 }, now, true)).toBe(true);
    expect(quietForCall(done, undefined, now, true)).toBe(true);
    expect(quietForCall({ kind: "spend" }, undefined, now, true)).toBe(false);
  });
  it("buzzes again after a written message, a call long over, or for spend", () => {
    expect(quietForCall(done, { at: now - 60_000 }, now)).toBe(false);
    expect(quietForCall(done, { at: now - CALL_QUIET_MS - 1, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
    expect(quietForCall({ kind: "spend" }, { at: now, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
    expect(quietForCall(done, undefined, now)).toBe(false);
    expect(quietForCall(null, { at: now, voiceCall: { callId: "call-12345678" } }, now)).toBe(false);
  });
});
