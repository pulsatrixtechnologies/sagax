// Settings nav (#4457, the owner 2026-11-16): the reference app's rail, seven
// entries with no group title (General, Computer, Permissions, Vault,
// Providers, Usage, Updates). The headed groups of 2026-10-16 are gone; every
// former page lives on one of the seven or one page further, the search
// finds them, and Organization is off the rail (its console is linked in the
// footer when the app is linked to one).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  org: null as unknown,
  config: { rooms: { turnTimeoutMinutes: 5 } } as Record<string, unknown> | undefined,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, appSettingsSubPage: null, instances: [], bots: [], groups: [], config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {}, usageMeterEnabled: () => false, setUsageMeterEnabled: () => {} }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => ({ status: "idle", allowPrerelease: false }) }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
}));

const { SECTIONS, SettingsModal, sectionMatches } = await import("./SettingsModal");
const render = () => renderToStaticMarkup(createElement(SettingsModal));
const nav = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const railRows = (html: string) => [...nav(html).matchAll(/data-settings-nav-row="(\w+)"/g)].map((match) => match[1]);
const updater = { check: vi.fn(), install: vi.fn(), onState: vi.fn(), setPrereleases: vi.fn() };
const page = (id: string) => SECTIONS.find((entry) => entry.id === id)!;

