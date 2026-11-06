// Owner, 2026-10-08: the window must move by grabbing anywhere along the top
// strip, not only the sidebar. The three header rows (sidebar head, chat
// header, docked panel header) are drag regions; every interactive control in
// them is no-drag, or it would stop clicking. These read the sources: the
// classes and the stylesheet rule are the contract.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = read("../styles.css");
const sidebar = read("./Sidebar.tsx");
const chatView = [read("./ChatView.tsx"), read("./ChatView.tsx-parts/ChatViewHeader.tsx"), read("./ChatView.tsx-parts/ChatViewShell.tsx")].join("\n");
const groupView = read("./GroupView.tsx");
const botPanel = read("./BotSettingsDialog.tsx");
const chrome = read("../../electron/window-chrome.mjs");
const rule = (selector: string) => {
  const match = styles.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
};

describe("window drag regions", () => {
  it("the stylesheet makes the head rows drag and every control inside no-drag", () => {
    const drag = styles.match(/\.window-drag,\s*\.content-topbar,\s*\.content-topbar-strip \{\s*-webkit-app-region: drag;/);
    expect(drag).not.toBeNull();
    const noDrag = styles.match(/\.window-no-drag,[^{]*\{\s*-webkit-app-region: no-drag;/)?.[0] ?? "";
    for (const control of ["button", "a[href]", "input", "select", "textarea", "summary", "label", '[role="button"]', '[role="menuitem"]', '[role="separator"]', '[role="combobox"]', '[role="tab"]', ".app-resize-handle"]) {
      expect(noDrag, control).toContain(control);
    }
    expect(noDrag).toContain(":is(.window-drag, .content-topbar)");
    expect(rule(".window-drag")).toContain("-webkit-app-region: drag");
  });

  it("the sidebar head row is a drag region with its control groups opted out", () => {
    expect(sidebar).toMatch(/<div data-sidebar-head className="window-drag shrink-0">/);
    expect(sidebar.match(/window-no-drag/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sidebar).not.toContain("windowDragStyle");
  });

  it("the chat and group header rows are .content-topbar (a drag region) with the name chip opted out", () => {
    for (const source of [chatView, groupView]) {
      const header = source.slice(source.indexOf('"content-topbar",') - 120, source.indexOf('"content-topbar",') + 600);
      expect(header).toContain("{...headerDragProps}");
      expect(header).toContain("@container/chathead");
    }
    expect(chatView).toContain("style={headerNoDragStyle}");
    expect(chatView).toContain('<div className="content-topbar-strip" />');
  });

  it("the docked panel header row is a .content-topbar and its controls are plain buttons", () => {
    const row = botPanel.slice(botPanel.indexOf('"content-topbar relative flex h-12'));
    expect(row.slice(0, 160)).toContain("content-topbar");
    const end = row.indexOf('<div className="content-card-body');
    const header = row.slice(0, end);
    // every clickable in the row is a <button> (or the export menu, whose
    // trigger is one), so the stylesheet rule above reaches it
    expect(header).not.toMatch(/<div[^>]*onClick/);
    expect(header).not.toMatch(/<span[^>]*onClick/);
  });

  it("the macOS hidden-inset title bar and traffic lights are kept", () => {
    expect(chrome).toContain('titleBarStyle: "hiddenInset", trafficLightPosition');
    expect(chrome).toContain('{ titleBarStyle: "hidden" }');
  });

  it("the floating windows (mascot, retro assistant) do not use the head classes", () => {
    for (const path of ["./floating-bots/Balloon.tsx", "./retro-assistant/Win98.tsx"]) {
      const source = read(path);
      expect(source).not.toContain("content-topbar");
      expect(source).not.toContain("window-drag");
    }
  });
});
