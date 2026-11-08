import { describe, expect, it } from "vitest";
import { cronToScheduleModel, defaultScheduleModel, scheduleModelToCron, timeZoneCity, type ScheduleModel } from "./schedule-model";

const model = (patch: Partial<ScheduleModel>) => defaultScheduleModel(patch);
const cronOf = (value: ScheduleModel) => {
  const built = scheduleModelToCron(value);
  if (!("expression" in built)) throw new Error(built.problem);
  return built.expression;
};

describe("schedule model and cron", () => {
  it.each<[string, Partial<ScheduleModel>, string]>([
    ["hourly", { frequency: "hourly", minute: 15 }, "15 * * * *"],
    ["daily", { frequency: "daily", times: ["09:00"] }, "0 9 * * *"],
    ["daily at several times", { frequency: "daily", times: ["16:30", "08:30", "12:30"] }, "30 8,12,16 * * *"],
    ["weekdays", { frequency: "weekdays", times: ["08:30", "12:30", "16:30"] }, "30 8,12,16 * * 1-5"],
    ["certain days", { frequency: "days", times: ["07:45"], weekdays: [1, 3, 5] }, "45 7 * * 1,3,5"],
    ["weekends", { frequency: "days", times: ["10:00"], weekdays: [0, 6] }, "0 10 * * 0,6"],
    ["monthly", { frequency: "monthly", times: ["09:00"], monthDay: 15 }, "0 9 15 * *"],
    ["monthly on the last day", { frequency: "monthly", times: ["18:00"], monthDay: "last" }, "0 18 L * *"],
    ["yearly", { frequency: "yearly", times: ["09:00"], monthDay: 1, month: 7 }, "0 9 1 7 *"],
    ["free minutes on weekdays", { frequency: "weekdays", times: ["12:30", "08:15", "16:30"] }, "15 8 * * 1-5; 30 12,16 * * 1-5"],
    ["free minutes on certain days", { frequency: "days", times: ["07:45", "18:00"], weekdays: [1, 3] }, "45 7 * * 1,3; 0 18 * * 1,3"],
    ["free minutes monthly", { frequency: "monthly", times: ["09:05", "17:40"], monthDay: "last" }, "5 9 L * *; 40 17 L * *"],
    ["every 15 minutes", { frequency: "every", every: 15, unit: "minutes" }, "*/15 * * * *"],
    ["every 6 hours", { frequency: "every", every: 6, unit: "hours" }, "0 */6 * * *"],
  ])("%s round-trips", (_name, patch, expression) => {
    const value = model(patch);
    expect(cronOf(value)).toBe(expression);
    const back = cronToScheduleModel(expression)!;
    expect(back).not.toBeNull();
    expect(back.frequency).toBe(value.frequency);
    expect(cronOf(back)).toBe(expression);
  });

  it("reads the owner's weekday routine as weekdays at three times", () => {
    expect(cronToScheduleModel("30 8,12,16 * * 1-5")).toMatchObject({ frequency: "weekdays", times: ["08:30", "12:30", "16:30"] });
    expect(cronToScheduleModel("0 9 * * MON-FRI")).toMatchObject({ frequency: "weekdays", times: ["09:00"] });
    expect(cronToScheduleModel("0 9 * * 0-6")).toMatchObject({ frequency: "daily" });
    expect(cronToScheduleModel("0 9 * * 7")).toMatchObject({ frequency: "days", weekdays: [0] });
    expect(cronToScheduleModel("0 8-10 * * *")).toMatchObject({ frequency: "daily", times: ["08:00", "09:00", "10:00"] });
  });

  it("reads several expressions that differ only in their times as one model", () => {
    expect(cronToScheduleModel("15 8 * * 1-5; 30 12 * * 1-5")).toMatchObject({ frequency: "weekdays", times: ["08:15", "12:30"] });
    expect(cronToScheduleModel("15 8 * * 1-5; 30 12 * * 1,3")).toBeNull();
    expect(cronToScheduleModel("15 * * * *; 30 * * * *")).toBeNull();
  });

  it("returns null for what no model fits, so the editor keeps it under Advanced", () => {
    for (const expression of ["15 9-17/2 * * 1-5", "0 9 * * 1#2", "0 9 1 * 1", "*/7 * * * *", "0 */5 * * *", "0,30 9 * * *", "0 9 L 2 *", "0 9 1 * *  extra", "*/15 9-17 * * 1-5"]) {
      expect(cronToScheduleModel(expression), expression).toBeNull();
    }
  });

  it("names what cannot be saved", () => {
    expect(scheduleModelToCron(model({ times: [] }))).toEqual({ problem: "noTime" });
    expect(scheduleModelToCron(model({ frequency: "days", weekdays: [] }))).toEqual({ problem: "noDays" });
    expect(scheduleModelToCron(model({ times: ["25:00"] }))).toEqual({ problem: "badTime" });
    expect(scheduleModelToCron(model({ frequency: "every", every: 7 }))).toEqual({ problem: "badTime" });
    expect(scheduleModelToCron(model({ frequency: "days", weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toEqual({ expression: "0 9 * * *" });
    expect(scheduleModelToCron(model({ times: ["09:00", "09:00", "17:00"] }))).toEqual({ expression: "0 9,17 * * *" });
  });

  it("says a zone by its city", () => {
    expect(timeZoneCity("America/Toronto")).toBe("Toronto");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneCity("UTC")).toBe("UTC");
  });
});
