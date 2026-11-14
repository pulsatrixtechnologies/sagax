// #4219: keyed ask_choice cards in a room. Raised in the room (and from a
// routine run whose source is the room, holding nothing), addressed to one
// person and re-addressed by key, the room's people readable by the bot,
// the answer naming who answered, a notification per person, and nobody
// outside the room sees or answers the card.
import { describe, expect, it, vi } from "vitest";

import { ASK_CHOICE_TOOL, parseAskChoiceInput } from "../../shared/options-card.ts";
import { createAgentCard, type AgentCardStore } from "../widgets/chat-widgets.ts";
import { AskKeyIndex, closedAskCard } from "../widgets/ask-choice-keys.ts";
import { promptWithReply, transcriptText } from "../messages/replies.ts";
import { createCardAnswerRefusal } from "../index-leaves/cardAnswerRefusal.ts";
import { createAnsweringCardAs } from "../index-leaves/answeringCardAs.ts";
import { createDeliverLateQuestionAnswer } from "../index-leaves/deliverLateQuestionAnswer.ts";
import { SendSequencer } from "../messages/send-idempotency.ts";
import { createRaiseHarnessQuestion } from "../index-leaves/raiseHarnessQuestion.ts";
import { ASK_CHOICE_DEF } from "../drivers/agents-tools/extras.ts";
import { callTool, type ToolCallContext } from "../drivers/agents-call.ts";
import type { HarnessClient } from "../drivers/agents-client.ts";
import type { Message } from "../store.ts";
import {
  answererIdentity,
  resolveAddressee,
  roomAskAnswer,
  roomAskAudience,
  roomMayPost,
  roomPeople,
  roomPeopleLine,
  routineRoomThread,
} from "./room-ask-cards.ts";

const BOT = { id: "bot-desk", name: "Desk", color: "blue" as const };
const OTHER_BOT = { id: "bot-field", name: "Field", color: "green" as const };
const ROOM = { id: "room-1", name: "Dispatch", threadId: "room-thread", memberIds: [BOT.id, OTHER_BOT.id], humanIds: ["p-ana", "user:p-ben", "team:t-ops"] };
// the server's people; the room's own verdict (server/index.ts
// viewerMayAnswerOnThread) lets Ana and Ben (listed), Cyd (a member of a
// listed team) and Eve (a participant of the room's shared section) post;
// Dan is outside the room
const CANDIDATES = [{ id: "p-ana", name: "Ana" }, { id: "p-ben", name: "Ben" }, { id: "p-cyd", name: "Cyd" }, { id: "p-dan", name: "Dan" }, { id: "p-eve", name: "Eve" }];
const POSTS = new Set(["p-ana", "p-ben", "p-cyd", "p-eve"]);
const mayPost = (id: string) => POSTS.has(id.toLowerCase());
const PEOPLE = roomPeople(CANDIDATES, mayPost);

