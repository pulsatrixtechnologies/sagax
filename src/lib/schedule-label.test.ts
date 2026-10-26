import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { cronScheduleLabel } from "../../shared/cron-label";
import { intervalLabel, scheduleLabel, scheduleSentence, whenLabel } from "./schedule-label";

describe("schedule labels", () => {
  it.each([
    ["0 9 1 * *", "Monthly on day 1 at 09:00"],
    ["30 8 L * *", "Monthly on the last day at 08:30"],
    ["0 9 1 1 *", "Yearly on January 1 at 09:00"],
    ["0 9 * * 1#2", "Monthly on the second Monday at 09:00"],
    ["0 9 * * 1-5", "Every weekday at 09:00"],
    ["0 9 1 * 1", "Cron 0 9 1 * 1"],
    ["*/15 9-17 * * 1-5", "Weekdays, 9 AM to 5 PM, every 15 minutes"],
    ["0 9 1,15 * 1", "Cron 0 9 1,15 * 1"],
  ])("labels %s without inventing a meaning for arbitrary expressions", (expression, description) => {
    const schedule = { type: "cron" as const, expression, timeZone: "Asia/Kolkata" };
    expect(scheduleLabel(schedule)).toBe(`${description} · Asia/Kolkata`);
    expect(scheduleSentence(schedule)).toBe(`${description} · Asia/Kolkata`);
  });
  it("keeps interval restrictions in both compact labels and prose", () => {
    const schedule = { type: "interval" as const, everyMinutes: 5, anchorAt: 0,
      weekdays: [1, 2, 3, 4, 5], window: { start: "09:00", end: "17:00" },
      endsAt: new Date(2026, 8, 30, 23, 59).getTime() };
    for (const label of [scheduleLabel(schedule), scheduleSentence(schedule)]) {
      expect(label).toContain("weekdays");
      expect(label).toContain("until");
      expect(label).toContain("2026");
    }
  });
  it("names intervals", () => {
    expect(intervalLabel(5)).toBe("Every 5 min");
    expect(intervalLabel(60)).toBe("Every hour");
    expect(intervalLabel(120)).toBe("Every 2 hr");
    expect(intervalLabel(90)).toBe("Every 1 hr 30 min");
  });

  it("writes schedules as prose", () => {
    expect(scheduleSentence({ type: "interval", everyMinutes: 5, anchorAt: 0 })).toBe("every 5 minutes");
    expect(scheduleSentence({ type: "interval", everyMinutes: 60, anchorAt: 0 })).toBe("every hour");
    expect(scheduleSentence({ type: "interval", everyMinutes: 120, anchorAt: 0 })).toBe("every 2 hours");
    expect(scheduleSentence({ type: "interval", everyMinutes: 90, anchorAt: 0 })).toBe("every 1 hour 30 minutes");
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] })).toMatch(/^every weekday at /);
    const flexible = {
      type: "daily" as const,
      time: "09:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      timing: "flexible" as const,
      windowEarlyMinutes: 15,
      windowLateMinutes: 0,
    };
    expect(scheduleLabel(flexible)).toMatch(/Every day around .+ \(-15\/\+0 min\)/);
    expect(scheduleSentence(flexible)).toMatch(/every day around .+ \(-15\/\+0 min\)/);
    expect(scheduleLabel({ type: "interval", everyMinutes: 30, anchorAt: 0, timing: "flexible", windowEarlyMinutes: 5, windowLateMinutes: 10 }))
      .toContain("around the time (-5/+10 min)");
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toMatch(/^every day at /);
    expect(scheduleSentence({ type: "daily", time: "09:00", weekdays: [3] })).toMatch(/^weekly on Wed at /);
    expect(scheduleSentence({ type: "once", at: Date.UTC(2026, 8, 5, 12) })).toMatch(/^once on /);
  });

  it("labels a change by time today and by date otherwise", () => {
    const now = Date.now();
    expect(whenLabel(now)).toBe(new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    const lastYear = new Date(now);
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    expect(whenLabel(lastYear.getTime())).toBe(
      lastYear.toLocaleDateString([], { month: "short", day: "numeric" }),
    );
  });
});

