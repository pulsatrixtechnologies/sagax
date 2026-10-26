import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_STEPS,
  firstRunInitialStep,
  firstRunStepDone,
  firstRunStepIndex,
  nextFirstRunStep,
} from "./first-run";

describe("firstRunInitialStep", () => {
  it("starts on connecting an engine when none is ready", () => {
    expect(firstRunInitialStep({ engineReady: false, botExists: false })).toBe("engine");
    expect(firstRunInitialStep({ engineReady: false, botExists: true })).toBe("engine");
  });

  it("skips the engine step and starts on the bot when an engine is already connected", () => {
    expect(firstRunInitialStep({ engineReady: true, botExists: false })).toBe("bot");
  });

  it("lands straight on the first message when an engine and a bot already exist", () => {
    expect(firstRunInitialStep({ engineReady: true, botExists: true })).toBe("message");
  });
});

describe("step order and progress", () => {
  it("is exactly three steps in a fixed order", () => {
    expect(FIRST_RUN_STEPS).toEqual(["engine", "bot", "message"]);
  });

  it("reports a one-based position through firstRunStepIndex", () => {
    expect(firstRunStepIndex("engine")).toBe(0);
    expect(firstRunStepIndex("bot")).toBe(1);
    expect(firstRunStepIndex("message")).toBe(2);
  });

  it("walks forward and stops at the last step", () => {
    expect(nextFirstRunStep("engine")).toBe("bot");
    expect(nextFirstRunStep("bot")).toBe("message");
    expect(nextFirstRunStep("message")).toBeNull();
  });
});

describe("firstRunStepDone", () => {
  it("marks the engine step done only when an engine is ready", () => {
    expect(firstRunStepDone("engine", { engineReady: true, botExists: false })).toBe(true);
    expect(firstRunStepDone("engine", { engineReady: false, botExists: false })).toBe(false);
  });

  it("marks the bot step done only when a bot already exists", () => {
    expect(firstRunStepDone("bot", { engineReady: true, botExists: true })).toBe(true);
    expect(firstRunStepDone("bot", { engineReady: true, botExists: false })).toBe(false);
  });

  it("never marks the message step done on its own", () => {
    expect(firstRunStepDone("message", { engineReady: true, botExists: true })).toBe(false);
  });
});
