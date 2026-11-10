import { describe, expect, it } from "vitest";
import { isFeedbackCommand } from "./feedback.ts";

describe("feedback command (#2618, #3299)", () => {
  it("recognizes /feedback only at the start of a message", () => {
    expect(isFeedbackCommand("/feedback")).toBe(true);
    expect(isFeedbackCommand("  /Feedback le bouton plante")).toBe(true);
    expect(isFeedbackCommand("/feedbacks")).toBe(false);
    expect(isFeedbackCommand("send /feedback")).toBe(false);
  });
});
