// Notices the chat shows once, as a passing banner, never as a row (the
// maintainer, 2026-10-26): a routine run that failed or was missed ("Routine:
// <name> · Failed · <date> · View run") and the card saying a routine could
// not run on the owner's access ("Your routine can't run: you don't have
// Claude access..."). The banner leaves on its own after a few seconds, or
// when the person closes it, and never comes back on reload. The access
// banner also leaves once the routine runs again. Nothing is lost: the
// message stays stored, the failure stays in the routine's history and the
// run's detail (View run), and in the Updates inbox.
//
// 2026-10-26: the failure that paused its routine (N failed runs in a row,
// shared/routine-auto-pause.ts) carries `routineRun.autoPausedAfter`. Its
// banner says so and offers Resume in one click (the routine back on, the
// failure count from zero); it leaves like the others, and also as soon as
// the routine is back on.
//
// #4058: the one summary of a routine's streak of problems
// (`routineRun.repeat.streak`, shared/routine-repeat.ts) is never one of
// these, even when its run failed or paused the routine: it is the row the
// chat keeps until the routine works again, and that same row then says so.
// A row of an auto-paused summary carries Resume itself.
//
// Desktop (src/components/TransientNotice.tsx) and iOS
// (ios/Sources/CompanionCore/TransientNotices.swift) read the same rule; the
// iOS copy is checked against ios/Tests/CompanionCoreTests/Fixtures/
// transient-notices.json, which shared/transient-notices.test.ts keeps in
// step with this file.

export const TRANSIENT_NOTICE_RULES = {
  /** routineRun statuses that read as a passing banner. */
  routineRunStatuses: ["failed", "missed"],
  /** Goal outcomes of a team run that read as one too. */
  routineGoalStatuses: ["failed"],
  /** How long the banner stays when nobody closes it. */
  visibleMs: 8000,
  /** A notice older than this when the chat first sees it is history, not
   * news: it never shows (a reload, a thread opened later). */
  freshMs: 120_000,
} as const;

type NoticeMessage = {
  kind: string;
  routineRun?: {
    status: string;
    goalStatus?: string | null;
    autoPausedAfter?: number | null;
    repeat?: { streak?: boolean | null } | null;
  } | null;
  access?: { routine?: boolean | null; reason?: string } | null;
};

/** #4058: the one summary of a routine's streak of problems: a row. */
export function isRoutineStreakSummary(message: NoticeMessage): boolean {
  return message.kind === "routine.run" && message.routineRun?.repeat?.streak === true;
}

/** A routine run that failed or was missed, whatever its row. */
function failedRoutineRun(message: NoticeMessage): boolean {
  const run = message.kind === "routine.run" ? message.routineRun : null;
  if (!run) return false;
  if (run.goalStatus) return (TRANSIENT_NOTICE_RULES.routineGoalStatuses as readonly string[]).includes(run.goalStatus);
  return (TRANSIENT_NOTICE_RULES.routineRunStatuses as readonly string[]).includes(run.status);
}

/** A run that paused its routine, whatever its row. */
function autoPausedRoutineRun(message: NoticeMessage): boolean {
  return message.kind === "routine.run" && (message.routineRun?.autoPausedAfter ?? 0) > 0;
}

/** A routine run that failed or was missed (not a streak's summary). */
export function isFailedRoutineRunNotice(message: NoticeMessage): boolean {
  return failedRoutineRun(message) && !isRoutineStreakSummary(message);
}

/** The failure that paused its routine: the banner offers Resume (not a
 * streak's summary, whose row offers it). */
export function isRoutineAutoPausedNotice(message: NoticeMessage): boolean {
  return autoPausedRoutineRun(message) && !isRoutineStreakSummary(message);
}

/** The card a routine leaves when its owner's access could not run it. */
export function isRoutineAccessNotice(message: NoticeMessage): boolean {
  return message.kind === "access" && message.access?.routine === true && message.access.reason !== "routine_delegation";
}

/** True for a message the chat draws as a passing banner, never as a row. */
export function isTransientChatNotice(message: NoticeMessage): boolean {
  return isFailedRoutineRunNotice(message) || isRoutineAutoPausedNotice(message) || isRoutineAccessNotice(message);
}

/** A routine access banner is settled once the same bot's routine has run
 * since: a later routine run of that bot that did not fail. */
export function routineAccessSettled(
  notice: { at: number; access?: { botId?: string } | null },
  later: ReadonlyArray<NoticeMessage & { at: number; from?: { botId?: string } | null }>,
): boolean {
  const botId = notice.access?.botId;
  return later.some((message) => message.at > notice.at && message.kind === "routine.run" && Boolean(message.routineRun)
    && !failedRoutineRun(message) && !autoPausedRoutineRun(message) && (!botId || !message.from?.botId || message.from.botId === botId));
}
