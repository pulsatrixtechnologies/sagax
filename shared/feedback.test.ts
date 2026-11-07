import { describe, expect, it } from "vitest";
import { frustrationSignal, isFeedbackCommand } from "./feedback.ts";

describe("feedback command and frustration heuristic (#2618)", () => {
  it("recognizes /feedback only at the start of a message", () => {
    expect(isFeedbackCommand("/feedback")).toBe(true);
    expect(isFeedbackCommand("  /Feedback le bouton plante")).toBe(true);
    expect(isFeedbackCommand("/feedbacks")).toBe(false);
    expect(isFeedbackCommand("send /feedback")).toBe(false);
  });

  it("reads swearing, broken, shouting and repeats, and stays quiet otherwise", () => {
    expect(frustrationSignal("Tabarnak, encore")).toBe("swearing");
    expect(frustrationSignal("ça marche pas pantoute")).toBe("broken");
    expect(frustrationSignal("It still does not work")).toBe("broken");
    expect(frustrationSignal("WHY IS THIS SO SLOW AGAIN")).toBe("shouting");
    expect(frustrationSignal("show me the open tickets for today", ["Show me the open tickets for today!"])).toBe("repeat");
    expect(frustrationSignal("Merci, c'est parfait")).toBeNull();
    expect(frustrationSignal("OK")).toBeNull();
    expect(frustrationSignal("")).toBeNull();
  });
});
