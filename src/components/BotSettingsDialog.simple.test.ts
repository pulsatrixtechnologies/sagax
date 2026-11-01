import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn() }) }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return {
    ...store,
    useStore: () => ({
      state: {
        ...store.initialState,
        settingsOpen: true,
        botSettingsExpandAccordion: true,
        botSettingsSection: "access",
      },
      dispatch: vi.fn(),
      flushBotPatches: vi.fn(),
    }),
  };
});
import { BotSettingsDialog } from "./BotSettingsDialog";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";

const bot = { id: "bot-1", name: "Maily", title: "", description: "", messages: [], tasks: [] } as never as Bot;

afterEach(() => vi.unstubAllGlobals());

describe("bot panel in Simple mode", () => {
  it("hides the computer tab and shows no More tab", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    const html = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
    const tabs = [...html.matchAll(/data-panel-tab="(\w+)"/g)].map((match) => match[1]);
    expect(tabs).toEqual(["details", "library"]);
    expect(html).not.toContain('data-panel-tab="computer"');
    expect(html).not.toContain('data-panel-tab="more"');
    expect(html).not.toContain('data-bot-settings-section="access"');
    // Simple still offers the editor (the bot's "..." menu, a click on the
    // mascot), which hides the same sections
    expect(html).toContain('data-bot-actions-button=""');
    expect(html).not.toContain('data-persona-edit-badge=""');
  });
});
