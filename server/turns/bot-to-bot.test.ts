// #3503: a bot's words to another bot of the same person stay between them,
// and the upgrade closes the questions this left waiting on the person, and
// only those.
import { describe, expect, it, vi } from "vitest";

import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { createWaitingCardSkip } from "../index-leaves/waitingCardSkip.ts";
import { openedByOwnBot, questionForRequester, sweepLeftoverBotQuestions } from "./bot-to-bot.ts";

const OWNERS: Record<string, string> = { "bot-team": "person-a", "bot-lead": "person-a", "bot-other": "person-b" };
const sameOwner = (botId: string, other: string) => Boolean(OWNERS[botId]) && OWNERS[botId] === OWNERS[other];
const opened = (botId: string, kind: "work" | "pair" | "agent" = "work") => ({ openedBy: { botId, name: botId, kind, at: 1 } });

describe("openedByOwnBot", () => {
  it("is a thread another bot of the same person opened, never anything else", () => {
    expect(openedByOwnBot(opened("bot-lead"), "bot-team", sameOwner)).toBe(true);
    expect(openedByOwnBot(opened("bot-lead", "pair"), "bot-team", sameOwner)).toBe(true);
    // isolation between people
    expect(openedByOwnBot(opened("bot-other"), "bot-team", sameOwner)).toBe(false);
    // an AI client, a thread the bot opened for itself, a routine run
    expect(openedByOwnBot(opened("agent:client", "agent"), "bot-team", sameOwner)).toBe(false);
    expect(openedByOwnBot(opened("bot-team"), "bot-team", sameOwner)).toBe(false);
    expect(openedByOwnBot({ ...opened("bot-lead"), routineRunId: "run-1" }, "bot-team", sameOwner)).toBe(false);
    expect(openedByOwnBot({}, "bot-team", sameOwner)).toBe(false);
    expect(openedByOwnBot(opened("bot-lead"), "bot-team", undefined)).toBe(false);
  });
});

describe("questionForRequester", () => {
  const child = { botId: "bot-team", parentId: "root", reply: "resume" };
  it("a plain question to the bot of the same person that handed the work over", () => {
    expect(questionForRequester(child, { botId: "bot-lead" }, "Which one first?", sameOwner)).toBe(true);
  });
  it("leaves the person's cards: an approval, a tag for the person, another person, a one-way notice, a room, a root", () => {
    expect(questionForRequester({ ...child, cards: ["m1"] }, { botId: "bot-lead" }, "Approve?", sameOwner)).toBe(false);
    expect(questionForRequester(child, { botId: "bot-lead" }, "[HUMAN] sign the order", sameOwner)).toBe(false);
    expect(questionForRequester(child, { botId: "bot-other" }, "Which one first?", sameOwner)).toBe(false);
    expect(questionForRequester({ ...child, oneWay: true, reply: "none" }, { botId: "bot-lead" }, "Which one first?", sameOwner)).toBe(false);
    expect(questionForRequester({ ...child, groupId: "room" }, { botId: "bot-lead" }, "Which one first?", sameOwner)).toBe(false);
    expect(questionForRequester({ botId: "bot-team" }, undefined, "Which one first?", sameOwner)).toBe(false);
  });
});

type Row = WireMessage & Record<string, unknown>;

