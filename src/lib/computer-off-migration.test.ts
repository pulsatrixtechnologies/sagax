// Off left the Computer menu. A bot still saved on Off goes
// back to Auto when the app loads it, so its Computer card shows again.
import { describe, expect, it } from "vitest";
import { botsToLeaveComputerOff } from "./computer-off-migration";

describe("a saved Off on the Computer", () => {
  it("lists every editable bot still on Off, once", () => {
    const done = new Set<string>();
    const bots = [
      { id: "a", computer: "off" as const },
      { id: "b", computer: "local" as const },
      { id: "c" },
      { id: "d", computer: "off" as const },
    ];
    expect(botsToLeaveComputerOff(bots, null, done)).toEqual(["a", "d"]);
    expect(botsToLeaveComputerOff(bots, null, done)).toEqual([]);
  });

  it("leaves a bot this person may not edit", () => {
    const config = { viewer: { botsReadOnly: true } } as never;
    expect(botsToLeaveComputerOff([{ id: "a", computer: "off" as const, ownerUserId: "someone" }], config, new Set())).toEqual([]);
  });
});
