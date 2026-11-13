// #4104: the one fold a card's long list uses (Access, Skills): what it shows
// folded, how many it hides, and that a row that needs the person is never hidden.
import { describe, expect, it } from "vitest";

import { foldItems } from "./ShowMoreFold";

const names = (count: number) => Array.from({ length: count }, (_, index) => `s${index + 1}`);

describe("foldItems (#4104)", () => {
  it("shows the first rows in order and hides the rest", () => {
    expect(foldItems(names(9), 4)).toEqual({ head: ["s1", "s2", "s3", "s4"], rest: ["s5", "s6", "s7", "s8", "s9"] });
  });

  it("hides nothing at or under the limit", () => {
    expect(foldItems(names(4), 4).rest).toEqual([]);
    expect(foldItems(names(2), 4)).toEqual({ head: ["s1", "s2"], rest: [] });
  });

  it("puts a row that needs the person first, never behind the fold", () => {
    const { head, rest } = foldItems(names(9), 4, (name) => name === "s7");
    expect(head).toEqual(["s7", "s1", "s2", "s3"]);
    expect(rest).toEqual(["s4", "s5", "s6", "s8", "s9"]);
  });

  it("grows the shown part when more rows need the person than the limit holds", () => {
    const keep = new Set(["s2", "s5", "s6", "s8", "s9"]);
    const { head, rest } = foldItems(names(9), 4, (name) => keep.has(name));
    expect(head).toEqual(["s2", "s5", "s6", "s8", "s9"]);
    expect(rest).toEqual(["s1", "s3", "s4", "s7"]);
  });
});
