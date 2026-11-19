// #5025 (production): "J'ai des questions similaires back à back". The run's last words said a card was ALREADY
// waiting and that a second card would duplicate it; the server read that
// as a card announced and not drawn, drew one itself with the bot's
// internal words and a bare "Continue / Stop here", and the next run of the
// same trigger drew another ("1 of 2").
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { claimedAskOpen, openAskCard, raiseClaimedAsks, type OpenAskCard } from "./claimed-card-raise.ts";
import {
  ROUTINE_CARD_CLAIM_WITHOUT_CARD, ROUTINE_CLAIM_ALREADY_OPEN, RoutineManager, routineClaimedCardChoice, routineClaimedCardChoices, routineClaimsCard,
  type RoutineManagerOptions,
} from "./routines.ts";
import { AskKeyIndex } from "../widgets/ask-choice-keys.ts";
import type { Message } from "../store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The bot's last words in the person's capture, names and numbers changed. */
const CAPTURE = "The earlier turn on this message already handled it. Robin passed all 4 of Scout's Northwind writes. I decided to split block 654321 on ticket #123456 into 9:00 to 10:00 a.m. and 10:30 to 11:15 a.m. ET. A card is already waiting for Sam, because Scout needs his GO quoted word for word before she writes. A second card would duplicate it. I'll relay his answer to Scout when it arrives.";

function harness(extra: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-routine-claim-dup-"));
  dirs.push(dir);
  let now = Date.parse("2026-11-19T16:18:00Z");
  let task = 0;
  const failed: unknown[] = [];
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    emit: () => {},
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++task}` }),
    startTurn: async () => {},
    interruptTurn: async () => {},
    onRunFailed: (run) => failed.push(run),
    ...extra,
  };
  const manager = new RoutineManager(options);
  const event = (threadId: string, rest: Record<string, unknown>) =>
    manager.handleRuntimeEvent({ eventId: `e-${now++}`, provider: "fake", threadId, createdAt: new Date(now).toISOString(), ...rest } as never);
  return { manager, event, failed, now: () => now, advance: (ms: number) => { now += ms; } };
}

/** The cards as index.ts raiseClaimedCard draws them: raiseClaimedAsks over
 * one store of rows and the one key index, the bot's open cards read from
 * the run's conversation, its routine's earlier runs and its keyed cards. */
function cardStore() {
  const rows = new Map<string, Message[]>();
  const rowsOf = (threadId: string) => rows.get(threadId) ?? rows.set(threadId, []).get(threadId)!;
  let rowId = 0;
  let clock = () => 0;
  const index = new AskKeyIndex({ seed: () => [], messagesFor: rowsOf });
  const raised: string[] = [];
  const raiseClaimedCard: NonNullable<RoutineManagerOptions["raiseClaimedCard"]> = (threadId, claim, card) => raiseClaimedAsks(threadId, claim, card, {
    open: () => {
      const near = new Set([threadId, ...(card?.earlierThreads ?? [])]);
      const cards: OpenAskCard[] = [];
      for (const id of near) for (const row of rowsOf(id)) if (openAskCard(row)) cards.push({ question: row.card!.subtitle, at: row.at, near: true });
      for (const row of index.pendingRows()) if (!near.has(row.threadId)) cards.push({ question: row.message.card!.subtitle, at: row.message.at });
      return cards;
    },
    keys: {
      find: (key) => index.find(key, () => true),
      remember: (key, cardThreadId, messageId) => index.remember(key, cardThreadId, messageId),
      patch: (cardThreadId, messageId, next) => {
        const list = rowsOf(cardThreadId);
        const at = list.findIndex((row) => row.id === messageId);
        if (at < 0) return false;
        list[at] = { ...list[at]!, card: next };
        return true;
      },
    },
    raise: (choice) => {
      raised.push(choice.question);
      const row = { id: `m${++rowId}`, at: clock(), role: "bot", kind: "options", card: { title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-choice-${rowId}`, requestType: "question", ...choice.card } } as Message;
      rowsOf(threadId).push(row);
      return { messageId: row.id };
    },
  });
  const pending = () => [...rows.values()].flat().filter((row) => openAskCard(row));
  return {
    raiseClaimedCard, raised, pending, rowsOf,
    setClock: (next: () => number) => { clock = next; },
    cardRaisedSince: (threadId: string, since: number) => rowsOf(threadId).some((row) => row.kind === "options" && row.at >= since && Boolean(row.card)),
  };
}

async function startRun(h: ReturnType<typeof harness>, routineId: string) {
  h.manager.runNow(routineId);
  await h.manager.tick();
  const run = h.manager.listRuns().find((candidate) => candidate.status === "running")!;
  expect(run).toBeDefined();
  return run;
}

