// Settings > General laid out as Grok Bot's (0.5.6, JC): grey headings
// (Account, Appearance, System) over cards of compact rows, Language as a
// pill menu (the skin is chosen in Appearance only, 2026-10-19), Updates on a page of its own, and General >
// Advanced described by what it holds today.
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
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {} }));
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

describe("Settings > General, Grok Bot's layout", () => {
  it("draws Account, Appearance and System as grey headings over their cards, in that order", () => {
    const html = render();
    const order = ['data-settings-group="account"', 'data-settings-group="appearance"', 'data-settings-group="system"'];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toMatch(/<h3[^>]*text-ink-secondary[^>]*>Account<\/h3>/);
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

  it("Microphone shows on the desktop app only, with the permission's state", () => {
    expect(render()).not.toContain('data-settings-row="microphone"');
    vi.stubGlobal("window", { ogb: { permStatus: vi.fn(async () => ({ mic: "granted" })) } });
    expect(render()).toContain('data-settings-row="microphone"');
  });

  it("Updates leave General for a page of their own, where the desktop app answers", () => {
    expect(render()).not.toContain('<option value="updates"');
    vi.stubGlobal("window", { ogb: { updater } });
    const general = render();
    expect(general).toContain('<option value="updates">Updates</option>');
    expect(general).not.toContain("Check for updates");
    fixture.section = "updates";
    const page = render();
    expect(page).toContain('data-settings-card="updates"');
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
    expect(html).toContain(">Compte</h3>");
    expect(html).toContain(">Apparence</h3>");
    expect(html).toContain(">Système</h3>");
    expect(html).not.toContain(">Thème</div>");
    expect(html).toContain(">Visites guidées</div>");
    expect(html).toContain('<option value="updates">Mises à jour</option>');
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("Settings search after the move", () => {
  const section = (id: AppSettingsSection) => SECTIONS.find((entry) => entry.id === id)!;
  it("finds updates and pre-releases on Updates, not on General", () => {
    for (const query of ["update", "prerelease", "pre-release", "beta", "mise à jour"]) {
      expect(sectionMatches(section("updates"), query), query).toBe(true);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
  });
  it("finds the rows General holds now", () => {
    for (const query of ["theme", "thème", "dark", "sombre", "variante"]) {
      expect(sectionMatches(section("appearance"), query), query).toBe(true);
      expect(sectionMatches(section("general"), query), query).toBe(false);
    }
    for (const query of ["language", "langue", "micro", "tour", "account", "copy email", "diagnostic", "tool access"]) {
      expect(sectionMatches(section("general"), query), query).toBe(true);
    }
  });
});
