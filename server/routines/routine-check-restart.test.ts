// #4579: a check whose run a server restart cut. The restart's own resume
// reports the run while the server's `routines` is still being built, so
// the card is told by the pass right after the build (catchUp), with a real
// RoutineManager wired as server/index.ts wires it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import { cardWithCheckNote, RoutineCheckFollowUps } from "./routine-problem-answer.ts";
import { RoutineManager, ROUTINE_RESTARTED, type RoutineManagerOptions, type RoutineRun } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("a run the restart failed still gets its line on the card: stopped before the end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-check-restart-"));
  dirs.push(dir);
  const now = Date.UTC(2026, 10, 4, 14);
  const base: RoutineManagerOptions = {
    file: join(dir, "routines.json"), now: () => now, botState: () => "ready",
    createTask: vi.fn(() => ({ threadId: "t-1" })), startTurn: vi.fn(async () => {}), engineForRun: () => ({ engine: dir }),
  };
  const first = new RoutineManager(base);
  const routine = first.create({ name: "Inbox", prompt: "Read.", botId: "osprey", schedule: { type: "interval", everyMinutes: 60, anchorAt: now } });
  first.runNow(routine.id, undefined, "person");
  for (let index = 0; index < 10; index += 1) { await first.tick(); await new Promise((resolve) => setTimeout(resolve, 0)); }
  // the answered card carries the run, as deliverLateQuestionAnswer writes it
  const cards = new Map([["m1", { askKey: `routine-problem:${routine.id}`, checkRunId: first.listRuns()[0]!.id, answerNote: "check started" } as { askKey: string; checkRunId?: string; answerNote?: string }]]);
  const seen: Array<{ error?: string; ready: boolean }> = [];
  // server/index.ts: `let routines = null; routines = new RoutineManager({ onRunChanged })`
  let routines: RoutineManager | null = null;
  const followUps = new RoutineCheckFollowUps({
    words: () => ENGLISH_WORDS,
    stillWrong: () => true,
    checkCards: (routineId) => (routines?.routineById(routineId)
      ? [...cards].filter(([, card]) => card.askKey === `routine-problem:${routineId}` && card.checkRunId).map(([messageId, card]) => ({ routineId, threadId: "t", messageId, runId: card.checkRunId! }))
      : []),
    tell: (card, note) => { cards.set(card.messageId, cardWithCheckNote(cards.get(card.messageId)!, note)); },
  });
  const options = { ...base, onRunChanged: (run: RoutineRun) => { seen.push({ error: run.error, ready: routines !== null }); followUps.runChanged(run); } };
  new RoutineManager(options); // first restart: the run resumes
  routines = new RoutineManager(options); // second restart: the run fails with ROUTINE_RESTARTED, before `routines` is set
  expect(seen.some((event) => event.error === ROUTINE_RESTARTED && !event.ready)).toBe(true);
  expect(cards.get("m1")!.answerNote).toBe("check started");
  // the pass right after the build, as server/index.ts runs it
  followUps.catchUp(routines.listRoutines().map((entry) => entry.id), (routineId, runId) => routines!.runsOfRoutineAsStored(routineId).find((run) => run.id === runId));
  expect(cards.get("m1")!.answerNote).toBe(ENGLISH_WORDS.t("routine.problemCard.checkStopped"));
  expect(cards.get("m1")!.checkRunId).toBeUndefined();
});
