import { describe, expect, it } from "vitest";
import { continueListOnEnter } from "./composer-list-continue";

describe("continueListOnEnter (#5409)", () => {
  it("continues a numbered list and leaves an empty item", () => {
    expect(continueListOnEnter("1. allo\n2. Test\n3. Something", 28)).toEqual({
      value: "1. allo\n2. Test\n3. Something\n4. ",
      caret: 32,
    });
    expect(continueListOnEnter("1. allo\n2. ", 11)).toEqual({ value: "1. allo\n", caret: 8 });
  });

  it("continues a bullet list and leaves an empty item", () => {
    expect(continueListOnEnter("- one\n- two", 11)).toEqual({ value: "- one\n- two\n- ", caret: 14 });
    expect(continueListOnEnter("* one\n* ", 8)).toEqual({ value: "* one\n", caret: 6 });
  });

  it("keeps the indent and does nothing off a list line", () => {
    expect(continueListOnEnter("  1. nested", 11)).toEqual({ value: "  1. nested\n  2. ", caret: 17 });
    expect(continueListOnEnter("plain", 5)).toBeNull();
    expect(continueListOnEnter("1.not a list", 12)).toBeNull();
  });
});
