import { describe, expect, it } from "vitest";
import {
  ROUTINE_GOAL_MAX_CHECK_MS,
  ROUTINE_GOAL_MIN_CHECK_MS,
  defaultNextCheck,
  expireGoal,
  goalPastDeadline,
  loadRoutineGoal,
  progressMetric,
  progressUnchanged,
  parseNextCheck,
  parseRoutineGoal,
  readGoalReport,
  readRoutineGoalLines,
  routineGoalBlock,
  routineGoalLinesSay,
  routineGoalOfLines,
  routineRunInstructions,
  stepGoal,
  writeRoutineGoalLines,
  type RoutineGoal,
} from "./routine-goal";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const HOUR = 3_600_000;

describe("parseRoutineGoal", () => {
  it("takes a sentence or { text, deadline } and removes on null or empty", () => {
    expect(parseRoutineGoal("Get the backup job to 100%")).toEqual({ ok: true, goal: { text: "Get the backup job to 100%", status: "active" } });
    const withDeadline = parseRoutineGoal({ text: "Close the ticket", deadline: "2026-11-10T17:00:00-05:00" });
    expect(withDeadline.ok && withDeadline.goal?.deadline).toBe(Date.parse("2026-11-10T22:00:00Z"));
    expect(parseRoutineGoal(null)).toEqual({ ok: true });
    expect(parseRoutineGoal("  ")).toEqual({ ok: true });
  });

  it("refuses a bad shape or deadline and an over-long goal", () => {
    expect(parseRoutineGoal(42).ok).toBe(false);
    expect(parseRoutineGoal({ text: "x", deadline: "not a date" }).ok).toBe(false);
    expect(parseRoutineGoal("x".repeat(2001)).ok).toBe(false);
  });

  it("keeps the progress of an unchanged goal and resets a reworded one", () => {
    const previous: RoutineGoal = { text: "Reach 100%", status: "active", checks: 4, progress: "78.95%" };
    const same = parseRoutineGoal("Reach 100%", previous);
    expect(same.ok && same.goal).toEqual(previous);
    const reworded = parseRoutineGoal("Reach 95%", previous);
    expect(reworded.ok && reworded.goal).toEqual({ text: "Reach 95%", status: "active" });
  });
});

describe("loadRoutineGoal", () => {
  it("drops unknown fields and bad values", () => {
    expect(loadRoutineGoal({ text: "Goal", status: "weird", checks: -1, nextCheckAt: NOW, extra: 1 })).toEqual({ text: "Goal", status: "active", nextCheckAt: NOW });
    expect(loadRoutineGoal({ status: "active" })).toBeUndefined();
  });
});

describe("readGoalReport", () => {
  it("reads the two lines and strips them from the report", () => {
    const read = readGoalReport("Backup at 82%.\n\nGOAL_STATUS: in_progress: 82%\nNEXT_CHECK: in 3h", NOW);
    expect(read).toEqual({ report: "Backup at 82%.", status: "in_progress", note: "82%", nextCheckAt: NOW + 3 * HOUR });
  });

  it("clamps the next check between the minimum and the maximum", () => {
    expect(readGoalReport("NEXT_CHECK: in 1m", NOW).nextCheckAt).toBe(NOW + ROUTINE_GOAL_MIN_CHECK_MS);
    expect(readGoalReport("NEXT_CHECK: in 90d", NOW).nextCheckAt).toBe(NOW + ROUTINE_GOAL_MAX_CHECK_MS);
  });

  it("refuses an absolute time without an offset", () => {
    expect(parseNextCheck("2026-11-09T09:00", NOW)).toBeUndefined();
    expect(parseNextCheck("2026-11-09T09:00:00-05:00", NOW)).toBe(Date.parse("2026-11-09T14:00:00Z"));
    expect(parseNextCheck("dans 2 j", NOW)).toBe(NOW + 48 * HOUR);
  });
});

