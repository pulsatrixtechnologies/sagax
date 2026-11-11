import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { inputRequestsDrawnElsewhere, pendingOffers, pendingQuestions, pinnedQuestionAnswer } from "./pending-question";
import { pinnedItemsFrom } from "./pinned-waiting";
import type { ServedWaitingItem } from "../../shared/waiting-items";

/** One server item (GET /api/approvals?waiting=1) carrying its message. */
const served = (message: Message, kind: ServedWaitingItem["kind"], threadId = "now"): ServedWaitingItem => ({
  id: message.card?.requestId ?? `attention:${message.id}`, kind, botId: "b1", botName: "Kiro", threadId, messageId: message.id, at: message.at, ageMs: 0,
  title: "", text: "", options: [], answerWith: "text", freeText: true, skippable: true, message,
});

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

describe("pinnedQuestionAnswer (#3214)", () => {
  const one = (more: Record<string, unknown> = {}, q: Record<string, unknown> = {}) =>
    pinnedItemsFrom([served(question("q", { questionRequest: { version: 1, questions: [{ question: "Which one?", options: [{ label: "A" }], ...q }] }, ...more }), "question")], "now")[0];
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
    const approval = pinnedItemsFrom([served({ id: "m", at: 1, role: "bot", kind: "options", card: { requestId: "ap", tool: "Bash", title: "", subtitle: "", options: [] } } as unknown as Message, "approval")], "now")[0];
    expect(approval?.kind).toBe("approval");
    expect(pinnedQuestionAnswer(approval, "x")).toBeNull();
  });
});

// #3438: a hand-off's card and the input request of the same ask are drawn
// once in the conversation; the pinned row draws the server's item (#3543).
describe("questions in words (#3438)", () => {
  const DAY = 86_400_000;
  const inputRequest = (id: string, at: number, more: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "activity", tool: { name: "Kiro needs your input: Which site?", ok: true }, from: { botId: "kiro", name: "Kiro" },
      inputRequest: { botId: "kiro", threadId: "work-1", botName: "Kiro", title: "Teammate work", question: "Which site?", ...more } }) as unknown as Message;
  const handoffCard = (id: string, at: number, more: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "text", text: "Kiro has a question for you", from: { botId: "kiro", name: "Kiro" },
      attention: { kind: "question", botId: "kiro", botName: "Kiro", threadId: "work-1", sourceMessageId: "src", openedBy: { botId: "mira", name: "Mira" }, items: [{ text: "Which site?" }], ...more } }) as unknown as Message;
  const choice = (id: string, at: number): Message => ({ ...question(id, { questionRequest: { version: 1, questions: [{ question: "Keep both?", options: [{ label: "Yes" }, { label: "No" }] }] } }), at });

  it("the input request of an ask with a hand-off card is drawn by that card", () => {
    expect([...inputRequestsDrawnElsewhere([handoffCard("card", 9), inputRequest("ir", 10)])]).toEqual(["ir"]);
  });

  it("each ask of the same work is its own: a later ask is drawn once the first was answered", () => {
    const HOUR = 3_600_000;
    const second = inputRequest("ir-2", 5 * HOUR, { question: "Which floor?" });
    expect(inputRequestsDrawnElsewhere([inputRequest("ir-1", 10, { answered: true }), second]).size).toBe(0);
    const withCards = [handoffCard("card-1", 9), inputRequest("ir-1", 10, { answered: true }), handoffCard("card-2", 5 * HOUR - 1), second];
    expect([...inputRequestsDrawnElsewhere(withCards)].sort()).toEqual(["ir-1", "ir-2"]);
    const reminded = [...withCards, inputRequest("ir-2b", 6 * HOUR, { question: "Which floor?", reminder: true })];
    expect(inputRequestsDrawnElsewhere(reminded).has("ir-2b")).toBe(true);
  });

  it("a handled earlier card, or a card that is not a question, never hides a later input request", () => {
    const HOUR = 3_600_000;
    const later = inputRequest("ir", 5 * HOUR);
    for (const card of [handoffCard("card", 9, { handledAt: 20 }), handoffCard("card", 9, { kind: "human" }), handoffCard("card", 9)]) {
      const transcript = card.attention!.kind === "question" && !card.attention!.handledAt ? [card, inputRequest("ir-0", 10, { answered: true }), later] : [card, later];
      expect(inputRequestsDrawnElsewhere(transcript).has("ir")).toBe(false);
    }
    expect(inputRequestsDrawnElsewhere([handoffCard("card", 9, { handledAt: 20 }), inputRequest("ir", 10)]).size).toBe(0);
  });

  it("typing in the box answers an earlier topic's question in its own thread", () => {
    const items = pinnedItemsFrom([served(choice("q", 1 * DAY), "question", "old"), served(inputRequest("ir", 3 * DAY), "request")], "now");
    expect(items.map((item) => [item.kind, item.threadId])).toEqual([["question", "old"], ["request", undefined]]);
    expect(pinnedQuestionAnswer(items[0], "yes, both")).toMatchObject({ requestId: "r-q", threadId: "old" });
  });
});

describe("#3512: the offers a bot posts on its own are pinned too", () => {
  const offer = (id: string, at: number, card: Record<string, unknown> = {}): Message =>
    ({ id, at, role: "bot", kind: "options", card: { title: "Garder le brief du jour ?", subtitle: "", options: ["Oui", "Pas maintenant"], proactiveProposal: { id: `p-${id}` }, ...card } }) as unknown as Message;

  it("keeps only open offer cards", () => {
    const list = [offer("a", 1), offer("b", 2, { answered: "Oui" }), offer("c", 3, { expired: true }), offer("d", 4, { dismissed: true }), question("q")];
    expect(pendingOffers(list).map((m) => m.id)).toEqual(["a"]);
  });
});
