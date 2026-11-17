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
  ALWAYS_AFTER, ANSWERS_KEPT, alwaysChoiceId, alwaysChoiceOn, alwaysChoices, alwaysOffer, answerHistory, answerLearningNote, answeredCardText,
  answersOnKind, cardKindOf, cardOffersAlways, forgetAlwaysChoice, learnFromAnsweredCard, migrateAlwaysLines, MOVED_ONLY_INSTRUCTIONS,
  questionShape, recordCardAnswer, rememberAlwaysChoice, takeAlwaysLines, type AnswerScope,
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
  const CHOICE = { kind: "ticket", question: "Approve this time entry?", options: OPTIONS, answer: "Approve" };
  it("is offered after three identical answers in a row, never before, never when the person already chose it", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, ALWAYS_AFTER - 1, "Approve");
    const input = { options: OPTIONS, chosen: null, language: "en" as const };
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)).toBeNull();
    answer(ledger, 1, "Approve");
    const offer = alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)!;
    expect(offer).toEqual({ option: "Approve (always for this routine)", answer: "Approve" });
    rememberAlwaysChoice(ledger, SCOPE, CHOICE);
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { ...input, chosen: alwaysChoiceOn(ledger, SCOPE, "ticket", CHOICE.question, OPTIONS) })).toBeNull();
    // a different answer breaks the streak
    answer(ledger, 1, "Refuse");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), input)).toBeNull();
    // the person's language
    answer(ledger, 3, "Approuver");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { ...input, options: ["Approuver", "Refuser"], language: "fr" })!.option).toBe("Approuver (toujours pour cette routine)");
  });

  it("never offers an answer the card does not offer", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Bob");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { options: ["Close", "Keep"], chosen: null, language: "en" })).toBeNull();
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { options: ["Bob", "Ann"], chosen: null, language: "en" })).not.toBeNull();
  });

  it("a card that offers its own \"always\" choice never gets a second one, in every language of the app", () => {
    for (const label of ["Always allow", "Toujours permettre", "Immer erlauben", "Permitir siempre", "Sempre permitir", "Завжди дозволяти", "हमेशा अनुमति दें", "常に許可", "始终允许", "一律允許"]) {
      expect(cardOffersAlways(["Allow", label]), label).toBe(true);
    }
    for (const label of ["Allow", "Not always", "Pas toujours", "Always-on VPN: enable", "Toujours-là"]) {
      expect(cardOffersAlways([label, "Deny"]), label).toBe(false);
    }
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Allow");
    const history = answersOnKind(ledger, SCOPE, "ticket-1");
    expect(alwaysOffer(history, { options: ["Allow", "Always allow", "Deny"], chosen: null, language: "en" })).toBeNull();
    expect(alwaysOffer(history, { options: ["Allow", "Deny"], chosen: null, language: "en" })).not.toBeNull();
  });

  it("the person's click keeps a preference for the routine, the card kind and its options, never a line in the instructions", () => {
    const ledger = ledgerOn(tempDir());
    const always = { option: "Approve (always for this routine)", answer: "Approve" };
    const learning = { routineId: "r1", kind: "ticket", always };
    const card = { threadId: "t1", question: "Ticket 6: approve this time entry?", options: ["Approve", "Refuse", always.option], learning };
    // another answer on the offering card keeps nothing
    expect(learnFromAnsweredCard(ledger, SCOPE, { ...card, askKey: "ticket-5", messageId: "m5", answer: "Refuse" })).toBe("recorded");
    expect(alwaysChoices(ledger, SCOPE)).toEqual([]);
    // the click keeps one preference, its card's question and options without the offer
    clock += 1_000;
    expect(learnFromAnsweredCard(ledger, SCOPE, { ...card, askKey: "ticket-6", messageId: "m6", answer: always.option })).toBe("always");
    expect(alwaysChoices(ledger, SCOPE)).toEqual([{ id: alwaysChoiceId("ticket", "Ticket 7: approve this time entry?", ["Refuse", "Approve"]), kind: "ticket", answer: "Approve", question: "Ticket 6: approve this time entry?", options: ["Approve", "Refuse"], at: clock }]);
    expect(answersOnKind(ledger, SCOPE, "ticket-1")!.answers[0]).toBe("Approve");
    // the same card seen again (a restart, a second patch) keeps nothing more
    expect(learnFromAnsweredCard(ledger, SCOPE, { ...card, askKey: "ticket-6", messageId: "m6", answer: always.option })).toBe("known");
    expect(alwaysChoices(ledger, SCOPE)).toHaveLength(1);
  });

  it("a choice covers one kind with the same options: another question of that kind is raised and offered on its own", () => {
    const ledger = ledgerOn(tempDir());
    rememberAlwaysChoice(ledger, SCOPE, { kind: "ticket", question: "Place ticket 1012 with whom?", options: ["Bob", "Ann"], answer: "Bob" });
    expect(alwaysChoiceOn(ledger, SCOPE, "ticket", "Place ticket 1013 with whom?", ["ann", "Bob "])!.answer).toBe("Bob");
    expect(alwaysChoiceOn(ledger, SCOPE, "ticket", "Close ticket 1013?", ["Close", "Keep"])).toBeNull();
    answer(ledger, 3, "Close");
    expect(alwaysOffer(answersOnKind(ledger, SCOPE, "ticket-1"), { options: ["Close", "Keep"], chosen: alwaysChoiceOn(ledger, SCOPE, "ticket", "Close ticket 1013?", ["Close", "Keep"]), language: "en" })).not.toBeNull();
    // the run is told the options the choice covers, and that another question is asked
    const note = answerLearningNote([], alwaysChoices(ledger, SCOPE))!;
    expect(note).toContain("- kind \"ticket\", the question \"Place ticket 1012 with whom?\" offering \"Bob\" / \"Ann\": always \"Bob\"");
  });

  it("a card keyed by its words: the run reads its question, never the key", () => {
    const ledger = ledgerOn(tempDir());
    rememberAlwaysChoice(ledger, SCOPE, { kind: "ask-0123456789abcdef", question: "Send the weekly digest?", options: ["Yes", "No"], answer: "Yes" });
    const note = answerLearningNote([], alwaysChoices(ledger, SCOPE))!;
    expect(note).toContain("- the question \"Send the weekly digest?\" offering \"Yes\" / \"No\": always \"Yes\"");
    expect(note).not.toContain("ask-0123456789abcdef");
  });

  it("a preference is the person's own, for one routine, kept across a restart, and removed for good", () => {
    const dir = tempDir();
    const ledger = ledgerOn(dir);
    rememberAlwaysChoice(ledger, SCOPE, CHOICE);
    clock += 1_000;
    rememberAlwaysChoice(ledger, SCOPE, { ...CHOICE, answer: "Refuse" });
    clock += 1_000;
    rememberAlwaysChoice(ledger, SCOPE, { kind: "inbox-review", question: "Archive this mail?", options: ["Archive", "Keep"], answer: "Archive" });
    ledger.flush();
    const after = ledgerOn(dir);
    expect(alwaysChoices(after, SCOPE).map((choice) => [choice.kind, choice.answer])).toEqual([["inbox-review", "Archive"], ["ticket", "Refuse"]]);
    expect(alwaysChoices(after, { ...SCOPE, person: "pr_b" })).toEqual([]);
    expect(alwaysChoices(after, { ...SCOPE, routineId: "r2" })).toEqual([]);
    // never mixed with the answer history
    expect(answerHistory(after, SCOPE)).toEqual([]);
    const id = alwaysChoiceId("ticket", CHOICE.question, OPTIONS);
    expect(forgetAlwaysChoice(after, { ...SCOPE, person: "pr_b" }, id)).toBe(false);
    expect(forgetAlwaysChoice(after, SCOPE, id)).toBe(true);
    expect(alwaysChoiceOn(after, SCOPE, "ticket", CHOICE.question, OPTIONS)).toBeNull();
    expect(alwaysChoices(after, SCOPE).map((choice) => choice.kind)).toEqual(["inbox-review"]);
  });

  it("a run reads each preference with the question it was chosen on, its kind and options", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 1, "Approve");
    rememberAlwaysChoice(ledger, SCOPE, { ...CHOICE, question: "Ticket 77: 2 h logged. Approve?" });
    const note = answerLearningNote(answerHistory(ledger, SCOPE), alwaysChoices(ledger, SCOPE))!;
    expect(note).toContain("- kind \"ticket\", the question \"Ticket 77: 2 h logged. Approve?\" offering \"Approve\" / \"Refuse\": always \"Approve\"");
    expect(note).toContain("only that same question asked of another item of the kind");
    expect(note).toContain("Any other question raises its card as usual, even one offering the same options or a different amount, level or quantity.");
    expect(answerLearningNote([], [])).toBeUndefined();
  });

  it("only an item's number may change; an amount, a level, a quantity or a date is part of the question", () => {
    const covers = (chosenOn: string, asked: string) => {
      const ledger = ledgerOn(tempDir());
      rememberAlwaysChoice(ledger, SCOPE, { kind: "ticket", question: chosenOn, options: ["Oui", "Non"], answer: "Oui" });
      return alwaysChoiceOn(ledger, SCOPE, "ticket", asked, ["Oui", "Non"]) !== null;
    };
    // the item's number or id: the same question
    expect(covers("Fermer le billet 1013 ?", "Fermer le billet 1014 ?")).toBe(true);
    expect(covers("Close ticket #1013?", "Close ticket #2077?")).toBe(true);
    expect(covers("Fermer le billet INC0012 ?", "Fermer le billet INC0457 ?")).toBe(true);
    expect(covers("チケット1013を閉じますか？", "チケット1014を閉じますか？")).toBe(true);
    // an amount, a level, a quantity: another question, the card goes back to the person
    expect(covers("Rembourser 50 $ ?", "Rembourser 5000 $ ?")).toBe(false);
    expect(covers("Donner l'accès niveau 1 ?", "Donner l'accès niveau 3 ?")).toBe(false);
    expect(covers("Commander 2 licences ?", "Commander 40 licences ?")).toBe(false);
    expect(covers("Order 2 licenses?", "Order 40 licenses?")).toBe(false);
    // a bare number is not known to be an id: in doubt, it counts
    expect(covers("Close 1013?", "Close 1014?")).toBe(false);
    // an amount right after an item word is an amount, never the item's number
    expect(covers("Payer la facture 500 $ ?", "Payer la facture 50000 $ ?")).toBe(false);
    expect(covers("Pay invoice 500 $?", "Pay invoice 50000 $?")).toBe(false);
    expect(covers("Payer la facture 500$ ?", "Payer la facture 50000$ ?")).toBe(false);
    // a time or a duration counts, h:mm alone included
    expect(covers("Ticket 77: 1:30 logged. Approve?", "Ticket 78: 9:45 logged. Approve?")).toBe(false);
    expect(covers("Approuver 1:30 sur le billet 77 ?", "Approuver 8:00 sur le billet 78 ?")).toBe(false);
    expect(covers("Ticket 77: 1:30 logged. Approve?", "Ticket 78: 1:30 logged. Approve?")).toBe(true);
    // a word that ends like an id mark is not one
    expect(covers("Réserver au casino. 2 places ?", "Réserver au casino. 20 places ?")).toBe(false);
    // a level, a size or a model written in one piece counts
    expect(covers("Passer au palier Tier2 ?", "Passer au palier Tier9 ?")).toBe(false);
    expect(covers("Redimensionner la VM en D4s_v5 ?", "Redimensionner la VM en D64s_v5 ?")).toBe(false);
    // a date counts, in digits as in words (a month or a day in words is text)
    expect(covers("Reporter au 2026-11-17 ?", "Reporter au 2026-12-02 ?")).toBe(false);
    expect(covers("Reporter au 17/11/2026 ?", "Reporter au 02/12/2026 ?")).toBe(false);
    expect(covers("Reporter au 3 décembre ?", "Reporter au 30 juin ?")).toBe(false);
    expect(covers("Reporter au 3 décembre ?", "Reporter au 30 décembre ?")).toBe(false);
    expect(covers("Postpone to December 3?", "Postpone to June 30?")).toBe(false);
    expect(covers("Fermer le billet 1013 du 3 décembre ?", "Fermer le billet 1014 du 3 décembre ?")).toBe(true);
    // after an item word only a whole number in one block, then the end, an
    // end punctuation or a linking word: anything else counts
    expect(covers("Payer la facture 1 500 $ ?", "Payer la facture 9 500 $ ?")).toBe(false);
    expect(covers("Pagar fatura 500 reais?", "Pagar fatura 50000 reais?")).toBe(false);
    expect(covers("Pagar factura 500 dólares?", "Pagar factura 50000 dólares?")).toBe(false);
    expect(covers("Сплатити заявка 500 грн?", "Сплатити заявка 50000 грн?")).toBe(false);
    expect(covers("請求書500ドルを支払いますか？", "請求書50000ドルを支払いますか？")).toBe(false);
    expect(covers("Dupliquer le billet 3 fois ?", "Dupliquer le billet 300 fois ?")).toBe(false);
    expect(covers("Envoyer la facture 3 décembre ?", "Envoyer la facture 30 décembre ?")).toBe(false);
    expect(covers("Send invoice 17/11/2026?", "Send invoice 03/11/2026?")).toBe(false);
    expect(covers("Close ticket #1 500?", "Close ticket #9 500?")).toBe(false);
    // a letter-led id holds at least three digits
    expect(covers("Fermer le billet P1 ?", "Fermer le billet P4 ?")).toBe(false);
    // a linking word, an end punctuation: the item's number
    expect(covers("Close ticket 1013 for the client?", "Close ticket 1014 for the client?")).toBe(true);
    expect(covers("Fermer le billet 1013, puis notifier ?", "Fermer le billet 1014, puis notifier ?")).toBe(true);
    expect(covers("工单1013的状态改为关闭？", "工单1014的状态改为关闭？")).toBe(true);
    // a version is not a date
    expect(covers("Mettre à jour vers 10.4.12 ?", "Mettre à jour vers 10.4.13 ?")).toBe(false);
  });

  it("\"always Oui\" on \"Fermer le billet 1013 ?\" covers closing another ticket, never billing one", () => {
    const ledger = ledgerOn(tempDir());
    rememberAlwaysChoice(ledger, SCOPE, { kind: "ticket", question: "Fermer le billet 1013 ?", options: ["Oui", "Non"], answer: "Oui" });
    expect(questionShape("Fermer le billet 1013 ?")).toBe(questionShape("Fermer le billet 1014 ?"));
    expect(alwaysChoiceOn(ledger, SCOPE, "ticket", "Fermer le billet 1014 ?", ["Oui", "Non"])!.answer).toBe("Oui");
    expect(alwaysChoiceOn(ledger, SCOPE, "ticket", "Facturer le billet 1014 au client ?", ["Oui", "Non"])).toBeNull();
    const note = answerLearningNote([], alwaysChoices(ledger, SCOPE))!;
    expect(note).toContain("the question \"Fermer le billet 1013 ?\" offering \"Oui\" / \"Non\": always \"Oui\"");
  });
});

