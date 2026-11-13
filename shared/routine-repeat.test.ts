import { describe, expect, it } from "vitest";

import { ROUTINE_PROBLEM_STREAK_TOLD, routinePostsEachResult, routineProblemToldAt, routineReportsByStreak, routineRepeatsWithinDay, routineRunPostsResult, routineRunRowInEveryChat, routineRunRowOutOfChat, routineRunsCounted, routineRunsSeveralTimesADay } from "./routine-repeat.ts";

const at = Date.parse("2026-11-11T12:00:00Z");

describe("routineRepeatsWithinDay (#3695): which routines report by their streak", () => {
  it("an interval under a day repeats; a whole day does not", () => {
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 5, anchorAt: at }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: at, window: { start: "08:00", end: "17:00" } }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 1_440, anchorAt: at }, at)).toBe(false);
  });

  it("an interval whose window fits one run a day does not repeat; one that fits two does", () => {
    // a window as long as the interval: one start a day at most
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 120, anchorAt: at, window: { start: "09:00", end: "11:00" } }, at, "UTC")).toBe(false);
    // hourly at a quarter to, between 08:00 and 09:30: only 08:45 fits
    const quarterTo = Date.parse("2026-11-11T08:45:00Z");
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(false);
    // hourly on the hour in the same window: 08:00 and 09:00
    const onTheHour = Date.parse("2026-11-11T08:00:00Z");
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: onTheHour, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(true);
    // the zone the window is read in decides the minute: 08:45 UTC is 03:45 in Toronto, still a quarter to
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "America/Toronto")).toBe(false);
    // an interval that does not divide a day moves its starts: two can fit
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 70, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(true);
  });

  it("a cron with two or more times on one day repeats; one time a day, a week or a month does not", () => {
    expect(routineRepeatsWithinDay({ type: "cron", expression: "*/5 * * * *", timeZone: "UTC" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "15 8 * * 1-5; 30 12 * * 1-5", timeZone: "America/Toronto" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 9,17 * * 1", timeZone: "America/Toronto" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 7 * * *", timeZone: "America/Toronto" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 7 * * 1", timeZone: "America/Toronto" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 9 1 * *", timeZone: "UTC" }, at)).toBe(false);
    // one time on two days, late and early: once a day, not twice
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 23 * * 1; 0 1 * * 2", timeZone: "UTC" }, at)).toBe(false);
  });

  it("a run at every usage-limit reset repeats (a short usage window resets several times a day); the next reset only does not", () => {
    expect(routineRepeatsWithinDay({ type: "limit_reset", engine: "claude", repeat: "every_reset", at: null }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "limit_reset", engine: "claude", repeat: "once", at: null }, at)).toBe(false);
  });

  it("a daily time, a single date and every trigger never repeat within a day", () => {
    expect(routineRepeatsWithinDay({ type: "daily", time: "07:00", weekdays: [1, 2, 3, 4, 5] }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "once", at }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "webhook" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "event", source: "email" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "event", source: "github", events: ["issues.opened"] }, at)).toBe(false);
    expect(routineRepeatsWithinDay(null, at)).toBe(false);
  });

  it("the person is told after three runs in a row", () => {
    expect(ROUTINE_PROBLEM_STREAK_TOLD).toBe(3);
  });
});

