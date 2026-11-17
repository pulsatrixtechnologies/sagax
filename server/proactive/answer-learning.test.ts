// #4250 (S7): answer learning. The ledger keeps each keyed card's answer by
// kind; a run reads the person's last answers in its prompt; a card puts the
// usual answer first and, after three identical answers, offers "Always do
// this for this routine", kept as the person's preference (never in the
// instructions) only on their click. Never an automatic answer.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ASK_CHOICE_TOOL } from "../../shared/options-card.ts";
import { RoutineManager } from "../routines/routines.ts";
import type { Message } from "../store.ts";
import { AskKeyIndex } from "../widgets/ask-choice-keys.ts";
import { createAgentCard, type AgentCardStore } from "../widgets/chat-widgets.ts";
import {
  ALWAYS_AFTER, ANSWERS_KEPT, alwaysChoiceOn, alwaysChoices, alwaysOffer, answerHistory, answerLearningNote, answeredCardText, answersOnKind,
  cardKindOf, cardOffersAlways, forgetAlwaysChoice, learnFromAnsweredCard, migrateAlwaysLines, recordCardAnswer, rememberAlwaysChoice,
  takeAlwaysLines, type AnswerScope,
} from "./answer-learning.ts";
import { SignalLedger, signalLedgerDirStorage } from "./signal-ledger.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-answer-learning-"));
  dirs.push(dir);
  return dir;
}

let clock = 1_000;
function ledgerOn(dir: string): SignalLedger {
  return new SignalLedger({ storage: signalLedgerDirStorage(join(dir, "signal-ledger")), now: () => clock, schedule: () => {} });
}

const SCOPE: AnswerScope = { person: "pr_a", bot: "b1", routineId: "r1" };

/** The person answers `n` cards of `key`'s kind with `answer`. */
function answer(ledger: SignalLedger, n: number, answerText: string, scope: AnswerScope = SCOPE, key = "ticket-10"): void {
  for (let index = 0; index < n; index += 1) {
    clock += 1_000;
    recordCardAnswer(ledger, scope, { askKey: key.replace(/\d+$/, String(100 + clock)), threadId: "t1", messageId: `m${clock}`, answer: answerText });
  }
}

describe("cardKindOf: the key without its item id", () => {
  it("drops a trailing id, keeps a key without one, and keeps a text key whole", () => {
    expect(cardKindOf("ticket-1012")).toBe("ticket");
    expect(cardKindOf("ticket-1012-2")).toBe("ticket");
    expect(cardKindOf("routine-problem:r_8f3a")).toBe("routine-problem");
    expect(cardKindOf("item:r1:t2041")).toBe("item");
    expect(cardKindOf("routine-problem:5c1e2a90-7d1b-4f0e-9a51-0d2c4b7e8f11")).toBe("routine-problem");
    expect(cardKindOf("inbox-review")).toBe("inbox-review");
    expect(cardKindOf("ask-0123456789abcdef")).toBe("ask-0123456789abcdef");
  });
});