describe("stepGoal", () => {
  const goal: RoutineGoal = { text: "Reach 100%", status: "active" };

  it("stops once the goal is reached", () => {
    const step = stepGoal(goal, { report: "", status: "achieved", note: "100%" }, NOW);
    expect(step.stop).toBe(true);
    expect(step.goal).toMatchObject({ status: "achieved", achievedAt: NOW, progress: "100%", checks: 1 });
    expect(step.problem).toBeUndefined();
  });

  it("expires past the deadline and tells the person", () => {
    const step = stepGoal({ ...goal, deadline: NOW - 1 }, { report: "", status: "in_progress", note: "80%" }, NOW);
    expect(step.stop).toBe(true);
    expect(step.goal.status).toBe("expired");
    expect(step.problem).toContain("deadline passed");
  });

  it("never schedules the next check past the deadline", () => {
    const step = stepGoal({ ...goal, deadline: NOW + 2 * HOUR }, { report: "", status: "in_progress", nextCheckAt: NOW + 10 * HOUR }, NOW);
    expect(step.goal.nextCheckAt).toBe(NOW + 2 * HOUR);
  });

  it("raises a blocked goal", () => {
    expect(stepGoal(goal, { report: "", status: "blocked", note: "no access" }, NOW).problem).toBe("The goal is blocked: no access");
  });

  it("rings once every three unchanged checks (the 78.95% case)", () => {
    let current: RoutineGoal = { ...goal, progress: "78.95%" };
    const problems: (string | undefined)[] = [];
    for (let run = 0; run < 6; run += 1) {
      const step = stepGoal(current, { report: "", status: "in_progress", note: "78.95%" }, NOW + run * HOUR);
      problems.push(step.problem);
      current = step.goal;
    }
    expect(problems.map(Boolean)).toEqual([false, true, false, false, true, false]);
  });
});

describe("stagnation (prod case: stuck at 78,95 %)", () => {
  const goal: RoutineGoal = { text: "Reach 100%", status: "active" };

  it("reads the metric whatever its writing", () => {
    expect(progressMetric("78,95 %")).toBe(78.95);
    expect(progressMetric("toujours 78.95% (15 sur 19)")).toBe(78.95);
    expect(progressMetric("15 of 19 done")).toBe(15);
    expect(progressMetric("waiting on the vendor")).toBeUndefined();
    expect(progressUnchanged("78,95 %", "Toujours bloqué à 78.95% (15/19)")).toBe(true);
    expect(progressUnchanged("78,95 %", "84,21 %")).toBe(false);
    expect(progressUnchanged("Waiting on vendor.", "waiting on vendor")).toBe(true);
  });

  it("rings with notes worded differently and a run without a note", () => {
    const notes = ["78,95 % (15 sur 19)", "Toujours 78.95%", undefined, "bloqué à 78,95 %", "78,95%", undefined];
    let current: RoutineGoal = { ...goal };
    const problems: (string | undefined)[] = [];
    notes.forEach((note, run) => {
      const step = stepGoal(current, { report: "", status: "in_progress", ...(note ? { note } : {}) }, NOW + run * HOUR);
      problems.push(step.problem);
      current = step.goal;
    });
    // First note sets the progress; then 2 unchanged checks (3 in all) ring.
    expect(problems.map(Boolean)).toEqual([false, false, true, false, false, true]);
    expect(current.progress).toBe("78,95%");
    expect(current.stalled).toBe(5);
  });

  it("a missing note never resets the count; real progress does", () => {
    let current: RoutineGoal = { ...goal, progress: "78,95 %", stalled: 1 };
    current = stepGoal(current, { report: "", status: "in_progress" }, NOW).goal;
    expect(current.stalled).toBe(2);
    current = stepGoal(current, { report: "" }, NOW).goal;
    expect(current.stalled).toBe(3);
    current = stepGoal(current, { report: "", status: "in_progress", note: "84,21 %" }, NOW).goal;
    expect(current.stalled).toBeUndefined();
  });
});

