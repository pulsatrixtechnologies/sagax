import { describe, expect, it } from "vitest";

import { PersonSignalGate } from "../../shared/signal-levels.ts";
import { pushesForFrame, type FramePushDeps } from "./frames.ts";

const deps = (patch: Partial<FramePushDeps> = {}): FramePushDeps => ({
  notificationPeople: () => ["pr_owner"],
  muted: () => false,
  achievementNotifications: () => true,
  achievementName: (id) => (id === "first-chat" ? "First chat" : undefined),
  now: () => 42,
  ...patch,
});

describe("frames to pushes", () => {
  it("a person's direct message goes to its audience only", () => {
    const out = pushesForFrame({ kind: "notify", notification: { kind: "message", botId: "", botName: "Alice", threadId: "t1", groupId: "g1", title: "Alice", body: "Hi", audience: ["PR_BOB"], avatarUrl: "/api/people/pr_alice/avatar?v=1" } }, deps());
    expect(out).toEqual([{
      kind: "message", personId: "pr_bob", title: "Alice", body: "Hi", threadId: "t1", groupId: "g1",
      senderName: "Alice", avatarUrl: "/api/people/pr_alice/avatar?v=1", at: 42,
    }]);
  });

  it("a bot notification without audience goes to the thread's person, unless they muted that bot", () => {
    const avatarUrl = "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp";
    const frame = { kind: "notify", notification: { kind: "done", botId: "b1", botName: "Max", threadId: "t2", title: "Max", body: "Done", avatarUrl } };
    expect(pushesForFrame(frame, deps()).map((push) => [push.kind, push.personId, push.botId, push.senderName, push.avatarUrl])).toEqual([["message", "pr_owner", "b1", "Max", avatarUrl]]);
    expect(pushesForFrame(frame, deps({ muted: () => true }))).toEqual([]);
  });

  it("maps approvals, questions, takeovers, turn failures, incidents and routines; ignores the rest", () => {
    const kinds = [
      "approval", "question", "takeover", "turn-failed", "incident",
      "routine-failed", "routine-deferred", "spend", "admin-action",
    ].map((kind) =>
      pushesForFrame({ kind: "notify", notification: { kind, botId: "b1", threadId: "t", title: "x", body: "y" } }, deps())[0]?.kind ?? null);
    expect(kinds).toEqual(["approval", "approval", "approval", "message", "message", "routine", "routine", null, null]);
  });

  it("a proactive report that needs the person wakes the phone at once, with Approve and Deny (#2697)", () => {
    const push = pushesForFrame({
      kind: "notify",
      notification: { kind: "needs-you", botId: "b1", botName: "Scout", threadId: "t", title: "Scout needs you", body: "sign the renewal" },
    }, deps())[0];
    expect(push).toMatchObject({ kind: "approval", botId: "b1", title: "Scout needs you", body: "sign the renewal", needsYou: true });
    expect(push?.requestId).toBeUndefined();
    expect(push?.prompt).toBeUndefined();
    const wait = pushesForFrame({ kind: "notify", notification: { kind: "wait", botId: "b1", threadId: "t", title: "x", body: "y" } }, deps())[0];
    expect(wait?.kind).toBe("message");
  });

  it("a proactive proposal card is a card-level push that names its proposal (#2697)", () => {
    const push = pushesForFrame({
      kind: "notify",
      notification: { kind: "proposal", botId: "b1", botName: "Scout", threadId: "t", title: "Renew the domain", body: "Shall I handle it?", proposalId: "p-123" },
    }, deps())[0];
    expect(push).toMatchObject({ kind: "message", botId: "b1", proposalId: "p-123", title: "Renew the domain" });
    expect(push?.needsYou).toBeUndefined();
    // a proposal frame without its id carries no proposal
    const bare = pushesForFrame({ kind: "notify", notification: { kind: "proposal", botId: "b1", threadId: "t", title: "x", body: "y" } }, deps())[0];
    expect(bare?.proposalId).toBeUndefined();
  });

  it("a proposal push respects the person's daily budget and quiet hours; a needs-you always goes (#2695, #2697)", () => {
    let quiet: { start: string; end: string; timeZone: string } | null = null;
    const gate = new PersonSignalGate(() => ({ budget: 1, quiet }), () => Date.UTC(2026, 10, 10, 15, 0));
    const proposal = (id: string) => pushesForFrame({ kind: "notify", notification: { kind: "proposal", botId: "b1", threadId: "t", title: "x", body: "y", proposalId: id } }, deps())[0]!;
    const needsYou = pushesForFrame({ kind: "notify", notification: { kind: "needs-you", botId: "b1", threadId: "t", title: "x", body: "y" } }, deps())[0]!;
    expect(gate.decide(proposal("p1"))).toBe("push");
    expect(gate.decide(proposal("p2"))).toBe("hold");
    expect(gate.decide(needsYou)).toBe("push");
    const fresh = new PersonSignalGate(() => ({ budget: 20, quiet }), () => Date.UTC(2026, 10, 10, 15, 0));
    quiet = { start: "00:00", end: "23:59", timeZone: "UTC" };
    expect(fresh.decide(proposal("p3"))).toBe("hold");
  });

  it("a takeover wakes like an approval but carries no Allow or Deny", () => {
    const takeover = pushesForFrame({
      kind: "notify",
      notification: { kind: "takeover", botId: "b1", botName: "Scout", threadId: "t", title: "Scout needs your hands", body: "the login page wants a code" },
    }, deps())[0];
    expect(takeover).toMatchObject({
      kind: "approval", botId: "b1", senderName: "Scout", title: "Scout needs your hands",
      body: "the login page wants a code",
    });
    expect(takeover?.prompt).toBeUndefined();
    expect(takeover?.requestId).toBeUndefined();
  });

  it("an approval carries its request and, when the key is required, says so; a question does not", () => {
    const approval = pushesForFrame({ kind: "notify", notification: { kind: "approval", botId: "b1", threadId: "t", title: "Allow?", body: "rm", requestId: "r1", needsKey: true } }, deps())[0];
    expect(approval).toMatchObject({ kind: "approval", requestId: "r1", prompt: "approval", needsKey: true });
    const question = pushesForFrame({ kind: "notify", notification: { kind: "question", botId: "b1", threadId: "t", title: "Q", body: "which?", requestId: "q1", needsKey: true } }, deps())[0];
    expect(question).toMatchObject({ kind: "approval", requestId: "q1", prompt: "question" });
    expect(question?.needsKey).toBeUndefined();
  });

  it("a finished routine keeps the result and names the routine", () => {
    const done = pushesForFrame({ kind: "notify", notification: { kind: "done", botId: "b1", botName: "Scout", threadId: "t", title: "Scout finished", body: "report ready", routineRunId: "run-1", routineName: "Morning brief" } }, deps())[0];
    expect(done).toMatchObject({ kind: "message", routineRunId: "run-1", routineName: "Morning brief", body: "report ready" });
  });

  it("a nudge carries its conversation, its id and the phone's own strings", () => {
    const out = pushesForFrame({ kind: "nudge", audience: "pr_bob", id: "n1", fromId: "pr_alice", fromName: "Alice", at: 7, open: { groupId: "g1", threadId: "t1" } }, deps());
    expect(out).toEqual([{
      kind: "nudge", personId: "pr_bob", title: "Alice sent you a nudge", body: "Open the conversation to answer.",
      titleLocKey: "%@ sent you a nudge", titleLocArgs: ["Alice"], bodyLocKey: "Open the conversation to answer.",
      threadId: "t1", groupId: "g1", fromId: "pr_alice", id: "n1", senderName: "Alice", senderId: "pr_alice", at: 7,
    }]);
    // the sender's own echo is not a push
    expect(pushesForFrame({ kind: "nudge.sent", audience: "pr_alice", id: "n1" }, deps())).toEqual([]);
  });

  it("an achievement only for a person who asked for system notifications", () => {
    const frame = { kind: "achievements", audience: "pr_bob", unlocked: [{ id: "first-chat", points: 5, unlockedAt: 1 }] };
    expect(pushesForFrame(frame, deps())[0]).toMatchObject({ kind: "achievement", personId: "pr_bob", body: "First chat", titleLocKey: "Achievement unlocked" });
    expect(pushesForFrame(frame, deps({ achievementNotifications: () => false }))).toEqual([]);
  });

  it("a bot's push carries its look; a person's message never asks for one", () => {
    const asked: string[] = [];
    const botLook = (id: string) => { asked.push(id); return { color: "teal", mascotLook: { character: "owl" as const } }; };
    const bot = pushesForFrame({ kind: "notify", notification: { kind: "done", botId: "b1", botName: "Max", threadId: "t2", title: "Max", body: "Done" } }, deps({ botLook }));
    expect(bot[0]?.senderLook).toEqual({ color: "teal", mascotLook: { character: "owl" } });
    const person = pushesForFrame({ kind: "notify", notification: { kind: "message", botId: "", botName: "Alice", threadId: "t1", groupId: "g1", title: "Alice", body: "Hi", audience: ["pr_bob"] } }, deps({ botLook }));
    expect(person[0]?.senderLook).toBeUndefined();
    expect(asked).toEqual(["b1"]);
  });
  it("an ask carries its plain question and a question its choices", () => {
    const approval = pushesForFrame({ kind: "notify", notification: { kind: "approval", botId: "b1", botName: "Scout", threadId: "t", title: "Publish version 2.4?", ask: "Publish version 2.4?", body: "Release notes checked.", requestId: "r1", choices: ["A"] } }, deps())[0];
    expect(approval).toMatchObject({ ask: "Publish version 2.4?", senderName: "Scout" });
    expect(approval?.choices).toBeUndefined();
    const question = pushesForFrame({ kind: "notify", notification: { kind: "question", botId: "b1", threadId: "t", title: "Q", body: "Which?", requestId: "q1", choices: ["Red", "", 4, "Blue"] } }, deps())[0];
    expect(question?.choices).toEqual(["Red", "Blue"]);
  });

  it("a conversation an AI client holds over MCP never rings a phone or a watch, approvals included", () => {
    for (const kind of ["approval", "question", "done"]) {
      expect(pushesForFrame({ kind: "notify", notification: { kind, botId: "b1", threadId: "t", title: "x", body: "y", requestId: "r1", quietOnPhones: true } }, deps())).toEqual([]);
    }
  });
  it("a message the bot wrote with notify false reaches no phone; true or absent still does", () => {
    const note = { kind: "done", botId: "b1", botName: "Max", threadId: "t2", title: "Max", body: "Progress" };
    expect(pushesForFrame({ kind: "notify", notification: { ...note, notify: false } }, deps())).toEqual([]);
    expect(pushesForFrame({ kind: "notify", notification: { ...note, notify: true } }, deps())).toHaveLength(1);
    expect(pushesForFrame({ kind: "notify", notification: note }, deps())).toHaveLength(1);    // #2695: FYI passes through to the signal gate, which holds it for the brief
    expect(pushesForFrame({ kind: "notify", notification: { ...note, notify: false, level: "fyi" } }, deps())).toHaveLength(1);
  });
});
