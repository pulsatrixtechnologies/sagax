// Settings nav in headed groups (2026-10-16, the owner): as Cursor Settings and
// the reference design keep their rail short, Sagax groups its pages under Personal, AI,
// Installation and App. Every page stays reachable, the search keeps working,
// and a heading with nothing under it is not drawn.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
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

const { NAV_GROUPS, SECTIONS, SettingsModal } = await import("./SettingsModal");
const render = () => renderToStaticMarkup(createElement(SettingsModal));
const nav = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const updater = { check: vi.fn(), install: vi.fn(), onState: vi.fn(), setPrereleases: vi.fn() };

beforeEach(() => {
  fixture.section = "account";
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", { ogb: { updater } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings nav groups", () => {
  it("puts every page in one known group, in the order of the groups", () => {
    const order = NAV_GROUPS.map((group) => group.id);
    const at = SECTIONS.map((entry) => order.indexOf(entry.group));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(SECTIONS.map((entry) => entry.id)).toEqual([
      // #2080 (L0): the final rail; Import lives in Backups (its old id stays
      // an alias). #2090: Updates is its own page. 2026-11-06: the old App
      // page splits into General (system, keyboard, mode) and About.
      // JC 2026-11-07: App in the Apple order, General first, About last.
      // #2614: Permissions (OS permissions of this computer) after Computer.
      "account", "appearance", "notifications", "security", "credentials",
      "providers", "engines", "voice", "usage",
      "organization", "computer", "permissions", "backups",
      "general", "updates", "developer", "about",
    ]);
  });

  it("draws the headings in order, each over its pages; Automations is in the avatar menu, not here", () => {
    const rail = nav(render());
    const headings = [...rail.matchAll(/data-settings-nav-group="([^"]+)"/g)].map((match) => match[1]);
    expect(headings).toEqual(["you", "ai", "workspace", "app"]);
    for (const label of ["Personal", "AI", "Organization", "App"]) expect(rail, label).toContain(`>${label}</div>`);
    const ai = rail.slice(rail.indexOf('data-settings-nav-group="ai"'), rail.indexOf('data-settings-nav-group="workspace"'));
    expect(ai).toContain(">Models</button>");
    expect(ai.indexOf(">Models</button>")).toBeLessThan(ai.indexOf(">Voice</button>"));
    const you = rail.slice(rail.indexOf('data-settings-nav-group="you"'), rail.indexOf('data-settings-nav-group="ai"'));
    for (const page of ["Account", "Security", "Vault", "Appearance", "Notifications"]) expect(you, page).toContain(`>${page}</button>`);
    expect(rail).not.toContain("data-settings-automations");
    const app = rail.slice(rail.indexOf('data-settings-nav-group="app"'));
    // JC 2026-11-07: the Apple order, General, Updates (desktop), Developer, About last
    const order = [">General</button>", ">Updates</button>", ">Developer</button>", ">About</button>"].map((label) => app.indexOf(label));
    expect(order.every((value) => value >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(app).not.toContain(">App</button>");
    expect(app).not.toContain("Help and about");
    // each group is labelled by its heading for assistive tech
    expect(rail).toMatch(/role="group" aria-labelledby="app-settings-nav-you"/);
  });

  // 2026-10-26: Published pages are in Connect apps. 2026-10-28: Security
  // and Vault are pages of their own. 2026-11-06: General comes back as the
  // app's own system page, under the App heading, never in Personal.
  it("keeps General under App, not Personal; Account first, then Security and Vault", () => {
    const html = render();
    const rail = nav(html);
    const you = rail.slice(rail.indexOf('data-settings-nav-group="you"'), rail.indexOf('data-settings-nav-group="ai"'));
    expect(you).not.toContain(">General</button>");
    expect(rail.slice(rail.indexOf('data-settings-nav-group="app"'))).toContain(">General</button>");
    const at = [">Account</button>", ">Appearance</button>", ">Security</button>", ">Vault</button>"].map((label) => rail.indexOf(label));
    expect(at.every((value) => value >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    for (const gone of ["Credentials", "Published pages", "Models and voice"]) expect(rail, gone).not.toContain(`>${gone}</button>`);
    for (const id of ["security", "credentials"]) expect(html, id).toContain(`<option value="${id}"`);
    expect(html).not.toContain('<option value="pages"');
  });

  it("Account keeps the account only: no security key, rule, tool access or vault there", () => {
    const html = render();
    expect(html).toContain('data-settings-group="account"');
    for (const gone of ['data-settings-card="security"', "Loading your vault", 'data-settings-card="credentials.items"', "data-security-page", "data-vault-page"]) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it("a search for pages finds Published pages in Connect apps, and the moved sections where they are now", async () => {
    const { publishedPagesMatch, sectionMatches } = await import("./SettingsModal");
    for (const query of ["pages", "published", "publiées", "revoke"]) expect(publishedPagesMatch(query), query).toBe(true);
    expect(publishedPagesMatch("vault")).toBe(false);
    expect(publishedPagesMatch("")).toBe(false);
    const account = SECTIONS.find((entry) => entry.id === "account")!;
    const security = SECTIONS.find((entry) => entry.id === "security")!;
    const vault = SECTIONS.find((entry) => entry.id === "credentials")!;
    // 2026-10-28: security keys, rules and tool access on Security; the vault on Vault
    for (const query of ["security key", "clé de sécurité", "passkey", "yubikey", "always allow", "toujours refuser", "demander d'abord", "règles d'approbation", "my tool access", "mon accès aux outils"]) {
      expect(sectionMatches(security, query), query).toBe(true);
      expect(sectionMatches(account, query), query).toBe(false);
    }
    // "tool access" also names People's tool access, an admin card that
    // lives on Security now (2026-11-06): one search, one place
    expect(sectionMatches(security, "tool access")).toBe(true);
    expect(sectionMatches(security, "people's tool access")).toBe(true);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "about")!, "people's tool access")).toBe(false);
    for (const query of ["vault", "coffre", "identifiants", "1password", "one-time card", "carte à usage unique", "mot de passe"]) {
      expect(sectionMatches(vault, query), query).toBe(true);
      expect(sectionMatches(account, query), query).toBe(false);
    }
    // what General held: identity and region on Account, tours and
    // diagnostics on About; the microphone on Voice
    for (const query of ["language", "langue", "time zone", "fuseau", "avatar"]) {
      expect(sectionMatches(account, query), query).toBe(true);
    }
    const app = SECTIONS.find((entry) => entry.id === "about")!;
    expect(sectionMatches(app, "tour")).toBe(true);
    // #2636: diagnostics on Developer
    expect(sectionMatches(app, "diagnostic")).toBe(false);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "developer")!, "diagnostic")).toBe(true);
    // the server choice is Organization's (its launch screen on a desktop with no server)
    for (const query of ["server", "serveur"]) {
      expect(sectionMatches(SECTIONS.find((entry) => entry.id === "organization")!, query), query).toBe(true);
    }
    expect(sectionMatches(account, "microphone")).toBe(false);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "engines")!, "microphone")).toBe(false);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "voice")!, "microphone")).toBe(true);
    const general = SECTIONS.find((entry) => entry.id === "general")!;
    for (const query of ["open at login", "hotkey", "send key"]) {
      expect(sectionMatches(general, query), query).toBe(true);
      expect(sectionMatches(app, query), query).toBe(false);
    }
  });

  it("groups the small-screen menu the same way", () => {
    const html = render();
    expect(html).toContain('<optgroup label="Personal"><option value="account" selected="">Account</option>');
    expect(html).toContain('<optgroup label="App"><option value="general">General</option><option value="updates">Updates</option>');
    expect(html).toContain('<option value="updates">Updates</option><option value="developer">Developer</option><option value="about">About</option>');
    expect(html).not.toContain(">App</option>");
  });

  it("keeps General and About without an updater; Updates hides; Help and about is gone", () => {
    vi.stubGlobal("window", {});
    const rail = nav(render());
    expect(rail).toContain('data-settings-nav-group="app"');
    expect(rail).toContain(">General</button>");
    expect(rail).toContain(">About</button>");
    expect(rail).not.toContain(">Updates</button>");
    expect(rail).not.toContain("Help and about");
    // a member who cannot edit the installation has no Experimental
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    vi.stubGlobal("window", {});
    const member = nav(render());
    expect(member).not.toContain(">Experimental</button>");
    expect(member).toContain(">General</button>");
    expect(member).toContain(">About</button>");
  });

  it("draws Updates without a This app heading; App keeps the About link", () => {
    fixture.section = "updates";
    const html = render();
    expect(html).toContain('data-settings-card="updates"');
    // JC 2026-11-08: the Release notes / About rows moved to Developer
    expect(html).not.toContain('data-settings-card="updates.links"');
    expect(html).not.toMatch(/<h3[^>]*>This app<\/h3>/);
    expect(html).not.toContain("data-about-section");
    fixture.section = "about";
    const app = render();
    expect(app).toContain('data-settings-card="about.about"');
    expect(app).not.toContain('data-settings-card="updates"');
  });

  it("reads in French, with no long dash", () => {
    setLocale("fr");
    const html = render();
    const rail = nav(html);
    for (const label of ["Personnel", "IA", "Espace de travail", "Application"]) expect(rail, label).toContain(`>${label}</div>`);
    expect(html).toContain('<optgroup label="Personnel">');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  // JC 2026-11-07: General selected and Updates highlighted looked like two
  // active rows. One row carries the selection; the hover of the others is a
  // lighter fill than bg-selected, never the same token.
  it("marks exactly one row active, and the hover of the others stays lighter", () => {
    for (const section of ["general", "updates", "about"] as AppSettingsSection[]) {
      fixture.section = section;
      const buttons = [...nav(render()).matchAll(/<button[^>]*>/g)].map((match) => match[0]);
      const rows = buttons.filter((tag) => /data-settings-nav-row="/.test(tag));
      expect(rows.length).toBeGreaterThan(10);
      const active = rows.filter((tag) => tag.includes('aria-current="page"'));
      expect(active, section).toHaveLength(1);
      expect(active[0]).toContain(`data-settings-nav-row="${section}"`);
      expect(rows.filter((tag) => /\bbg-selected\b/.test(tag)), section).toHaveLength(1);
      for (const tag of rows.filter((row) => !row.includes('aria-current="page"'))) {
        expect(tag).not.toContain("hover:bg-selected");
        expect(tag).not.toContain("hover:bg-hover");
        expect(tag).toContain("hover:bg-ink/[0.05]");
      }
    }
  });
});