describe("the lines an older version wrote into the instructions move to the preferences", () => {
  const EN = "Always for \"Ticket 77: 2 h logged. Approve?\" (key ticket): Approve. The person chose this on a card: do it without asking.";
  const FR = "Toujours pour « Ticket 78 ? » (clé inbox-review) : Archiver. La personne l'a choisi sur une carte : fais-le sans demander.";
  const routinesOf = (prompts: Map<string, string>) => [...prompts].map(([id, prompt]) => ({ id, prompt, scope: { ...SCOPE, routineId: id } }));
  it("takes each line out, leaves the rest of the text as it was", () => {
    expect(takeAlwaysLines(`Review the time entries.\n\n${EN}`)).toMatchObject({ instructions: "Review the time entries.", choices: [{ kind: "ticket", answer: "Approve", question: "Ticket 77: 2 h logged. Approve?" }] });
    expect(takeAlwaysLines(`Review.\n  Keep this.\n\n${EN}\n\n${FR}`)).toMatchObject({
      instructions: "Review.\n  Keep this.",
      choices: [{ kind: "ticket", answer: "Approve" }, { kind: "inbox-review", answer: "Archiver" }],
    });
    expect(takeAlwaysLines(`${EN}\n\nReview.`)).toMatchObject({ instructions: "Review." });
    // an answer ending with a period keeps it
    expect(takeAlwaysLines("Always for \"Q?\" (key k): Approve.. The person chose this on a card: do it without asking.").choices[0]!.answer).toBe("Approve.");
  });

  it("a line the author wrote in their own words stays: only the server's full words move", () => {
    for (const plain of [
      "Review.\nAlways for urgent tickets: call me.",
      "Review.\nAlways for \"weekends\" (key off): skip the run",
      "Review.\nToujours pour « fins de semaine » (clé off) : saute l'exécution.",
    ]) expect(takeAlwaysLines(plain)).toEqual({ instructions: plain, choices: [] });
  });

  it("migrates every routine once: preferences kept, instructions cleaned, the newest of one kind wins", () => {
    const ledger = ledgerOn(tempDir());
    const later = EN.replace(": Approve.", ": Refuse.");
    const prompts = new Map([["r1", `Review.\n\n${EN}\n\n${later}`], ["r2", "Nothing learned."]]);
    expect(migrateAlwaysLines(ledger, routinesOf(prompts), (id, prompt) => { prompts.set(id, prompt); return true; })).toBe(1);
    expect(prompts.get("r1")).toBe("Review.");
    expect(prompts.get("r2")).toBe("Nothing learned.");
    const choices = alwaysChoices(ledger, SCOPE);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ kind: "ticket", answer: "Refuse", question: "Ticket 77: 2 h logged. Approve?", options: [] });
    // a second pass finds nothing
    expect(migrateAlwaysLines(ledger, routinesOf(prompts), () => true)).toBe(0);
  });

  it("instructions made only of such lines keep neutral words, never the line", () => {
    const ledger = ledgerOn(tempDir());
    const prompts = new Map([["r1", EN]]);
    migrateAlwaysLines(ledger, routinesOf(prompts), (id, prompt) => { prompts.set(id, prompt); return true; });
    expect(prompts.get("r1")).toBe(MOVED_ONLY_INSTRUCTIONS.en);
    expect(alwaysChoices(ledger, SCOPE)).toHaveLength(1);
    const french = new Map([["r2", FR]]);
    migrateAlwaysLines(ledger, routinesOf(french), (id, prompt) => { french.set(id, prompt); return true; });
    expect(french.get("r2")).toBe(MOVED_ONLY_INSTRUCTIONS.fr);
  });

  it("Remove is for good: a line still there (a write that failed) never brings the choice back", () => {
    const ledger = ledgerOn(tempDir());
    const prompts = new Map([["r1", `Review.\n\n${EN}`]]);
    migrateAlwaysLines(ledger, routinesOf(prompts), () => false);
    const [choice] = alwaysChoices(ledger, SCOPE);
    expect(forgetAlwaysChoice(ledger, SCOPE, choice!.id)).toBe(true);
    migrateAlwaysLines(ledger, routinesOf(prompts), () => false);
    expect(alwaysChoices(ledger, SCOPE)).toEqual([]);
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
        always: (kind, question, options) => alwaysChoiceOn(ledger, SCOPE, kind, question, options),
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

  it("no offer once the person chose \"always\" for this question: the card is answered with their choice", () => {
    const ledger = ledgerOn(tempDir());
    answer(ledger, 3, "Refuse");
    rememberAlwaysChoice(ledger, SCOPE, { kind: "ticket", question: "Approve this time entry?", options: ["Approve", "Refuse"], answer: "Refuse" });
    const w = world(ledger);
    const posted = w.ask({ key: "ticket-79", question: "Approve this time entry?", options: ["Approve", "Refuse"], wait: false });
    const card = w.of("run-1").find((row) => row.id === (posted as { messageId: string }).messageId)!.card!;
    expect(card.options).toEqual(["Refuse", "Approve"]);
    expect(card.answerLearning?.always).toBeUndefined();
    expect(card).toMatchObject({ answeredText: "Refuse", autoApplied: true });
  });

  it("the server answers the same question for another item with the person's choice, and leaves another question with the same options to them", () => {
    const ledger = ledgerOn(tempDir());
    rememberAlwaysChoice(ledger, SCOPE, { kind: "ticket", question: "Fermer le billet 1013 ?", options: ["Oui", "Non"], answer: "Oui" });
    const w = world(ledger);
    const close = w.ask({ key: "ticket-1014", question: "Fermer le billet 1014 ?", options: ["Oui", "Non"], wait: false }) as { messageId: string; answered?: { choice: string; standing?: true } };
    expect(close.answered).toMatchObject({ choice: "Oui", standing: true });
    const closed = w.of("run-1").find((row) => row.id === close.messageId)!.card!;
    // a question of the chat, settled and marked as the person's "always" answer: never hidden
    expect(closed).toMatchObject({ requestType: "question", answered: "answer", answeredText: "Oui", autoApplied: true, standingAnswer: { routineId: "r1" } });
    const bill = w.ask({ key: "ticket-1015", question: "Facturer le billet 1015 au client ?", options: ["Oui", "Non"], wait: false }) as { messageId: string; answered?: unknown };
    expect(bill.answered).toBeUndefined();
    const billed = w.of("run-1").find((row) => row.id === bill.messageId)!.card!;
    expect(billed.answered).toBeUndefined();
    expect(billed.autoApplied).toBeUndefined();
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
