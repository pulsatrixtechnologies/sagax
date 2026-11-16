// #4438: an answered card closes at once, on every surface that lists it:
// it is answered before the turn its answer starts (which may wait), and a
// server card's own choice is done with no turn at all.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { formatQuestionAnswers } from "../../shared/ask-question.ts";
import { answerWithoutNote } from "../../shared/options-card.ts";
import type { Message } from "../store.ts";
import { createDeliverLateQuestionAnswer } from "./deliverLateQuestionAnswer.ts";

const BOT = { id: "b1", name: "Watch" };
const THREAD = "conv-b1";

function card(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: {
      title: "Sweep needs a fix", subtitle: "Sweep ended with problems on its last run.", options: ["Run a check", "Pause the routine", "Open the routine"],
      requestId: "ask-choice-1", requestType: "question", askKey: "routine-problem:r1", noHold: true,
      questionRequest: { version: 1, questions: [{ question: "Sweep ended with problems on its last run.", options: [{ label: "Run a check" }, { label: "Pause the routine" }, { label: "Open the routine" }] }] },
      ...extra,
    },
  } as Message;
}

function host(row: Message, extra: Record<string, unknown> = {}) {
  const rows = [row];
  const store = {
    messagesFor: () => rows,
    patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => {
      const index = rows.findIndex((message) => message.id === id);
      if (index < 0) return undefined;
      rows[index] = { ...rows[index]!, ...patch } as Message;
      return rows[index];
    },
    taskByThread: () => ({ threadId: THREAD }),
    groupByThread: () => undefined,
  };
  return {
    rows,
    host: {
      store,
      sendSequencer: { run: (_key: string, _print: unknown, work: () => unknown) => work() },
      startOrQueueDirectMessage: vi.fn(async (..._args: unknown[]) => ({})),
      messageSender: () => undefined,
      usageTriggerFor: () => undefined,
      cardTurnSettled: vi.fn(),
      cfg: {},
      ...extra,
    },
  };
}

