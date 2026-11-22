// #5171: one helper says whether the tab is visible. The browser panel and
// the organization computer tab used to keep a private copy of it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("page visibility is one helper (#5171)", () => {
  it("BrowserPanel and OrgComputerTab import the shared hook and keep no private copy", () => {
    const browser = source("../components/BrowserPanel.tsx");
    const computer = source("../components/computer/OrgComputerTab.tsx");
    for (const text of [browser, computer]) {
      expect(text).not.toMatch(/function usePageVisible/);
      expect(text).toContain('from "@/lib/page-visible"');
    }
  });
});
