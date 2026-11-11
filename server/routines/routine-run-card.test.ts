import { describe, expect, it } from "vitest";

import { unclosedFenceOffset } from "../../src/lib/rich-blocks.ts";
import { pickRoutineFullReport, routineRunCard, routineRunFallbackText, ROUTINE_REPORT_POST_MAX, wakeTopicOf } from "./routine-run-card.ts";
import type { RoutineRun } from "./routines.ts";

const REPORT = "Le suivi de 14 h 50 n'a rien écrit dans ConnectWise. J'ai libéré le verrou dispatch.";

function run(overrides: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: "run-1", routineId: "r-1", routineName: "[Dispatch] New tickets", botId: "bot-1", scheduledFor: 1,
    createdAt: 1, status: "completed", target: "bot", runOn: "maus", threadId: "exec-1", output: REPORT,
    ...overrides,
  } as RoutineRun;
}

describe("routineRunCard", () => {
  // 2026-10-29: the conversation gets the whole report (read from the run's
  // task), not the 2 000 characters the run's record keeps, so nobody opens
  // the run's own task to read the rest.
  it("carries the whole report when the run's task holds it", () => {
    const whole = `${"Draft. ".repeat(600)}End.`;
    const card = routineRunCard(run({ output: whole.slice(0, 2_000) }), "main", whole);
    expect(card.summary).toBe(whole);
    expect(routineRunCard(run(), "main", "x".repeat(30_000)).summary).toHaveLength(ROUTINE_REPORT_POST_MAX);
    // a wait keeps its short line
    expect(routineRunCard(run({ status: "waiting", attention: "Approve" }), "main", whole).summary).toBe("Approve");
  });

  // #3515: a cut ends at a sentence or a word, never in the middle of one.
  it("cuts a long report, a wait's line and an error at a sentence, never inside a word", () => {
    const long = "Les deux partis sont partisans, et la suite est longue. ".repeat(500);
    const summary = routineRunCard(run(), "main", long).summary!;
    expect(summary.length).toBeLessThanOrEqual(ROUTINE_REPORT_POST_MAX);
    expect(summary.endsWith("longue.…")).toBe(true);
    const waiting = routineRunCard(run({ status: "waiting", attention: long }), "main").summary!;
    expect(waiting.endsWith("longue.…")).toBe(true);
    const failed = routineRunCard(run({ status: "failed", error: long }), "main");
    expect(failed.error!.length).toBeLessThanOrEqual(500);
    expect(failed.error!.endsWith("longue.…")).toBe(true);
    const queued = routineRunCard(run({ status: "queued", attention: long }), "main");
    expect(queued.attention!.endsWith("longue.…")).toBe(true);
  });

  // 2026-11-06 (#2186): a long report with a widget stays whole; a cut never
  // opens a fence without closing it.
  it("keeps a long widget fence whole in the posted summary", () => {
    const css = `#dgx .fold summary::-webkit-details-marker{display:none}`.repeat(800);
    const widget = `\`\`\`widget-imperfect\n<style>${css}</style>\n<div id=dgx>ok</div>\n\`\`\``;
    const whole = `Dispatch finished.\n\n${widget}`;
    expect(whole.length).toBeGreaterThan(ROUTINE_REPORT_POST_MAX);
    const card = routineRunCard(run({ output: whole.slice(0, 2_000) }), "main", whole);
    expect(card.summary).toBe(whole);
    expect(unclosedFenceOffset(card.summary!)).toBe(-1);
    expect(card.summary).toContain("webkit-details-marker");
    expect(card.summary!.trimEnd().endsWith("```")).toBe(true);
  });

  it("picks the task's full report when the run record ends inside a fence", () => {
    const whole = "Checked the board.\n\n```widget-imperfect\n<style>#dgx .fold summary::-webkit-details-marker{display:none}</style>\n<div>ok</div>\n```";
    const cut = whole.slice(0, whole.indexOf("webkit") + 10);
    expect(unclosedFenceOffset(cut)).toBeGreaterThanOrEqual(0);
    expect(pickRoutineFullReport(cut, whole)).toBe(whole);
    expect(pickRoutineFullReport(whole.slice(0, 40), whole)).toBe(whole);
    expect(pickRoutineFullReport(whole, whole)).toBeUndefined();
  });

  // 2026-11-04: a running card shows how long the run has been going.
  it("carries when the run started, for the running card's elapsed time", () => {
    expect(routineRunCard(run({ status: "running", startedAt: 42 })).startedAt).toBe(42);
    expect(routineRunCard(run({ status: "queued" })).startedAt).toBeUndefined();
  });

  it("carries the report when the run worked in its own task", () => {
    expect(routineRunCard(run(), "main").summary).toBe(REPORT);
  });

  // 2026-10-19 (production): routines in conversation wrote the full report under
  // the card, and the card repeated it.
  it("keeps only the state when the run joined the conversation it reports to", () => {
    const card = routineRunCard(run({ threadId: "main" }), "main");
    expect(card.summary).toBeUndefined();
    expect(card.status).toBe("completed");
    expect(card.executionThreadId).toBe("main");
  });

  it("still says what a joined run waits for, and why it failed", () => {
    expect(routineRunCard(run({ threadId: "main", status: "waiting", attention: "Approve the write" }), "main").summary).toBe("Approve the write");
    expect(routineRunCard(run({ threadId: "main", status: "failed", error: "cluster down" }), "main").error).toBe("cluster down");
  });

  // 2026-10-22: a run that waited on the person, then ended with nothing to
  // report, leaves its one message saying so, without a report.
  it("a quiet run reads as nothing to report", () => {
    const card = routineRunCard(run({ quiet: true }), "main");
    expect(card.status).toBe("nothing_to_report");
    expect(card.summary).toBeUndefined();
  });

  it("says when the failure paused its routine (2026-10-26)", () => {
    expect(routineRunCard(run({ status: "failed", error: "down", autoPaused: { failures: 5 } }), "main").autoPausedAfter).toBe(5);
    expect(routineRunCard(run({ status: "failed", error: "down" }), "main")).not.toHaveProperty("autoPausedAfter");
  });
});

