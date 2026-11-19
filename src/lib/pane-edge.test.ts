// The edge between two panes is one token (M-20261119-027): the reference's
// tertiary translucent border, 8% of the ink, never a per-element colour and
// never the 16% solid sidebar hairline that read too light next to the head's
// round buttons.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = read("../styles.css");
const sidebar = read("../components/Sidebar.tsx");

describe("pane edge token", () => {
  it("is 8% of the ink, for the content and for the rail", () => {
    expect(styles).toContain("--color-pane-edge: color-mix(in srgb, var(--color-ink) 8%, transparent);");
    expect(styles).toContain("--color-sidebar-pane-edge: color-mix(in srgb, var(--color-sidebar-ink) 8%, transparent);");
  });
  it("paints the rail's edge, not the solid sidebar hairline", () => {
    expect(sidebar).toContain("border-r border-sidebar-pane-edge bg-sidebar");
    expect(sidebar).not.toContain("border-r border-sidebar-hairline");
  });
  it("paints every docked panel's left edge", () => {
    for (const f of ["PersonPanel", "SideThreadPanel", "BotSettingsDialog", "ScreenPanel", "GroupPanel", "DetailPanel", "ActivityPanel", "InspectorPanel"]) {
      expect(read(`../components/${f}.tsx`), f).toContain("border-pane-edge");
    }
  });
  it("high contrast still draws the strong edge", () => {
    expect(styles).toMatch(/:root\[data-contrast="high"\] aside\[data-sidebar-surface\] \{\n  border-color: var\(--color-sidebar-hairline\);/);
  });
});
