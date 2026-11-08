import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// QA 0.8.66 #12: the Today box gallery page exists and forces the "today"
// fixtures. The pageerror and console error check in fr and en is scripts/capture/today-box.mjs.
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
  it("entry silences the live-events stream before loading the page", () => {
    const src = readFileSync(join(dir, "today-box.tsx"), "utf8");
    expect(src.indexOf("EventSource = SilentEventSource")).toBeGreaterThan(-1);
    expect(src.indexOf("EventSource = SilentEventSource")).toBeLessThan(src.indexOf('import("./approvals-page")'));
  });
  it("capture script fails on console errors too, not only pageerror", () => {
    const src = readFileSync(join(dir, "..", "..", "scripts", "capture", "today-box.mjs"), "utf8");
    expect(src).toContain('page.on("pageerror"');
    expect(src).toMatch(/page\.on\("console"[\s\S]*?message\.type\(\) !== "error"\) return;[\s\S]*?errors\.push/);
  });
  it("capture script cites its reference set so the docs-media guard keeps the PNGs", () => {
    const src = readFileSync(join(dir, "..", "..", "scripts", "capture", "today-box.mjs"), "utf8");
    expect(src).toContain("docs/screenshots/today-box");
  });
});
