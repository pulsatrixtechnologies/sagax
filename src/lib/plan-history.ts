// Plan usage history (#2757): the periods the server recorded from each
// reading of the plan windows (server/usage/plan-history.ts), grouped for
// the Usage page: one row per weekly window, its 5-hour sessions inside.
export type PlanPeriodWindow = "5-hour" | "weekly";

export interface PlanPeriod {
  account: string;
  name: string;
  driver: string;
  window: PlanPeriodWindow;
  startsAt: string;
  resetsAt: string;
  peakPercent: number;
  lastPercent: number;
  firstSeenAt: string;
  lastSeenAt: string;
  samples: number;
}

export interface PlanHistoryAccount {
  id: string;
  name: string;
  driver: string;
  plan: string | null;
}

export interface PlanHistory {
  updatedAt: string | null;
  accounts: PlanHistoryAccount[];
  periods: PlanPeriod[];
}

export interface PlanHistoryGroup {
  /** weekly: a weekly window. day: a calendar day of 5-hour sessions, for a plan without a weekly window. */
  kind: "weekly" | "day";
  key: string;
  startsAt: number;
  endsAt: number;
  /** The weekly window's own peak, or the fullest session of the day. */
  percent: number;
  current: boolean;
  sessions: PlanPeriod[];
  samples: number;
}

const DAY_MS = 86_400_000;

function localDayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** One account's periods as rows, newest first. */
export function planHistoryGroups(history: PlanHistory | null, account: string, now = Date.now()): PlanHistoryGroup[] {
  if (!history) return [];
  const mine = history.periods.filter((period) => period.account === account);
  const sessions = mine.filter((period) => period.window === "5-hour").sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt));
  const weeks = mine.filter((period) => period.window === "weekly");
  if (weeks.length > 0) {
    return weeks
      .map((week) => {
        const startsAt = Date.parse(week.startsAt);
        const endsAt = Date.parse(week.resetsAt);
        const inside = sessions.filter((session) => {
          const start = Date.parse(session.startsAt);
          return start >= startsAt && start < endsAt;
        });
        return { kind: "weekly" as const, key: `${week.account}:${week.resetsAt}`, startsAt, endsAt, percent: week.peakPercent, current: endsAt > now, sessions: inside, samples: week.samples };
      })
      .sort((left, right) => right.endsAt - left.endsAt);
  }
  const days = new Map<number, PlanPeriod[]>();
  for (const session of sessions) {
    const day = localDayStart(Date.parse(session.startsAt));
    days.set(day, [...(days.get(day) ?? []), session]);
  }
  return [...days.entries()]
    .map(([day, inside]) => ({
      kind: "day" as const,
      key: `${account}:${day}`,
      startsAt: day,
      endsAt: day + DAY_MS,
      percent: Math.max(...inside.map((session) => session.peakPercent)),
      current: inside.some((session) => Date.parse(session.resetsAt) > now),
      sessions: inside,
      samples: inside.reduce((sum, session) => sum + session.samples, 0),
    }))
    .sort((left, right) => right.endsAt - left.endsAt);
}

/** "62%", "<1%" for a share above zero that rounds to none, "0%"; `unit` writes the locale's form ("62 %" in French). */
export function formatLimitShare(percent: number, unit: (value: string) => string = (value) => `${value}%`): string {
  if (percent > 0 && percent < 0.5) return unit("<1");
  return unit(String(Math.round(Math.min(100, Math.max(0, percent)))));
}

/** The accounts that have periods, the busiest first. */
export function planHistoryAccounts(history: PlanHistory | null): PlanHistoryAccount[] {
  if (!history) return [];
  const counts = new Map<string, number>();
  for (const period of history.periods) counts.set(period.account, (counts.get(period.account) ?? 0) + 1);
  return history.accounts.filter((account) => counts.has(account.id)).sort((left, right) => (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0));
}
