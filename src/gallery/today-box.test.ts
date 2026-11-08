import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// QA 0.8.66 #12: the Today box gallery page exists and forces the "today"
// fixtures. The pageerror check in fr and en is scripts/capture/today-box.mjs.
describe("today-box gallery page", () => {
  const dir = __dirname;
  it("html loads the tsx entry", () => {
    expect(readFileSync(join(dir, "today-box.html"), "utf8")).toContain('src="./today-box.tsx"');
  });
  it("entry forces today=1 then loads the approvals page", () => {
    const src = readFileSync(join(dir, "today-box.tsx"), "utf8");
    expect(src).toContain('params.set("today", "1")');
    expect(src).toContain('import("./approvals-page")');
  });
});