// 2026-11-03 (the maintainer): the problem lines belong in the run detail (View run)
// only, never in the conversation, the message's text included.
describe("wakeTopicOf (#2694)", () => {
  it("names the wake kind the person rates: heartbeat, the mail or calendar source, none for a routine", () => {
    expect(wakeTopicOf(run({ webhookId: "heartbeat:bot-1" }))).toBe("heartbeat");
    expect(wakeTopicOf(run({ proactive: { sources: ["mail"] } } as Partial<RoutineRun>))).toBe("mail");
    expect(routineRunCard(run({ proactive: { sources: ["calendar"] } } as Partial<RoutineRun>), "main").wakeTopic).toBe("calendar");
    expect(wakeTopicOf(run())).toBeUndefined();
    expect(routineRunCard(run(), "main").wakeTopic).toBeUndefined();
  });
});

describe("routineRunFallbackText", () => {
  const problems = "Get message failed 2 times and never succeeded after: Microsoft Graph API error: 404 Not Found";

  it("says a quiet run in the conversation's language (#3219)", () => {
    const card = routineRunCard(run({ quiet: true, output: undefined }), "main");
    expect(card.status).toBe("nothing_to_report");
    expect(routineRunFallbackText(card, "fr-CA")).toMatch(/rien à signaler/);
    expect(routineRunFallbackText(card, "fr-CA")).not.toContain("NOTHING_TO_REPORT");
    expect(routineRunFallbackText(card, "en")).toContain("had nothing to report");
  });

  it("says a run completed with problems without their lines", () => {
    const card = routineRunCard(run({ problems }), "main");
    expect(card.problems).toBe(problems);
    const text = routineRunFallbackText(card);
    expect(text).toContain(REPORT);
    expect(text).toContain("Completed with problems.");
    expect(text).not.toContain("Graph API");
    expect(text).not.toContain("failed 2 times");
  });

  it("says so for a run with no report too", () => {
    const text = routineRunFallbackText(routineRunCard(run({ problems, output: undefined }), "main"));
    expect(text).toBe("Routine “[Dispatch] New tickets” completed with problems");
  });

  it("keeps a failure's reason, which is not a problem line", () => {
    expect(routineRunFallbackText(routineRunCard(run({ status: "failed", output: undefined, error: "The engine stopped" }), "main")))
      .toBe("Routine “[Dispatch] New tickets” failed\n\nThe engine stopped");
  });
});

// The card keeps readiness codes so the client translates the blocked reason.
it("carries independent readiness checks for a blocked run", () => {
  const readiness = [{ kind: "skills", ok: false, code: "skill_missing", params: { skill: "inbox-review" }, line: "Missing skill. Assign it." }] as const;
  const card = routineRunCard({ id: "run-check", routineId: "r1", routineName: "Inbox", botId: "osprey", target: "bot", runOn: "maus", status: "blocked", scheduledFor: 1, createdAt: 1, manual: true, readiness: [...readiness] });
  expect(card.readiness).toEqual(readiness);
  expect(card.readiness).not.toBe(readiness);
});