describe("one rule for every routine, whatever starts it (#3990)", () => {
  const daily = { type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] };
  it("every run but one the person started or a team goal's reports by its streak", () => {
    expect(routineReportsByStreak({})).toBe(true);
    expect(routineReportsByStreak({ target: "bot" })).toBe(true);
    expect(routineReportsByStreak({ startedBy: "person" })).toBe(false);
    expect(routineReportsByStreak({ target: "room-goal" })).toBe(false);
  });

  it("only a clock routine that runs once a day or less, set to post its results, posts each one", () => {
    expect(routinePostsEachResult(daily, true, at)).toBe(true);
    expect(routinePostsEachResult(daily, false, at)).toBe(false);
    expect(routinePostsEachResult({ type: "webhook" }, true, at)).toBe(false);
    expect(routinePostsEachResult({ type: "event", source: "email" } as { type: string }, true, at)).toBe(false);
    expect(routinePostsEachResult({ type: "interval", everyMinutes: 5, anchorAt: at } as { type: string }, true, at)).toBe(false);
  });

  it("a routine that can run several times a day tells a problem at its third run in a row; one that runs at most once a day at its first", () => {
    const often = [
      { type: "webhook" },
      { type: "event", source: "email" },
      { type: "event", source: "github" },
      { type: "interval", everyMinutes: 5, anchorAt: at },
      { type: "limit_reset", repeat: "every_reset" },
      { type: "cron", expression: "0 9,17 * * *", timeZone: "UTC" },
    ];
    for (const schedule of often) {
      expect(routineRunsSeveralTimesADay(schedule, at), JSON.stringify(schedule)).toBe(true);
      expect(routineProblemToldAt(schedule, at), JSON.stringify(schedule)).toBe(ROUTINE_PROBLEM_STREAK_TOLD);
    }
    const rare = [
      daily,
      { type: "cron", expression: "0 8 1 * *", timeZone: "UTC" },
      { type: "once", at },
      { type: "interval", everyMinutes: 1_440, anchorAt: at },
      { type: "cron", expression: "0 9 * * 1", timeZone: "UTC" },
      null,
    ];
    for (const schedule of rare) {
      expect(routineRunsSeveralTimesADay(schedule, at), JSON.stringify(schedule)).toBe(false);
      expect(routineProblemToldAt(schedule, at), JSON.stringify(schedule)).toBe(1);
    }
  });

  it("a proactive wake posts a result only when the person chose to hear it; a webhook's own run posts none", () => {
    expect(routineRunPostsResult({ proactive: {} }, undefined, true, at)).toBe(false);
    expect(routineRunPostsResult({ proactive: { alwaysReport: true } }, undefined, true, at)).toBe(true);
    expect(routineRunPostsResult({ webhookId: "hook" }, undefined, true, at)).toBe(false);
    expect(routineRunPostsResult({}, undefined, true, at)).toBe(true);
    expect(routineRunPostsResult({}, { schedule: daily }, true, at)).toBe(true);
    expect(routineRunPostsResult({}, { schedule: daily, postResults: false }, true, at)).toBe(false);
    expect(routineRunPostsResult({}, { schedule: { type: "webhook" }, postResults: true }, true, at)).toBe(false);
  });

  it("a conversation from before draws none of its runs' state rows; what is for the person stays", () => {
    const row = (routineRun: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: "routine.run", routineRun: { runId: "r", ...routineRun }, ...extra });
    const out = [
      row({ status: "completed", problems: "the mailbox refused the move" }),
      row({ status: "completed", problems: "x", repeat: { firstRunId: "a", count: 4, since: 1, lastAt: 2 } }),
      row({ status: "completed", recovered: { afterRuns: 2, since: 1 } }),
      row({ status: "nothing_to_report", recovered: { afterRuns: 1, since: 1 } }),
      row({ status: "nothing_to_report" }),
      row({ status: "blocked", error: "signed out" }),
      row({ status: "cancelled" }),
      // a wake's result the person did not choose, the kind stored in the chats before
      row({ status: "completed", summary: "Replied to the teammate.", wakeTopic: "peer" }),
      row({ status: "completed", summary: "A new mail from the supplier.", wakeTopic: "email" }),
      row({ status: "completed", summary: "Meeting moved to 3 pm.", wakeTopic: "calendar" }),
      row({ status: "completed", summary: "All quiet.", wakeTopic: "heartbeat" }),
      // #3990: a chosen wake's row stored before (an accepted suggestion, a
      // watch): its words were forced out of a quiet ending, so a stored
      // row cannot tell "nothing for you" from a report; it leaves the chat
      row({ status: "completed", summary: "Rien à remonter.", wakeTopic: "watch" }),
      row({ status: "completed", summary: "Messages from teammates:\n- Bot B: ticket closed", wakeTopic: "peer" }),
      row({ status: "completed", summary: "The suggestion you accepted.", wakeTopic: "suggestion" }),
      row({ status: "completed", summary: "Your watch found a new ticket.", wakeTopic: "watch" }),
      // #4201: a run another bot asked for, stored as the person's: its
      // "2 runs with problems since" card is a streak count, not the summary
      row({ status: "completed", problems: "x", startedBy: "person", repeat: { firstRunId: "a", count: 2, since: 1, lastAt: 2 } }),
    ];
    for (const message of out) expect(routineRunRowOutOfChat(message), JSON.stringify(message)).toBe(true);
    const kept = [
      row({ status: "completed", summary: "Three meetings today." }),
      // #3990: a wake's report written for the person since
      row({ status: "completed", summary: "The suggestion you accepted.", wakeTopic: "suggestion", forPerson: true }),
      row({ status: "completed", summary: "Your watch found a new ticket.", wakeTopic: "watch", forPerson: true }),
      row({ status: "completed", summary: "Replied to the teammate.", wakeTopic: "peer" }, { attention: { items: [{ text: "decide" }] } }),
      row({ status: "completed", summary: "Replied to the teammate.", wakeTopic: "peer", startedBy: "person" }),
      row({ status: "completed", problems: "x", repeat: { firstRunId: "a", count: 3, since: 1, lastAt: 2, streak: true } }),
      row({ status: "completed", recovered: { afterRuns: 4, since: 1, streak: true } }),
      row({ status: "completed", problems: "x", startedBy: "person" }),
      row({ status: "completed", problems: "x", startedBy: "person", repeat: { firstRunId: "a", count: 3, since: 1, lastAt: 2, streak: true } }),
      row({ status: "completed", problems: "x" }, { attention: { items: [{ text: "decide" }] } }),
      row({ status: "waiting", attention: "Publish?" }),
      row({ status: "running" }),
      row({ status: "failed", error: "engine" }),
      row({ status: "completed", goalStatus: "needs-input" }),
      row({ status: "failed", autoPausedAfter: 5 }),
      { kind: "text", text: "hello" },
    ];
    for (const message of kept) expect(routineRunRowOutOfChat(message), JSON.stringify(message)).toBe(false);
  });
});

