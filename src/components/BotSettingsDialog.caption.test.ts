import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

// The full fold-out panel this checks is Advanced mode's.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn() }) }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, useStore: () => ({ state: store.initialState, dispatch: vi.fn(), flushBotPatches: vi.fn() }) };
});
import { BotSettingsDialog } from "./BotSettingsDialog";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";
import { CIRCLE_BUTTON } from "@/lib/circle-button";

const bot = { id: "bot-1", name: "Maily", title: "", description: "Sorts the inbox.", messages: [], tasks: [] } as never as Bot;
// The provider reads window.ogb.platform on render, so each case sees its stub.
const headerTag = () => {
  const html = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
  // The top bar holds only the controls; the name sits under the avatar.
  return html.match(/<div[^>]*class="content-topbar [^"]*"[^>]*>/)?.[0] ?? "";
};
const header = () => headerTag().match(/class="([^"]*)"/)?.[1] ?? "";

afterEach(() => vi.unstubAllGlobals());

describe("bot settings caption inset", () => {
  it("drops the close button below the Windows caption buttons", () => {
    vi.stubGlobal("window", { ogb: { platform: "win32" } });
    expect(header()).toContain("pt-[28px]");
  });

  it("keeps the header flush elsewhere", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    const classes = header();
    expect(classes).toContain("h-12");
    expect(classes).not.toContain("pt-[28px]");
  });

  it.each([["darwin", true], ["win32", true], ["linux", false]] as const)(
    "makes the header a window drag region on %s: %s",
    (platform, drags) => {
      vi.stubGlobal("window", { ogb: { platform } });
      const tag = headerTag();
      expect(tag.includes("data-window-drag")).toBe(drags);
      expect(tag.includes("-webkit-app-region:drag")).toBe(drags);
    },
  );
});

describe("bot panel header and tabs", () => {
  it("keeps the header to round controls: the bot's one \"...\" menu and Close", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    const html = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
    const classOf = (marker: RegExp) => html.match(marker)?.[1] ?? html.match(marker)?.[2];
    const close = classOf(/<button[^>]*aria-label="Close"[^>]*class="([^"]*)"|<button[^>]*class="([^"]*)"[^>]*aria-label="Close"/);
    expect(close).toBe(CIRCLE_BUTTON);
    const more = html.match(/<button[^>]*data-bot-actions-button=""[^>]*>/)?.[0] ?? "";
    expect(more).toContain('aria-label="Bot menu"');
    expect(more).toContain('aria-haspopup="menu"');
    // Export and Inspector moved into the menu; no pencil on the mascot
    expect(html).not.toContain('aria-label="Export conversation"');
    expect(html).not.toContain('aria-label="Inspector"');
    expect(html).not.toContain("data-persona-edit-badge");
    expect(html).not.toContain("data-edit-persona");
    expect(html.indexOf("data-bot-actions-button")).toBeLessThan(html.indexOf("data-avatar-edit"));
  });

  it("opens the editor from the mascot, with no second persona button", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    const html = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('aria-label="Edit persona"');
    expect(html).not.toContain(">Edit persona<");
    // the name pencil shows only on hover or focus (and on touch screens);
    // the label has none while there is no label
    const inlinePencils = [...html.matchAll(/<svg[^>]*lucide-pencil[^>]*>/g)].map((m) => m[0]).filter((svg) => svg.includes("opacity-0"));
    expect(inlinePencils).toHaveLength(1);
    for (const svg of inlinePencils) expect(svg).toContain("group-hover/inline:opacity-100");
  });

  const panel = () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    return renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
  };

  it("edits the name where it shows, with no Name or Label field, and shows the label only when there is one", () => {
    const html = panel();
    expect(html).toMatch(/<button[^>]*id="bot-settings-title"[^>]*data-inline-edit="text"/);
    expect(html).toContain(">Maily</span>");
    // adding a label is in the editor's Profile
    expect(html).not.toContain("Add a label");
    expect(html).not.toContain('id="bot-name-bot-1"');
    expect(html).not.toContain("Label (optional)");
  });

  it("centers the name and the label, and does not show the description under the label", () => {
    const html = panel();
    expect(html).not.toContain('data-description-info="button"');
    expect(html).toContain(">Maily</span>");
    expect(html).not.toContain("Sorts the inbox.");
    expect(html).not.toContain("One line on what this bot is for");
    expect(html).not.toContain('id="bot-instructions-bot-1"');
  });

  it("shows Details, Library, Capabilities and Computer, with Routines on Details and no empty Coding or Activity", () => {
    const html = panel();
    const tabs = [...html.matchAll(/data-panel-tab="(\w+)"/g)].map((match) => match[1]);
    expect(tabs).toEqual(["details", "library", "computer"]);
    expect(html).not.toContain("Search settings");
    expect(html.indexOf('data-bot-settings-section="routines"')).toBeGreaterThan(-1);
    // nothing running and no code work yet: neither section is drawn
    expect(html).not.toContain('data-bot-settings-section="coding"');
    expect(html).not.toContain('data-bot-settings-section="activity"');
    expect(html).not.toContain("Nothing running.");
  });
});