function upgradeHost() {
  const tasks: Record<string, Partial<WireTask>> = {
    "bot-team:work": { threadId: "work", ...opened("bot-lead") },
    "bot-team:old-work": { threadId: "old-work", ...opened("bot-lead"), archivedAt: 5 },
    "bot-team:foreign": { threadId: "foreign", ...opened("bot-other") },
    "bot-team:client": { threadId: "client", ...opened("agent:client", "agent") },
    "bot-team:team-main": { threadId: "team-main" },
  };
  const question = (id: string, threadId: string, extra: Record<string, unknown> = {}): Row =>
    ({ id, at: 1, role: "bot", kind: "text", text: "Team has a question for you", attention: { kind: "question", items: [{ text: "Which one first?" }], botId: "bot-team", botName: "Team", threadId, sourceMessageId: `src-${id}`, ...extra } }) as Row;
  const request = (id: string, threadId: string, text = "Which one first?"): Row =>
    ({ id, at: 1, role: "bot", kind: "activity", from: { botId: "bot-team", name: "Team" }, inputRequest: { botId: "bot-team", threadId, botName: "Team", question: text } }) as Row;
  const rows: Record<string, Row[]> = {
    // the team bot's own conversation with the person: attention cards
    "team-main": [
      question("q-live", "work"),
      question("q-archived", "old-work"),
      question("q-foreign", "foreign"),
      question("q-client", "client"),
      question("q-own", "team-main"),
      { ...question("q-human", "work"), attention: { ...question("x", "work").attention!, kind: "human" } } as Row,
      { ...question("q-failure", "work"), attention: { ...question("x", "work").attention!, kind: "failure" } } as Row,
      question("q-done", "work", { handledAt: 3 }),
      // a one-way notice's question sits in the asking bot's own conversation
      request("r-oneway", "work"),
    ],
    // the orchestrator's conversation: the hand-over's input request rows
    "lead-main": [
      request("r-live", "work"),
      request("r-tagged", "work", "[HUMAIN] sign the order"),
      request("r-foreign", "foreign"),
    ],
  };
  const answerWork = vi.fn(() => true);
  const noted: Array<[string, string]> = [];
  const pauses: number[] = [];
  const host: Record<string, any> = {
    store: {
      bots: [{ id: "bot-team", threadId: "team-main" }, { id: "bot-lead", threadId: "lead-main" }],
      tasks: () => [],
      messagesFor: (threadId: string) => rows[threadId] ?? [],
      taskByThread: (botId: string, threadId: string) => tasks[`${botId}:${threadId}`],
      botByThread: (threadId: string) => (threadId === "team-main" ? { id: "bot-team" } : threadId === "lead-main" ? { id: "bot-lead" } : undefined),
      patchMessage: (threadId: string, id: string, patch: Record<string, unknown>) => {
        const row = (rows[threadId] ?? []).find((candidate) => candidate.id === id);
        if (row) Object.assign(row, patch);
      },
      appendMessage: (threadId: string, message: { text: string }) => { noted.push([threadId, message.text]); },
    },
    coordinator: { answer: answerWork },
    settleInputRequests: vi.fn(),
    sameBotOwner: sameOwner,
    pendingExpiryDeps: () => ({ localeFor: () => "en" }),
  };
  const leaf = createWaitingCardSkip(() => host);
  const find = (id: string) => Object.values(rows).flat().find((row) => row.id === id)!;
  return { leaf, find, answerWork, noted, pauses };
}

describe("the upgrade's sweep of the questions bots left on the person (#3503)", () => {
  it("closes as skipped the plain questions from threads a bot of the same person opened, and only those", async () => {
    const h = upgradeHost();
    expect(await h.leaf.sweepBotQuestions()).toBe(3);
    expect(h.find("q-live").attention).toMatchObject({ closed: "skipped" });
    expect(h.find("q-archived").attention).toMatchObject({ closed: "skipped" });
    expect(h.find("r-live").inputRequest).toMatchObject({ expired: true, skipped: true });
    for (const id of ["q-foreign", "q-client", "q-own", "q-human", "q-failure"]) expect(h.find(id).attention?.closed).toBeUndefined();
    expect(h.find("q-done").attention).toMatchObject({ handledAt: 3 });
    for (const id of ["r-oneway", "r-tagged", "r-foreign"]) expect(h.find(id).inputRequest).not.toMatchObject({ expired: true });
  });

  it("tells the waiting work once with the quiet line, and an archived thread's bots not again", async () => {
    const h = upgradeHost();
    await h.leaf.sweepBotQuestions();
    const told = h.answerWork.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(told).toEqual(["work", "work"]);
    expect(told).not.toContain("old-work");
    expect(h.noted).toEqual([]);
  });

  it("gives the event loop back between two conversations", async () => {
    const pause = vi.fn(async () => undefined);
    const read: string[] = [];
    await sweepLeftoverBotQuestions({
      threads: () => ["a", "b", "c"],
      messages: (threadId) => { read.push(threadId); expect(pause).toHaveBeenCalledTimes(read.length - 1); return []; },
      task: () => undefined,
      botOfThread: () => undefined,
      sameOwner,
      close: () => true,
      pause,
    });
    expect(read).toEqual(["a", "b", "c"]);
    expect(pause).toHaveBeenCalledTimes(3);
  });
});
