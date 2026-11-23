import { describe, expect, it } from "vitest";

import { parseTemporal } from "./render.ts";

describe("parseTemporal", () => {
  it("keeps years 0 through 99 instead of mapping them onto 1900", () => {
    const yearOne = parseTemporal("0001-01-01");
    expect(yearOne).toBeInstanceOf(Date);
    expect((yearOne as Date).getFullYear()).toBe(1);
    expect((yearOne as Date).getMonth()).toBe(0);
    expect((yearOne as Date).getDate()).toBe(1);
    const early = parseTemporal("0099-12-31 00:00:00");
    expect((early as Date).getFullYear()).toBe(99);
    const leap = parseTemporal("0004-02-29");
    expect((leap as Date).getFullYear()).toBe(4);
    expect((leap as Date).getMonth()).toBe(1);
    expect((leap as Date).getDate()).toBe(29);
  });
});
