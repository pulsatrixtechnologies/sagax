import { describe, expect, it } from "vitest";
import { createApplyConfigHttpPatch } from "./config-http-patch.ts";

describe("createApplyConfigHttpPatch", () => {
  it("returns a function", () => {
    expect(typeof createApplyConfigHttpPatch(() => ({}))).toBe("function");
  });
});
