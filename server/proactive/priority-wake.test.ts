import { describe, expect, it } from "vitest";

import {
  PRIORITY_DOWNGRADED_NOTE, PRIORITY_NOW_PER_HOUR, admitPriorityNow, parseWakePriority, planPriorityWake,
  releasePriorityNow, resetPriorityWakeForTests, wakeSenderId,
} from "./priority-wake.ts";

const HOUR_MS = 3_600_000;
const T0 = 1_700_000_000_000;

describe("priority wake", () => {
  it("reads now, normal, an omitted value and anything else", () => {
    expect(parseWakePriority(undefined)).toBe("absent");
    expect(parseWakePriority(null)).toBe("absent");
    expect(parseWakePriority("")).toBe("absent");
    expect(parseWakePriority("now")).toBe("now");
    expect(parseWakePriority("normal")).toBe("normal");
    expect(parseWakePriority("urgent")).toBe("invalid");
    expect(parseWakePriority(1)).toBe("invalid");
  });

  it("names a bot by its id and a person apart from a bot with the same id", () => {
    expect(wakeSenderId({ kind: "bot", id: "alpha" })).toBe("alpha");
    expect(wakeSenderId({ kind: "person", id: "alpha" })).toBe("person:alpha");
  });

  it("admits ten now-sends in an hour and refuses the eleventh without counting it", () => {
    resetPriorityWakeForTests();
    for (let n = 0; n < PRIORITY_NOW_PER_HOUR; n++) expect(admitPriorityNow("sender-a", T0 + n)).toBe(true);
    expect(admitPriorityNow("sender-a", T0 + PRIORITY_NOW_PER_HOUR)).toBe(false);
    expect(admitPriorityNow("sender-b", T0)).toBe(true);
    releasePriorityNow("sender-a");
    expect(admitPriorityNow("sender-a", T0 + PRIORITY_NOW_PER_HOUR)).toBe(true);
  });

  it("forgets stamps once the hour has passed", () => {
    resetPriorityWakeForTests();
    for (let n = 0; n < PRIORITY_NOW_PER_HOUR; n++) admitPriorityNow("sender-c", T0);
    expect(admitPriorityNow("sender-c", T0 + HOUR_MS - 1)).toBe(false);
    expect(admitPriorityNow("sender-c", T0 + HOUR_MS)).toBe(true);
  });

  it("wakes an idle recipient, queues in front when busy, and never spends a slot it should not", () => {
    resetPriorityWakeForTests();
    const base = { asked: "now" as const, applies: true, needsApproval: false, senderId: "sender-d", now: T0 };
    expect(planPriorityWake({ ...base, slotFree: true })).toMatchObject({ reported: "now", wakeNow: true, queueFront: false, downgraded: false });
    expect(planPriorityWake({ ...base, slotFree: false, now: T0 + 1 })).toMatchObject({ reported: "now", wakeNow: false, queueFront: true });
    expect(planPriorityWake({ ...base, slotFree: true, needsApproval: true, now: T0 + 2 })).toMatchObject({
      reported: "normal", wakeNow: false, queueFront: false, downgraded: false,
    });
    expect(planPriorityWake({ ...base, slotFree: true, applies: false, now: T0 + 3 })).toMatchObject({ reported: null, wakeNow: false });
    expect(planPriorityWake({ ...base, asked: "absent", slotFree: true })).toMatchObject({ reported: null });
    expect(planPriorityWake({ ...base, asked: "normal", slotFree: false })).toMatchObject({ reported: "normal", queueFront: false, wakeNow: false });
    // Approval and a send the flag does not apply to did not consume the cap,
    // so eight more now-sends still fit after the two admitted above.
    for (let n = 0; n < 8; n++) {
      expect(planPriorityWake({ ...base, slotFree: true, now: T0 + 10 + n }).reported).toBe("now");
    }
    const over = planPriorityWake({ ...base, slotFree: true, now: T0 + 30 });
    expect(over).toMatchObject({ reported: "normal", downgraded: true, wakeNow: false, queueFront: false, note: PRIORITY_DOWNGRADED_NOTE });
  });
});
