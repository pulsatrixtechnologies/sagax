// Settings > General laid out as the reference design's (0.5.6, the owner): grey headings
// over cards of compact rows, Language as a pill menu, Updates on a page of
// its own. #4457 (the owner 2026-11-16): General holds Account, Appearance
// (with Language and Time zone), Notifications, Mascots and System.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  config: { rooms: { turnTimeoutMinutes: 5 } } as Record<string, unknown> | undefined,
  advanced: true,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, appSettingsSubPage: null, instances: [], bots: [], groups: [], config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
  usageMeterEnabled: () => false,
  setUsageMeterEnabled: async () => false,
}));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => ({ status: "idle", allowPrerelease: false }) }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

const { SettingsModal, SECTIONS, sectionMatches } = await import("./SettingsModal");
const render = () => renderToStaticMarkup(createElement(SettingsModal));
const updater = { check: vi.fn(), install: vi.fn(), onState: vi.fn(), setPrereleases: vi.fn() };

beforeEach(() => {
  fixture.section = "general";
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  fixture.advanced = true;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings > General, the reference design's layout", () => {
  it("draws Account, Appearance, Notifications, Mascots, then System (#4457)", () => {
    const html = render();
    const order = ["account", "generalAppearance", "generalNotifications", "generalMascots", "generalSystem"].map((group) => `data-settings-group="${group}"`);
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    for (const heading of ["Appearance", "Notifications", "Mascots", "System"]) expect(html, heading).toMatch(new RegExp(`<h3[^>]*text-ink-secondary[^>]*>${heading}</h3>`));
    // no group title "Language and region" any more: the rows sit on Appearance
    expect(html).not.toContain('data-settings-group="languageRegion"');
  });

  it("Language is a borderless pill menu, not a native select, with no help line, beside the theme", () => {
    const html = render();
    const card = html.slice(html.indexOf('data-settings-group="generalAppearance"'), html.indexOf('data-settings-group="generalNotifications"'));
    expect(card).toContain('data-settings-row="language"');
    expect(card).toContain('data-settings-row="timeZone"');
    expect(card).toContain('data-settings-card="appearance.skin"');
    expect(card).toContain('data-settings-card="general.appearance"');
    expect(card).not.toContain("<select");
    expect(card).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain("Follows your system language");
    expect(html).not.toContain("Only part of the interface is translated");
  });

  it("Guided tours live on Updates > About, with two buttons and no tour paragraphs", () => {
    expect(render()).not.toContain('data-settings-row="tours"');
    fixture.section = "about";
    const html = render();
    expect(html).toContain('data-settings-subpage="updates.about"');
    const row = html.slice(html.indexOf('data-settings-row="tours"'));
    expect(row).toContain(">App tour</button>");
    expect(row).toContain(">Welcome tour</button>");
    expect(html).not.toContain("A short guided tour");
    expect(html).not.toContain("The first-run walkthrough");
  });

  it("Microphone permission is a row of General > System (#4457), desktop app only", async () => {
    vi.stubGlobal("window", { ogb: { permStatus: vi.fn(async () => ({ mic: "granted" })) } });
    const html = render();
    const system = html.slice(html.indexOf('data-settings-group="generalSystem"'));
    expect(system).toContain('data-settings-card="connections.audio"');
    const { MicrophonePermissionRow } = await import("./settings/MicrophoneSettings");
    expect(renderToStaticMarkup(createElement(MicrophonePermissionRow))).toContain('data-settings-row="microphoneAccess"');
    vi.stubGlobal("window", { ogb: {} });
    expect(renderToStaticMarkup(createElement(MicrophonePermissionRow))).toBe("");
  });

  // #2090: Updates are a page of their own, where the desktop app answers;
  // #4457: the page stays everywhere (About and Advanced live there)
  it("Updates are a page of their own; the version card shows where the desktop app answers", () => {
    expect(render()).toContain('<option value="updates">Updates</option>');
    vi.stubGlobal("window", { ogb: { updater } });
    const general = render();
    expect(general).not.toContain("Check for updates");
    fixture.section = "updates";
    const page = render();
    expect(page).toContain('data-settings-card="updates"');
    expect(page).toContain("Check for updates");
    expect(page).toContain("Update channel");
  });

  it("keeps help on Updates > About; the system rows live on General", () => {
    fixture.section = "about";
    const app = render();
    expect(app).toContain('data-settings-card="about.help"');
    expect(app).toContain('data-settings-card="about.about"');
    expect(app).not.toContain('data-settings-card="general.system"');
    fixture.section = "general";
    const general = render();
    expect(general).toContain('data-settings-card="general.system"');
    expect(general).toContain('data-settings-card="general.input"');
    // #2636: the loop guard is on Developer (General > Advanced)
    expect(general).not.toContain('data-settings-card="general.loopGuard"');
  });

  it("reads in French", () => {
    setLocale("fr");
    vi.stubGlobal("window", { ogb: { updater } });
    const html = render();
    expect(html).toContain(">Apparence</h3>");
    expect(html).toContain(">Système</h3>");
    expect(html).not.toContain(">Visites guidées</div>");
    expect(html).toContain('<option value="general" selected="">Général</option>');
    expect(html).toContain('<option value="updates">Mises à jour</option>');
    expect(html).not.toContain('<option value="about">');
    expect(html).not.toContain("Aide et à propos");
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("Settings search after the move", () => {
  const section = (id: AppSettingsSection) => SECTIONS.find((entry) => entry.id === id)!;
  it("finds updates and pre-releases on Updates, not on General", () => {
    // "update" / "mise à jour" also hit General via "scheduled update" / "mise à jour planifiée"
    for (const query of ["prerelease", "pre-release", "beta", "what's new", "release notes"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
    for (const query of ["update", "mise à jour"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
    }
  });
  it("finds About on Updates (its About sub-page), not on General", () => {
    for (const query of ["about", "à propos", "license", "licence", "github", "documentation"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
    }
    // "github" also hits General via "github oauth" on Advanced
    for (const query of ["license", "licence", "documentation"]) {
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
  });
  it("finds the rows General and Updates hold now (#4457 / M-20261127-068)", () => {
    for (const query of ["theme", "thème", "dark", "sombre", "variante", "language", "langue", "account", "copy email", "open at login", "hotkey", "send key", "spellcheck", "hardware acceleration", "app icon"]) {
      expect(sectionMatches(section("general"), query), query).toBe(true);
      expect(sectionMatches(section("updates"), query), query).toBe(false);
    }
    // What's new / About stay on Updates; Advanced (diagnostics, logs, advanced mode) is on General
    // "tour" alone also hits General via "timeout"; use words unique to Updates
    for (const query of ["tours", "send feedback", "what's new"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
    for (const query of ["diagnostic", "logs", "advanced mode"]) {
      expect(sectionMatches(section("general"), query), query).toBe(true);
      expect(sectionMatches(section("updates"), query), query).toBe(false);
    }
  });
});
