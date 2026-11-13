import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SendKey } from "@/lib/send-key";
import { SHORTCUT_GROUPS } from "@/lib/keyboard-shortcuts";

const fixture = vi.hoisted(() => ({ sendKey: "enter" as SendKey }));
vi.mock("@/lib/send-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/send-key")>(),
  useSendKey: () => fixture.sendKey,
}));

import { KeyboardShortcutsModal, shortcutSheetGroups, splitShortcutColumns } from "./KeyboardShortcutsModal";

const render = () => renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: true, onClose: vi.fn() }));

/** The keycaps drawn on a row. */
function keys(html: string, id: string): string[] {
  const row = html.slice(html.indexOf(`data-shortcut="${id}"`)).split("</li>")[0]!;
  return [...row.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map((match) => match[1]!);
}

/** The grey hint beside a row's label. */
function hint(html: string, id: string): string | undefined {
  const row = html.slice(html.indexOf(`data-shortcut="${id}"`)).split("</li>")[0]!;
  return /data-shortcut-hint="">([^<]*)</.exec(row)?.[1];
}

describe("KeyboardShortcutsModal", () => {
  it("is a labeled native dialog with a close button, no search field and no footer (#4097)", () => {
    const html = render();
    expect(html).toContain('<dialog aria-labelledby="shortcuts-dialog-title"');
    expect(html).toContain('aria-label="Close keyboard shortcuts"');
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain(">Done<");
    expect(html).toContain("max-w-[900px]");
  });

  it("lays the groups out in two columns, Essentials first (#4097)", () => {
    const html = render();
    expect(html.match(/data-shortcut-column=""/g)).toHaveLength(2);
    const order = [...html.matchAll(/data-shortcut-group="(\w+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["essentials", "chat", "navigation", "panels", "window", "calls", "management"]);
    // the left column holds at least half of the rows, as the reference splits
    const [left, right] = splitShortcutColumns(shortcutSheetGroups(SHORTCUT_GROUPS, true));
    expect(left.map((group) => group.id)).toEqual(["essentials", "chat"]);
    expect(right.map((group) => group.id)).toEqual(["navigation", "panels", "window", "calls", "management"]);
  });

  it("keeps every shortcut of the registry: new line becomes Send's grey hint", () => {
    const html = render();
    for (const item of SHORTCUT_GROUPS.flatMap((group) => group.items)) {
      // new line is Send's hint; Settings is macOS's ⌘, only
      if (item.id === "new-line" || item.id === "settings") continue;
      expect(html, item.id).toContain(`data-shortcut="${item.id}"`);
    }
    expect(hint(html, "send-message")).toBe("Shift Enter for new line");
    expect(hint(html, "dictate")).toBe("Again to stop");
    // "[ / ]" draws two caps with a grey slash between them
    expect(keys(html, "switch-bot")).toEqual(["Ctrl", "Shift", "[", "]"]);
  });

  it("lists Settings in Essentials on macOS only, before Keyboard shortcuts (#4097)", () => {
    const essentials = (isMac: boolean) => shortcutSheetGroups(SHORTCUT_GROUPS, isMac)[0]!;
    const mac = essentials(true);
    expect(mac.rows.map((row) => row.id)).toEqual(["command-palette", "search-everything", "new-bot", "send-message", "jump-bot", "toggle-sidebar", "settings", "shortcuts-cheat-sheet"]);
    expect(mac.rows.find((row) => row.id === "settings")).toMatchObject({ label: "Settings", keys: ["⌘", ","] });
    expect(essentials(false).rows.some((row) => row.id === "settings")).toBe(false);
    expect(render()).not.toContain('data-shortcut="settings"');
  });

  it("has the reference's Window group: zoom and full screen (#4097)", () => {
    const html = render();
    expect(keys(html, "zoom")).toEqual(["Ctrl", "+", "−"]);
    expect(keys(html, "full-screen")).toEqual(["F11"]);
    const window = shortcutSheetGroups(SHORTCUT_GROUPS, true).find((group) => group.id === "window")!;
    expect(window.rows.map((row) => [row.label, row.keys])).toEqual([["Zoom", ["⌘", "+ / −"]], ["Full screen", ["⌃", "⌘", "F"]]]);
  });

  it("lets a hint wrap under its label on a narrow window instead of cutting it", () => {
    const hintTag = /<span class="([^"]*)" data-shortcut-hint="">/.exec(render())![1]!;
    expect(hintTag.split(" ")).not.toContain("truncate");
    expect(hintTag.split(" ")).toContain("md:truncate");
  });

  it.each([
    ["enter", ["Enter"], "Shift Enter for new line"],
    ["shift-enter", ["Shift", "Enter"], "Enter for new line"],
    ["mod-enter", ["Ctrl", "Enter"], "Enter for new line"],
  ] as const)("shows the send key chosen in Settings (%s)", (sendKey, send, newLine) => {
    fixture.sendKey = sendKey;
    const html = render();
    expect(keys(html, "send-message")).toEqual(send);
    expect(hint(html, "send-message")).toBe(newLine);
    fixture.sendKey = "enter";
  });

  it("does not render when closed", () => {
    expect(renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: false, onClose: vi.fn() }))).toBe("");
  });
});