const TABLE: Array<[string, string, string]> = [
  ["0,17,20,40 8-18 * * 1-5", "Weekdays, 8 AM to 6 PM, at :00, :17, :20 and :40", "Du lundi au vendredi, de 8 h à 18 h, à :00, :17, :20 et :40"],
  ["15,45 * * * *", "Every hour at :15 and :45", "Toutes les heures à :15 et :45"],
  ["*/15 * * * *", "Every 15 minutes", "Toutes les 15 minutes"],
  ["* * * * *", "Every minute", "Chaque minute"],
  ["*/10 8-17 * * MON-FRI", "Weekdays, 8 AM to 5 PM, every 10 minutes", "Du lundi au vendredi, de 8 h à 17 h, toutes les 10 minutes"],
  ["0 */2 * * *", "Every 2 hours", "Toutes les 2 heures"],
  ["30 8-18/2 * * 1-5", "Weekdays, every 2 hours, 8 AM to 6 PM, at :30", "Du lundi au vendredi, toutes les 2 heures, de 8 h à 18 h, à :30"],
  ["0 9,17 * * 1,3,5", "Monday, Wednesday and Friday, at 9:00 AM and 5:00 PM", "Les lundis, mercredis et vendredis, à 9 h 00 et 17 h 00"],
  ["0 8 * * 6,0", "Weekends, at 8:00 AM", "Les fins de semaine, à 8 h 00"],
  ["0 8 * * 5-7", "Friday to Sunday, at 8:00 AM", "Du vendredi au dimanche, à 8 h 00"],
  ["0 8 * * MON", "Mondays, at 8:00 AM", "Le lundi, à 8 h 00"],
  ["0 12 1,15 * *", "On the 1st and 15th, at 12:00 PM", "Le 1er et 15 du mois, à 12 h 00"],
  ["0 9 * 1,4,7,10 1-5", "Weekdays, in January, April, July and October, at 9:00 AM", "Du lundi au vendredi, en janvier, avril, juillet et octobre, à 9 h 00"],
  ["0 9 * jun-aug *", "In June, July and August, at 9:00 AM", "En juin, juillet et août, à 9 h 00"],
  ["0 0 * * *", "Every day at 00:00", "Tous les jours à 0 h 00"],
  ["0 9 * * 1-5", "Every weekday at 09:00", "Du lundi au vendredi à 9 h 00"],
  ["30 8 L * *", "Monthly on the last day at 08:30", "Le dernier jour du mois à 8 h 30"],
  ["0 9 * * 1#2", "Monthly on the second Monday at 09:00", "Le deuxième lundi du mois à 9 h 00"],
  ["0 9 1 1 *", "Yearly on January 1 at 09:00", "Chaque année, le 1er janvier, à 9 h 00"],
  ["0 9 1 * 1", "Cron 0 9 1 * 1", "Cron 0 9 1 * 1"],
  ["0 9 ? * 1", "Cron 0 9 ? * 1", "Cron 0 9 ? * 1"],
  ["*/15 8,12 * * *", "Cron */15 8,12 * * *", "Cron */15 8,12 * * *"],
  ["61 9 * * *", "Cron 61 9 * * *", "Cron 61 9 * * *"],
  ["0 9 * *", "Cron 0 9 * *", "Cron 0 9 * *"],
];

describe("cron wording in French and English", () => {
  it.each(TABLE)("%s", (expression, en, fr) => {
    const schedule = { type: "cron" as const, expression, timeZone: "America/Toronto" };
    expect(cronScheduleLabel(schedule, "en")).toBe(`${en} · America/Toronto`);
    expect(cronScheduleLabel(schedule, "fr")).toBe(`${fr} · America/Toronto`);
  });

  it("follows the app language in the task and list labels", () => {
    const schedule = { type: "cron" as const, expression: "0,17,20,40 8-18 * * 1-5", timeZone: "America/Toronto" };
    try {
      setLocale("fr-CA");
      expect(scheduleLabel(schedule)).toBe("Du lundi au vendredi, de 8 h à 18 h, à :00, :17, :20 et :40 · America/Toronto");
      setLocale("en");
      expect(scheduleLabel(schedule)).toBe("Weekdays, 8 AM to 6 PM, at :00, :17, :20 and :40 · America/Toronto");
    } finally {
      setLocale("en");
    }
  });
});
