import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";
import { mascotRowAnimated } from "./mascot-animate";

const queued = {};

function bot(patch: Partial<Bot> = {}): Bot {
  return { threadId: "t", busy: false, unread: false, tasks: [], ...patch } as Bot;
}

describe("mascotRowAnimated", () => {
  it("holds a resting pose when nothing is happening", () => {
    expect(mascotRowAnimated(bot(), queued, "none")).toBe(false);
    expect(mascotRowAnimated(bot(), queued, null)).toBe(false);
    expect(mascotRowAnimated(bot(), queued)).toBe(false);
  });

  it("moves for real work, an unread notice, or a motion beat", () => {
    expect(mascotRowAnimated(bot({ busy: true }), queued, "none")).toBe(true);
    expect(mascotRowAnimated(bot({ unread: true }), queued, "none")).toBe(false);
    expect(mascotRowAnimated(bot({ unread: true }), queued, "none", true)).toBe(true);
    expect(mascotRowAnimated(bot(), queued, "success")).toBe(true);
  });

  it("does not treat a wait on the person as work", () => {
    expect(mascotRowAnimated(bot({ busy: true, activity: "waiting-on-you" }), queued, "none")).toBe(false);
  });
});
