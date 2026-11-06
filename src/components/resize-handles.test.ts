// Every column resize handle shares `.app-resize-handle`: invisible at rest
// (the column's hairline border is the edge), a 6px hit area, and a 2px
// accent line only on hover, drag or keyboard focus.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "styles.css"), "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("resize handles", () => {
  it("are a transparent 6px col-resize hit area with no display of their own", () => {
    const base = rule(".app-resize-handle");
    expect(base).toContain("width: 6px");
    expect(base).toContain("cursor: col-resize");
    expect(base).toContain("background-color: transparent");
    expect(base).not.toMatch(/display:/);
  });

  it("draw a 2px line, transparent at rest, accent on hover, drag and focus", () => {
    const line = rule(".app-resize-handle::after");
    expect(line).toContain("width: 2px");
    expect(line).toContain("background-color: transparent");
    for (const state of [":hover::after", ":active::after", "[data-resizing]::after", ":focus-visible::after"]) {
      expect(css).toContain(`.app-resize-handle${state}`);
    }
    expect(css).toMatch(/\.app-resize-handle:focus-visible::after \{\s*background-color: color-mix\(in srgb, var\(--color-accent\)/);
    expect(rule(".app-resize-handle:focus-visible")).toContain("outline: none");
  });

  it.each(["Sidebar.tsx-parts/SidebarResizeHandle.tsx", "DockedPanelResize.tsx", "ComputerPanel.tsx-parts/PanelChrome.tsx"])(
    "%s uses the shared handle, not a bright bar of its own",
    (file) => {
      if (file.startsWith("Sidebar.tsx-parts/")) {
        // 0db3d586d extracted the separator; keep its sidebar wiring pinned.
        const sidebar = readFileSync(join(here, "Sidebar.tsx"), "utf8");
        expect(sidebar).toContain('import { SidebarResizeHandle } from "./Sidebar.tsx-parts/SidebarResizeHandle"');
        expect(sidebar).toContain("<SidebarResizeHandle");
      }
      const source = readFileSync(join(here, file), "utf8");
      const separators = source.match(/role="separator"[\s\S]*?className=("[^"]*"|\{[^}]*\})/g) ?? [];
      expect(separators.length).toBeGreaterThan(0);
      for (const separator of separators) {
        const className = /className=("[^"]*"|\{[^}]*\})$/.exec(separator)?.[1] ?? "";
        expect(className).toContain("app-resize-handle");
        expect(className).not.toMatch(/bg-accent|\bw-3\b|w-1\.5|cursor-col-resize/);
      }
    },
  );

  describe("docked right panel (bot settings, person and group)", () => {
    const read = (file: string) => readFileSync(join(here, file), "utf8");
    const shared = read("DockedPanelResize.tsx");

    it("is one 320 to 720 px column with one stored width and keyboard steps", () => {
      expect(shared).toContain('DOCKED_PANEL_WIDTH_KEY = "omb-settings-panel-width"');
      expect(shared).toContain("DOCKED_PANEL_MIN_WIDTH = 320");
      expect(shared).toContain("DOCKED_PANEL_MAX_WIDTH = 720");
      expect(shared).toContain('event.key === "ArrowLeft"');
      expect(shared).toContain("hidden lg:block");
    });

    it.each(["BotSettingsDialog.tsx", "PersonPanel.tsx", "GroupPanel.tsx"])("%s uses the shared hook and handle, with no copy of its own", (file) => {
      const source = read(file);
      expect(source).toMatch(/useDockedPanelWidth\((BOT_PANEL_BOUNDS)?\)/);
      expect(source).toContain("<DockedPanelResizeHandle");
      expect(source).toContain("style={{ width: dockedPanel.width }}");
      // Below lg the overlay must fill inset-0; `!` beats the inline width (#1662).
      expect(source).toContain("max-lg:w-auto!");
      expect(source).not.toContain('role="separator"');
      expect(source).not.toContain("omb-settings-panel-width");
    });

    it("opens the bot panel at 308 px like Grok Bot, other panels unchanged (#2141)", () => {
      expect(shared).toMatch(/BOT_PANEL_BOUNDS[^}]*key: BOT_PANEL_WIDTH_KEY,\s*min: 308,[^}]*fallback: 308/);
      expect(read("BotSettingsDialog.tsx")).toContain("useDockedPanelWidth(BOT_PANEL_BOUNDS)");
      for (const file of ["PersonPanel.tsx", "GroupPanel.tsx"]) expect(read(file)).toContain("useDockedPanelWidth()");
    });
  });
});
