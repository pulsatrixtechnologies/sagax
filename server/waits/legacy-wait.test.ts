import { describe, expect, it } from "vitest";
import { legacyWaitStillHeld } from "./legacy-wait.ts";

describe("legacy wait after a thread settles (#5011)", () => {
  it("does not keep the bot waiting once the work thread has closed", () => {
    expect(legacyWaitStillHeld([
      { threadId: "chat", activity: "idle" },
      { threadId: "work", activity: "waiting-on-you", closedBy: { botId: "ada" } },
    ], "work")).toBe(false);
  });

  it("keeps the wait while another open thread still needs the person", () => {
    expect(legacyWaitStillHeld([
      { threadId: "chat", activity: "waiting-on-you" },
      { threadId: "work", activity: "idle" },
    ], "work")).toBe(true);
  });
});