describe("the ledger keeps each keyed card's answer by kind", () => {
  it("records one answer per card, by kind, across a restart, in a file the previous version reads", () => {
    const dir = tempDir();
    const ledger = ledgerOn(dir);
    expect(recordCardAnswer(ledger, SCOPE, { askKey: "ticket-1", threadId: "t1", messageId: "m1", answer: "Approve" })).toBe(true);
    // the same card patched again is the same answer
    expect(recordCardAnswer(ledger, SCOPE, { askKey: "ticket-1", threadId: "t1", messageId: "m1", answer: "Approve" })).toBe(false);
    clock += 1_000;
    recordCardAnswer(ledger, SCOPE, { askKey: "ticket-2", threadId: "t2", messageId: "m2", answer: "Refuse" });
    ledger.flush();
    const after = ledgerOn(dir);
    expect(answersOnKind(after, SCOPE, "ticket-99")).toMatchObject({ kind: "ticket", answers: ["Refuse", "Approve"] });
    // every entry is an ordinary ledger entry, settled answered
    const entries = after.entries({ person: "pr_a", kind: "card-answer" }).map(({ entry }) => entry);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.state === "answered" && typeof entry.answer === "string" && entry.bot === "b1")).toBe(true);
  });

  it("keeps the newest answers per routine and kind, and one person's answers are never another's", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, ANSWERS_KEPT + 4, "Approve");
    expect(answersOnKind(ledger, SCOPE, "ticket-1")!.answers).toHaveLength(ANSWERS_KEPT);
    expect(answersOnKind(ledger, { ...SCOPE, person: "pr_b" }, "ticket-1")).toBeNull();
    expect(answersOnKind(ledger, { ...SCOPE, routineId: "r2" }, "ticket-1")).toBeNull();
  });

  it("reads the usual answer (the most frequent) and the streak of identical answers", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Approve");
    answer(ledger, 1, "refuse");
    answer(ledger, 1, "Refuse ");
    const seen = answersOnKind(ledger, SCOPE, "ticket-1")!;
    expect(seen.usual).toBe("Approve");
    expect(seen.streak).toBe(2);
  });

  it("an answer counts only when the person gave it", () => {
    expect(answeredCardText({ answered: "Approve" })).toBe("Approve");
    expect(answeredCardText({ answered: "answer", answeredText: "Refuse" })).toBe("Refuse");
    expect(answeredCardText({ answered: "answer" })).toBeNull();
    expect(answeredCardText({ answered: "skipped", skipped: true })).toBeNull();
    expect(answeredCardText({ answered: "Approve", autoApplied: true })).toBeNull();
    expect(answeredCardText({ answered: "Approve", answeredBy: { kind: "worker" } })).toBeNull();
    expect(answeredCardText({ answered: "Approve", expired: true })).toBeNull();
  });
});

describe("prompt section: the person's last answers on this kind", () => {
  it("lists each kind's usual answer and last answers, and tells the bot never to answer for the person", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 2, "Approve");
    answer(ledger, 1, "Refuse");
    const note = answerLearningNote(answerHistory(ledger, SCOPE))!;
    expect(note).toContain("kind \"ticket\": usual \"Approve\"; last \"Refuse\", \"Approve\", \"Approve\"");
    expect(note).toContain("never answer a card for them");
    expect(answerLearningNote(answerHistory(ledger, { ...SCOPE, routineId: "other" }))).toBeUndefined();
  });

  it("a routine run's prompt carries the section", async () => {
    const dir = tempDir();
    const turns: string[] = [];
    const manager = new RoutineManager({
      file: join(dir, "routines.json"),
      botState: () => "ready",
      createTask: () => ({ threadId: "thread-1" }),
      startTurn: async (_botId, _threadId, prompt) => { turns.push(prompt); },
      answersNote: (run) => run.routineId === routine.id ? "The person's last answers: kind \"ticket\"" : undefined,
    });
    const routine = manager.create({ name: "Time review", prompt: "Review the time entries.", botId: "b1", schedule: { type: "daily", time: "09:00", weekdays: [3] } });
    manager.runNow(routine.id);
    await manager.tick();
    for (let index = 0; index < 5 && !turns.length; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(turns[0]).toContain("Review the time entries.");
    expect(turns[0]).toContain("The person's last answers: kind \"ticket\"");
  });
});

