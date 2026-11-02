import { describe, expect, it } from "vitest";
import { boundedLabel, containsControlCharacter, plainRecord } from "./plain.ts";

describe("plainRecord", () => {
  it("returns plain objects and rejects arrays and primitives", () => {
    expect(plainRecord({ a: 1 })).toEqual({ a: 1 });
    expect(plainRecord(null)).toBeNull();
    expect(plainRecord([1])).toBeNull();
    expect(plainRecord("x")).toBeNull();
  });
});

describe("containsControlCharacter", () => {
  it("detects ASCII controls and DEL", () => {
    expect(containsControlCharacter("ok")).toBe(false);
    expect(containsControlCharacter("bad\n")).toBe(true);
    expect(containsControlCharacter("x\u007f")).toBe(true);
  });
});

describe("boundedLabel", () => {
  it("trims and accepts short labels without controls", () => {
    expect(boundedLabel("  Fixture  ")).toBe("Fixture");
    expect(boundedLabel("")).toBeNull();
    expect(boundedLabel(12)).toBeNull();
    expect(boundedLabel("a".repeat(161))).toBeNull();
    expect(boundedLabel("bad\tlabel")).toBeNull();
  });
});
