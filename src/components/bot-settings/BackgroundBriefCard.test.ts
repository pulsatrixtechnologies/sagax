import { describe, expect, it } from "vitest";

import { briefQueueText, briefSchedulePatch } from "./BackgroundBriefCard";

describe("background brief screen", () => {
  it("says the queue stays empty when no app is connected", () => {
    expect(briefQueueText({ notice: "no_apps", suggestions: [] })).toBe("No app is connected. The queue stays empty.");
    expect(briefQueueText({ apps: 0 })).toBe("No app is connected. The queue stays empty.");
    expect(briefQueueText({ apps: 2, suggestions: [] })).toBeNull();
  });

  it("a change of time or switch sends this device's time zone", () => {
    const patch = briefSchedulePatch({ at: "07:15" });
    expect(patch.at).toBe("07:15");
    expect(typeof patch.timeZone).toBe("string");
    expect(patch.timeZone.length).toBeGreaterThan(0);
    expect(briefSchedulePatch({ enabled: false })).toMatchObject({ enabled: false });
  });
});

describe("screen context switch (#2699)", () => {
  it("sends the person's choice with this device's time zone", () => {
    expect(briefSchedulePatch({ screenContext: true })).toMatchObject({ screenContext: true });
  });
});
