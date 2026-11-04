import { describe, expect, it } from "vitest";

import { warmBotAccessRefusal } from "./thread-warm.ts";

describe("warmBotAccessRefusal (#1975)", () => {
  it("refuses a bot the person cannot use", () => {
    expect(warmBotAccessRefusal(null, { adminScope: false, orgAdmin: false })).toEqual({
      status: 404,
      body: { error: "no such bot" },
    });
  });

  it("allows use, run, edit, manage and owner", () => {
    for (const level of ["use", "run", "edit", "manage", "owner"] as const) {
      expect(warmBotAccessRefusal(level, { adminScope: false, orgAdmin: false })).toBeNull();
    }
  });

  it("allows an admin scope or org admin even without a grant", () => {
    expect(warmBotAccessRefusal(null, { adminScope: true, orgAdmin: false })).toBeNull();
    expect(warmBotAccessRefusal(null, { adminScope: false, orgAdmin: true })).toBeNull();
  });
});
