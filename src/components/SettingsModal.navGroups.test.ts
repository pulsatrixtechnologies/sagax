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
      // an alias). #2090: Updates is its own page; App (about) keeps L2 extras.
      "account", "appearance", "notifications", "security", "credentials",
      "providers", "engines", "voice", "usage",
      "organization", "computer", "backups",
      "updates", "experimental", "about",
    ]);
  });

  it("draws the headings in order, each over its pages; Automations is in the avatar menu, not here", () => {
    const rail = nav(render());
    const headings = [...rail.matchAll(/data-settings-nav-group="([^"]+)"/g)].map((match) => match[1]);
    expect(headings).toEqual(["you", "ai", "workspace", "app"]);
    for (const label of ["Personal", "AI", "Installation", "App"]) expect(rail, label).toContain(`>${label}</div>`);
    const ai = rail.slice(rail.indexOf('data-settings-nav-group="ai"'), rail.indexOf('data-settings-nav-group="workspace"'));
    expect(ai).toContain(">Models</button>");
    expect(ai.indexOf(">Models</button>")).toBeLessThan(ai.indexOf(">Voice</button>"));
    const you = rail.slice(rail.indexOf('data-settings-nav-group="you"'), rail.indexOf('data-settings-nav-group="ai"'));
    for (const page of ["Account", "Security", "Vault", "Appearance", "Notifications"]) expect(you, page).toContain(`>${page}</button>`);
    expect(rail).not.toContain("data-settings-automations");
    const app = rail.slice(rail.indexOf('data-settings-nav-group="app"'));
    // #2090: Updates (desktop) then Experimental; #2080: App keeps L2 extras
    expect(app.indexOf(">Updates</button>")).toBeLessThan(app.indexOf(">Experimental</button>"));
    expect(app.indexOf(">Experimental</button>")).toBeLessThan(app.indexOf(">App</button>"));
    expect(app).not.toContain(">About</button>");
    // each group is labelled by its heading for assistive tech
    expect(rail).toMatch(/role="group" aria-labelledby="app-settings-nav-you"/);
  });

  // 2026-10-26: General is out of the navigation, Published pages are in
  // Connect apps. 2026-10-28: Security and Vault are pages of their own.
  it("leaves General out of the rail and the menu; Account first, then Security and Vault", () => {
    const html = render();
    const rail = nav(html);
    expect(rail).not.toContain(">General</button>");
    expect(html).not.toContain('<option value="general"');
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
    // "tool access" also names People's tool access, an admin card of
    // App > Advanced (#2080 L2): a search finds both, each in its own place
    expect(sectionMatches(security, "tool access")).toBe(true);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "about")!, "people's tool access")).toBe(true);
    for (const query of ["vault", "coffre", "identifiants", "1password", "one-time card", "carte à usage unique", "mot de passe"]) {
      expect(sectionMatches(vault, query), query).toBe(true);
      expect(sectionMatches(account, query), query).toBe(false);
    }
    // what General held: identity and region on Account, the rest on App
    // (#2080 L2); the microphone on Voice
    for (const query of ["language", "langue", "time zone", "fuseau", "avatar"]) {
      expect(sectionMatches(account, query), query).toBe(true);
    }
    const app = SECTIONS.find((entry) => entry.id === "about")!;
    for (const query of ["tour", "diagnostic"]) {
      expect(sectionMatches(app, query), query).toBe(true);
    }
    // the server choice is Organization's (its launch screen on a desktop with no server)
    for (const query of ["server", "serveur"]) {
      expect(sectionMatches(SECTIONS.find((entry) => entry.id === "organization")!, query), query).toBe(true);
    }
    expect(sectionMatches(account, "microphone")).toBe(false);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "engines")!, "microphone")).toBe(false);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "voice")!, "microphone")).toBe(true);
    expect(SECTIONS.some((entry) => entry.id === ("general" as string))).toBe(false);
  });

  it("groups the small-screen menu the same way", () => {
    const html = render();
    expect(html).toContain('<optgroup label="Personal"><option value="account" selected="">Account</option>');
    expect(html).toContain('<optgroup label="App"><option value="updates">Updates</option>');
    expect(html).toContain('<option value="about">App</option>');
  });

  it("keeps the App page without an updater; Updates hides; About is never a row label", () => {
    vi.stubGlobal("window", {});
    const rail = nav(render());
    expect(rail).toContain('data-settings-nav-group="app"');
    expect(rail).toContain(">App</button>");
    expect(rail).not.toContain(">Updates</button>");
    expect(rail).not.toContain(">About</button>");
    // a member who cannot edit the installation has no Experimental
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    vi.stubGlobal("window", {});
    const member = nav(render());
    expect(member).not.toContain(">About</button>");
    expect(member).not.toContain(">Experimental</button>");
  });

  it("titles the Updates page's card; App keeps the About link", () => {
    fixture.section = "updates";
    const html = render();
    expect(html).toContain('data-settings-card="updates"');
    expect(html).toMatch(/<h3[^>]*>This app<\/h3>/);
    expect(html).toContain("Check for updates");
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
    for (const label of ["Personnel", "IA", "Installation", "Application"]) expect(rail, label).toContain(`>${label}</div>`);
    expect(html).toContain('<optgroup label="Personnel">');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
