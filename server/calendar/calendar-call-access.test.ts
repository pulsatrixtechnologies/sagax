import { describe, expect, it } from "vitest";

import { calendarCallRefusal, visibleCalendarCalls, type CalendarCallAccess } from "./calendar-call-access.ts";
import type { CalendarCall } from "./calendar-calls.ts";

function call(id: string, botIds: string[]): CalendarCall {
  return {
    id, name: id, description: "", botIds, durationMinutes: 30, attachments: [],
    schedule: { type: "once", at: 1 }, nextRunAt: 1, createdAt: 0, updatedAt: 0,
  };
}

const member = (visible: string[], runnable = visible): CalendarCallAccess => ({
  everything: false,
  botVisible: (botId) => visible.includes(botId),
  needsRun: (botId) => !runnable.includes(botId),
});

describe("calendar call access (#1482)", () => {
  const calls = [call("mine", ["a", "b"]), call("mixed", ["a", "hidden"]), call("other", ["hidden"])];

  it("lists for a member only the calls whose bots they can all see", () => {
    expect(visibleCalendarCalls(calls, member(["a", "b"])).map((c) => c.id)).toEqual(["mine"]);
  });

  it("never lists a call on a bot the member sees but may not run: someone else's", () => {
    expect(visibleCalendarCalls(calls, member(["a", "b", "hidden"], ["a", "b"])).map((c) => c.id)).toEqual(["mine"]);
  });

  it("lists every call for an admin", () => {
    expect(visibleCalendarCalls(calls, { ...member([]), everything: true })).toHaveLength(3);
  });

  it("lets a member create, change and delete a call with their own bots", () => {
    const access = member(["a", "b"]);
    expect(calendarCallRefusal(access, null, { botIds: ["a", "b"] })).toBeNull();
    expect(calendarCallRefusal(access, calls[0]!, { name: "Renamed" })).toBeNull();
    expect(calendarCallRefusal(access, calls[0]!)).toBeNull();
  });

  it("answers a hidden bot or call like a missing one", () => {
    const access = member(["a", "b"]);
    expect(calendarCallRefusal(access, null, { botIds: ["a", "hidden"] })?.status).toBe(404);
    expect(calendarCallRefusal(access, calls[1]!)?.status).toBe(404);
  });

  it("answers a call on a bot the member sees but may not run like a missing one", () => {
    const access = member(["a", "b", "hidden"], ["a", "b"]);
    expect(calendarCallRefusal(access, calls[2]!)).toEqual({ status: 404, body: { error: "no such scheduled call" } });
    expect(calendarCallRefusal(access, calls[2]!, { name: "Renamed" })?.status).toBe(404);
  });

  it("refuses a visible bot the member may not run", () => {
    expect(calendarCallRefusal(member(["a", "b"], ["a"]), null, { botIds: ["a", "b"] })).toEqual({
      status: 403, body: { error: "you need the right to run every bot in this call", code: "needs_run" },
    });
  });

  it("never refuses an admin", () => {
    expect(calendarCallRefusal({ ...member([]), everything: true }, calls[2]!, { botIds: ["x"] })).toBeNull();
  });
});