describe("\"Always do this for this routine\" after three identical answers", () => {
  const OPTIONS = ["Approve", "Refuse"];
  it("is offered after three identical answers in a row, never before, never when the person already chose it", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, ALWAYS_AFTER - 1, "Approve");
    const input = { options: OPTIONS, chosen: null, language: "en" as const };
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)).toBeNull();
    answer(ledger, 1, "Approve");
    const offer = alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)!;
    expect(offer).toEqual({ option: "Approve (always for this routine)", answer: "Approve" });
    rememberAlwaysChoice(ledger, SCOPE, "ticket", "Approve");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { ...input, chosen: alwaysChoiceOn(ledger, SCOPE, "ticket") })).toBeNull();
    // a different answer breaks the streak
    answer(ledger, 1, "Refuse");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)).toBeNull();
    // the person's language
    answer(ledger, 3, "Approuver");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { ...input, language: "fr" })!.option).toBe("Approuver (toujours pour cette routine)");
  });

  it("a card that offers its own \"always\" choice never gets a second one", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Allow");
    const history = answersOnKind(ledger, SCOPE, "ticket-1");
    expect(cardOffersAlways(["Allow", "Always allow", "Deny"])).toBe(true);
    expect(cardOffersAlways(["Permettre", "Toujours permettre"])).toBe(true);
    expect(cardOffersAlways(["Allow", "Deny"])).toBe(false);
    expect(alwaysOffer(history, { options: ["Allow", "Always allow", "Deny"], chosen: null, language: "en" })).toBeNull();
    expect(alwaysOffer(history, { options: ["Permettre", "Toujours permettre"], chosen: null, language: "fr" })).toBeNull();
    expect(alwaysOffer(history, { options: ["Allow", "Deny"], chosen: null, language: "en" })).not.toBeNull();
  });

  it("the person's click keeps a preference for the routine and the card kind, never a line in the instructions", () => {
    const ledger = ledgerOn(tempDir());
    const always = { option: "Approve (always for this routine)", answer: "Approve" };
    const learning = { routineId: "r1", kind: "ticket", always };
    // another answer on the offering card keeps nothing
    expect(learnFromAnsweredCard(ledger, SCOPE, { askKey: "ticket-5", threadId: "t1", messageId: "m5", answer: "Refuse", learning })).toBe("recorded");
    expect(alwaysChoices(ledger, SCOPE)).toEqual([]);
    // the click keeps one preference, by kind, and the answer recorded is the usual one
    clock += 1_000;
    expect(learnFromAnsweredCard(ledger, SCOPE, { askKey: "ticket-6", threadId: "t1", messageId: "m6", answer: always.option, learning })).toBe("always");
    expect(alwaysChoices(ledger, SCOPE)).toEqual([{ kind: "ticket", answer: "Approve", at: clock }]);
    expect(answersOnKind(ledger, SCOPE, "ticket-1")!.answers[0]).toBe("Approve");
    // the same card seen again (a restart, a second patch) keeps nothing more
    expect(learnFromAnsweredCard(ledger, SCOPE, { askKey: "ticket-6", threadId: "t1", messageId: "m6", answer: always.option, learning })).toBe("known");
    expect(alwaysChoices(ledger, SCOPE)).toHaveLength(1);
  });

  it("a preference is the person's own, for one routine, kept across a restart, and removable", () => {
    const dir = tempDir();
    const ledger = ledgerOn(dir);
    rememberAlwaysChoice(ledger, SCOPE, "ticket", "Approve");
    clock += 1_000;
    rememberAlwaysChoice(ledger, SCOPE, "ticket", "Refuse");
    clock += 1_000;
    rememberAlwaysChoice(ledger, SCOPE, "inbox-review", "Archive");
    ledger.flush();
    const after = ledgerOn(dir);
    expect(alwaysChoices(after, SCOPE).map((choice) => [choice.kind, choice.answer])).toEqual([["inbox-review", "Archive"], ["ticket", "Refuse"]]);
    expect(alwaysChoiceOn(after, SCOPE, "ticket")!.answer).toBe("Refuse");
    expect(alwaysChoices(after, { ...SCOPE, person: "pr_b" })).toEqual([]);
    expect(alwaysChoices(after, { ...SCOPE, routineId: "r2" })).toEqual([]);
    // never mixed with the answer history
    expect(answerHistory(after, SCOPE)).toEqual([]);
    expect(forgetAlwaysChoice(after, { ...SCOPE, person: "pr_b" }, "ticket")).toBe(false);
    expect(forgetAlwaysChoice(after, SCOPE, "ticket")).toBe(true);
    expect(alwaysChoiceOn(after, SCOPE, "ticket")).toBeNull();
    expect(alwaysChoices(after, SCOPE).map((choice) => choice.kind)).toEqual(["inbox-review"]);
  });

  it("a run reads the preferences by card kind, never one card's question", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 1, "Approve");
    rememberAlwaysChoice(ledger, SCOPE, "ticket", "Approve");
    const note = answerLearningNote(answerHistory(ledger, SCOPE), alwaysChoices(ledger, SCOPE))!;
    expect(note).toContain("- kind \"ticket\": always \"Approve\"");
    expect(note).not.toContain("Ticket 77");
    // the preferences alone are a section too
    expect(answerLearningNote([], alwaysChoices(ledger, SCOPE))).toContain("kind \"ticket\": always \"Approve\"");
    expect(answerLearningNote([], [])).toBeUndefined();
  });
});

