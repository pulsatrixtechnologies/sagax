// Settings nav in headed groups (2026-10-16, JC): as Cursor Settings and
// Grok Bot keep their rail short, Sagax groups its pages under Personal, AI,
// Installation and App. Every page stays reachable, the search keeps working,
// and a heading with nothing under it is not drawn.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
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
  fixture.section = "general";
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
      "general", "appearance", "notifications", "credentials", "security",
      "engines",
      "organization", "computer", "usage", "pages", "backups", "import",
      "updates", "experimental",
    ]);
  });

  it("draws the headings in order, each over its pages; Automations is in the avatar menu, not here", () => {
    const rail = nav(render());
    const headings = [...rail.matchAll(/data-settings-nav-group="([^"]+)"/g)].map((match) => match[1]);
    expect(headings).toEqual(["you", "ai", "workspace", "app"]);
    for (const label of ["Personal", "AI", "Installation", "App"]) expect(rail, label).toContain(`>${label}</div>`);
    const ai = rail.slice(rail.indexOf('data-settings-nav-group="ai"'), rail.indexOf('data-settings-nav-group="workspace"'));
    expect(ai).toContain(">Models and voice</button>");
    expect(rail).not.toContain("data-settings-automations");
    const app = rail.slice(rail.indexOf('data-settings-nav-group="app"'));
    expect(app.indexOf(">Updates</button>")).toBeLessThan(app.indexOf(">Experimental</button>"));
    // each group is labelled by its heading for assistive tech
    expect(rail).toMatch(/role="group" aria-labelledby="app-settings-nav-you"/);
  });

  it("groups the small-screen menu the same way", () => {
    const html = render();
    expect(html).toContain('<optgroup label="Personal"><option value="general" selected="">General</option>');
    expect(html).toContain('<optgroup label="App"><option value="updates">Updates</option>');
  });

  it("leaves out a heading with nothing under it (no updater: App keeps Experimental only)", () => {
    vi.stubGlobal("window", {});
    const rail = nav(render());
    expect(rail).toContain('data-settings-nav-group="app"');
    expect(rail).not.toContain(">Updates</button>");
    // a member who cannot edit the installation has no Experimental either
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    vi.stubGlobal("window", {});
    expect(nav(render())).not.toContain('data-settings-nav-group="app"');
  });

  it("titles the Updates page's card", () => {
    fixture.section = "updates";
    const html = render();
    expect(html).toContain('data-settings-group="updates"');
    expect(html).toMatch(/<h3[^>]*>This app<\/h3>/);
    expect(html).toContain("Check for updates");
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
