import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_INTERFACE_MODE } from "./interface-mode";

const here = dirname(fileURLToPath(import.meta.url));

// Owner, 2026-10-16: an organization member could not open Connect apps. They
// start on Simple, and the shell closed Connect apps the moment it opened in
// Simple, so the sidebar pill (shown in both modes) did nothing for them.
// Since 2026-10-16 everyone starts on Advanced; a person who chooses Simple
// must still reach Connect apps.
describe("Connect apps in Simple mode", () => {
  it("everyone, an organization member included, starts on Advanced", () => {
    expect(DEFAULT_INTERFACE_MODE).toBe("advanced");
  });

  it("the shell's Simple-mode effect never closes Connect apps", () => {
    const app = readFileSync(join(here, "../App.tsx-parts/useShellEffects.ts"), "utf8");
    const start = app.indexOf("if (advanced) return;");
    expect(start).toBeGreaterThan(-1);
    const effect = app.slice(start, app.indexOf("}, [advanced", start));
    expect(effect).toContain("toggleInspector");
    expect(effect).toContain("toggleComputer");
    expect(effect).not.toContain("togglePlugins");
  });
});
