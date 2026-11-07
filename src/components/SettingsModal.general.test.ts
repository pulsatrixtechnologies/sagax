// Settings > General laid out as the reference design's (0.5.6, the owner): grey headings
// (Account, Appearance, System) over cards of compact rows, Language as a
// pill menu (the skin is chosen in Appearance only, 2026-10-19), Updates on a page of its own, and General >
// Advanced described by what it holds today.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
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
  fixture.section = "account";
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
  it("draws Account then Language and region (#2080 L2)", () => {
    const html = render();
    const order = ['data-settings-group="account"', 'data-settings-group="languageRegion"'];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toContain('data-settings-group="account"');
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Language and region<\/h3>/);
    expect(html).not.toContain('data-settings-group="system"');
    expect(html).not.toContain('data-settings-group="appearance"');
  });

  it("Language is a borderless pill menu, not a native select, with no help line; the skin is chosen in Appearance only", () => {
    const html = render();
    const region = html.slice(html.indexOf('data-settings-group="languageRegion"'));
    expect(region).not.toContain('data-settings-row="theme"');
    expect(region).toContain('data-settings-row="language"');
    expect(region).toContain('data-settings-row="timeZone"');
    expect(region.match(/data-pill-select/g)).toHaveLength(1);
    expect(region).not.toContain("<select");
    expect(region).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain("Follows your system language");
    expect(html).not.toContain("Only part of the interface is translated");
  });

  it("Guided tours live on About, with two buttons and no tour paragraphs", () => {
    expect(render()).not.toContain('data-settings-row="tours"');
    fixture.section = "about";
    const html = render();
    const row = html.slice(html.indexOf('data-settings-row="tours"'));
    expect(row).toContain(">App tour</button>");
    expect(row).toContain(">Welcome tour</button>");
    expect(html).not.toContain("A short guided tour");
    expect(html).not.toContain("The first-run walkthrough");
  });

  it("Microphone permission is no longer on Account: it is in Models and voice > Audio, desktop app only", async () => {
    vi.stubGlobal("window", { ogb: { permStatus: vi.fn(async () => ({ mic: "granted" })) } });
    expect(render()).not.toContain('data-settings-row="microphoneAccess"');
    const { MicrophonePermissionRow } = await import("./settings/MicrophoneSettings");
    expect(renderToStaticMarkup(createElement(MicrophonePermissionRow))).toContain('data-settings-row="microphoneAccess"');
    vi.stubGlobal("window", { ogb: {} });
    expect(renderToStaticMarkup(createElement(MicrophonePermissionRow))).toBe("");
  });

  // #2090: Updates are a page of their own again, where the desktop app answers
  it("Updates leave General for a page of their own, where the desktop app answers", () => {
    expect(render()).not.toContain('<option value="updates"');
    vi.stubGlobal("window", { ogb: { updater } });
    fixture.section = "account";
    const general = render();
    expect(general).toContain('<option value="updates">Updates</option>');
    expect(general).not.toContain("Check for updates");
    fixture.section = "updates";
    const page = render();
    expect(page).toContain('data-settings-card="updates"');
    expect(page).toContain("Check for updates");
    expect(page).toContain("Update channel");
  });

  it("keeps Account identity-only; system rows live on General, help on About", () => {
    const html = render();
    expect(html).toContain('data-settings-group="languageRegion"');
    expect(html).not.toContain('data-settings-card="general.advanced"');
    expect(html).not.toContain(">Visites guidées</div>");
    fixture.section = "about";
    const app = render();
    expect(app).toContain('data-settings-card="about.help"');
    expect(app).toContain('data-settings-card="about.about"');
    expect(app).not.toContain('data-settings-card="general.system"');
    fixture.section = "general";
    const general = render();
    expect(general).toContain('data-settings-card="general.system"');
    expect(general).toContain('data-settings-card="general.input"');
    // #2636: the loop guard is on Developer; General keeps one link there
    expect(general).not.toContain('data-settings-card="general.loopGuard"');
    expect(general).toContain('data-developer-link=""');
  });

  it("reads in French", () => {
    setLocale("fr");
    vi.stubGlobal("window", { ogb: { updater } });
    const html = render();
    expect(html).toContain(">Langue et région</h3>");
    expect(html).not.toContain(">Système</h3>");
    expect(html).not.toContain(">Thème</div>");
    // #2080 L2: tours live on App, not Account. #2090: Updates is its own page.
    expect(html).not.toContain(">Visites guidées</div>");
    // JC 2026-11-07: Général first, À propos last
    expect(html).toContain('<option value="general">Général</option><option value="updates">Mises à jour</option>');
    expect(html).toContain('<option value="about">À propos</option>');
    expect(html).not.toContain("Aide et à propos");
    expect(html).not.toContain(">Application</option>");
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("Settings search after the move", () => {
  const section = (id: AppSettingsSection) => SECTIONS.find((entry) => entry.id === id)!;
  it("finds updates and pre-releases on Updates, not on General", () => {
    for (const query of ["update", "prerelease", "pre-release", "beta", "mise à jour"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
  });
  it("finds About on its own App entry, not on Updates", () => {
    for (const query of ["about", "à propos", "license", "licence", "github", "documentation"]) {
      expect(sectionMatches(section("about"), query), query).toBe(true);
      expect(sectionMatches(section("updates"), query), query).toBe(false);
    }
    // "about me" stays on Account; license and github do not
    for (const query of ["license", "licence", "github", "documentation"]) {
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
  });
  it("finds the rows Account and App hold now (#2080 L2)", () => {
    for (const query of ["theme", "thème", "dark", "sombre", "variante"]) {
      expect(sectionMatches(section("appearance"), query), query).toBe(true);
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
    for (const query of ["language", "langue", "account", "copy email"]) {
      expect(sectionMatches(section("account"), query), query).toBe(true);
    }
    for (const query of ["tour", "help", "feedback"]) {
      expect(sectionMatches(section("about"), query), query).toBe(true);
      expect(sectionMatches(section("account"), query), query).toBe(false);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
    // #2636: diagnostics and logs are on Developer
    for (const query of ["diagnostic", "logs"]) {
      expect(sectionMatches(section("developer"), query), query).toBe(true);
      expect(sectionMatches(section("about"), query), query).toBe(false);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
    for (const query of ["open at login", "hotkey", "send key", "spellcheck", "advanced mode", "hardware acceleration", "app icon"]) {
      expect(sectionMatches(section("general"), query), query).toBe(true);
      expect(sectionMatches(section("about"), query), query).toBe(false);
    }
  });
});
