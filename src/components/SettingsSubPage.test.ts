// Settings sub-pages (src/components/SettingsSubPage.tsx): General > About me
// opens as its own page in the Settings modal, with a back arrow and the
// breadcrumb, and Escape goes back to the section before it closes Settings.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { initialState, reducer, type AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { createAboutMeDraft } from "./about-me-draft";
import { subPageKeyAction } from "./SettingsSubPage";
import { aboutMeBotPreview, aboutMeCount, withOutline, ABOUT_ME_MAX } from "./AboutMeSettings";
import { SUB_PAGES, resolveSubPage } from "./settings/settings-sub-pages";
import { providerCardTarget } from "@/lib/settings-sections";

const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
  subPage: null as string | null,
  aboutMe: "## Who I am\nIT lead at Example.",
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({
    state: { appSettingsSection: fixture.section, appSettingsSubPage: fixture.subPage, instances: [], bots: [], groups: [], config: { rooms: { turnTimeoutMinutes: 5 }, profile: { aboutMe: fixture.aboutMe } } },
    dispatch: vi.fn(),
  }),
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => null,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ useDesktopWorkspace: () => ({ available: false, current: null, open: false, error: "", openMenu: () => {} }) }));

beforeEach(() => {
  fixture.section = "account";
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
    // the row opens the page on its home section (SUB_PAGES): General is a
    // page of its own again since #2430, so About me names Account itself
    const open = reducer(initialState, { type: "toggleAppSettings", open: true, section: SUB_PAGES["general.aboutMe"]!.section, subPage: "general.aboutMe" });
    expect(open.appSettingsSection).toBe("account");
    expect(open.appSettingsSubPage).toBe("general.aboutMe");
    // back: the section again, no page
    expect(reducer(open, { type: "toggleAppSettings", open: true, section: "account" }).appSettingsSubPage).toBeNull();
    // another section, or closing Settings
    expect(reducer(open, { type: "toggleAppSettings", open: true, section: "appearance" }).appSettingsSubPage).toBeNull();
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

  it("Account > About me shows the breadcrumb, the back arrow and the editor in place of the section", async () => {
    fixture.subPage = "general.aboutMe";
    const html = await render();
    expect(html).toContain('data-settings-subpage="general.aboutMe"');
    expect(html).toContain('aria-label="Back to Account"');
    expect(html).toMatch(/<nav aria-label="Settings path"[^>]*>.*>Account<\/button>.*aria-current="page"[^>]*>About me</);
    expect(html).toContain('id="profile-about-me"');
    expect(html).toContain("IT lead at Example.");
    expect(html).toContain("What to write");
    expect(html).toContain("How bots see it");
    expect(html).toContain("About the user (shared with all bots):");
    expect(html).toContain("Saves as you type");
    expect(html).toContain(aboutMeCount(fixture.aboutMe.length));
    // the section itself is not drawn under the page
    expect(html).not.toContain('data-settings-card="general.account"');
  });

  it("reads Compte > À propos de moi in French", async () => {
    setLocale("fr");
    fixture.subPage = "general.aboutMe";
    const html = await render();
    expect(html).toContain('aria-label="Retour à Compte"');
    expect(html).toContain(">À propos de moi<");
    expect(html).toContain("Quoi écrire");
    expect(html).toContain("Enregistré au fil de la saisie");
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
    fixture.section = "appearance";
    fixture.subPage = "general.aboutMe";
    const html = await render();
    expect(html).not.toContain("data-settings-subpage=");
    expect(html).not.toContain('id="profile-about-me"');
  });
});

describe("About me editor", () => {
  it("saves on its own a moment after typing stops", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const draft = createAboutMeDraft("", save);
    draft.edit("I run");
    draft.edit("I run IT");
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("I run IT");
    expect(draft.getSnapshot().status).toBe("saved");
  });

  it("counts characters, previews what bots read, and inserts the outline after the text", () => {
    expect(aboutMeCount(0)).toBe(`0 / ${ABOUT_ME_MAX.toLocaleString("en")} characters`);
    expect(aboutMeBotPreview("  \n")).toBe("");
    expect(aboutMeBotPreview(" Hi \n")).toBe("About the user (shared with all bots):\nHi");
    expect(withOutline("", "## A")).toBe("## A");
    expect(withOutline("Hi\n\n", "## A")).toBe("Hi\n\n## A");
    expect(withOutline("x".repeat(ABOUT_ME_MAX), "## A")).toHaveLength(ABOUT_ME_MAX);
  });
});
