import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import { routineReadinessLine } from "./routine-readiness";

const previousZone = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  setLocale("en");
  if (previousZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousZone;
});
describe("readiness timestamps in the viewer's time zone (#1945)", () => {
  it.each(["en", "fr"])("uses short local times today and includes the date on other days in %s", (locale) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T16:00:00.000Z"));
    setLocale(locale);
    const check = { kind: "engine", ok: false, code: "engine_credits", line: "Server UTC line.", params: { engine: "Grok", at: "2026-11-04T14:30:00.000Z" } } as const;
    process.env.TZ = "America/Toronto";
    const toronto = routineReadinessLine(check);
    expect(toronto).toContain(locale === "en" ? "9:30 AM" : "9:30");
    expect(toronto).not.toMatch(/Nov|nov|2026|14:30|UTC|T14/);
    process.env.TZ = "Asia/Tokyo";
    const tokyo = routineReadinessLine(check);
    expect(tokyo).toContain(locale === "en" ? "Nov 4" : "4 nov.");
    expect(tokyo).toContain(locale === "en" ? "11:30 PM" : "23:30");
    process.env.TZ = "America/Toronto";
    const tomorrow = routineReadinessLine({ ...check, code: "engine_limit", params: { engine: "Grok", until: "2026-11-05T07:15:00.000Z" } });
    expect(tomorrow).toContain(locale === "en" ? "Nov 5" : "5 nov.");
    expect(tomorrow).toContain(locale === "en" ? "2:15 AM" : "2:15");
    expect(check.params.at).toBe("2026-11-04T14:30:00.000Z");
  });
  it("preserves labels in older runs and malformed timestamps", () => {
    for (const until of ["06:00 UTC", "2026-invalid"]) {
      expect(routineReadinessLine({ kind: "engine", ok: false, code: "engine_limit", line: "", params: { engine: "Grok", until } })).toContain(until);
    }
  });
});
