import { describe, expect, it } from "vitest";
import { bottomsOf, fitRows, moreKind } from "./record-card-fit";

// rows 18px tall, 4px apart, the first at the pane's top padding (8px); the
// "N more" line takes 22px at the foot
const rows = (count: number) => bottomsOf(Array.from({ length: count }, () => 18), 4, 8);
const room = (height: number) => ({ full: height - 8, partial: height - 22 });

describe("fitRows", () => {
  it("shows everything when everything fits, and reserves nothing", () => {
    expect(fitRows({ bottoms: rows(3), ...room(100) })).toBe(3);
    // the last row ends exactly at the limit
    expect(fitRows({ bottoms: [92], full: 92, partial: 78 })).toBe(1);
  });

  it("drops the rows that do not fit, and keeps room for the line when it drops one", () => {
    // 4 rows end at 26, 48, 70, 92; the pane's limit is 84: the fourth does not fit
    // and the line takes room: the third (70) is over 100 - 22 = 78? no, it fits
    expect(fitRows({ bottoms: rows(4), full: 84, partial: 78 })).toBe(3);
    // the line's room pushes one more row out: partial 60 keeps only two
    expect(fitRows({ bottoms: rows(4), full: 84, partial: 60 })).toBe(2);
  });

  it("counts rows, not nodes: twelve fields in a short pane", () => {
    const twelve = rows(12);
    const shown = fitRows({ bottoms: twelve, ...room(120) });
    expect(shown).toBe(4); // bottoms 26, 48, 70, 92 end at or above 98; the fifth ends at 114
    expect(twelve.length - shown).toBe(8);
  });

  it("shows no row at all in a pane too short for the first one", () => {
    expect(fitRows({ bottoms: rows(3), ...room(20) })).toBe(0);
    expect(fitRows({ bottoms: [], ...room(100) })).toBe(0);
  });

  it("never shows a row that ends below the limit it was given", () => {
    for (let height = 0; height < 160; height += 7) {
      const bottoms = rows(9);
      const shown = fitRows({ bottoms, ...room(height) });
      if (shown === bottoms.length) expect(bottoms.at(-1)).toBeLessThanOrEqual(height - 8);
      else if (shown > 0) expect(bottoms[shown - 1]).toBeLessThanOrEqual(height - 22);
    }
  });
});

describe("moreKind", () => {
  it("says fields when only key fields were left out, rows otherwise", () => {
    expect(moreKind(["f-field-2", "f-field-3"])).toBe("field");
    expect(moreKind(["f-due", "f-field-0"])).toBe("row");
    expect(moreKind(["n-1"])).toBe("row");
    expect(moreKind([])).toBe("row");
  });
});
