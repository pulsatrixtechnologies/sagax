import { describe, expect, it } from "vitest";

import { formatRoutinePage, pageRoutines, routinePageRequest, ROUTINE_PAGE_BUDGET } from "./routine-listing.ts";

// A routine as the internal listing gave it whole before 2026-10-29: long
// instructions and a long last output.
function fullRoutine(n: number) {
  return {
    id: `routine-${String(n).padStart(2, "0")}`,
    name: `Report ${n}`,
    instructions: `Check the queue number ${n} and write the summary. `.repeat(60).slice(0, 2_000),
    instructionsTruncated: true,
    enabled: n % 3 !== 0,
    schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/Toronto" },
    nextRunAt: "2026-10-30T13:00:00.000Z",
    failureStreak: 0,
    latestRun: { id: `run-${n}`, status: "succeeded", startedAt: "2026-10-29T13:00:00.000Z", finishedAt: "2026-10-29T13:02:00.000Z", output: "x".repeat(1_000), error: null },
  };
}

describe("routine pages (a bot read back 3 of its 23 routines, 2026-10-29)", () => {
  it("regression: every one of 23 routines is read back, page by page, and no page is cut", () => {
    const all = Array.from({ length: 23 }, (_, index) => fullRoutine(index + 1));
    // the old answer: every routine whole, indented, over the 24,000 a result keeps whole
    expect(JSON.stringify(all, null, 2).length).toBeGreaterThan(24_000);
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page = pageRoutines(all, { offset });
      const text = formatRoutinePage(page, { now: "now", timeZone: "UTC", readOne: "read one", next: "offset {offset}" });
      expect(text.length).toBeLessThan(ROUTINE_PAGE_BUDGET + 600);
      expect(page.total).toBe(23);
      seen.push(...page.routines.map((row) => row.id));
      offset = page.nextOffset;
      pages += 1;
      expect(pages).toBeLessThan(10);
    }
    expect(seen).toEqual(all.map((routine) => routine.id));
  });

  it("says how many there are and where the next page starts; a row keeps the instructions' first words", () => {
    const all = Array.from({ length: 23 }, (_, index) => fullRoutine(index + 1));
    const page = pageRoutines(all, { limit: 5 });
    expect(page).toMatchObject({ total: 23, offset: 0, nextOffset: 5 });
    expect(page.routines[0]!.instructions.length).toBeLessThanOrEqual(141);
    expect(page.routines[0]).toMatchObject({ id: "routine-01", latestRun: { status: "succeeded", at: "2026-10-29T13:02:00.000Z" } });
    const text = formatRoutinePage(page, { now: "now", timeZone: "UTC", readOne: "read one", next: "call with offset {offset}" });
    expect(text).toMatch(/routines 1 to 5 of 23/);
    expect(text).toMatch(/18 more: call with offset 5/);
    const last = pageRoutines(all, { offset: 20, limit: 5 });
    expect(last.nextOffset).toBeNull();
    expect(formatRoutinePage(last, { now: "n", timeZone: "UTC", readOne: "r", next: "o" })).toMatch(/That is all of them/);
  });

  it("reads the Automations shape too (prompt, a time in ms), a folder, and clamps the request", () => {
    const page = pageRoutines([{ id: "a", name: "A", prompt: "hello", enabled: false, nextRunAt: 0, folder: "Home" }, { id: "b", name: "B", prompt: "x" }], { folder: "Home" });
    expect(page.routines).toEqual([expect.objectContaining({ id: "a", instructions: "hello", enabled: false, folder: "Home", nextRunAt: "1970-01-01T00:00:00.000Z" })]);
    expect(routinePageRequest({ offset: -3, limit: 1000 })).toEqual({ offset: 0, limit: 100 });
    expect(routinePageRequest({ offset: "4", limit: "2" })).toEqual({ offset: 4, limit: 2 });
    expect(formatRoutinePage(pageRoutines([], {}), { now: "n", timeZone: "UTC", readOne: "r", next: "o" })).toMatch(/has no routines/);
  });

  it("keeps an owned webhook id on the short row so list_routines can load by either id (#1891)", () => {
    const page = pageRoutines([{
      id: "voice-routine",
      name: "Voice line requests from JC",
      prompt: "Handle the request",
      enabled: false,
      schedule: { type: "webhook" },
      webhookId: "9fe3376c-7c0c-4a19-9a8d-5475c52ebf8f",
    }], {});
    expect(page.routines[0]).toMatchObject({
      id: "voice-routine",
      webhookId: "9fe3376c-7c0c-4a19-9a8d-5475c52ebf8f",
      enabled: false,
    });
  });
});
