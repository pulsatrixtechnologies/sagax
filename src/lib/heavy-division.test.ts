// The cell division of a Heavy run (M-20261126-122), the motion alone: any
// number of experts from 2 to 8 ends as that many cells in the row's pile,
// several divide at once when many are needed, a cell loses its eyes before
// it divides, and reduced motion lands every step at once.
import { describe, expect, it } from "vitest";

import { divisionGeometry, HeavyDivisionSim } from "./heavy-division";

const SIZE = 22;
const sim = (over: Partial<ConstructorParameters<typeof HeavyDivisionSim>[0]> = {}) => new HeavyDivisionSim({ size: SIZE, random: () => 0.5, ...over });
/** Step frame by frame until nothing moves, noting what `watch` reads on the way. */
function play<T>(run: HeavyDivisionSim, watch: (run: HeavyDivisionSim) => T): T[] {
  const seen: T[] = [watch(run)];
  for (let frame = 0; frame < 60 * 30 && run.busy; frame += 1) {
    run.advance(1 / 60);
    seen.push(watch(run));
  }
  expect(run.busy).toBe(false);
  return seen;
}
const distinct = <T,>(values: T[]) => values.filter((value, index) => index === 0 || value !== values[index - 1]);

describe("the division's motion", () => {
  it("starts as the bot alone: one cell, its eyes open, in its own colour", () => {
    const run = sim();
    expect(run.cells).toHaveLength(1);
    expect(run.cells[0]).toMatchObject({ x: SIZE / 2, r: SIZE / 2, face: 1, tint: 0, expert: -1 });
    expect(run.busy).toBe(false);
    expect(run.width()).toBe(SIZE);
  });

  it.each([2, 3, 4, 5, 6, 7, 8])("divides into %i experts, each in its colour, closed up into the pile", (count) => {
    const run = sim();
    run.setCount(count);
    play(run, () => 0);
    const { x0, stack, radius } = divisionGeometry(SIZE);
    const row = run.ordered();
    expect(row).toHaveLength(count);
    expect(row.map((cell) => cell.expert)).toEqual(Array.from({ length: count }, (_, index) => index));
    row.forEach((cell, index) => {
      expect(cell.x).toBeCloseTo(x0 + stack * index, 5);
      expect(cell).toMatchObject({ r: radius, face: 1, tint: 1 });
    });
    expect(run.melt).toBe(0);
    expect(run.untinted).toBe(false);
    // the text stays against the pile: the drawing is as wide as the pile, 22 px then 16 more per expert
    expect(run.width()).toBeCloseTo(SIZE + 16 * (count - 1), 5);
  });

  it("divides several cells at once when many experts are needed", () => {
    const eight = sim();
    eight.setCount(8);
    expect(distinct(play(eight, (run) => run.cells.length))).toEqual([1, 2, 4, 8]);
    const five = sim();
    five.setCount(5);
    expect(distinct(play(five, (run) => run.cells.length))).toEqual([1, 2, 4, 5]);
  });

  it("a cell loses its eyes, divides as one membrane, and the daughters get their eyes back before their colour", () => {
    const run = sim();
    run.setCount(2);
    const seen = play(run, (now) => ({ cells: now.cells.length, face: Math.min(...now.cells.map((cell) => cell.face)), melt: now.melt, tint: Math.max(...now.cells.map((cell) => cell.tint)), gap: now.cells.length > 1 ? Math.abs(now.cells[1]!.x - now.cells[0]!.x) : 0 }));
    const born = seen.findIndex((at) => at.cells === 2);
    // the eyes are gone and the cell has melted before the daughter appears, out of the parent itself
    expect(seen[born - 1]!.face).toBeLessThan(0.3);
    expect(seen[born]!.melt).toBeGreaterThan(0.5);
    expect(seen[born]!.gap).toBeLessThan(0.5);
    // no colour before the daughters are apart with their eyes back
    const tinted = seen.findIndex((at) => at.tint > 0.01);
    expect(tinted).toBeGreaterThan(born);
    expect(seen[tinted]!.face).toBeGreaterThan(0.9);
    expect(seen[tinted]!.gap).toBeGreaterThan(SIZE * 0.8);
    // the row grows while they part, then closes up
    expect(Math.max(...seen.map((at) => at.gap))).toBeGreaterThan(divisionGeometry(SIZE).stack);
  });

  it("at the mock-up's one speed: two experts are apart after one round of 2.2 s", () => {
    const run = sim();
    run.setCount(2);
    let seconds = 0;
    while (run.cells.every((cell) => cell.expert < 0)) {
      run.advance(1 / 60);
      seconds += 1 / 60;
    }
    expect(seconds).toBeGreaterThan(2.15);
    expect(seconds).toBeLessThan(2.3);
  });

  it("under reduced motion every step lands at once", () => {
    const run = sim({ reduced: true });
    run.setCount(5);
    expect(run.busy).toBe(false);
    expect(run.ordered().map((cell) => [cell.expert, cell.tint, cell.face])).toEqual([[0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1], [4, 1, 1]]);
    expect(run.width()).toBeCloseTo(SIZE + 16 * 4, 5);
  });

  it("a finished run starts in its pile, with nothing left to play", () => {
    const run = sim({ rest: 8 });
    expect(run.busy).toBe(false);
    expect(run.ordered().map((cell) => cell.expert)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(run.untinted).toBe(false);
    run.setCount(8);
    expect(run.busy).toBe(false);
  });

  it("an expert that leaves the team closes the pile up, and a team that grows divides again", () => {
    const run = sim({ rest: 5 });
    run.setCount(4);
    play(run, () => 0);
    expect(run.ordered().map((cell) => cell.expert)).toEqual([0, 1, 2, 3]);
    expect(run.width()).toBeCloseTo(SIZE + 16 * 3, 5);
    run.setCount(6);
    play(run, () => 0);
    expect(run.ordered().map((cell) => [cell.expert, cell.tint])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
  });
});