describe("a card the bot speaks of as already there is never drawn again (#5025, point 1)", () => {
  it("reads the capture as a report, never a card claim", () => {
    expect(routineClaimsCard(CAPTURE)).toBe(false);
  });

  it("never reads an existing, earlier, past or someone else's card as a claim", () => {
    for (const report of [
      "A card is already waiting for you.",
      "Il y a déjà une carte pour ça.",
      "La carte attend toujours ta réponse.",
      "A second card would duplicate it.",
      "Pas besoin d'une autre carte : celle de ce matin est en attente.",
      "A card was posted earlier today.",
      "La carte a été affichée au tour précédent.",
      "The card is waiting for Sam.",
      "La carte attend Robin.",
      "The card from the previous run is still open.",
    ]) {
      expect(routineClaimsCard(report), report).toBe(false);
    }
  });

  it("still reads a card announced for the person now", () => {
    for (const claim of [
      "La carte est affichée.",
      "La carte de choix t'attend dans Sagax.",
      "J'ai affiché la carte d'approbation.",
      "I've shown you a card with the options.",
      "The approval card is waiting for you.",
      "Voici la carte :\n- Approuver\n- Refuser",
      "Voici la carte, j'ai déjà écrit le lot A : approuver le lot B ou passer ?",
    ]) {
      expect(routineClaimsCard(claim), claim).toBe(true);
    }
  });

  it("draws no card for the capture's run, which completes with its words in its log", async () => {
    const cards = cardStore();
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: cards.cardRaisedSince, raiseClaimedCard: cards.raiseClaimedCard });
    const routine = h.manager.create({ name: "Northwind relay", prompt: "Relay Scout's writes.", botId: "nova", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    const run = await startRun(h, routine.id);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: CAPTURE });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(cards.raised).toEqual([]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "completed", output: CAPTURE });
    expect(h.failed).toHaveLength(0);
  });
});

describe("a real announcement still draws its card (#5025)", () => {
  it("draws one card with the bot's own choices", async () => {
    const cards = cardStore();
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: cards.cardRaisedSince, raiseClaimedCard: cards.raiseClaimedCard });
    const routine = h.manager.create({ name: "Approvals", prompt: "Review.", botId: "nova", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    const run = await startRun(h, routine.id);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Voici la carte :\n- Approuver\n- Refuser" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(cards.pending()).toHaveLength(1);
    expect(cards.pending()[0]!.card).toMatchObject({ subtitle: "Voici la carte :", options: ["Approuver", "Refuser"] });
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "waiting" });
  });
});

