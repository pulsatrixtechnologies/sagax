// #3503: a team bot's question to the orchestrator bot that handed it the
// work is for that bot (the runtime wakes it with the question): the person
// gets no card, no Today or pinned item and no notification. A question
// tagged for the person, a hand-over from a bot of another person and a
// one-way notice still reach the person.
import { describe, expect, it, vi } from "vitest";

import { createPostInputRequest } from "./postInputRequest.ts";

const OWNERS: Record<string, string> = { "bot-team": "person-a", "bot-lead": "person-a", "bot-other": "person-b" };

function fakeHost(parentBot = "bot-lead") {
  const appended: Array<[string, Record<string, unknown>]> = [];
  const notify = vi.fn();
  const bots: Record<string, { id: string; name: string; threadId: string; color: string }> = {
    "bot-team": { id: "bot-team", name: "Team", threadId: "team-main", color: "blue" },
    "bot-lead": { id: "bot-lead", name: "Lead", threadId: "lead-main", color: "green" },
    "bot-other": { id: "bot-other", name: "Other", threadId: "other-main", color: "red" },
  };
  const nodes: Record<string, Record<string, unknown>> = {
    root: { id: "root", rootId: "root", botId: parentBot, threadId: `${parentBot === "bot-lead" ? "lead" : "other"}-main` },
  };
  const host: Record<string, any> = {
    store: {
      bot: (id: string) => bots[id],
      taskByThread: (_botId: string, threadId: string) => ({ threadId, title: threadId }),
      isConfidentialThread: () => false,
      group: () => undefined,
      appendMessage: (threadId: string, message: Record<string, unknown>) => { appended.push([threadId, message]); return { id: `m${appended.length}` }; },
      patchTask: vi.fn(),
      patchGroup: vi.fn(),
    },
    coordinator: { node: (id: string) => nodes[id] },
    openInputRequests: new Map(),
    botMainThread: (botId: string) => bots[botId]?.threadId,
    newestQuestionCard: () => undefined,
    notify,
    sameBotOwner: (botId: string, other: string) => OWNERS[botId] === OWNERS[other],
  };
  const post = createPostInputRequest(() => host);
  const child = (extra: Record<string, unknown> = {}) => ({ id: "child", rootId: "root", parentId: "root", botId: "bot-team", threadId: "work", reply: "resume", ...extra });
  return { post, child, appended, notify, host };
}

describe("postInputRequest, a question between two bots of the same person (#3503)", () => {
  it("posts nothing for the person and rings nothing: the orchestrator bot reads it", () => {
    const h = fakeHost();
    h.post(h.child(), "Which branch goes first, the queue or the hot fix?", false);
    h.post(h.child(), "Which branch goes first, the queue or the hot fix?", true);
    expect(h.appended).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.host.openInputRequests.size).toBe(0);
  });

  it("a question tagged for the person still reaches the person", () => {
    const h = fakeHost();
    h.post(h.child(), "[HUMAIN] approve the release window", false);
    expect(h.appended).toHaveLength(1);
    expect(h.appended[0]![1]).toMatchObject({ inputRequest: { botId: "bot-team", threadId: "work" } });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("a hand-over from a bot of another person keeps today's card", () => {
    const h = fakeHost("bot-other");
    h.post(h.child(), "Which branch goes first?", false);
    expect(h.appended).toHaveLength(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("a one-way notice, which carries nothing back to a bot, keeps today's card", () => {
    const h = fakeHost();
    h.post(h.child({ oneWay: true, reply: "none" }), "Which branch goes first?", false);
    expect(h.appended.map(([threadId]) => threadId)).toContain("team-main");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});
