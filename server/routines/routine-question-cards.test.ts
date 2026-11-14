// #4205 (points 1 and 2): a routine whose run left the person nine items to
// decide drew ONE generic card (Continue / Stop here) whose question was cut
// at 500 characters, then the bot asked the items one by one as text to
// answer by typing. The card now carries the whole question, and each
// separate ask is its own card with its own choices.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ROUTINE_ASK_EACH_ITEM_RULE, ROUTINE_REPORT_CONTRACT } from "./routine-report.ts";
import {
  RoutineManager, routineAsksInText, routineClaimedCardChoice, routineClaimedCardChoices, routineClaimedCardWaiting,
  type RoutineManagerOptions,
} from "./routines.ts";
import { AskKeyIndex, raiseTextKeyedAsk } from "../widgets/ask-choice-keys.ts";
import type { Message } from "../store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CHOICES = ["Approuver", "Refuser", "Corriger", "Toujours permettre"];

/** The run's final words: an intro, nine items each ending on its choices
 * in words, a closing line. */
function nineItems(): string {
  const items = Array.from({ length: 9 }, (_, index) => [
    `${index + 1}. **Billet #${1000 + index}** : 1,5 h saisie le lundi pour la migration du serveur de fichiers.`,
    `   Note : le technicien a travaillé pendant ces heures sur la copie des dossiers partagés.`,
    `   Approuver, Refuser, Corriger ou Toujours permettre ?`,
  ].join("\n"));
  return ["Voici les entrées de temps à décider :", "", items.join("\n\n"), "", "Rien n'est écrit tant que tu n'as pas décidé."].join("\n");
}

