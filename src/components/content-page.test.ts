// One phone margin for the full pages (Routines, Memory, Approvals): the reference's 16px gutter, measured on its
// full pages, set once in the shared header and the shared frame, never per page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("the content frame's phone margin", () => {
  const source = readFileSync(join(__dirname, "content-page.tsx"), "utf8");

  it("the shared header takes 16px at 390 for every page, the title row under the drawer button", () => {
    expect(source).toContain('"relative pl-6 max-sm:px-4 max-sm:pb-3 max-sm:pt-12"');
    expect(source).not.toContain("max-sm:pl-12");
    expect(source).toContain("max-sm:absolute max-sm:right-4 max-sm:top-2");
  });

  it("the full page body takes the same 16px", () => {
    expect(source).toContain("px-6 py-6 max-sm:px-4");
  });

  it("no page asks for its own phone gutter any more", () => {
    const routines = readFileSync(join(__dirname, "RoutineCalendarPage.tsx-parts/RoutinesPageView.tsx"), "utf8");
    expect(routines).not.toMatch(/^\s+aligned\s*$/m);
  });
});
