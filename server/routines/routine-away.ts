// Routines that run only while their person is there (2026-10-16, parity
// with the reference design's "Routines paused while you were away", per routine here).
//
// A routine with `onlyWhenPresent` (the editor's "Only when I'm here"
// switch, off by default) creates no run while its person is away:
//
// - a recurring schedule skips that occurrence (no run, no catch-up burst)
//   and counts it in `awaySkips`; the next occurrence is planned as usual;
// - a one-time routine waits (its time stays due) and runs once they are
//   back, since skipping it would lose it.
//
// When the person is back, the skipped count is reported once (the routine
// frame, a notification, the banner on the Automations page) and stays on
// the routine until they dismiss it (POST /api/routines/:id/away-seen).
//
// Who is "there" (AwayVerdict): on an organization server, the routine's
// person's presence (server/presence.ts, shared/presence.ts thresholds:
// online is present, away and offline are away). On a solo server, the
// desktop or web page's own beat (POST /api/routines/away/beat, the idle
// time and the system idle state, LocalAwayTracker below). With no signal
// at all the verdict is "unknown" and the routine runs: a missing signal
// never silently stops work.
//
// Pure, apart from LocalAwayTracker's memory; covered by routine-away.test.ts.
import { PRESENCE_AWAY_AFTER_MS, PRESENCE_OFFLINE_AFTER_MS, type SystemIdleState } from "../../shared/presence.ts";

export type AwayVerdict = "present" | "away" | "unknown";

/** Runs a routine skipped while its person was away. */
export interface RoutineAwaySkips {
  count: number;
  /** The first and last skipped occurrence (scheduled times, ms). */
  firstAt: number;
  lastAt: number;
  /** Set once the person is back and the count was reported. */
  reportedAt?: number;
}

const MAX_DATE_MS = 8_640_000_000_000_000;

export function loadAwaySkips(value: unknown): RoutineAwaySkips | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { count, firstAt, lastAt, reportedAt } = value as Record<string, unknown>;
  const time = (entry: unknown) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 && entry <= MAX_DATE_MS;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || !time(firstAt) || !time(lastAt)) return undefined;
  return {
    count,
    firstAt: firstAt as number,
    lastAt: lastAt as number,
    ...(time(reportedAt) ? { reportedAt: reportedAt as number } : {}),
  };
}

/** What the scheduler does with a due routine: run it, skip this
 * occurrence (recurring, person away) or hold it until they are back
 * (one-time, person away). */
export function awayDecision(
  routine: { onlyWhenPresent?: boolean; schedule: { type: string } },
  verdict: AwayVerdict,
): "run" | "skip" | "hold" {
  if (routine.onlyWhenPresent !== true || verdict !== "away") return "run";
  return routine.schedule.type === "once" ? "hold" : "skip";
}

/** Count one more skipped occurrence. A count already reported (the person
 * came back, then left again) starts a new spell. */
export function recordAwaySkip(previous: RoutineAwaySkips | undefined, scheduledFor: number): RoutineAwaySkips {
  if (!previous || previous.reportedAt !== undefined) return { count: 1, firstAt: scheduledFor, lastAt: scheduledFor };
  return {
    count: Math.min(Number.MAX_SAFE_INTEGER, previous.count + 1),
    firstAt: Math.min(previous.firstAt, scheduledFor),
    lastAt: Math.max(previous.lastAt, scheduledFor),
  };
}

/** The skips to report now: the person is back and they were not reported yet. */
export function awayReportDue(routine: { awaySkips?: RoutineAwaySkips }, verdict: AwayVerdict): boolean {
  return Boolean(routine.awaySkips && routine.awaySkips.reportedAt === undefined && verdict === "present");
}

/** The notification line (server notifications are English, like the rest). */
export function awaySkipsDetail(name: string, skips: Pick<RoutineAwaySkips, "count">): string {
  return `${name}: ${skips.count} ${skips.count === 1 ? "run was" : "runs were"} skipped while you were away`;
}

/** Presence as the routines read it from shared/presence.ts states. */
export function verdictFromPresence(state: "online" | "away" | "offline" | undefined): AwayVerdict {
  if (state === undefined) return "unknown";
  return state === "online" ? "present" : "away";
}

/** A solo server's person, from the beats of their own pages: away when the
 * page says the computer is idle or locked, when they have not used it for
 * PRESENCE_AWAY_AFTER_MS, or when no page has beaten for
 * PRESENCE_OFFLINE_AFTER_MS. Unknown before the first beat. Memory only. */
export class LocalAwayTracker {
  private last: { at: number; idleMs: number; systemIdle: SystemIdleState } | null = null;

  beat(beat: { idleMs: number; systemIdle?: SystemIdleState }, now: number): void {
    const idleMs = Number.isFinite(beat.idleMs) ? Math.min(Math.max(0, beat.idleMs), 24 * 60 * 60_000) : 0;
    this.last = { at: now, idleMs, systemIdle: beat.systemIdle ?? "unknown" };
  }

  verdict(now: number): AwayVerdict {
    const last = this.last;
    if (!last) return "unknown";
    if (now - last.at > PRESENCE_OFFLINE_AFTER_MS) return "away";
    if (last.systemIdle === "idle" || last.systemIdle === "locked") return "away";
    return last.idleMs + Math.max(0, now - last.at) > PRESENCE_AWAY_AFTER_MS ? "away" : "present";
  }
}
