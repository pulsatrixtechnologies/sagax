// 2026-11-03 (GOX, Ember's run of "Projet CW #801"): a routine run called
// ask_choice, the card sat in the run's hidden task, and the run ended
// Completed six seconds later saying "La carte est affichée". A question card
// that outlives the turn now holds the run waiting for the person, and a bot
// that claims a card nobody can see fails its run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ROUTINE_CARD_CLAIM_WITHOUT_CARD, RoutineManager, routineClaimsCard, type RoutineManagerOptions } from "./routines.ts";

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
  const routine = h.manager.create({ name: "Projet CW #801 : temps et cédule", prompt: "Propose the batch; JC chooses on the card.", botId: "ember", enabled: false,
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
    // the GOX path: ask_choice raised as a question (request.opened), then the turn ends
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

  it("fails clearly, never Completed, when the bot says it showed a card and none was drawn", async () => {
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
