import { describe, expect, it } from "vitest";
import { reduceBots } from "./reduce-bots";
import { initialState } from "./model";

describe("select another bot", () => {
  it("closes an open routine run exchange", () => {
    const state = { ...initialState, selectedId: "bot-a", routineRunSheet: { runId: "run-1" } } as typeof initialState;
    const next = reduceBots(state, { type: "select", id: "bot-b" } as never, (s) => s);
    expect(next?.routineRunSheet ?? null).toBeNull();
  });
  it("keeps it when the same bot is selected again", () => {
    const state = { ...initialState, selectedId: "bot-a", routineRunSheet: { runId: "run-1" } } as typeof initialState;
    const next = reduceBots(state, { type: "select", id: "bot-a" } as never, (s) => s);
    expect(next?.routineRunSheet).toEqual({ runId: "run-1" });
  });
});
