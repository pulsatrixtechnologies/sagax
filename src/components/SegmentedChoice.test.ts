import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SEGMENTS_PER_LINE, SegmentedChoice, segmentLines } from "./SegmentedChoice";

// M-20261119-051: seven reasoning levels were one squeezed line, the last one
// cut at the menu's edge; past four choices the control takes balanced lines
describe("the shared segmented control", () => {
  it("keeps up to four choices on one line and splits more into balanced lines", () => {
    expect(SEGMENTS_PER_LINE).toBe(4);
    expect(segmentLines([1, 2, 3]).map((line) => line.length)).toEqual([3]);
    expect(segmentLines([1, 2, 3, 4]).map((line) => line.length)).toEqual([4]);
    expect(segmentLines([1, 2, 3, 4, 5]).map((line) => line.length)).toEqual([3, 2]);
    expect(segmentLines([1, 2, 3, 4, 5, 6, 7]).map((line) => line.length)).toEqual([4, 3]);
    expect(segmentLines([1, 2, 3, 4, 5, 6, 7, 8]).map((line) => line.length)).toEqual([4, 4]);
    expect(segmentLines([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((line) => line.length)).toEqual([3, 3, 3]);
  });

  it("is a radio group with only the chosen segment in the tab order, every label whole", () => {
    const markup = renderToStaticMarkup(createElement(SegmentedChoice<string>, {
      label: "Level", value: "b", onPick: vi.fn(), fill: true,
      options: ["a", "b", "c", "d", "e", "f", "g"].map((value) => ({ value, label: value.toUpperCase(), data: { "data-level": value } })),
    }));
    expect(markup).toMatch(/^<div role="radiogroup" aria-label="Level"/);
    expect([...markup.matchAll(/role="radio"/g)]).toHaveLength(7);
    expect(markup).toMatch(/aria-checked="true" tabindex="0"[^>]*data-level="b"/);
    expect([...markup.matchAll(/tabindex="0"/g)]).toHaveLength(1);
    // two lines (4 and 3), the track's corners follow; a label never wraps or shrinks below its width
    expect([...markup.matchAll(/<div class="flex min-w-0 gap-0.5">/g)]).toHaveLength(2);
    expect(markup).toContain("rounded-xl");
    expect([...markup.matchAll(/whitespace-nowrap/g)]).toHaveLength(7);
  });
});