describe("the lines an older version wrote into the instructions move to the preferences", () => {
  const EN = "Always for \"Ticket 77: 2 h logged. Approve?\" (key ticket): Approve. The person chose this on a card: do it without asking.";
  const FR = "Toujours pour « Ticket 78 ? » (clé inbox-review) : Archiver. La personne l'a choisi sur une carte : fais-le sans demander.";
  it("takes each line out, leaves the rest of the text as it was", () => {
    expect(takeAlwaysLines(`Review the time entries.\n\n${EN}`)).toEqual({ instructions: "Review the time entries.", choices: [{ kind: "ticket", answer: "Approve" }] });
    expect(takeAlwaysLines(`Review.\n  Keep this.\n\n${EN}\n\n${FR}`)).toEqual({
      instructions: "Review.\n  Keep this.",
      choices: [{ kind: "ticket", answer: "Approve" }, { kind: "inbox-review", answer: "Archiver" }],
    });
    expect(takeAlwaysLines(`${EN}\n\nReview.`)).toEqual({ instructions: "Review.", choices: [{ kind: "ticket", answer: "Approve" }] });
    const plain = "Review.\nAlways for urgent tickets: call me.";
    expect(takeAlwaysLines(plain)).toEqual({ instructions: plain, choices: [] });
  });

  it("migrates every routine once: preferences kept, instructions cleaned", () => {
    const ledger = ledgerOn(tempDir());
    const prompts = new Map([["r1", `Review.\n\n${EN}`], ["r2", "Nothing learned."]]);
    const moved = migrateAlwaysLines(ledger, [...prompts].map(([id, prompt]) => ({ id, prompt, scope: { ...SCOPE, routineId: id } })), (id, prompt) => { prompts.set(id, prompt); return true; });
    expect(moved).toBe(1);
    expect(prompts.get("r1")).toBe("Review.");
    expect(prompts.get("r2")).toBe("Nothing learned.");
    expect(alwaysChoiceOn(ledger, SCOPE, "ticket")!.answer).toBe("Approve");
    // a second pass finds nothing
    expect(migrateAlwaysLines(ledger, [...prompts].map(([id, prompt]) => ({ id, prompt, scope: { ...SCOPE, routineId: id } })), () => true)).toBe(0);
  });
});

