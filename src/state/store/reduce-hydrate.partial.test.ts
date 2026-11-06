import { describe, expect, it } from "vitest";
import { reduceHydrate } from "./reduce-hydrate";
import { initialState } from "./model";
import type { Action } from "./model";

// The gallery pages answer /api/bots with an object that carries no `bots`
// (or no `groups`); the snapshot must hydrate as empty lists, not throw.
describe("reduceHydrate with a partial snapshot", () => {
  const run = (payload: Record<string, unknown>) =>
    reduceHydrate(initialState, { type: "hydrate", computerControl: {}, ...payload } as unknown as Action, (s) => s);

  it("tolerates a snapshot without bots", () => {
    const next = run({ groups: [] });
    expect(next?.bots).toEqual([]);
    expect(next?.hydrated).toBe(true);
  });
  it("tolerates a snapshot without groups", () => {
    const next = run({ bots: [] });
    expect(next?.groups).toEqual([]);
    expect(next?.hydrated).toBe(true);
  });
  it("tolerates an empty gallery payload", () => {
    expect(run({})?.hydrated).toBe(true);
  });
});