describe("never the same card twice (#5025, point 2)", () => {
  it("two runs of the same trigger with nearly the same claim leave one card", async () => {
    const cards = cardStore();
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: cards.cardRaisedSince, raiseClaimedCard: cards.raiseClaimedCard });
    cards.setClock(h.now);
    const start = Date.parse("2026-11-19T16:00:00Z");
    const routine = h.manager.create({ name: "Queue check", prompt: "Check the queue.", botId: "nova", enabled: true,
      schedule: { type: "interval", everyMinutes: 5, anchorAt: start } });
    h.manager.runNow(routine.id);
    const words = [
      "J'ai préparé la scission du bloc sur le billet #123456 en deux plages. La carte est affichée : approuver ou refuser ?",
      "J'ai préparé la scission du bloc sur le billet #123456 en deux plages (9 h à 10 h, 10 h 30 à 11 h 15). La carte est affichée : approuver ou refuser ?",
    ];
    for (const [pass, text] of words.entries()) {
      if (pass) h.advance(5 * 60_000);
      await h.manager.tick();
      const run = h.manager.listRuns().find((candidate) => candidate.status === "running")!;
      h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text });
      h.event(run.threadId!, { type: "turn.completed", ok: true });
      expect(h.manager.listRuns().find((candidate) => candidate.id === run.id)).toMatchObject({ status: "completed" });
    }
    expect(h.manager.listRuns()).toHaveLength(2);
    expect(cards.raised).toHaveLength(1);
    expect(cards.pending()).toHaveLength(1);
  });

  it("a card the trigger's earlier run left open carries the next run's nearly same ask: no second card", async () => {
    const cards = cardStore();
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: cards.cardRaisedSince, raiseClaimedCard: cards.raiseClaimedCard });
    cards.setClock(h.now);
    const routine = h.manager.create({ name: "Invoice batch", prompt: "Prepare the batch.", botId: "nova", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    const first = await startRun(h, routine.id);
    // the bot drew its own card, holding nothing, and the run completed
    cards.rowsOf(first.threadId!).push({ id: "own-1", at: h.now(), role: "bot", kind: "options",
      card: { title: "Nova has a question", subtitle: "Le lot de factures de novembre est prêt : envoyer ou attendre ?", options: ["Envoyer", "Attendre"], requestId: "ask-choice-own-1", requestType: "question", noHold: true } } as Message);
    h.event(first.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Le lot de factures de novembre est prêt. J'ai affiché la carte : envoyer ou attendre ?" });
    h.event(first.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns().find((candidate) => candidate.id === first.id)).toMatchObject({ status: "completed" });
    h.advance(60_000);
    const second = await startRun(h, routine.id);
    h.event(second.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Le lot de factures de novembre est prêt. La carte t'attend : envoyer ou attendre ?" });
    h.event(second.threadId!, { type: "turn.completed", ok: true });
    expect(cards.raised).toEqual([]);
    expect(cards.pending()).toHaveLength(1);
    expect(h.manager.listRuns().find((candidate) => candidate.id === second.id)).toMatchObject({ status: "completed" });
    expect(h.failed).toHaveLength(0);
  });

  it("reads an open card on the same ticket, the same ask, or an earlier run's nearly same words as that ask's card", () => {
    const open = (question: string, near = false): OpenAskCard => ({ question, at: 1, ...(near ? { near: true } : {}) });
    // the same ticket, anywhere in the person's scope
    expect(claimedAskOpen("Billet #123456 : scinder le bloc ? Approuver ou refuser ?", [open("Le temps du billet #123456 attend ton GO : approuver ou refuser ?")])).toBe(true);
    // the same ask
    expect(claimedAskOpen("Envoyer le rapport ?", [open("envoyer le rapport ?")])).toBe(true);
    // nearly the same words, from this trigger's earlier run only
    const before = "Le lot de factures de novembre est prêt. La carte est affichée : envoyer ou attendre ?";
    const now = "Le lot de factures de novembre est prêt. La carte t'attend : envoyer ou attendre ?";
    expect(claimedAskOpen(now, [open(before, true)])).toBe(true);
    expect(claimedAskOpen(now, [open(before)])).toBe(false);
    // two tickets, two subjects, however alike their words
    expect(claimedAskOpen("Billet #1001 : 1,5 h saisie lundi. Approuver ou refuser ?", [open("Billet #1000 : 1,5 h saisie lundi. Approuver ou refuser ?", true)])).toBe(false);
    // a card drawn since the claim window opened is the one it speaks of
    expect(claimedAskOpen("Approuver ou refuser ?", [{ question: "Autre chose", at: 10 }], 5)).toBe(true);
    expect(claimedAskOpen("Approuver ou refuser ?", [], 5)).toBe(false);
  });

  it("answers ROUTINE_CLAIM_ALREADY_OPEN when every ask already has its card, and draws only the new ones", () => {
    const raised: string[] = [];
    const deps = (open: OpenAskCard[]) => ({
      open: () => open,
      keys: null,
      raise: (choice: { question: string }) => { raised.push(choice.question); return { messageId: `m${raised.length}` }; },
    });
    const claim = "- Billet #1000 : 2 h lundi. Approuver ou refuser ?\n- Billet #1001 : 1 h mardi. Approuver ou refuser ?";
    expect(raiseClaimedAsks("t", claim, undefined, deps([{ question: "Billet #1000 : approuver ou refuser ?", at: 1 }, { question: "Billet #1001 : approuver ou refuser ?", at: 1 }]))).toBe(ROUTINE_CLAIM_ALREADY_OPEN);
    expect(raised).toEqual([]);
    expect(raiseClaimedAsks("t", claim, undefined, deps([{ question: "Billet #1000 : approuver ou refuser ?", at: 1 }]))).toMatch(/^Waiting for your answer: - Billet #1001/);
    expect(raised).toEqual(["- Billet #1001 : 1 h mardi. Approuver ou refuser ?"]);
  });
});

describe("a claimed card without a real question draws no card (#5025, point 3)", () => {
  it("offers no go on or stop card when the words list no choice and ask nothing", () => {
    expect(routineClaimedCardChoice("La carte est affichée.")).toBeNull();
    expect(routineClaimedCardChoice("The approval card is waiting for you.")).toBeNull();
    expect(routineClaimedCardChoices("J'ai affiché une carte pour continuer.")).toEqual([]);
    // a question or a request made to the person still carries a decision
    expect(routineClaimedCardChoice("La carte est affichée. On envoie le rapport ?")?.options).toEqual(["Continuer", "Arrêter ici"]);
    expect(routineClaimedCardChoice("La carte est affichée. Confirme l'envoi.")).not.toBeNull();
    expect(routineClaimedCardChoice("The card is waiting for you. I need your approval before I write.")).not.toBeNull();
  });

  it("completes the run with its words in its log, no card and no failure", async () => {
    const cards = cardStore();
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: cards.cardRaisedSince, raiseClaimedCard: cards.raiseClaimedCard });
    const routine = h.manager.create({ name: "Report", prompt: "Report.", botId: "nova", enabled: false,
      schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
    const run = await startRun(h, routine.id);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Rapport prêt. La carte est affichée." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(cards.raised).toEqual([]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "completed", output: "Rapport prêt. La carte est affichée." });
    expect(h.manager.listRuns()[0]!.error).not.toBe(ROUTINE_CARD_CLAIM_WITHOUT_CARD);
    expect(h.failed).toHaveLength(0);
  });
});
