// Settings sub-pages (src/components/SettingsSubPage.tsx): General > More
// appearance opens as its own page in the Settings modal, with a back arrow and the
// breadcrumb, and Escape goes back to the section before it closes Settings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { initialState, reducer, type AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { subPageKeyAction } from "./SettingsSubPage";
import { resolveSubPage } from "./settings/settings-sub-pages";
import { SETTINGS_SUB_PAGES as SUB_PAGES } from "@/lib/settings-sections";
import { providerCardTarget } from "@/lib/settings-sections";

const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
  subPage: null as string | null,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({
    state: { appSettingsSection: fixture.section, appSettingsSubPage: fixture.subPage, instances: [], bots: [], groups: [], config: { rooms: { turnTimeoutMinutes: 5 } } },
    dispatch: vi.fn(),
  }),
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => null,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ useDesktopWorkspace: () => ({ available: false, current: null, open: false, error: "", openMenu: () => {} }) }));

beforeEach(() => {
  fixture.section = "general";
  fixture.subPage = null;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLocale("en");
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
};

describe("sub-page navigation", () => {
  it("opens from the row, keeps its section, and any other navigation clears it", () => {
    // the row opens the page on its home section (SUB_PAGES)
    const open = reducer(initialState, { type: "toggleAppSettings", open: true, section: SUB_PAGES["general.appearance"]!.section, subPage: "general.appearance" });
    expect(open.appSettingsSection).toBe("general");
    expect(open.appSettingsSubPage).toBe("general.appearance");
    // back: the section again, no page
    expect(reducer(open, { type: "toggleAppSettings", open: true, section: "general" }).appSettingsSubPage).toBeNull();
    // another section, or closing Settings
    expect(reducer(open, { type: "toggleAppSettings", open: true, section: "computer" }).appSettingsSubPage).toBeNull();
    expect(reducer(open, { type: "toggleAppSettings", open: false }).appSettingsSubPage).toBeNull();
  });

  it("Escape goes back unless something else already took it", () => {
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: false })).toBe("back");
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: true })).toBeNull();
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: false, isComposing: true })).toBeNull();
    expect(subPageKeyAction({ key: "Enter", defaultPrevented: false })).toBeNull();
    const inSearch = { closest: (selector: string) => (selector.includes("[data-settings-search]") ? {} : null) };
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: false, target: inSearch as never })).toBeNull();
    // #4376: a name being renamed cancels its own edit with Escape
    const renaming = { closest: (selector: string) => (selector.includes("[data-keeps-escape]") ? {} : null) };
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: false, target: renaming as never })).toBeNull();
    const inEditor = { closest: () => null };
    expect(subPageKeyAction({ key: "Escape", defaultPrevented: false, target: inEditor as never })).toBe("back");
  });

  it("General > More appearance shows the breadcrumb, the back arrow and its page in place of the section", async () => {
    fixture.subPage = "general.appearance";
    const html = await render();
    expect(html).toContain('data-settings-subpage="general.appearance"');
    expect(html).toContain('aria-label="Back to General"');
    expect(html).toMatch(/<nav aria-label="Settings path"[^>]*>.*>General<\/button>.*aria-current="page"[^>]*>More appearance</);
    // the section itself is not drawn under the page
    expect(html).not.toContain('data-settings-card="general.account"');
  });

  it("reads Général > Plus d'apparence in French", async () => {
    setLocale("fr");
    fixture.subPage = "general.appearance";
    const html = await render();
    expect(html).toContain('aria-label="Retour à Général"');
    expect(html).toMatch(/aria-current="page"[^>]*>Plus d(?:'|&#x27;)apparence</);
  });

  // the owner 2026-11-17: About me left the settings; an old link to its
  // page opens nothing (the person's bots keep the text)
  it("an old About me link opens no page", async () => {
    expect(resolveSubPage("general.aboutMe")).toBeNull();
    fixture.subPage = "general.aboutMe";
    const html = await render();
    expect(html).not.toContain("data-settings-subpage=");
    expect(html).not.toContain('id="profile-about-me"');
  });

  // #4329 lot 1: one provider's page is a sub-page of Providers.
  it("Providers > SpaceXSI: a provider's page opens on Providers with its name in the breadcrumb", async () => {
    expect(resolveSubPage("providers.provider:xai")?.section).toBe("providers");
    expect(resolveSubPage("providers.nope")).toBeNull();
    fixture.section = "providers";
    fixture.subPage = "providers.provider:xai";
    const html = await render();
    expect(html).toContain('data-settings-subpage="providers.provider:xai"');
    expect(html).toContain('aria-label="Back to Providers"');
    expect(html).toMatch(/aria-current="page"[^>]*>SpaceXSI</);
  });

  it("an old link to a provider row's card names the page that holds it now", () => {
    expect(providerCardTarget("providers.advanced.codex")).toEqual({ kind: "row", id: "codex" });
    expect(providerCardTarget("computer.localModels")).toEqual({ kind: "computer" });
    expect(providerCardTarget("providers.localModels")).toEqual({ kind: "computer" });
    // Providers' own Advanced and its claude.ai connectors stay on the list
    expect(providerCardTarget("providers.advanced")).toBeNull();
    expect(providerCardTarget("providers.advanced.connectors")).toBeNull();
    expect(providerCardTarget("providers.advanced.connectors.xai")).toBeNull();
    expect(providerCardTarget(null)).toBeNull();
  });

  it("a page of another section is ignored", async () => {
    fixture.section = "usage";
    fixture.subPage = "general.appearance";
    const html = await render();
    expect(html).not.toContain("data-settings-subpage=");
  });
});
