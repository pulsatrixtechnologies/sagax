// #4438: the routine fix card's choices act at once, with no model turn; an
// answer is never applied on stale facts; the card never shows a raw code.
import { describe, expect, it, vi } from "vitest";

import { ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import { serverApprovalWords } from "../approvals/approval-words.ts";
import { answerRoutineFix, cardWithCheckNote, RoutineCheckFollowUps, routineFixChoice, type RoutineFixAnswerDeps } from "./routine-problem-answer.ts";
import { plainProblemText, routineProblemCardInput } from "./routine-problem-card.ts";

const FRENCH = serverApprovalWords("fr", {});
const ROUTINE = { id: "r1", name: "Sweep", botId: "b1" };

function deps(extra: Partial<RoutineFixAnswerDeps<typeof ROUTINE>> = {}) {
  return {
    routine: vi.fn((id: string) => (id === "r1" ? ROUTINE : undefined)),
    words: vi.fn(() => ENGLISH_WORDS),
    stillWrong: vi.fn(() => true),
    runNow: vi.fn(() => ({ ok: true as const })),
    pause: vi.fn(() => ({ ok: true as const })),
    ...extra,
  };
}

describe("the fix card's choices (#4438)", () => {
  it("reads each choice in the card's language and in English; words of the person's own are not a choice", () => {
    expect(routineFixChoice("Open the routine", [ENGLISH_WORDS])).toBe("open");
    expect(routineFixChoice("  run a CHECK ", [ENGLISH_WORDS])).toBe("check");
    expect(routineFixChoice("Mettre la routine en pause", [FRENCH, ENGLISH_WORDS])).toBe("pause");
    expect(routineFixChoice("Pause the routine", [FRENCH, ENGLISH_WORDS])).toBe("pause");
    expect(routineFixChoice("Open the routine and fix the mailbox", [ENGLISH_WORDS])).toBeNull();
    expect(routineFixChoice("", [ENGLISH_WORDS])).toBeNull();
  });

  it("Open the routine opens its page on the device: nothing runs, nothing is written", () => {
    const d = deps({ opens: true });
    expect(answerRoutineFix("routine-problem:r1", "Open the routine", d)).toEqual({
      note: ENGLISH_WORDS.t("routine.problemCard.opened"),
      open: { type: "open_routine", routineId: "r1", botId: "b1" },
    });
    expect(d.runNow).not.toHaveBeenCalled();
    expect(d.pause).not.toHaveBeenCalled();
  });

  it("a device that cannot open the page (a released app, a call) is told where it is, never that it is open", () => {
    const d = deps();
    expect(answerRoutineFix("routine-problem:r1", "Open the routine", d)).toEqual({ note: "Its page is in Routines: Sweep." });
    expect(d.runNow).not.toHaveBeenCalled();
  });

  it("Run a check runs the routine once now and says so in one line", () => {
    const d = deps();
    expect(answerRoutineFix("routine-problem:r1", "Run a check", d)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.checkStarted") });
    expect(d.runNow).toHaveBeenCalledWith(ROUTINE);
    // a run already going: said, nothing started twice
    const busy = deps({ runNow: vi.fn(() => ({ ok: false as const, running: true as const })) });
    expect(answerRoutineFix("routine-problem:r1", "Run a check", busy)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.checkRunning") });
  });

  it("Pause the routine turns it off and says so in one line; a refusal is said as it is", () => {
    const d = deps();
    expect(answerRoutineFix("routine-problem:r1", "Pause the routine", d)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.pausedNow") });
    expect(d.pause).toHaveBeenCalledWith(ROUTINE);
    const refused = deps({ pause: vi.fn(() => ({ ok: false as const, error: "you need the right to run this bot's routines" })) });
    expect(answerRoutineFix("routine-problem:r1", "Pause the routine", refused)).toEqual({ note: "you need the right to run this bot's routines" });
  });

  it("an answer to a card whose problem is over writes nothing: the card says there is nothing left to do", () => {
    const d = deps({ stillWrong: vi.fn(() => false) });
    expect(answerRoutineFix("routine-problem:r1", "Pause the routine", d)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.alreadyFixed") });
    expect(answerRoutineFix("routine-problem:r1", "Run a check", d)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.alreadyFixed") });
    expect(d.pause).not.toHaveBeenCalled();
    expect(d.runNow).not.toHaveBeenCalled();
  });

  it("words of the person's own, and any other card, still reach the bot", () => {
    const d = deps();
    expect(answerRoutineFix("routine-problem:r1", "Fix the sign-in first", d)).toBeNull();
    expect(answerRoutineFix("ticket-1012", "Open the routine", d)).toBeNull();
    expect(answerRoutineFix("routine-cheap-path:r1", "Run a check", d)).toBeNull();
  });

  it("a routine gone since says so", () => {
    expect(answerRoutineFix("routine-problem:gone", "Run a check", deps())).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.gone") });
  });
});

describe("the fix card never shows a raw code (#4438)", () => {
  const RAW = "Api result query failed 3 times and never succeeded after: handle res_0123456789abcdef is unknown, expired, or not yours (handle_unknown)";
  const need: RoutineNeedsPerson = { kind: "problem", text: "", since: 1 };

  it("an unknown result handle reads as a plain sentence; the raw words stay under Details", () => {
    const input = routineProblemCardInput({ id: "r1", name: "Sweep" }, need, { summary: RAW, count: 4 }, ENGLISH_WORDS);
    expect(input.question).toContain(ENGLISH_WORDS.t("routine.problemCard.savedResultGone"));
    expect(input.question).not.toMatch(/handle_unknown|res_0123|handle res_/);
    expect(input.technical).toBe(RAW);
    // in French as well
    const fr = routineProblemCardInput({ id: "r1", name: "Sweep" }, need, { summary: RAW, count: 4 }, FRENCH);
    expect(fr.question).toContain(FRENCH.t("routine.problemCard.savedResultGone"));
    expect(fr.question).not.toMatch(/handle_unknown/);
  });

  it("a trailing raw code is dropped; plain words are kept as they are", () => {
    expect(plainProblemText("Get message failed: 404 Not Found (not_found)", ENGLISH_WORDS)).toEqual({ text: "Get message failed: 404 Not Found", raw: "Get message failed: 404 Not Found (not_found)" });
    expect(plainProblemText("Flow failed 2 times and never succeeded after: Tool not found: Flow", ENGLISH_WORDS)).toEqual({ text: "Flow failed 2 times and never succeeded after: Tool not found: Flow" });
    const input = routineProblemCardInput({ id: "r1", name: "Sweep" }, need, { summary: "Down", count: 3 }, ENGLISH_WORDS);
    expect(input.technical).toBeUndefined();
  });
});

describe("Run a check: the card says what that run did (#4579)", () => {
  it("names the run it started, or the one already going, so its end can be told", () => {
    const d = deps({ runNow: vi.fn(() => ({ ok: true as const, runId: "run-9" })) });
    expect(answerRoutineFix("routine-problem:r1", "Run a check", d)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.checkStarted"), checkRunId: "run-9" });
    const busy = deps({ runNow: vi.fn(() => ({ ok: false as const, running: true as const, runId: "run-8" })) });
    expect(answerRoutineFix("routine-problem:r1", "Run a check", busy)).toEqual({ note: ENGLISH_WORDS.t("routine.problemCard.checkRunning"), checkRunId: "run-8" });
  });

  it("when that run ends, the card's line says clean, the same problem again, or stopped; once", () => {
    const notes: Array<[string, string, string]> = [];
    let wrong = false;
    const followUps = new RoutineCheckFollowUps({
      words: () => ENGLISH_WORDS,
      stillWrong: () => wrong,
      tell: (card, note) => { notes.push([card.threadId, card.messageId, note]); },
    });
    followUps.remember("run-1", { routineId: "r1", threadId: "t1", messageId: "m1" });
    followUps.remember("run-2", { routineId: "r1", threadId: "t1", messageId: "m2" });
    followUps.remember("run-3", { routineId: "r1", threadId: "t1", messageId: "m3" });
    // still going: nothing said yet
    followUps.runChanged({ id: "run-1", routineId: "r1", status: "running" });
    expect(notes).toEqual([]);
    followUps.runChanged({ id: "run-1", routineId: "r1", status: "completed" });
    wrong = true;
    followUps.runChanged({ id: "run-2", routineId: "r1", status: "failed" });
    followUps.runChanged({ id: "run-3", routineId: "r1", status: "cancelled" });
    // a run nobody asked to follow, or told again: nothing
    followUps.runChanged({ id: "run-1", routineId: "r1", status: "completed" });
    followUps.runChanged({ id: "run-4", routineId: "r1", status: "failed" });
    expect(notes).toEqual([
      ["t1", "m1", ENGLISH_WORDS.t("routine.problemCard.checkClean")],
      ["t1", "m2", ENGLISH_WORDS.t("routine.problemCard.checkStill")],
      ["t1", "m3", ENGLISH_WORDS.t("routine.problemCard.checkStopped")],
    ]);
    expect(new Set(notes.map(([, , note]) => note)).size).toBe(3);
  });

  it("the new line replaces the card's note, and the one after its words for an app that reads only those", () => {
    const started = ENGLISH_WORDS.t("routine.problemCard.checkStarted");
    const clean = ENGLISH_WORDS.t("routine.problemCard.checkClean");
    expect(cardWithCheckNote({ answeredText: "Run a check", answerNote: started }, clean)).toEqual({ answeredText: "Run a check", answerNote: clean });
    expect(cardWithCheckNote({ answeredText: `Run a check\n\n${started}`, answerNote: started }, clean)).toEqual({ answeredText: `Run a check\n\n${clean}`, answerNote: clean });
  });
});