function world() {
  const threads = new Map<string, Message[]>();
  let next = 0;
  const rows = (threadId: string) => {
    if (!threads.has(threadId)) threads.set(threadId, []);
    return threads.get(threadId)!;
  };
  const store: AgentCardStore = {
    groupByThread: (threadId) => (threadId === ROOM.threadId ? ROOM : undefined),
    messagesFor: (threadId) => rows(threadId),
    appendMessage: (threadId, message) => {
      const full = { ...message, id: `m${++next}`, at: next } as Message;
      rows(threadId).push(full);
      return full;
    },
    patchMessage: (threadId, messageId, patch) => {
      const list = rows(threadId);
      const index = list.findIndex((row) => row.id === messageId);
      if (index < 0) return null;
      list[index] = { ...list[index]!, ...patch } as Message;
      return list[index]!;
    },
  };
  const index = new AskKeyIndex({ seed: () => [], messagesFor: (threadId) => store.messagesFor(threadId) });
  const raised: Array<Record<string, unknown>> = [];
  // a real question card in the room, from its asking bot, as the
  // request.opened path draws it (the room row carries `from`)
  const raiseQuestionFor = (asker: typeof BOT | typeof OTHER_BOT) => (choice: { title: string; question: string; options: string[]; card?: Record<string, unknown> }) => {
    raised.push(choice);
    const row = store.appendMessage(ROOM.threadId, {
      role: "bot", kind: "options", from: { botId: asker.id, name: asker.name, color: asker.color },
      card: {
        title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-choice-${next + 1}`, requestType: "question",
        questionRequest: { version: 1, questions: [{ question: choice.question, options: choice.options.map((label) => ({ label })) }] },
        ...choice.card,
      },
    } as Omit<Message, "id" | "at">);
    return { messageId: row.id };
  };
  const notifyAddressee = vi.fn();
  const ask = (input: Record<string, unknown>, extra: Partial<Parameters<typeof createAgentCard>[0]> = {}) =>
    createAgentCard({
      store, bot: BOT, threadId: ROOM.threadId, input: { tool: ASK_CHOICE_TOOL, ...input },
      raiseQuestion: raiseQuestionFor((extra.bot as typeof BOT | undefined) ?? BOT),
      room: { people: PEOPLE },
      notifyAddressee,
      askKeys: {
        find: (key, accepts) => index.find(key, (threadId) => threadId === ROOM.threadId, accepts),
        remember: (key, threadId, messageId) => index.remember(key, threadId, messageId),
        retire: (threadId, message) => { store.patchMessage(threadId, message.id, { card: closedAskCard(message.card!) }); },
      },
      ...extra,
    });
  const cards = () => rows(ROOM.threadId).filter((row) => row.kind === "options");
  return { store, rows, ask, cards, raised, notifyAddressee };
}

const ITEM = { question: "Ticket 12: who takes the on-site visit today?", options: ["Take it", "Hand it over"] };

describe("#4219 point 1: a keyed card is raised in a room", () => {
  it("draws a real question card in the room, from the asking bot, with its key", () => {
    const w = world();
    const result = w.ask({ ...ITEM, key: "ticket-12", wait: false });
    expect(result.ok).toBe(true);
    const [card] = w.cards();
    expect(card?.card?.requestId).toMatch(/^ask-choice-/);
    expect(card?.from?.botId).toBe(BOT.id);
    expect(card?.card?.askKey).toBe("ticket-12");
    expect(card?.card?.noHold).toBe(true);
    expect(result.ok && "holds" in result ? result.holds : undefined).toBe(false);
  });

  it("from a routine run whose source is the room, holds nothing even without wait false", () => {
    const w = world();
    const result = w.ask({ ...ITEM, key: "ticket-12" }, { room: { people: PEOPLE, name: "Dispatch", fromRun: true } });
    expect(result.ok && "holds" in result ? result.holds : undefined).toBe(false);
    expect(w.cards()[0]?.card?.noHold).toBe(true);
    // the result names the room the card lives in (its answer is a turn there)
    expect(result.ok && "inRoom" in result ? result.inRoom : undefined).toBe("Dispatch");
  });

  it("the tool result of a routine run's room card says its answer arrives in that room, not in the run", async () => {
    const body = { ok: true, messageId: "m1", waitsForPerson: true, holds: false, people: roomPeopleLine(PEOPLE), inRoom: "Dispatch" };
    const api = vi.fn<HarnessClient["api"]>(async () => body);
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body }));
    const context: ToolCallContext = { botId: BOT.id, threadId: "run-thread", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api, apiResponse } };
    const text = (await callTool(ASK_CHOICE_TOOL, { ...ITEM, key: "ticket-12" }, context)).text;
    expect(text).toContain('arrives later as its own turn in the room "Dispatch"');
    expect(text).not.toContain("its own turn in this conversation");
  });

  it("the routine run's card goes to its source room when the bot is a member, never to a room it is not in", () => {
    const roomOf = (threadId: string) => (threadId === ROOM.threadId ? ROOM : threadId === "people-dm" ? { ...ROOM, peopleDm: true } : undefined);
    expect(routineRoomThread({ sourceThreadId: ROOM.threadId }, BOT.id, roomOf)).toBe(ROOM.threadId);
    expect(routineRoomThread({ resultsThreadId: "bot-thread", sourceThreadId: ROOM.threadId }, BOT.id, roomOf)).toBe(ROOM.threadId);
    expect(routineRoomThread({ sourceThreadId: ROOM.threadId }, "bot-other", roomOf)).toBeNull();
    expect(routineRoomThread({ sourceThreadId: "people-dm" }, BOT.id, roomOf)).toBeNull();
    expect(routineRoomThread({ sourceThreadId: "bot-thread" }, BOT.id, roomOf)).toBeNull();
  });

  it("the raise carries the card's key, hold and addressee from its first frame (its notification reads them)", () => {
    const w = world();
    w.ask({ ...ITEM, key: "ticket-12", wait: false, to: "Ana" });
    expect(w.raised[0]?.card).toEqual({ askKey: "ticket-12", noHold: true, askTo: { id: "p-ana", name: "Ana" } });
  });

  it("raiseHarnessQuestion raises in a room for a member bot, naming it as the asker", () => {
    const publish = vi.fn();
    const askMessageByRequest = new Map<string, string>();
    const raise = createRaiseHarnessQuestion(() => ({
      newId: () => "id1",
      store: { botByThread: () => undefined, groupByThread: (threadId: string) => (threadId === ROOM.threadId ? ROOM : undefined) },
      bus: { publish: (event: { threadId: string; requestId: string }) => { publish(event); askMessageByRequest.set(`${event.threadId}:${event.requestId}`, "row-1"); } },
      askMessageByRequest,
    }));
    const raised = raise(ROOM.threadId, { title: "Your bot has a question", question: ITEM.question, options: ITEM.options, askerBotId: BOT.id, card: { askKey: "ticket-12", askTo: { id: "p-ana", name: "Ana" } } });
    expect(raised?.messageId).toBe("row-1");
    expect(publish.mock.calls[0]![0]).toMatchObject({ askerBotId: BOT.id, askCard: { askKey: "ticket-12", askTo: { id: "p-ana", name: "Ana" } }, harnessAsk: true });
    // a bot that is not a member of the room raises nothing there
    expect(raise(ROOM.threadId, { title: "t", question: ITEM.question, options: ITEM.options, askerBotId: "bot-other" })).toBeNull();
  });
});

describe("#4219 point 2: the answering turn names who answered", () => {
  const identity = answererIdentity("p-ana", "Ana", {
    email: "ana@example.test", login: "ana", controlPlaneUserId: "u-17", subject: { iss: "https://id.example.test", sub: "s-17" },
    perspicaxRole: "manager", teams: [{ id: "t-ops" }], label: "Dispatcher",
  });

  it("carries the stable id, the display name and the product identity fields the server holds", () => {
    expect(identity).toEqual({ id: "p-ana", name: "Ana", email: "ana@example.test", login: "ana", accountId: "u-17", subject: "s-17", role: "manager", teams: ["t-ops"], label: "Dispatcher" });
    expect(answererIdentity("p-ben", "", null)).toEqual({ id: "p-ben", name: "p-ben" });
  });

  it("promptWithReply and the transcript give the key, who answered and the option", () => {
    const card = { id: "c1", role: "bot", kind: "options", at: 1, card: { title: "q", subtitle: ITEM.question, options: ITEM.options, requestId: "r1", askKey: "ticket-12", answeredBy: { kind: "session", ...identity, via: "call" }, questionRequest: { version: 1, questions: [{ question: ITEM.question, options: [] }] } } } as unknown as Message;
    const prompt = promptWithReply("Take it", { id: "c1", text: "", kind: "options", card: card.card } as never);
    expect(prompt).toContain('key: "ticket-12"');
    expect(prompt).toContain(`answered by: ${JSON.stringify(identity)}`);
    expect(prompt).toContain("Take it");
    const answer = { id: "a1", role: "user", kind: "text", at: 2, text: "@Desk: Take it", replyToId: "c1" } as unknown as Message;
    const line = transcriptText(answer, new Map([["c1", card]]));
    expect(line).toContain('with key "ticket-12"');
    expect(line).toContain(`answered by ${JSON.stringify(identity)}`);
  });

  it("two people answering at the same moment: the accepted answer names its own answerer, the refused one never overwrites it", async () => {
    const w = world();
    w.ask({ ...ITEM, key: "ticket-12", wait: false });
    const row = w.cards()[0]!;
    const requestId = row.card!.requestId!;
    const answererOf = (auth: { name: string }) => ({ id: auth.name === "Ana" ? "p-ana" : "p-ben", name: auth.name });
    const startGroupTurn = vi.fn((_groupId: string, text: string, target: Message, sendId: string) => {
      w.store.appendMessage(ROOM.threadId, { role: "user", kind: "text", text, replyToId: target.id, sendId, channelMode: "chat" } as Omit<Message, "id" | "at">);
    });
    const host = {
      store: { ...w.store, group: () => ROOM, groupTaskByThread: () => ({ threadId: ROOM.threadId }), taskByThread: () => undefined },
      sendSequencer: new SendSequencer(),
      groupThreadIsWorking: () => false,
      startGroupTurn,
      messageSender: () => undefined, usageTriggerFor: () => undefined, cfg: {},
      roomAskAnswerer: (auth: { name: string }) => answererOf(auth),
      cardAnswererFor: (auth: { name: string }) => ({ kind: "session", name: auth.name }),
      withDecisionActor: async (_actor: unknown, work: () => Promise<unknown>) => work(),
      decisionActorFor: () => ({}),
      actConfirmed: () => undefined,
      flushDecisionLog: async () => {},
      DATA_DIR: "/nowhere",
    };
    const deliver = createDeliverLateQuestionAnswer(() => host);
    const answering = createAnsweringCardAs(() => host);
    const answer = (name: string, choice: string) => answering({ kind: "session", name }, ROOM.threadId, requestId, () => deliver({ kind: "session", name }, ROOM.threadId, requestId, choice, row, BOT));
    const [ana, ben] = await Promise.allSettled([answer("Ana", "Take it"), answer("Ben", "Hand it over")]);
    expect(ana.status).toBe("fulfilled");
    expect(ben).toMatchObject({ status: "rejected", reason: { status: 409 } });
    expect(startGroupTurn).toHaveBeenCalledTimes(1);
    // the turn starts on the card that names Ana, and the card keeps Ana
    // in the card's one answeredBy (no second answerer field)
    expect(startGroupTurn.mock.calls[0]![2].card?.answeredBy).toEqual({ kind: "session", id: "p-ana", name: "Ana" });
    expect(w.cards()[0]?.card?.answeredBy).toEqual({ kind: "session", id: "p-ana", name: "Ana" });
    expect(w.cards()[0]?.card).not.toHaveProperty("answerer");
  });
});

describe("#4219 point 3: addressed to one person, re-addressed by key, the room's people readable", () => {
  it("lists the room's people by the room's own verdict (listed, team members, its shared section's members), with ids and display names", () => {
    expect(PEOPLE).toEqual([{ id: "p-ana", name: "Ana" }, { id: "p-ben", name: "Ben" }, { id: "p-cyd", name: "Cyd" }, { id: "p-eve", name: "Eve" }]);
    expect(roomPeopleLine(PEOPLE)).toBe("People in this room (address a keyed ask_choice card to one of them with to): Ana (person id p-ana), Ben (person id p-ben), Cyd (person id p-cyd), Eve (person id p-eve).");
  });

  it("the room's verdict decides who posts: the operator at this computer, and on a solo server the operator signed in too", () => {
    const rule = { solo: true, operatorId: "p-op", verdict: mayPost };
    expect(roomMayPost(undefined, rule)).toBe(true);
    expect(roomMayPost("p-op", rule)).toBe(true);
    expect(roomMayPost("p-eve", rule)).toBe(true);
    expect(roomMayPost("p-dan", rule)).toBe(false);
    // on an organization server the operator's own sign-in follows the room's verdict
    expect(roomMayPost("p-op", { ...rule, solo: false })).toBe(false);
    // a solo room that lists only a guest: the operator is one of its people
    const soloPeople = roomPeople([{ id: "p-op", name: "Operator" }, { id: "p-guest", name: "Guest" }], (id) => roomMayPost(id, { solo: true, operatorId: "p-op", verdict: (who) => who === "p-guest" }));
    expect(soloPeople.map((person) => person.id)).toEqual(["p-op", "p-guest"]);
  });

  it("a key names the asking bot's own card: another bot's card with the same key in the room is skipped by the lookup", () => {
    const w = world();
    w.ask({ ...ITEM, key: "k", wait: false });
    w.ask({ ...ITEM, key: "k", wait: false }, { bot: OTHER_BOT });
    expect(w.cards()).toHaveLength(2);
    const again = w.ask({ question: "Ticket 12: still yours?", options: ITEM.options, key: "k", wait: false });
    expect(again).toMatchObject({ ok: true, replaced: true });
    expect(w.cards()).toHaveLength(2);
    expect(w.cards()[0]?.card?.subtitle).toBe("Ticket 12: still yours?");
    expect(w.cards()[1]?.card?.subtitle).toBe(ITEM.question);
    expect(w.ask({ key: "k", retire: true })).toMatchObject({ ok: true, retired: 1 });
    expect(w.cards()[0]?.card?.expired).toBe(true);
    expect(w.cards()[1]?.card?.expired).toBeUndefined();
  });

  it("resolves to by person id or by a display name, and names the people when it cannot", () => {
    expect(resolveAddressee("p-ben", PEOPLE)).toEqual({ ok: true, addressee: { id: "p-ben", name: "Ben" } });
    expect(resolveAddressee("@ana", PEOPLE)).toEqual({ ok: true, addressee: { id: "p-ana", name: "Ana" } });
    const missing = resolveAddressee("Dan", PEOPLE);
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain("Ana (person id p-ana)");
  });

  it("the tool takes to, and the parser keeps it", () => {
    expect(Object.keys(ASK_CHOICE_DEF.inputSchema.properties)).toContain("to");
    const parsed = parseAskChoiceInput({ ...ITEM, key: "k", to: "Ana" });
    expect(parsed.ok && "value" in parsed ? parsed.value.to : undefined).toBe("Ana");
  });

  it("addresses the card to one person and tells the bot whom, with the room's people", () => {
    const w = world();
    const result = w.ask({ ...ITEM, key: "ticket-12", wait: false, to: "Ana" });
    expect(w.cards()[0]?.card?.askTo).toEqual({ id: "p-ana", name: "Ana" });
    expect(result.ok && "addressedTo" in result ? result.addressedTo : undefined).toBe("Ana");
    expect(result.ok && "people" in result ? result.people : "").toContain("Ben (person id p-ben)");
  });

  it("the same key with another to replaces the card in place, re-addressed, and notifies the new person only", () => {
    const w = world();
    w.ask({ ...ITEM, key: "ticket-12", wait: false, to: "Ana" });
    const result = w.ask({ ...ITEM, key: "ticket-12", wait: false, to: "p-ben" });
    expect(w.cards()).toHaveLength(1);
    expect(w.cards()[0]?.card?.askTo).toEqual({ id: "p-ben", name: "Ben" });
    expect(result.ok && "replaced" in result ? result.replaced : undefined).toBe(true);
    expect(w.notifyAddressee).toHaveBeenCalledTimes(1);
    expect(w.notifyAddressee).toHaveBeenCalledWith(ROOM.threadId, w.cards()[0]!.id);
    // the same addressee again: no second notification
    w.ask({ ...ITEM, key: "ticket-12", wait: false, to: "Ben" });
    expect(w.notifyAddressee).toHaveBeenCalledTimes(1);
  });

  it("refuses to outside a room, and a person who is not in the room", () => {
    const w = world();
    const outside = w.ask({ ...ITEM, key: "k", to: "Ana" }, { threadId: "bot-thread", room: undefined });
    expect(outside.ok).toBe(false);
    const stranger = w.ask({ ...ITEM, key: "k", to: "Dan" });
    expect(stranger.ok).toBe(false);
    expect(w.cards()).toHaveLength(0);
  });

  it("the tool result tells the bot the card is addressed and the room's people", async () => {
    const body = { ok: true, messageId: "m1", waitsForPerson: true, holds: false, addressedTo: "Ana", people: roomPeopleLine(PEOPLE) };
    const api = vi.fn<HarnessClient["api"]>(async () => body);
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body }));
    const context: ToolCallContext = { botId: BOT.id, threadId: ROOM.threadId, depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api, apiResponse } };
    const text = (await callTool(ASK_CHOICE_TOOL, { ...ITEM, key: "ticket-12", wait: false, to: "Ana" }, context)).text;
    expect(text).toContain("only Ana's answer counts");
    expect(text).toContain("Ben (person id p-ben)");
  });
});

describe("#4219 points 4 and 5: notification per person, isolation whole", () => {
  const keyed = { askKey: "ticket-12" };
  const addressed = { askKey: "ticket-12", askTo: { id: "p-ana", name: "Ana" } };

  it("notifies the room's people for a keyed card (its shared section's members included), the addressee alone for an addressed one", () => {
    expect(roomAskAudience(keyed, ROOM, PEOPLE)).toEqual(["p-ana", "p-ben", "p-cyd", "p-eve"]);
    expect(roomAskAudience(addressed, ROOM, PEOPLE)).toEqual(["p-ana"]);
    expect(roomAskAudience({}, ROOM, PEOPLE)).toBeUndefined();
    expect(roomAskAudience(keyed, { ...ROOM, dm: true }, PEOPLE)).toBeUndefined();
  });

  it("a person outside the room never answers; whoever posts in the room does; only the addressee's answer counts", () => {
    const by = (id: string | undefined) => ({ mayPost: roomMayPost(id, { solo: false, operatorId: "p-op", verdict: mayPost }), answererId: id });
    expect(roomAskAnswer(keyed, ROOM, by("p-dan")).kind).toBe("refused");
    expect(roomAskAnswer(keyed, ROOM, by("p-cyd")).kind).toBe("allowed");
    // a member of the room's shared section reads, posts and answers
    expect(roomAskAnswer(keyed, ROOM, by("p-eve")).kind).toBe("allowed");
    expect(roomAskAnswer(addressed, ROOM, by("p-ben")).kind).toBe("refused");
    expect(roomAskAnswer(addressed, ROOM, by("P-ANA")).kind).toBe("allowed");
    expect(roomAskAnswer({}, ROOM, by("p-dan")).kind).toBe("other");
    // addressed to Eve, a section member: the card counts her answer
    expect(roomAskAnswer({ askKey: "k", askTo: { id: "p-eve", name: "Eve" } }, ROOM, by("p-eve")).kind).toBe("allowed");
  });

  it("the answer route refuses an outsider and a non-addressee, workspace admins included", () => {
    const verdict = vi.fn();
    const refusal = createCardAnswerRefusal(() => ({ roomAskAnswerFor: verdict, store: { messagesFor: () => [] } }));
    const admin = { kind: "session", scopes: ["admin"], session: {} };
    verdict.mockReturnValueOnce({ kind: "refused", error: "Only the people in this room can answer this card." });
    expect(refusal(admin, ROOM.threadId, "r1", "answer")).toBe("Only the people in this room can answer this card.");
    verdict.mockReturnValueOnce({ kind: "allowed" });
    expect(refusal({ kind: "session", scopes: [], session: {} }, ROOM.threadId, "r1", "answer")).toBeNull();
  });
});
