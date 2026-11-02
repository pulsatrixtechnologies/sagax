import { describe, expect, it } from "vitest";
import { settledChipLabel, stageLabel, stageOf } from "./waiting-chip.ts";

describe("settledChipLabel", () => {
  it("says approval only when a person allowed it", () => {
    expect(settledChipLabel("Dispatch", "approval", { behavior: "allow", source: "user" })).toBe("@Dispatch got your approval");
  });
  it("names a denial, an expiry and a cancellation for what they are", () => {
    expect(settledChipLabel("Dispatch", "approval", { behavior: "deny", source: "user" })).toBe("You declined @Dispatch's request");
    expect(settledChipLabel("Dispatch", "approval", { behavior: "deny", source: "timeout" })).toBe("@Dispatch's approval request expired");
    expect(settledChipLabel("Dispatch", "approval", { behavior: "deny", source: "system" })).toBe("@Dispatch is no longer waiting on your approval");
    expect(settledChipLabel("Dispatch", "approval", { behavior: "deny", source: "unavailable" })).toBe("@Dispatch is no longer waiting on your approval");
  });
  it("names automatic and teammate decisions", () => {
    expect(settledChipLabel("Dispatch", "approval", { behavior: "allow", source: "auto" })).toBe("@Dispatch's request was approved automatically");
    expect(settledChipLabel("Dispatch", "approval", { behavior: "deny", source: "auto" })).toBe("@Dispatch's request was declined automatically");
    expect(settledChipLabel("Dispatch", "approval", { behavior: "allow", source: "peer" })).toBe("@Dispatch's request was approved by a teammate");
  });
  it("keeps answers as answers and never claims an outcome it was not told", () => {
    expect(settledChipLabel("Sales", "answer", { behavior: "answer", source: "user" })).toBe("@Sales got your answer");
    expect(settledChipLabel("Sales", "approval")).toBe("@Sales's approval request was answered");
  });
});

describe("delegation stage labels via waiting-chip", () => {
  it("re-exports who-waits-for-what labels for the task sheet", () => {
    expect(stageOf({ status: "needs_input", question: "Go?", result: "", executions: 1 }, [])).toBe("awaiting_reply");
    expect(stageLabel("held")).toBe("Blocked: needs you");
    expect(stageLabel("to_review")).toBe("Ready for your review");
  });
});