describe("the card: usual answer first, the offer, never an automatic answer", () => {
  function world(ledger: SignalLedger) {
    const rows = new Map<string, Message[]>();
    let next = 0;
    const of = (threadId: string) => rows.get(threadId) ?? rows.set(threadId, []).get(threadId)!;
    const store: AgentCardStore = {
      groupByThread: () => undefined,
      messagesFor: (threadId) => of(threadId),
      appendMessage: (threadId, message) => {
        const full = { ...message, id: `m${++next}`, at: next } as Message;
        of(threadId).push(full);
        return full;
      },
      patchMessage: (threadId, messageId, patch) => {
        const list = of(threadId);
        const index = list.findIndex((row) => row.id === messageId);
        if (index < 0) return null;
        list[index] = { ...list[index]!, ...patch } as Message;
        return list[index]!;
      },
    };
    const left: string[] = [];
    const index = new AskKeyIndex({ seed: () => [], messagesFor: (threadId) => of(threadId), left: (_threadId, messageId) => { left.push(messageId); } });
    const ask = (input: Record<string, unknown>) => createAgentCard({
      store, bot: { id: "b1", name: "Watch", color: "blue" }, threadId: "run-1",
      input: { tool: ASK_CHOICE_TOOL, ...input },
      // Full access: a may-I would be answered; a keyed card never is
      approvalLevel: "full",
      askKeys: {
        find: (key) => index.find(key, () => true),
        remember: (key, threadId, messageId) => index.remember(key, threadId, messageId),
        retire: () => {},
      },
      answerLearning: {
        routineId: "r1",
        answers: (key) => answersOnKind(ledger, SCOPE, key),
        always: (kind) => alwaysChoiceOn(ledger, SCOPE, kind),
        language: "en",
      },
    });
    return { store, ask, of, index, left };
  }

  it("puts the usual answer first and offers \"Always\" after three identical answers, the card left for the person", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Refuse");
    const w = world(ledger);
    const posted = w.ask({ key: "ticket-77", question: "Ticket 77: 2 h logged. Approve this time entry?", options: ["Approve", "Refuse", "Correct"], wait: false });
    expect(posted.ok).toBe(true);
    const card = w.of("run-1").find((row) => row.id === (posted as { messageId: string }).messageId)!.card!;
    expect(card.options).toEqual(["Refuse", "Approve", "Correct", "Refuse (always for this routine)"]);
    expect(card.answerLearning).toMatchObject({ routineId: "r1", kind: "ticket", always: { option: "Refuse (always for this routine)", answer: "Refuse" } });
    // the offer quotes no card's question
    expect(JSON.stringify(card.answerLearning)).not.toContain("Ticket 77");
    // never an automatic answer
    expect(card.answered).toBeUndefined();
    expect(card.autoApplied).toBeUndefined();
  });

  it("two identical answers: the usual answer first, no offer yet", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 2, "Refuse");
    const w = world(ledger);
    const posted = w.ask({ key: "ticket-78", question: "Approve this time entry?", options: ["Approve", "Refuse"], wait: false });
    const card = w.of("run-1").find((row) => row.id === (posted as { messageId: string }).messageId)!.card!;
    expect(card.options).toEqual(["Refuse", "Approve"]);
    expect(card.answerLearning).toEqual({ routineId: "r1", kind: "ticket" });
  });

  it("no offer once the person chose \"always\" for this kind", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Refuse");
    rememberAlwaysChoice(ledger, SCOPE, "ticket", "Refuse");
    const w = world(ledger);
    const posted = w.ask({ key: "ticket-79", question: "Approve this time entry?", options: ["Approve", "Refuse"], wait: false });
    const card = w.of("run-1").find((row) => row.id === (posted as { messageId: string }).messageId)!.card!;
    expect(card.options).toEqual(["Refuse", "Approve"]);
    expect(card.answerLearning?.always).toBeUndefined();
  });

  it("an answered keyed card leaves the index for the learning to read it", () => {
    const ledger = ledgerOn(tempDir());
    const w = world(ledger);
    const posted = w.ask({ key: "ticket-80", question: "Approve this time entry?", options: ["Approve", "Refuse"], wait: false }) as { messageId: string };
    const row = w.of("run-1").find((message) => message.id === posted.messageId)!;
    w.store.patchMessage("run-1", row.id, { card: { ...row.card!, answered: "Approve" } });
    w.index.changed("run-1", row.id);
    expect(w.left).toEqual([row.id]);
  });
});