describe("#4201: the two cards of a teammate's run_routine hop leave the chat together", () => {
  const row = (routineRun: Record<string, unknown>) => ({ kind: "routine.run", routineRun: { routineId: "x", routineName: "X", ...routineRun } });
  it("the first pass with problems leaves with the count that names it, a lone first card stays", () => {
    // the owner's capture: "Completed with problems", then "2 runs with problems since"
    const first = row({ runId: "r1", status: "completed", problems: "x", startedBy: "person" });
    const second = row({ runId: "r2", status: "completed", problems: "x", startedBy: "person", repeat: { firstRunId: "r1", count: 2, since: 1, lastAt: 2 } });
    const transcript = [first, second];
    const counted = routineRunsCounted(transcript);
    expect(transcript.filter((message) => !routineRunRowOutOfChat(message, counted))).toEqual([]);
    // a run the person started that no count names is theirs and stays
    const own = row({ runId: "r3", status: "completed", problems: "x", startedBy: "person" });
    expect(routineRunRowOutOfChat(own, routineRunsCounted([own, second]))).toBe(false);
    // the streak's one summary names its first run too; that run is not left out for it
    const summary = row({ runId: "r4", status: "completed", problems: "x", repeat: { firstRunId: "r3", count: 3, since: 1, lastAt: 2, streak: true } });
    expect(routineRunRowOutOfChat(own, routineRunsCounted([own, summary]))).toBe(false);
  });
  it("a person's Run now stays when a later pass with items for them names it in its count", () => {
    // Run now ended with problems; the next scheduled pass has problems and items for the person
    const mine = row({ runId: "r1", status: "completed", problems: "x", startedBy: "person" });
    const itemsRow = {
      kind: "routine.run",
      attention: { kind: "human", items: [{ text: "decide" }] },
      routineRun: { routineId: "x", routineName: "X", runId: "r2", status: "completed", problems: "x", repeat: { firstRunId: "r1", count: 2, since: 1, lastAt: 2 } },
    };
    const transcript = [mine, itemsRow];
    const counted = routineRunsCounted(transcript);
    expect(counted.has("r1")).toBe(false);
    expect(transcript.filter((message) => !routineRunRowOutOfChat(message, counted))).toEqual(transcript);
  });
});

describe("routineRunRowInEveryChat (#4051): a row rings only where every desktop in use draws it", () => {
  const row = (routineRun: Record<string, unknown>, attention?: true) => ({ kind: "routine.run", ...(attention ? { attention } : {}), routineRun });
  it("a wake's answer of a topic the 0.8.92 desktop leaves out is drawn here and rings nowhere", () => {
    for (const wakeTopic of ["screen", "bot", "sms", "run"]) {
      const answer = row({ status: "completed", wakeTopic, forPerson: true });
      expect(routineRunRowOutOfChat(answer)).toBe(false);
      expect(routineRunRowInEveryChat(answer)).toBe(false);
      // items for the person are drawn by every desktop
      expect(routineRunRowInEveryChat(row({ status: "completed", wakeTopic, forPerson: true }, true))).toBe(true);
    }
  });
  it("what every desktop draws rings; what this one leaves out rings nowhere", () => {
    expect(routineRunRowInEveryChat(row({ status: "completed", wakeTopic: "watch", forPerson: true }))).toBe(true);
    expect(routineRunRowInEveryChat(row({ status: "completed", wakeTopic: "suggestion", forPerson: true }))).toBe(true);
    expect(routineRunRowInEveryChat(row({ status: "completed" }))).toBe(true);
    expect(routineRunRowInEveryChat(row({ status: "waiting", wakeTopic: "screen" }))).toBe(true);
    expect(routineRunRowInEveryChat(row({ status: "completed", wakeTopic: "watch" }))).toBe(false);
    expect(routineRunRowInEveryChat(row({ status: "cancelled" }))).toBe(false);
  });
});
