import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { inputRequestsDrawnElsewhere, pendingOffers, pendingQuestions, pendingRequests, pinnedItems, pinnedQuestionAnswer, topicsToScan } from "./pending-question";

const question = (id: string, card: Record<string, unknown> = {}): Message =>
  ({ id, at: 1, role: "bot", kind: "options", card: { title: "q", options: [], requestId: `r-${id}`, questionRequest: { version: 1, questions: [] }, ...card } }) as unknown as Message;

describe("pendingQuestions", () => {
  it("keeps only open question cards", () => {
    const list = [
      question("a"),
      question("b", { answered: "answer" }),
      question("c", { dismissed: true }),
      question("d", { expired: true }),
      question("e", { tool: "Bash", questionRequest: undefined }),
      { id: "f", at: 1, role: "bot", kind: "text", text: "hi" } as Message,
    ];
    expect(pendingQuestions(list).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("pinnedItems (#3214)", () => {
  const approval = (id: string, at: number) =>
    ({ message: { id: `m-${id}`, at, role: "bot", kind: "options", card: { requestId: id, tool: "Bash", title: "", subtitle: "" } }, requestId: id, tool: "Bash", detail: "" }) as unknown as import("@/components/PendingApproval").Pending;
  it("holds approvals and questions together, oldest first", () => {
    const items = pinnedItems([approval("ap-late", 30), approval("ap-early", 5)], [{ ...question("q"), at: 10 }]);
    expect(items.map((item) => item.key)).toEqual(["approval::ap-early", "question:r-q", "approval::ap-late"]);
  });
  it("is empty when nothing waits", () => {
    expect(pinnedItems([], [])).toEqual([]);
  });
});

describe("pinnedQuestionAnswer (#3214)", () => {
  const one = (more: Record<string, unknown> = {}, q: Record<string, unknown> = {}) =>
    pinnedItems([], [question("q", { questionRequest: { version: 1, questions: [{ question: "Which one?", options: [{ label: "A" }], ...q }] }, ...more })])[0];
  it("turns the typed text into the question's free answer", () => {
    expect(pinnedQuestionAnswer(one(), "  the second one ")).toEqual({ requestId: "r-q", answer: "The user answered your questions.\n\nQ: Which one?\nA: the second one" });
  });
  it("answers nothing for an empty line, a closed question or a page choice", () => {
    expect(pinnedQuestionAnswer(one(), "   ")).toBeNull();
    expect(pinnedQuestionAnswer(one({}, { custom: false }), "x")).toBeNull();
    expect(pinnedQuestionAnswer(one({ pageTargetChoice: true }), "x")).toBeNull();
    expect(pinnedQuestionAnswer(undefined, "x")).toBeNull();
  });
  it("leaves a multi-question ask and an approval to their own buttons", () => {
    expect(pinnedQuestionAnswer(one({ questionRequest: { version: 1, questions: [{ question: "a" }, { question: "b" }] } }), "x")).toBeNull();
    const approval = pinnedItems([{ message: { id: "m", at: 1, card: { requestId: "ap" } }, requestId: "ap", tool: "Bash", detail: "" } as unknown as import("@/components/PendingApproval").Pending], [])[0];
    expect(pinnedQuestionAnswer(approval, "x")).toBeNull();
  });
});

// #3438: seen on 0.8.84, nothing pinned while the bot waited on the person
// for a choice question asked two days earlier in an earlier topic, and for
// an input request from work another bot handed over.
describe("questions in words and earlier topics (#3438)", () => {
  const DAY = 86_400_000;
  const inputRequest = (id: string, at: number, more: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "activity", tool: { name: "Kiro needs your input: Which site?", ok: true }, from: { botId: "kiro", name: "Kiro" },
      inputRequest: { botId: "kiro", threadId: "work-1", botName: "Kiro", title: "Teammate work", question: "Which site?", ...more } }) as unknown as Message;
  const handoffCard = (id: string, at: number, more: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "text", text: "Kiro has a question for you", from: { botId: "kiro", name: "Kiro" },
      attention: { kind: "question", botId: "kiro", botName: "Kiro", threadId: "work-1", sourceMessageId: "src", openedBy: { botId: "mira", name: "Mira" }, items: [{ text: "Which site?" }], ...more } }) as unknown as Message;
  const choice = (id: string, at: number): Message => ({ ...question(id, { questionRequest: { version: 1, questions: [{ question: "Keep both?", options: [{ label: "Yes" }, { label: "No" }] }] } }), at });

  it("an input request is pinned, as the standard card, until it is answered", () => {
    const open = pendingRequests([inputRequest("ir", 10)]);
    expect(open.map((entry) => entry.message.id)).toEqual(["ir"]);
    expect(open[0]!.card).toMatchObject({ kind: "question", botId: "kiro", threadId: "work-1", items: [{ text: "Which site?" }] });
    expect(pinnedItems([], [], open).map((item) => item.kind)).toEqual(["request"]);
    expect(pendingRequests([inputRequest("ir", 10, { answered: true })])).toEqual([]);
    expect(pendingRequests([inputRequest("ir", 10, { expired: true })])).toEqual([]);
  });

  it("the hand-off's card and the input request of the same ask are one item, and settle together", () => {
    const both = [handoffCard("card", 9), inputRequest("ir", 10)];
    expect(pendingRequests(both).map((entry) => entry.message.id)).toEqual(["card"]);
    expect([...inputRequestsDrawnElsewhere(both)]).toEqual(["ir"]);
    expect(pendingRequests([handoffCard("card", 9), inputRequest("ir", 10, { answered: true })])).toEqual([]);
    expect(pendingRequests([handoffCard("card", 9, { handledAt: 20 })])).toEqual([]);
    // a notice that only needs the person (not a question) is not pinned
    expect(pendingRequests([handoffCard("card", 9, { kind: "human" })])).toEqual([]);
  });

  it("the person writing about something else leaves the hand-off's question pinned", () => {
    const said = { id: "u", at: 30, role: "user", kind: "text", text: "and the invoice?" } as Message;
    const transcript = [handoffCard("card", 9), inputRequest("ir", 10), said];
    expect(pendingRequests(transcript).map((entry) => entry.message.id)).toEqual(["card"]);
    expect(pendingRequests([handoffCard("card", 9), said]).map((entry) => entry.message.id)).toEqual(["card"]);
  });

  it("each ask of the same work settles on its own: the second question is pinned and drawn once the first was answered", () => {
    const HOUR = 3_600_000;
    const second = inputRequest("ir-2", 5 * HOUR, { question: "Which floor?" });
    const onlyRows = [inputRequest("ir-1", 10, { answered: true }), second];
    expect(pendingRequests(onlyRows).map((entry) => entry.message.id)).toEqual(["ir-2"]);
    expect(inputRequestsDrawnElsewhere(onlyRows).size).toBe(0);
    // the same with a hand-off card for each ask
    const withCards = [handoffCard("card-1", 9), inputRequest("ir-1", 10, { answered: true }), handoffCard("card-2", 5 * HOUR - 1), second];
    expect(pendingRequests(withCards).map((entry) => entry.message.id)).toEqual(["card-2"]);
    expect([...inputRequestsDrawnElsewhere(withCards)].sort()).toEqual(["ir-1", "ir-2"]);
    // a reminder repeats the open ask: one item, drawn with its card
    const reminded = [...withCards, inputRequest("ir-2b", 6 * HOUR, { question: "Which floor?", reminder: true })];
    expect(pendingRequests(reminded).map((entry) => entry.message.id)).toEqual(["card-2"]);
    expect(inputRequestsDrawnElsewhere(reminded).has("ir-2b")).toBe(true);
  });

  it("a handled earlier card, or a card that is not a question, never hides a later input request", () => {
    const HOUR = 3_600_000;
    const later = inputRequest("ir", 5 * HOUR);
    for (const card of [handoffCard("card", 9, { handledAt: 20 }), handoffCard("card", 9, { kind: "human" }), handoffCard("card", 9)]) {
      const transcript = card.attention!.kind === "question" && !card.attention!.handledAt ? [card, inputRequest("ir-0", 10, { answered: true }), later] : [card, later];
      expect(inputRequestsDrawnElsewhere(transcript).has("ir")).toBe(false);
      expect(pendingRequests(transcript).map((entry) => entry.message.id)).toEqual(["ir"]);
    }
    // the person marked the card of this very ask handled while its work still waits: the input request is drawn and pinned
    const handledSameAsk = [handoffCard("card", 9, { handledAt: 20 }), inputRequest("ir", 10)];
    expect(inputRequestsDrawnElsewhere(handledSameAsk).size).toBe(0);
    expect(pendingRequests(handledSameAsk).map((entry) => entry.message.id)).toEqual(["ir"]);
  });

  it("an earlier topic that waits on the person is read, and its question is pinned with its own thread", () => {
    const tasks = [
      { threadId: "old", createdAt: 1, activity: "waiting-on-you" },
      { threadId: "quiet", createdAt: 2 },
      { threadId: "news", createdAt: 3, unread: true },
      { threadId: "now", createdAt: 4 },
    ] as unknown as import("@/state/store").Task[];
    expect(topicsToScan(tasks, "now")).toEqual(["news", "old"]);
    expect(topicsToScan(tasks, "now", "quiet")).toEqual(["news", "quiet", "old"]);
    const items = pinnedItems([], [], pendingRequests([inputRequest("ir", 3 * DAY)]), [
      { threadId: "old", questions: [choice("q", 1 * DAY)], requests: [] },
    ]);
    expect(items.map((item) => [item.kind, item.kind === "approval" ? undefined : item.threadId])).toEqual([["question", "old"], ["request", undefined]]);
    // typing in the box answers the earlier topic's question in its own thread
    expect(pinnedQuestionAnswer(items[0], "yes, both")).toMatchObject({ requestId: "r-q", threadId: "old" });
  });

  it("an approval asked in an earlier topic is pinned, oldest first, with its topic as the target, and leaves once decided", () => {
    const approvalIn = (id: string, at: number, threadId?: string) =>
      ({ message: { id, at, role: "bot", kind: "options", card: { requestId: `r-${id}`, tool: "Bash", title: "", subtitle: "" } }, requestId: `r-${id}`, tool: "Bash", detail: "", ...(threadId ? { threadId } : {}) }) as unknown as import("@/components/PendingApproval").Pending;
    const items = pinnedItems([approvalIn("now-ap", 3 * DAY)], [], [], [
      { threadId: "old", questions: [], requests: [], approvals: [approvalIn("old-ap", 1 * DAY)] },
    ]);
    expect(items.map((item) => item.key)).toEqual(["approval:old:r-old-ap", "approval::r-now-ap"]);
    const first = items[0]!;
    expect(first.kind === "approval" && [first.threadId, first.pending.threadId]).toEqual(["old", "old"]);
    // decided there: the topic holds no open approval any more
    expect(pinnedItems([approvalIn("now-ap", 3 * DAY)], [], [], [{ threadId: "old", questions: [], requests: [], approvals: [] }]).map((item) => item.key)).toEqual(["approval::r-now-ap"]);
  });

  it("the same ask seen in two topics is pinned once", () => {
    const entry = pendingRequests([inputRequest("ir", 10)]);
    expect(pinnedItems([], [], entry, [{ threadId: "old", questions: [], requests: entry }])).toHaveLength(1);
  });
});

describe("#3512: the offers a bot posts on its own are pinned too", () => {
  const offer = (id: string, at: number, card: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "options", card: { title: "Garder le brief du jour ?", subtitle: "", options: ["Oui", "Pas maintenant"], proactiveProposal: { id: `p-${id}` }, ...card } }) as unknown as Message;

  it("keeps only open offer cards", () => {
    const list = [offer("a", 1), offer("b", 2, { answered: "Oui" }), offer("c", 3, { expired: true }), offer("d", 4, { dismissed: true }), question("q")];
    expect(pendingOffers(list).map((m) => m.id)).toEqual(["a"]);
  });

  it("pins an offer of this topic and one an earlier topic still holds, once each, oldest first", () => {
    const items = pinnedItems([], [{ ...question("q"), at: 20 }], [], [{ threadId: "older", questions: [], requests: [], offers: [offer("old", 5)] }], [offer("now", 30)]);
    expect(items.map((item) => [item.kind, item.key, item.threadId])).toEqual([
      ["offer", "offer:p-old", "older"],
      ["question", "question:r-q", undefined],
      ["offer", "offer:p-now", undefined],
    ]);
  });
});
