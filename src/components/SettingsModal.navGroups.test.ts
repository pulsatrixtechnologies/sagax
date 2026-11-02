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
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {} }));
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
      "account", "security", "credentials", "appearance", "notifications",
      "providers", "engines", "voice",
      "organization", "computer", "usage", "backups", "import",
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
    expect(app.indexOf(">Updates</button>")).toBeLessThan(app.indexOf(">Experimental</button>"));
    // 2026-11-02 (JC): About is not a row of the Settings menu
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
    const at = [">Account</button>", ">Security</button>", ">Vault</button>", ">Appearance</button>"].map((label) => rail.indexOf(label));
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
    // Account > Advanced: a search finds both, each in its own place
    expect(sectionMatches(security, "tool access")).toBe(true);
    expect(sectionMatches(account, "people's tool access")).toBe(true);
    for (const query of ["vault", "coffre", "identifiants", "1password", "one-time card", "carte à usage unique", "mot de passe"]) {
      expect(sectionMatches(vault, query), query).toBe(true);
      expect(sectionMatches(account, query), query).toBe(false);
    }
    // what General held is found on Account; the microphone on Voice
    for (const query of ["language", "langue", "time zone", "fuseau", "server", "serveur", "tour", "diagnostic", "avatar"]) {
      expect(sectionMatches(account, query), query).toBe(true);
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
    expect(html).not.toContain('<option value="about">');
  });

  it("keeps the App group without an updater; About is never a row", () => {
    vi.stubGlobal("window", {});
    const rail = nav(render());
    expect(rail).toContain('data-settings-nav-group="app"');
    expect(rail).not.toContain(">Updates</button>");
    expect(rail).not.toContain(">About</button>");
    // a member who cannot edit the installation has no Experimental
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    vi.stubGlobal("window", {});
    const member = nav(render());
    expect(member).not.toContain(">About</button>");
    expect(member).not.toContain(">Experimental</button>");
  });

  it("titles the Updates page's card and no longer nests About there", () => {
    fixture.section = "updates";
    const html = render();
    expect(html).toContain('data-settings-group="updates"');
    expect(html).toMatch(/<h3[^>]*>This app<\/h3>/);
    expect(html).toContain("Check for updates");
    expect(html).not.toContain("data-about-section");
  });

  it("reads in French, with no long dash", () => {
    setLocale("fr");
    const html = render();
    const rail = nav(html);
    for (const label of ["Personnel", "IA", "Espace de travail", "Application"]) expect(rail, label).toContain(`>${label}</div>`);
    expect(html).toContain('<optgroup label="Personnel">');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
