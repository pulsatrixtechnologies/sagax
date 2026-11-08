// 2026-11-03 (production, a bot's run of "Projet CW #100200"): a routine run called
// ask_choice, the card sat in the run's hidden task, and the run ended
// Completed six seconds later saying "La carte est affichée". A question card
// that outlives the turn now holds the run waiting for the person, and a bot
// that claims a card nobody can see fails its run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ROUTINE_CARD_CLAIM_WITHOUT_CARD, RoutineManager, routineClaimedCardChoice, routineClaimsCard, type RoutineManagerOptions } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(extra: Partial<RoutineManagerOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-routine-cards-"));
  dirs.push(dir);
  let now = Date.parse("2026-11-03T17:27:00Z");
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
  const base = (threadId: string) => ({ eventId: `e-${now++}`, provider: "fake", threadId, createdAt: new Date(now).toISOString() });
  return {
    manager, options, failed,
    event: (threadId: string, rest: Record<string, unknown>) => manager.handleRuntimeEvent({ ...base(threadId), ...rest } as never),
  };
}

async function startedRun(h: ReturnType<typeof harness>) {
  const routine = h.manager.create({ name: "Projet CW #100200 : temps et cédule", prompt: "Propose the batch; the person chooses on the card.", botId: "scout", enabled: false,
    schedule: { type: "cron", expression: "30 18 * * 1-5", timeZone: "America/Toronto" } });
  h.manager.runNow(routine.id);
  await h.manager.tick();
  const run = h.manager.listRuns()[0]!;
  expect(run.status).toBe("running");
  return run;
}

