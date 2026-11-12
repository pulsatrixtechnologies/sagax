// #3584: the shared UTF-8 slicer (workspace_read and a page source read).
import { describe, expect, it } from "vitest";

import { utf8Slice } from "./utf8-slice.ts";

/** Follow `end` from offset 0 to the last byte. */
function walk(bytes: Uint8Array, limit: number) {
  const slices: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset < bytes.length) {
    const slice = utf8Slice(bytes, offset, limit);
    slices.push(slice);
    expect(slice.end).toBeGreaterThan(slice.start);
    offset = slice.end;
    expect(slices.length).toBeLessThanOrEqual(bytes.length);
  }
  return slices;
}

describe("utf8Slice", () => {
  it("moves an offset inside a character to the next character", () => {
    const bytes = Buffer.from("a\u00e9\u6f22\u{1f600}b", "utf8"); // 1, 2, 3, 4 and 1 bytes
    expect(utf8Slice(bytes, 2, 100)).toEqual({ start: 3, end: bytes.length });
    expect(utf8Slice(bytes, 4, 100).start).toBe(6);
    expect(utf8Slice(bytes, 5, 100).start).toBe(6);
    for (const offset of [7, 8, 9]) expect(utf8Slice(bytes, offset, 100).start).toBe(10);
  });

  it("never cuts a character and gives at least one", () => {
    const bytes = Buffer.from("\u{1f600}\u{1f600}", "utf8");
    expect(utf8Slice(bytes, 0, 1)).toEqual({ start: 0, end: 4 });
    expect(utf8Slice(bytes, 0, 6)).toEqual({ start: 0, end: 4 });
    expect(utf8Slice(bytes, 4, 6)).toEqual({ start: 4, end: 8 });
  });

  it("on bytes that are not UTF-8: offset 0 keeps the leading bytes and slices concatenate to the whole", () => {
    // continuation bytes with no lead byte, then a lead byte followed by a long run of them
    const bytes = Uint8Array.from([0x80, 0xbf, 0x80, 0x41, 0xe2, ...Array.from({ length: 40 }, () => 0x80), 0x42, 0xff, 0xfe]);
    expect(utf8Slice(bytes, 0, 10).start).toBe(0);
    for (const limit of [1, 2, 3, 5, 10]) {
      const slices = walk(bytes, limit);
      expect(slices[0]!.start).toBe(0);
      expect(Buffer.concat(slices.map((slice) => bytes.subarray(slice.start, slice.end)))).toEqual(Buffer.from(bytes));
      // a slice is never larger than the limit, or one character (4 bytes at most) when the limit is smaller
      for (const slice of slices) expect(slice.end - slice.start, `limit ${limit}`).toBeLessThanOrEqual(Math.max(limit, 4));
    }
  });

  it("a character cut by the end of the bytes is one unit, never past the end", () => {
    const bytes = Uint8Array.from([0x41, 0xe2, 0x80]);
    expect(utf8Slice(bytes, 2, 10)).toEqual({ start: 3, end: 3 });
    expect(utf8Slice(bytes, 1, 1)).toEqual({ start: 1, end: 3 });
    expect(Buffer.concat(walk(bytes, 1).map((slice) => bytes.subarray(slice.start, slice.end)))).toEqual(Buffer.from(bytes));
  });

  it("valid UTF-8: slices concatenate to the whole for any limit", () => {
    const text = "\ufeff<h1>\u00c9t\u00e9 \u6f22\u5b57 \u{1f600}</h1>\r\n".repeat(5);
    const bytes = Buffer.from(text, "utf8");
    for (const limit of [1, 2, 3, 4, 7, 64]) {
      const slices = walk(bytes, limit);
      expect(slices.map((slice) => bytes.subarray(slice.start, slice.end).toString("utf8")).join("")).toBe(text);
    }
  });
});
