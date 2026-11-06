import { afterEach, describe, expect, it } from "vitest";
import {
  resetTurnActiveProfileResolver,
  setTurnActiveProfileResolver,
  turnActiveProfileFor,
} from "./turn-active-profile.ts";

afterEach(() => resetTurnActiveProfileResolver());

describe("turnActiveProfileFor (#2258)", () => {
  it("returns the resolver's slug for the thread", () => {
    setTurnActiveProfileResolver((threadId, botId) => {
      expect(threadId).toBe("t1");
      expect(botId).toBe("b1");
      return "personal-bot";
    });
    expect(turnActiveProfileFor("t1", "b1")).toBe("personal-bot");
  });

  it("treats blank and missing as undefined so the catalog keeps the first connector", () => {
    setTurnActiveProfileResolver(() => "  ");
    expect(turnActiveProfileFor("t1")).toBeUndefined();
    resetTurnActiveProfileResolver();
    expect(turnActiveProfileFor("t1")).toBeUndefined();
    expect(turnActiveProfileFor(undefined)).toBeUndefined();
  });

  it("swallows a resolver throw", () => {
    setTurnActiveProfileResolver(() => {
      throw new Error("boom");
    });
    expect(turnActiveProfileFor("t1")).toBeUndefined();
  });
});