function harness(extra: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-routine-asks-"));
  dirs.push(dir);
  let now = Date.parse("2026-11-13T15:00:00Z");
  let task = 0;
  const options: RoutineManagerOptions = {
    file: join(dir, "routines.json"),
    now: () => now,
    emit: () => {},
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++task}` }),
    startTurn: async () => {},
    interruptTurn: async () => {},
    ...extra,
  };
  const manager = new RoutineManager(options);
  const event = (threadId: string, rest: Record<string, unknown>) =>
    manager.handleRuntimeEvent({ eventId: `e-${now++}`, provider: "fake", threadId, createdAt: new Date(now).toISOString(), ...rest } as never);
  return { manager, event, now: () => now, advance: (ms: number) => { now += ms; } };
}

async function startedRun(h: ReturnType<typeof harness>) {
  const routine = h.manager.create({ name: "Time entries review", prompt: "Review the week's time entries.", botId: "scout", enabled: false,
    schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" } });
  h.manager.runNow(routine.id);
  await h.manager.tick();
  const run = h.manager.listRuns()[0]!;
  expect(run.status).toBe("running");
  return run;
}

describe("a routine's question card carries the whole question (#4205, point 1)", () => {
  it("keeps a 3000-character question whole in the card's data, never cut with an ellipsis", () => {
    const paragraph = "Le billet attend une décision sur le temps saisi pendant ces trois jours de migration. ";
    const long = paragraph.repeat(Math.ceil(3000 / paragraph.length)).trim();
    expect(long.length).toBeGreaterThanOrEqual(3000);
    const claim = `${long}\n\nLa carte est affichée.`;
    const choice = routineClaimedCardChoice(claim);
    expect(choice.question).toBe(claim);
    expect(choice.question).not.toContain("…");
  });

  it("keeps the question's lines, so the card reads it as written", () => {
    expect(routineClaimedCardChoice("Résumé :\n- Billet 1\n- Billet 2\n\n\n\nLa carte est affichée.").question)
      .toBe("Résumé :\n- Billet 1\n- Billet 2\n\nLa carte est affichée.");
  });

  it("offers the choices one ask names in words, not a generic go on or stop", () => {
    expect(routineClaimedCardChoice("Un rapport pareil roule déjà. La carte est affichée : continuer ou arrêter ?").options).toEqual(["Continuer", "Arrêter"]);
  });
});

describe("one card per item a routine asks about (#4205, point 2)", () => {
  it("finds each separate ask with its own choices and its whole item", () => {
    const asks = routineAsksInText(nineItems());
    expect(asks).toHaveLength(9);
    for (const [index, ask] of asks.entries()) {
      expect(ask.options).toEqual(CHOICES);
      expect(ask.question).toBe([
        `${index + 1}. Billet #${1000 + index} : 1,5 h saisie le lundi pour la migration du serveur de fichiers.`,
        "   Note : le technicien a travaillé pendant ces heures sur la copie des dossiers partagés.",
        "   Approuver, Refuser, Corriger ou Toujours permettre ?",
      ].join("\n"));
    }
    // one line per item, in English
    expect(routineAsksInText("- Ticket 12: 2 h on Monday. Approve, Refuse or Correct?\n- Ticket 13: 1 h on Tuesday. Approve, Refuse or Correct?"))
      .toEqual([
        { question: "- Ticket 12: 2 h on Monday. Approve, Refuse or Correct?", options: ["Approve", "Refuse", "Correct"] },
        { question: "- Ticket 13: 1 h on Tuesday. Approve, Refuse or Correct?", options: ["Approve", "Refuse", "Correct"] },
      ]);
  });

  it("draws one card per ask for a claimed card, and a single card otherwise", () => {
    const cards = routineClaimedCardChoices(nineItems());
    expect(cards).toHaveLength(9);
    expect(cards.every((card) => card.title === "Your bot has a question" && card.options.join() === CHOICES.join())).toBe(true);
    expect(routineClaimedCardWaiting(cards)).toMatch(/^Waiting for your answers to 9 questions: 1\. Billet #1000/);
    expect(routineClaimedCardChoices("La carte est affichée.")).toEqual([routineClaimedCardChoice("La carte est affichée.")]);
  });

  it("never reads a summary or a yes-no question as choices", () => {
    expect(routineAsksInText("Résumé:\n- Ticket 1234 fermé\n- Ticket 5678 en attente")).toEqual([]);
    expect(routineAsksInText("Do I approve or refuse ticket 12?\nShould I send it or wait?")).toEqual([]);
    expect(routineAsksInText("Is the backup on the server or on the disk of the office computer?")).toEqual([]);
  });

  it("holds the run on one card per ask when its final words list several asks as text", async () => {
    const raised: string[][] = [];
    let drawn = false;
    const h = harness({
      awaitsPerson: () => null,
      cardRaisedSince: () => drawn,
      raiseClaimedCard: (_threadId, claim) => {
        const cards = routineClaimedCardChoices(claim);
        raised.push(cards.map((card) => card.question));
        drawn = true;
        return routineClaimedCardWaiting(cards);
      },
    });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: nineItems() });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toHaveLength(9);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "waiting" });
    expect(h.manager.listRuns()[0]!.attention).toMatch(/^Waiting for your answers to 9 questions/);
  });

  it("completes a run whose report asks nothing", async () => {
    const raised: string[] = [];
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => false, raiseClaimedCard: (_threadId, claim) => { raised.push(claim); return "x"; } });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Nine time entries approved.\n- Ticket 12: 2 h\n- Ticket 13: 1 h" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(raised).toEqual([]);
    expect(h.manager.listRuns()[0]!.status).toBe("completed");
  });

  it("tells every routine run to ask each item on its own card, keyed, and how not to hold the run", () => {
    expect(ROUTINE_ASK_EACH_ITEM_RULE).toMatch(/one ask_choice call per separate item/);
    expect(ROUTINE_ASK_EACH_ITEM_RULE).toMatch(/key/);
    expect(ROUTINE_ASK_EACH_ITEM_RULE).toMatch(/wait false/);
    // #4233: a routine that runs several times a day holds nothing by default
    expect(ROUTINE_ASK_EACH_ITEM_RULE).toMatch(/several times a day/);
    expect(ROUTINE_REPORT_CONTRACT).toContain(ROUTINE_ASK_EACH_ITEM_RULE);
  });

  it("closes the question cards of a run that was cancelled or superseded (comment, point 4)", async () => {
    const closed: Array<[string, number]> = [];
    let open = true;
    const h = harness({ awaitsPerson: () => (open ? "Waiting for your answer: Approve?" : null), closeRunCards: (threadId, since) => { closed.push([threadId, since]); open = false; } });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("waiting");
    expect(closed).toEqual([]);
    await h.manager.cancelRun(run.id, "Superseded");
    // only the cards this run drew: those since its start (#4205 review)
    expect(run.startedAt).toBeTypeOf("number");
    expect(closed).toEqual([[run.threadId, run.startedAt]]);
  });

  it("#4219: a cancelled run closes exactly the cards it drew in its source room, never the room's other cards", async () => {
    const closed: Array<[string, number, unknown]> = [];
    let open = true;
    const h = harness({ awaitsPerson: () => (open ? "Waiting for your answer: Approve?" : null), closeRunCards: (threadId, since, roomCards) => { closed.push([threadId, since, roomCards]); open = false; } });
    const run = await startedRun(h);
    h.manager.recordRoomCard(run.threadId!, { threadId: "room-thread", messageId: "card-1" });
    h.manager.recordRoomCard(run.threadId!, { threadId: "room-thread", messageId: "card-1" });
    h.manager.recordRoomCard(run.threadId!, { threadId: "room-thread", messageId: "card-2" });
    // another thread's run draws nothing on this one
    h.manager.recordRoomCard("some-other-thread", { threadId: "room-thread", messageId: "card-9" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("waiting");
    await h.manager.cancelRun(run.id, "Superseded");
    expect(closed).toEqual([[run.threadId, run.startedAt, [{ threadId: "room-thread", messageId: "card-1" }, { threadId: "room-thread", messageId: "card-2" }]]]);
  });

  it("#4233: a 5 minute routine's asks hold nothing by default: the run ends, the next occurrence starts on time", async () => {
    const raised: Array<{ claim: string; noHold: boolean }> = [];
    let drawnAt: number | null = null;
    const started: string[] = [];
    const h = harness({
      awaitsPerson: () => null,
      cardRaisedSince: (_threadId, since) => drawnAt !== null && drawnAt >= since,
      startTurn: async (_botId, threadId) => { started.push(threadId); },
      raiseClaimedCard: (_threadId, claim, card) => {
        raised.push({ claim, noHold: card?.noHold === true });
        drawnAt = Date.parse("2026-11-13T15:00:30Z");
        return routineClaimedCardWaiting(routineClaimedCardChoices(claim));
      },
    });
    const start = Date.parse("2026-11-13T15:00:00Z");
    const routine = h.manager.create({ name: "Queue check", prompt: "Check the queue.", botId: "scout", enabled: true,
      schedule: { type: "interval", everyMinutes: 5, anchorAt: start } });
    h.manager.runNow(routine.id);
    await h.manager.tick();
    const run = h.manager.listRuns()[0]!;
    expect(run.status).toBe("running");
    expect(h.manager.asksHoldNothing(run.threadId!)).toBe(true);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: nineItems() });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    // the cards are raised, holding nothing, and the run ends normally
    expect(raised).toEqual([{ claim: expect.any(String), noHold: true }]);
    expect(h.manager.listRuns().find((candidate) => candidate.id === run.id)).toMatchObject({ status: "completed" });
    expect(h.manager.asksHoldNothing(run.threadId!)).toBe(false);
    // the next occurrence, five minutes later, starts on time
    h.advance(5 * 60_000);
    await h.manager.tick();
    const next = h.manager.listRuns().find((candidate) => candidate.id !== run.id);
    expect(next).toMatchObject({ status: "running" });
    expect(started).toHaveLength(2);
  });

  it("#4233: two runs of a 5 minute routine with the same text asks leave one pending card per ask", async () => {
    // the cards drawn as index.ts raiseClaimedCard draws them: keyed by
    // their text, the same ask replaces its pending card in place
    const rows = new Map<string, Message[]>();
    const rowsOf = (threadId: string) => rows.get(threadId) ?? rows.set(threadId, []).get(threadId)!;
    let rowId = 0;
    let rings = 0;
    const index = new AskKeyIndex({ seed: () => [], messagesFor: rowsOf });
    const h = harness({
      awaitsPerson: () => null,
      cardRaisedSince: () => false,
      raiseClaimedCard: (threadId, claim, card) => {
        expect(card).toEqual({ noHold: true });
        const raised = routineClaimedCardChoices(claim).filter((choice) => raiseTextKeyedAsk(threadId, choice, {
          find: (key) => index.find(key, () => true),
          remember: (key, cardThreadId, messageId) => index.remember(key, cardThreadId, messageId),
          patch: (cardThreadId, messageId, next) => {
            const list = rowsOf(cardThreadId);
            const at = list.findIndex((row) => row.id === messageId);
            if (at < 0) return false;
            list[at] = { ...list[at]!, card: next };
            return true;
          },
          raise: (keyed) => {
            rings += 1;
            const row = { id: `m${++rowId}`, at: rowId, role: "bot", kind: "options", card: { title: keyed.title, subtitle: keyed.question, options: keyed.options, requestId: `ask-choice-${rowId}`, requestType: "question", ...keyed.card } } as Message;
            rowsOf(threadId).push(row);
            return { messageId: row.id };
          },
        }));
        return raised.length ? routineClaimedCardWaiting(raised) : null;
      },
    });
    const start = Date.parse("2026-11-13T15:00:00Z");
    const routine = h.manager.create({ name: "Queue check", prompt: "Check the queue.", botId: "scout", enabled: true,
      schedule: { type: "interval", everyMinutes: 5, anchorAt: start } });
    h.manager.runNow(routine.id);
    for (let pass = 0; pass < 2; pass += 1) {
      if (pass) h.advance(5 * 60_000);
      await h.manager.tick();
      const run = h.manager.listRuns().find((candidate) => candidate.status === "running")!;
      h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: nineItems() });
      h.event(run.threadId!, { type: "turn.completed", ok: true });
      expect(h.manager.listRuns().find((candidate) => candidate.id === run.id)).toMatchObject({ status: "completed" });
    }
    const pending = [...rows.values()].flat().filter((row) => row.card && !row.card.expired && !row.card.answered);
    expect(h.manager.listRuns()).toHaveLength(2);
    expect(pending).toHaveLength(9);
    expect(new Set(pending.map((row) => row.card!.askKey)).size).toBe(9);
    expect(pending.every((row) => row.card!.noHold === true)).toBe(true);
    // nine rings, from the first run only
    expect(rings).toBe(9);
  });

  it("#4233: a claimed card the next run replaces in place counts as drawn: every run completes, none fails as a claim without a card", async () => {
    // index.ts as is: cardRaisedSince sees only a NEW options row, and
    // raiseClaimedCard keys each ask by its text (raiseTextKeyedAsk)
    const rows = new Map<string, Message[]>();
    const rowsOf = (threadId: string) => rows.get(threadId) ?? rows.set(threadId, []).get(threadId)!;
    let rowId = 0;
    let rings = 0;
    const index = new AskKeyIndex({ seed: () => [], messagesFor: rowsOf });
    let clock = () => 0;
    const h = harness({
      awaitsPerson: () => null,
      cardRaisedSince: (threadId, since) => rowsOf(threadId).some((row) => row.kind === "options" && row.at >= since && Boolean(row.card)),
      raiseClaimedCard: (threadId, claim, card) => {
        expect(card).toEqual({ noHold: true });
        const raised = routineClaimedCardChoices(claim).filter((choice) => raiseTextKeyedAsk(threadId, choice, {
          find: (key) => index.find(key, () => true),
          remember: (key, cardThreadId, messageId) => index.remember(key, cardThreadId, messageId),
          patch: (cardThreadId, messageId, next) => {
            const list = rowsOf(cardThreadId);
            const at = list.findIndex((row) => row.id === messageId);
            if (at < 0) return false;
            list[at] = { ...list[at]!, card: next };
            return true;
          },
          raise: (keyed) => {
            rings += 1;
            const row = { id: `m${++rowId}`, at: clock(), role: "bot", kind: "options", card: { title: keyed.title, subtitle: keyed.question, options: keyed.options, requestId: `ask-choice-${rowId}`, requestType: "question", ...keyed.card } } as Message;
            rowsOf(threadId).push(row);
            return { messageId: row.id };
          },
        }));
        return raised.length ? routineClaimedCardWaiting(raised) : null;
      },
    });
    clock = h.now;
    const start = Date.parse("2026-11-13T15:00:00Z");
    const routine = h.manager.create({ name: "Queue check", prompt: "Check the queue.", botId: "scout", enabled: true,
      schedule: { type: "interval", everyMinutes: 5, anchorAt: start } });
    h.manager.runNow(routine.id);
    const ended: string[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      if (pass) h.advance(5 * 60_000);
      await h.manager.tick();
      const run = h.manager.listRuns().find((candidate) => candidate.status === "running")!;
      h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "La carte est affichée : continuer ou arrêter?" });
      h.event(run.threadId!, { type: "turn.completed", ok: true });
      const done = h.manager.listRuns().find((candidate) => candidate.id === run.id)!;
      ended.push(`${done.status}:${done.error ?? ""}`);
    }
    expect(ended).toEqual(["completed:", "completed:", "completed:"]);
    // one pending card, rung once, replaced in place by the later runs
    const pending = [...rows.values()].flat().filter((row) => row.card && !row.card.expired && !row.card.answered);
    expect(pending).toHaveLength(1);
    expect(rings).toBe(1);
  });

  it("#4233: a run the person started and a routine that runs once a day keep holding on their asks", async () => {
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => false, raiseClaimedCard: (_threadId, claim, card) => (card?.noHold ? null : routineClaimedCardWaiting(routineClaimedCardChoices(claim))) });
    const often = h.manager.create({ name: "Queue check", prompt: "Check the queue.", botId: "scout", enabled: false,
      schedule: { type: "interval", everyMinutes: 5, anchorAt: Date.parse("2026-11-13T15:00:00Z") } });
    h.manager.runNow(often.id, undefined, "person");
    await h.manager.tick();
    const mine = h.manager.listRuns()[0]!;
    expect(h.manager.asksHoldNothing(mine.threadId!)).toBe(false);
    h.event(mine.threadId!, { type: "item.completed", itemType: "assistant_text", text: nineItems() });
    h.event(mine.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns().find((candidate) => candidate.id === mine.id)).toMatchObject({ status: "waiting" });
    // a weekday 9:00 routine runs once a day
    const h2 = harness();
    const once = await startedRun(h2);
    expect(h2.manager.asksHoldNothing(once.threadId!)).toBe(false);
  });

  it("completes a run whose cards hold nothing (wait false), so the next occurrence starts on time", async () => {
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => true });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Three time entries wait for you on their cards." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("completed");
  });
});
