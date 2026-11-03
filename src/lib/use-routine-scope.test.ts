// 2026-11-02 (calendar performance): the scoped listing is read again after
// every live frame; equal records must keep their identity so the calendar
// does not redraw.
import { describe, expect, it } from "vitest";
import { shareListing } from "./use-routine-scope";

const info = { scope: "mine", allowed: { mine: true, team: true, all: true }, facets: { teams: [], owners: [], botChoices: [] } } as never;
const listing = (name: string, status: string) => ({
  search: "scope=mine",
  routines: JSON.parse(JSON.stringify([{ id: "r1", name }, { id: "r2", name: "Other" }])),
  runs: JSON.parse(JSON.stringify([{ id: "x1", routineId: "r1", status }])),
  info: JSON.parse(JSON.stringify(info)),
});

describe("shareListing", () => {
  it("returns the previous listing when the new one reads the same", () => {
    const before = listing("Digest", "running");
    expect(shareListing(before, listing("Digest", "running"))).toBe(before);
  });

  it("keeps the unchanged records and takes the changed ones", () => {
    const before = listing("Digest", "running");
    const next = shareListing(before, listing("Digest", "completed"));
    expect(next).not.toBe(before);
    expect(next.routines).toBe(before.routines);
    expect(next.runs[0]).not.toBe(before.runs[0]);
    expect(next.runs[0]!.status).toBe("completed");

    const renamed = shareListing(before, listing("Renamed", "running"));
    expect(renamed.routines[0]!.name).toBe("Renamed");
    expect(renamed.routines[1]).toBe(before.routines[1]);
  });

  it("takes a listing for another scope as it is", () => {
    const before = listing("Digest", "running");
    const other = { ...listing("Digest", "running"), search: "scope=all" };
    expect(shareListing(before, other)).toBe(other);
  });
});