beforeEach(() => {
  fixture.section = "general";
  fixture.org = null;
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", { ogb: { updater } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings rail (#4457)", () => {
  it("draws the seven entries in the reference order, with no group heading", () => {
    const html = render();
    expect(railRows(html)).toEqual(["general", "computer", "security", "credentials", "providers", "usage", "updates"]);
    const rail = nav(html);
    for (const label of ["General", "Computer", "Permissions", "Vault", "Providers", "Usage", "Updates"]) expect(rail, label).toContain(`${label}</button>`);
    expect(rail).not.toContain("data-settings-nav-group");
    for (const heading of ["Personal", "AI", "Installation", "App"]) expect(rail, heading).not.toContain(`>${heading}</div>`);
    // Organization is off the rail
    expect(rail).not.toContain('data-settings-nav-row="organization"');
    expect(rail).not.toContain("data-settings-automations");
  });

  it("the small-screen menu lists the same seven pages, with no group", () => {
    const html = render();
    expect(html).not.toContain("<optgroup");
    const options = [...html.matchAll(/<option value="(\w+)"/g)].map((match) => match[1]);
    expect(options).toEqual(["general", "computer", "security", "credentials", "providers", "usage", "updates"]);
  });

  it("links the organization console in the footer, only when the app is linked to one", () => {
    expect(nav(render())).not.toContain("data-settings-console-link");
    fixture.org = { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://console.example.test/" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    const rail = nav(render());
    expect(rail).toMatch(/<a href="https:\/\/console\.example\.test\/console\/" target="_blank" rel="noreferrer" data-settings-console-link=""/);
    expect(rail).toContain("More on Perspicax");
    setLocale("fr");
    expect(nav(render())).toContain("Plus dans Perspicax");
  });

  it("General holds Account, Appearance, Notifications, Mascots and System, with its rows one page further", () => {
    const html = render();
    for (const group of ["account", "generalAppearance", "generalNotifications", "generalMascots", "generalSystem"]) expect(html, group).toContain(`data-settings-group="${group}"`);
    for (const row of ["general.appearance", "general.notifications", "general.mascots", "general.backups"]) expect(html, row).toContain(`data-settings-card="${row}"`);
    // the owner 2026-11-17: About me left the settings (the bots keep it)
    expect(html).not.toContain('data-settings-card="general.aboutMe"');
    // the order of the cards
    const at = ["account", "generalAppearance", "generalNotifications", "generalMascots", "generalSystem"].map((group) => html.indexOf(`data-settings-group="${group}"`));
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it("Permissions holds Before acting, Privacy and Security", () => {
    fixture.section = "security";
    const html = render();
    for (const group of ["permissionsBeforeActing", "privacy", "permissionsSecurity"]) expect(html, group).toContain(`data-settings-group="${group}"`);
    for (const row of ["security.rules", "security.toolGrants", "security.keys"]) expect(html, row).toContain(`data-settings-card="${row}"`);
    expect(html).toContain(">Permissions</h2>");
  });

  it("Providers holds the Models and Voice cards; Updates holds What's new and About; Advanced is on General", async () => {
    const { ProvidersModelsVoice, ProvidersSettings } = await import("./lazy-settings-sections");
    await Promise.all([ProvidersModelsVoice.preload(), ProvidersSettings.preload()]);
    fixture.section = "providers";
    const providers = render();
    for (const row of ["providers.models", "providers.voice"]) expect(providers, row).toContain(`data-settings-card="${row}"`);
    // Accounts, Models, Voice, then Advanced (never under the Advanced fold)
    const at = ["providers.list", "providers.models", "voice.providers", "providers.advanced"].map((card) => providers.indexOf(`data-settings-card="${card}"`));
    expect(at.every((index) => index >= 0), at.join()).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(providers).toContain('data-settings-group="providersModels"');
    fixture.section = "updates";
    const updates = render();
    expect(updates).toContain('data-settings-card="updates.links"');
    expect(updates).toContain('data-settings-card="updates.about"');
    expect(updates).not.toContain('data-settings-card="updates.advanced"');
    expect(updates).not.toContain('data-settings-card="general.advanced"');
    fixture.section = "general";
    const general = render();
    expect(general).toContain('data-settings-card="general.advanced"');
    // Advanced is the last settings card on General
    const lastCard = [...general.matchAll(/data-settings-card="([^"]+)"/g)].map((match) => match[1]).at(-1);
    expect(lastCard).toBe("general.advanced");
  });

  it("keeps Updates on the web (About), with no updater", () => {
    vi.stubGlobal("window", {});
    expect(railRows(render())).toContain("updates");
  });

  it("the search finds each moved option on the page that holds it now", () => {
    const where: Record<string, string[]> = {
      general: ["language", "time zone", "avatar", "open at login", "hotkey", "send key", "microphone", "notification sound", "backup", "theme", "font", "diagnostic", "advanced mode"],
      security: ["security key", "passkey", "always allow", "my tool access", "people's tool access", "read receipts", "screen recording"],
      credentials: ["vault", "1password", "one-time card"],
      providers: ["api key", "models", "voice", "tts", "decision model"],
      updates: ["version", "licence", "send feedback"],
      organization: ["server", "obsidian"],
    };
    for (const [id, queries] of Object.entries(where)) {
      for (const query of queries) {
        const found = SECTIONS.filter((entry) => sectionMatches(entry, query)).map((entry) => entry.id);
        expect(found, query).toContain(id);
      }
    }
  });

  it("a search lists Organization in the rail, the way it lists the pages it finds", async () => {
    const { railSections } = await import("./settings/settings-nav");
    expect(railSections(SECTIONS).map((entry) => entry.id)).not.toContain("organization");
    expect(sectionMatches(page("organization"), "obsidian")).toBe(true);
  });

  it("reads in French, with no long dash", () => {
    setLocale("fr");
    const html = render();
    const rail = nav(html);
    for (const label of ["Général", "Ordinateur", "Autorisations", "Coffre", "Fournisseurs", "Utilisation", "Mises à jour"]) expect(rail, label).toContain(label);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  // the owner 2026-11-07: one row carries the selection; the hover of the
  // others is a lighter fill than bg-selected, never the same token.
  it("marks exactly one row active, and the hover of the others stays lighter", () => {
    for (const section of ["general", "updates", "security"] as AppSettingsSection[]) {
      fixture.section = section;
      const buttons = [...nav(render()).matchAll(/<button[^>]*>/g)].map((match) => match[0]);
      const rows = buttons.filter((tag) => /data-settings-nav-row="/.test(tag));
      expect(rows).toHaveLength(7);
      const active = rows.filter((tag) => tag.includes('aria-current="page"'));
      expect(active, section).toHaveLength(1);
      expect(active[0]).toContain(`data-settings-nav-row="${section}"`);
      expect(rows.filter((tag) => /\bbg-selected\b/.test(tag)), section).toHaveLength(1);
      for (const tag of rows.filter((row) => !row.includes('aria-current="page"'))) {
        expect(tag).not.toContain("hover:bg-selected");
        expect(tag).toContain("hover:bg-ink/[0.05]");
      }
    }
  });
});
