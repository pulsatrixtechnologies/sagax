// 2026-11-09: the sidebar says what a waiting bot waits on.
import { describe, expect, it } from "vitest";

import { teammateWaitLine, waitingLine } from "./preview";

describe("waiting lines", () => {
  it("names the card the bot waits on", () => {
    expect(waitingLine({ waitingOn: { threadId: "t", messageId: "m", text: "Which repo should I file it in?" } })).toBe("Waiting for you: Which repo should I file it in?");
  });

  it("keeps the plain line without a card (an older server)", () => {
    expect(waitingLine({})).toBe("Waiting for you…");
  });

  it("names the awaited teammates", () => {
    expect(teammateWaitLine({ waitingOnTeammates: ["Milo", "Lina"] })).toBe("Waiting on Milo, Lina…");
    expect(teammateWaitLine({})).toBe("Waiting on a teammate…");
  });
});