describe("deadline", () => {
  const goal: RoutineGoal = { text: "Reach 100%", status: "active", deadline: NOW };

  it("refuses a run past the deadline, after a short grace", () => {
    expect(goalPastDeadline(goal, NOW)).toBe(false);
    expect(goalPastDeadline(goal, NOW + 4 * 60_000)).toBe(false);
    expect(goalPastDeadline(goal, NOW + HOUR)).toBe(true);
    expect(goalPastDeadline({ ...goal, status: "achieved" }, NOW + HOUR)).toBe(false);
    expect(goalPastDeadline({ text: "x", status: "active" }, NOW + HOUR)).toBe(false);
  });

  it("closes the goal with a final report", () => {
    const closed = expireGoal({ ...goal, checks: 4, progress: "78,95 %" }, NOW + HOUR);
    expect(closed.goal).toMatchObject({ status: "expired", expiredAt: NOW + HOUR });
    expect(closed.report).toContain("Checks run: 4.");
    expect(closed.report).toContain("Last progress: 78,95 %");
    expect(closed.problem).toContain("deadline passed");
  });

  it("a default next check lands a day later, never past the deadline", () => {
    expect(defaultNextCheck({ text: "x", status: "active" }, NOW)).toBe(NOW + 24 * HOUR);
    expect(defaultNextCheck({ ...goal, deadline: NOW + 3 * HOUR }, NOW)).toBe(NOW + 3 * HOUR);
  });
});

describe("routineGoalBlock", () => {
  it("fences the goal and asks for the two closing lines", () => {
    const block = routineGoalBlock({ text: "Fix <it>", status: "active", deadline: NOW + HOUR, checks: 2, progress: "50%" }, NOW);
    expect(block).toContain("<goal>Fix &lt;it&gt;</goal>");
    expect(block).toContain("GOAL_STATUS:");
    expect(block).toContain("NEXT_CHECK:");
    expect(block).toContain("Checks so far: 2.");
    expect(block).toContain("NOTHING_TO_REPORT");
  });
});

describe("the /goal line (#4098)", () => {
  it("reads the goal and its deadline line from the instructions and leaves them out of what the run reads", () => {
    const prompt = "Watch the backup job.\n\n/goal Backup job at 100%\n/deadline 2026-11-20T17:00:00Z\n\nReport the percentage.";
    expect(readRoutineGoalLines(prompt)).toEqual({
      goal: { text: "Backup job at 100%", deadline: "2026-11-20T17:00:00Z" },
      instructions: "Watch the backup job.\n\nReport the percentage.",
    });
    const read = routineGoalOfLines(prompt);
    expect(read.ok && read.goal).toEqual({ text: "Backup job at 100%", status: "active", deadline: Date.parse("2026-11-20T17:00:00Z") });
    expect(routineRunInstructions(prompt)).toBe("Watch the backup job.\n\nReport the percentage.");
    // No line, no goal: the instructions stay as written.
    expect(readRoutineGoalLines("Say hi.\n/goals are nice")).toEqual({ instructions: "Say hi.\n/goals are nice" });
  });

  it("refuses a deadline line that is not a date, as the goal input does", () => {
    expect(routineGoalOfLines("/goal Reach 100%\n/deadline someday").ok).toBe(false);
  });

  it("writes a goal as its first lines, once, and removes them on none", () => {
    const deadline = Date.parse("2026-11-20T17:00:00Z");
    const written = writeRoutineGoalLines("Watch the backup job.", { text: "Backup\njob at 100%", deadline });
    expect(written).toBe("/goal Backup job at 100%\n/deadline 2026-11-20T17:00:00.000Z\n\nWatch the backup job.");
    expect(writeRoutineGoalLines(written, { text: "Backup job at 100%", deadline })).toBe(written);
    expect(routineGoalLinesSay(written, { text: "Backup job at 100%", deadline })).toBe(true);
    // The person's own place and date format are kept when they say the same goal.
    const own = "Watch.\n/goal Reach 100%\n/deadline 2026-11-20T17:00:00Z";
    expect(writeRoutineGoalLines(own, { text: "Reach 100%", deadline })).toBe(own);
    expect(writeRoutineGoalLines(written, undefined)).toBe("Watch the backup job.");
    expect(writeRoutineGoalLines("/goal Only this", { text: "Other" })).toBe("/goal Other");
  });

  it("keeps the goal's progress when only the line's place changes", () => {
    const previous: RoutineGoal = { text: "Reach 100%", status: "active", checks: 4, progress: "78.95%", stalled: 2 };
    const moved = routineGoalOfLines("Check the job.\n\n/goal Reach 100%", previous);
    expect(moved.ok && moved.goal).toEqual(previous);
  });
});
