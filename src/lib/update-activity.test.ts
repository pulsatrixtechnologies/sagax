import { describe, expect, it } from "vitest";
import { workingBotCount } from "./update-activity";

describe("workingBotCount", () => {
  it("counts bots and groups with a turn or a parallel task running", () => {
    const bots = [{ busy: true }, { busy: false }, { activity: "working" }, { tasks: [{ busy: true }] }, { activity: "idle" }] as never;
    const groups = [{ working: true }, { working: false, tasks: [] }] as never;
    expect(workingBotCount({ bots, groups })).toBe(4);
    expect(workingBotCount({ bots: [], groups: [] as never })).toBe(0);
  });
});
