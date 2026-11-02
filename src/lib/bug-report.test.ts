import { describe, expect, it, vi } from "vitest";
import { bugReportExcerpt, openBugReport } from "./bug-report";

describe("bug report", () => {
  it("strips an address and does not open anything until the person agrees", async () => {
    expect(bugReportExcerpt("It failed for ada@example.com today")).toBe("It failed for [redacted] today");
    const open = vi.fn();
    const confirm = vi.fn(() => false);
    expect(await openBugReport({ excerpt: "The reply stopped halfway.", version: "0.8.5", confirm, open })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    expect(await openBugReport({ excerpt: "The reply stopped halfway.", version: "0.8.5", confirm, open })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]?.[0])).toContain("mailto:");
    expect(String(open.mock.calls[0]?.[0])).not.toContain("ada@");
  });
});
