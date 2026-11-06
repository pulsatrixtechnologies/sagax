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
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {} }));
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
  it("draws Appearance and System as grey headings over their cards, in that order (Account moved to its own page)", () => {
    const html = render();
    const order = ['data-settings-group="account"', 'data-settings-group="appearance"', 'data-settings-group="system"'];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toContain('data-settings-group="account"');
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Appearance<\/h3>/);
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>System<\/h3>/);
  });

  it("Language is a borderless pill menu, not a native select, with no help line; the skin is chosen in Appearance only", () => {
    const html = render();
    const appearance = html.slice(html.indexOf('data-settings-group="appearance"'), html.indexOf('data-settings-group="system"'));
    // one option, one place (2026-10-19): the skin, its variant and Light,
    // Dark or Auto live in Appearance > Skin, not in a General Theme menu
    expect(appearance).not.toContain('data-settings-row="theme"');
    expect(appearance).toContain('data-settings-row="language"');
    expect(appearance.match(/data-pill-select/g)).toHaveLength(1);
    expect(appearance).not.toContain("<select");
    expect(appearance).toContain('aria-haspopup="listbox"');
    expect(html).not.toContain("Follows your system language");
    expect(html).not.toContain("Only part of the interface is translated");
  });

  it("one Guided tours row with two buttons, and no tour paragraphs", () => {
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

  // #2080 (L0): Updates are the first card of App, where the desktop app answers
  it("Updates leave General for the App page, where the desktop app answers", () => {
    fixture.section = "about";
    expect(render()).not.toContain('data-settings-card="about.updates"');
    vi.stubGlobal("window", { ogb: { updater } });
    fixture.section = "account";
    const general = render();
    expect(general).toContain('<option value="about">App</option>');
    expect(general).not.toContain('<option value="updates"');
    expect(general).not.toContain("Check for updates");
    fixture.section = "about";
    const page = render();
    expect(page).toContain('data-settings-card="about.updates"');
    expect(page).toContain("Check for updates");
    expect(page).toContain("Update channel");
  });

  it("describes General > Advanced by what it holds today, and hides it when it would be empty", () => {
    const html = render();
    expect(html).toContain("tool access, conversation cleanup, diagnostics");
    expect(html).not.toContain("parallel conversations");
    // a member who cannot edit the installation, in a browser: nothing in it
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    expect(render()).not.toContain('data-settings-card="general.advanced"');
  });

  it("reads in French", () => {
    setLocale("fr");
    vi.stubGlobal("window", { ogb: { updater } });
    const html = render();
    expect(html).toContain(">Apparence</h3>");
    expect(html).toContain(">Système</h3>");
    expect(html).not.toContain(">Thème</div>");
    expect(html).toContain(">Visites guidées</div>");
    expect(html).toContain('<option value="about">Application</option>');
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("Settings search after the move", () => {
  const section = (id: AppSettingsSection) => SECTIONS.find((entry) => entry.id === id)!;
  it("finds updates and pre-releases on App, not on General", () => {
    for (const query of ["update", "prerelease", "pre-release", "beta", "mise à jour"]) {
      expect(sectionMatches(section("about"), query), query).toBe(true);
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
  });
  it("finds About on its own App entry", () => {
    for (const query of ["about", "à propos", "license", "licence", "github", "documentation"]) {
      expect(sectionMatches(section("about"), query), query).toBe(true);
    }
    // "about me" stays on Account; license and github do not
    for (const query of ["license", "licence", "github", "documentation"]) {
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
  });
  it("finds the rows General holds now", () => {
    for (const query of ["theme", "thème", "dark", "sombre", "variante"]) {
      expect(sectionMatches(section("appearance"), query), query).toBe(true);
      expect(sectionMatches(section("account"), query), query).toBe(false);
    }
    for (const query of ["language", "langue", "tour", "account", "copy email", "diagnostic", "tool access", "server"]) {
      expect(sectionMatches(section("account"), query), query).toBe(true);
    }
  });
});