describe("an answered card closes at once (#4438)", () => {
  it("is answered before the turn its answer starts", async () => {
    const world = host(card({ askKey: "ticket-1012" }));
    let answeredAtStart: unknown;
    world.host.startOrQueueDirectMessage = vi.fn(async () => {
      answeredAtStart = world.rows[0]!.card!.answered;
      return {};
    });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await deliver({}, THREAD, "ask-choice-1", "Approve", world.rows[0]!, BOT);
    expect(answeredAtStart).toBe("answer");
    expect(world.rows[0]!.card).toMatchObject({ answered: "answer", answeredText: "Approve" });
  });

  it("a turn that could not start puts the card back, still to answer", async () => {
    const world = host(card({ askKey: "ticket-1012" }));
    world.host.startOrQueueDirectMessage = vi.fn(async () => {
      throw Object.assign(new Error("the bot switched tasks"), { status: 409 });
    });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await expect(deliver({}, THREAD, "ask-choice-1", "Approve", world.rows[0]!, BOT)).rejects.toThrow(/switched tasks/);
    expect(world.rows[0]!.card!.answered).toBeUndefined();
    expect(world.rows[0]!.card!.answeredText).toBeUndefined();
  });

  it("a server card's own choice is done at once: no turn, no line in the chat, the card says what happened", async () => {
    const serverCardAnswer = vi.fn(async (_auth: unknown, key: string, answer: string) => (key === "routine-problem:r1" && answer === "Open the routine"
      ? { note: "The routine's page is open.", open: { type: "open_routine", routineId: "r1", botId: "b1" } }
      : null));
    const world = host(card(), { serverCardAnswer });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    // the card's answer, as the question card sends it (its question, then the pick)
    const answer = formatQuestionAnswers(world.rows[0]!.card!.questionRequest!.questions, [["Open the routine"]]);
    const receipt = await deliver({}, THREAD, "ask-choice-1", answer, world.rows[0]!, BOT);
    expect(serverCardAnswer).toHaveBeenCalledWith({}, "routine-problem:r1", "Open the routine", { threadId: THREAD, messageId: "m1", opens: false });
    expect(receipt).toEqual({ queued: false, direct: true, open: { type: "open_routine", routineId: "r1", botId: "b1" } });
    expect(world.host.startOrQueueDirectMessage).not.toHaveBeenCalled();
    expect(world.rows).toHaveLength(1);
    expect(world.rows[0]!.card).toMatchObject({ answered: "answer", answerNote: "The routine's page is open." });
    expect(world.host.cardTurnSettled).toHaveBeenCalledWith(THREAD, "m1");
  });

  it("words of the person's own on a server card still reach the bot", async () => {
    const serverCardAnswer = vi.fn(async () => null);
    const world = host(card(), { serverCardAnswer });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await deliver({}, THREAD, "ask-choice-1", "Fix the sign-in first", world.rows[0]!, BOT);
    expect(world.host.startOrQueueDirectMessage).toHaveBeenCalledTimes(1);
    expect(world.rows[0]!.card!.answerNote).toBeUndefined();
  });

  it("a card answered already is refused, never done twice", async () => {
    const serverCardAnswer = vi.fn(async () => ({ note: "x" }));
    const world = host(card({ answered: "answer", answeredText: "Run a check" }), { serverCardAnswer });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await expect(deliver({}, THREAD, "ask-choice-1", "Run a check", world.rows[0]!, BOT)).rejects.toThrow(/already been answered/);
    expect(serverCardAnswer).not.toHaveBeenCalled();
  });

  it("a device that opens what the answer names says so; a call never does", async () => {
    const serverCardAnswer = vi.fn(async () => ({ note: "x" }));
    const world = host(card(), { serverCardAnswer });
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await deliver({}, THREAD, "ask-choice-1", "Open the routine", world.rows[0]!, BOT, undefined, undefined, true);
    expect(serverCardAnswer).toHaveBeenLastCalledWith({}, "routine-problem:r1", "Open the routine", { threadId: THREAD, messageId: "m1", opens: true });
    const called = host(card(), { serverCardAnswer });
    await createDeliverLateQuestionAnswer(() => called.host)({}, THREAD, "ask-choice-1", "Open the routine", called.rows[0]!, BOT, "call", "call-1", true);
    expect(serverCardAnswer).toHaveBeenLastCalledWith({}, "routine-problem:r1", "Open the routine", { threadId: THREAD, messageId: "m1", opens: false });
  });

  it("an app released before the note (no opens) still reads what happened, in the answer's words; a newer app reads it once", async () => {
    const serverCardAnswer = vi.fn(async () => ({ note: "Routine paused. Turn it back on from its page." }));
    const old = host(card(), { serverCardAnswer });
    await createDeliverLateQuestionAnswer(() => old.host)({}, THREAD, "ask-choice-1", "Pause the routine", old.rows[0]!, BOT);
    expect(old.rows[0]!.card).toMatchObject({
      answeredText: "Pause the routine\n\nRoutine paused. Turn it back on from its page.",
      answerNote: "Routine paused. Turn it back on from its page.",
    });
    expect(answerWithoutNote(old.rows[0]!.card!.answeredText!, old.rows[0]!.card!.answerNote)).toBe("Pause the routine");
    const fresh = host(card(), { serverCardAnswer });
    await createDeliverLateQuestionAnswer(() => fresh.host)({}, THREAD, "ask-choice-1", "Pause the routine", fresh.rows[0]!, BOT, undefined, undefined, true);
    expect(fresh.rows[0]!.card!.answeredText).toBe("Pause the routine");
  });

  it("the same answer sent again to a bot's keyed card is accepted as the one already recorded", async () => {
    const serverCardAnswer = vi.fn(async () => ({ note: "x" }));
    const world = host(card({ askKey: "ticket-1012", answered: "answer", answeredText: "Approve" }), { serverCardAnswer });
    const sendId = `late-question-${createHash("sha256").update(`${THREAD}:ask-choice-1`).digest("hex").slice(0, 32)}`;
    world.rows.push({ id: "m2", role: "user", kind: "text", at: 2, text: "Approve", sendId, replyToId: "m1" } as Message);
    const deliver = createDeliverLateQuestionAnswer(() => world.host);
    await expect(deliver({}, THREAD, "ask-choice-1", "Approve", world.rows[0]!, BOT)).resolves.toEqual({ queued: false });
    expect(serverCardAnswer).not.toHaveBeenCalled();
    expect(world.host.startOrQueueDirectMessage).not.toHaveBeenCalled();
  });
});