describe("a routine run's question card reaches its person", () => {
  it("stays waiting for the person when its turn ends on an open question card", async () => {
    const open = new Set<string>();
    const h = harness({ awaitsPerson: (threadId) => (open.has(threadId) ? "Waiting for your answer: Which batch do I write?" : null), cardRaisedSince: () => true });
    const run = await startedRun(h);
    // the production path: ask_choice raised as a question (request.opened), then the turn ends
    h.event(run.threadId!, { type: "request.opened", requestType: "question", requestId: "ask-choice-1", tool: "ask_choice", summary: "Which batch do I write?", harnessAsk: true });
    open.add(run.threadId!);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "La carte est affichée. Rien n'est écrit tant que tu n'as pas choisi." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    const waiting = h.manager.listRuns()[0]!;
    expect(waiting).toMatchObject({ status: "waiting", attention: "Waiting for your answer: Which batch do I write?" });
    expect(waiting.finishedAt).toBeUndefined();
    expect(waiting.waitingSince).toEqual(expect.any(Number));

    // the person's answer starts the next turn of the same run, which then completes
    open.delete(run.threadId!);
    h.event(run.threadId!, { type: "turn.started" });
    expect(h.manager.listRuns()[0]!.status).toBe("running");
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Batch A written." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "completed", output: "Batch A written." });
  });

  it("keeps a waiting question across a restart, where its answer still resumes it", async () => {
    const h = harness({ awaitsPerson: () => "Waiting for your answer", cardRaisedSince: () => true });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "request.opened", requestType: "question", requestId: "ask-choice-1", tool: "ask_choice", summary: "Which?", harnessAsk: true });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("waiting");
    const restarted = new RoutineManager(h.options);
    expect(restarted.listRuns()[0]).toMatchObject({ status: "waiting" });
  });

  // 2026-11-08 (QA 0.8.66 F4, "Overdue invoices report" run by hand): the bot
  // said it showed a card, none existed, and the run failed in 45 s. The card
  // it announced is now drawn for real and holds the run.
  it("draws the card the bot announced and waits for the person, never failing the run", async () => {
    const raised: Array<{ threadId: string; claim: string }> = [];
    let drawn = false;
    const h = harness({
      awaitsPerson: () => null,
      cardRaisedSince: () => drawn,
      raiseClaimedCard: (threadId, claim) => { raised.push({ threadId, claim }); drawn = true; return "Waiting for your answer: Un rapport pareil roule déjà."; },
    });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Un rapport pareil roule déjà. La carte est affichée : continuer ou arrêter?" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(raised).toEqual([{ threadId: run.threadId, claim: "Un rapport pareil roule déjà. La carte est affichée : continuer ou arrêter?" }]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "waiting", attention: "Waiting for your answer: Un rapport pareil roule déjà." });
    expect(h.manager.listRuns()[0]!.error).toBeUndefined();
    expect(h.failed).toHaveLength(0);
    // the person's answer starts the next turn of the same run
    h.event(run.threadId!, { type: "turn.started" });
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Rapport envoyé : 7 factures en retard." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "completed", output: "Rapport envoyé : 7 factures en retard." });
    expect(raised).toHaveLength(1);
  });

  // #2939: the host card used to be raised after the goal and the report
  // were settled and the turn's trouble dropped; the answer's turn then
  // settled again. The goal is now stepped once per run, and the first
  // turn's trouble still reaches the run's problems.
  it("settles a goal and the first turn's trouble once, on the turn that ends the run", async () => {
    let drawn = false;
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => drawn,
      raiseClaimedCard: () => { drawn = true; return "Waiting for your answer: Continuer?"; } });
    const routine = h.manager.create({ name: "Goal", prompt: "Watch.", botId: "scout", enabled: false,
      schedule: { type: "cron", expression: "30 18 * * 1-5", timeZone: "America/Toronto" }, goal: { text: "Reach 100%" } });
    h.manager.runNow(routine.id);
    await h.manager.tick();
    const run = h.manager.listRuns()[0]!;
    h.event(run.threadId!, { type: "turn.started" });
    for (const id of ["t1", "t2"]) {
      h.event(run.threadId!, { type: "item.started", itemType: "tool", itemId: id, title: "cw_psa_query" });
      h.event(run.threadId!, { type: "item.completed", itemType: "tool", itemId: id, ok: false, output: "500 server error" });
    }
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "À 40 %. J'ai affiché une carte pour continuer.\nGOAL_STATUS: in_progress: 40%" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("waiting");
    expect(h.manager.listRoutines()[0]!.goal?.checks ?? 0).toBe(0);
    h.event(run.threadId!, { type: "turn.started" });
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Fait, 50 %.\nGOAL_STATUS: in_progress: 50%" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    const done = h.manager.listRuns()[0]!;
    expect(done.status).toBe("completed");
    expect(h.manager.listRoutines()[0]!.goal).toMatchObject({ checks: 1, progress: "50%" });
    expect(done.problems).toContain("failed 2 times");
  });

  // #2939: the card the host drew for a first claim no longer hides a second
  // false claim later in the same run.
  it("draws a card again for a second false claim after the host's first card", async () => {
    const cards: number[] = [];
    const clock = Date.parse("2026-11-08T17:00:00Z");
    const h = harness({
      now: () => clock,
      awaitsPerson: () => null,
      cardRaisedSince: (_threadId, since) => cards.some((at) => at >= since),
      raiseClaimedCard: () => { cards.push(clock); return "Waiting for your answer: Continuer?"; },
    });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "La carte est affichée : continuer ou arrêter?" });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(cards).toHaveLength(1);
    h.event(run.threadId!, { type: "turn.started" });
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "Voici la carte de confirmation, elle t'attend." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(cards).toHaveLength(2);
    expect(h.manager.listRuns()[0]!.status).toBe("waiting");
  });

  // #2939: a summary list of what the bot did is never the card's choices.
  it("never offers a summary list as the card's choices", () => {
    const summary = "Résumé:\n- Ticket 1234 fermé\n- Ticket 5678 en attente\n- Facture 99 envoyée\nJ'ai affiché une carte pour confirmer l'envoi.";
    expect(routineClaimedCardChoice(summary)).toEqual({
      title: "Your bot has a question",
      question: "Résumé: - Ticket 1234 fermé - Ticket 5678 en attente - Facture 99 envoyée J'ai affiché une carte pour confirmer l'envoi.",
      options: ["Continuer", "Arrêter ici"],
    });
    // the choices offered after the account still win
    expect(routineClaimedCardChoice("Fait :\n- Billet 1 fermé\n- Billet 2 fermé\nLa carte est affichée, lequel j'envoie?\n1. Rapport A\n2. Rapport B").options).toEqual(["Rapport A", "Rapport B"]);
  });

  it("words the drawn card with the bot's own choices, else go on or stop in its language", () => {
    expect(routineClaimedCardChoice("Voici la carte, choisis :\n1. Lot A\n2. **Lot B**")).toEqual({
      title: "Your bot has a question", question: "Voici la carte, choisis :", options: ["Lot A", "Lot B"],
    });
    expect(routineClaimedCardChoice("La carte est affichée.").options).toEqual(["Continuer", "Arrêter ici"]);
    expect(routineClaimedCardChoice("The approval card is waiting for you.")).toMatchObject({ question: "The approval card is waiting for you.", options: ["Continue", "Stop here"] });
  });

  it("fails clearly, never Completed, when the bot says it showed a card and none could be drawn", async () => {
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => false });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "La carte est affichée. Rien n'est écrit tant que tu n'as pas choisi." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "failed", error: ROUTINE_CARD_CLAIM_WITHOUT_CARD });
    expect(h.failed).toHaveLength(1);
  });

  it("completes as before when the card it speaks of was really drawn and answered", async () => {
    const h = harness({ awaitsPerson: () => null, cardRaisedSince: () => true });
    const run = await startedRun(h);
    h.event(run.threadId!, { type: "item.completed", itemType: "assistant_text", text: "I showed you the card; you picked batch A, written." });
    h.event(run.threadId!, { type: "turn.completed", ok: true });
    expect(h.manager.listRuns()[0]!.status).toBe("completed");
  });

  it("reads a card claim in French and English, and not ordinary words", () => {
    for (const claim of ["La carte est affichée.", "La carte de choix t'attend dans Sagax.", "J'ai affiché la carte d'approbation.", "I've shown you a card with the options.", "The approval card is waiting for you."]) {
      expect(routineClaimsCard(claim), claim).toBe(true);
    }
    for (const plain of ["Temps saisi sur le billet 4.3.", "Paid with the company credit card ending 1234.", undefined]) {
      expect(routineClaimsCard(plain), String(plain)).toBe(false);
    }
  });
});
