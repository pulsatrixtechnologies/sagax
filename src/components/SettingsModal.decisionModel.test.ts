// Decision model is a card of Settings > Models (#2093: always shown; its
// own master switch is the only control). An old link to the section opens
// Models. It is never a rail entry and never an Experimental switch.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { resetSettingsCards } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({
    state: {
      appSettingsSection: fixture.section,
      instances: [],
      bots: [],
      groups: [],
      config: { features: { skillAuthoring: true }, rooms: { turnTimeoutMinutes: 5 } },
    },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
  usageMeterEnabled: () => false,
  setUsageMeterEnabled: () => Promise.resolve(false),
}));

beforeEach(() => {
  fixture.section = "appearance";
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "openmausbot.settingsCards.v1" ? JSON.stringify({ "experimental.features": false }) : null),
    setItem: () => {},
    removeItem: () => {},
  });
  resetSettingsCards();
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  const { DecisionModelSettings, DeveloperSettings, EnginesSettings } = await import("./lazy-settings-sections");
  await Promise.all([
    DecisionModelSettings.preload(),
    EnginesSettings.preload(),
    DeveloperSettings.preload(),
  ]);
  return renderToStaticMarkup(createElement(SettingsModal));
};

describe("Settings → Decision model", () => {
  it("is never a menu entry, and always a card of Models (#2093)", async () => {
    fixture.section = "engines";
    const on = await render();
    expect(on).not.toContain('<option value="decisionModel">');
    expect(on).toContain('data-settings-card="engines.decisionModel"');
    expect(on).toContain("A fast decision model that picks");
    expect(on).toContain("Fast decisions");

    // an old link to the section opens the page that holds the card
    fixture.section = "decisionModel";
    const panel = await render();
    expect(panel).toContain('<option value="engines" selected="">');
    expect(panel).toContain("A fast decision model that picks");
  });

  it("leaves Experimental without Decision model or browser (on Models / Computer); VPS and Boat stay gone", async () => {
    fixture.section = "developer";
    const html = await render();
    expect(html).not.toContain('data-experimental-feature="decisionModel"');
    expect(html).not.toContain(">Decision model<");
    expect(html).not.toContain('data-experimental-feature="browser"');
    expect(html).not.toContain("data-experimental-browse-bots");
    expect(html).not.toContain("Browse Bots");
    expect(html).not.toContain("Templates");
    expect(html).not.toContain("VPS Computer");
    expect(html).not.toContain("Boat Computer");
    // #2636: Context pods moved to Settings > Developer
    expect(html).not.toContain('data-settings-card="experimental.developer"');
  });

  // #575 retired the Sidebar shortcuts setting: the Grok-style footer (avatar
  // menu + Connect apps pill) replaced the two menu rows, so it had no effect.
  it("no longer offers Sidebar shortcuts in Appearance", async () => {
    fixture.section = "appearance";
    const html = await render();
    expect(html).not.toContain("Sidebar shortcuts");
    expect(html).not.toContain('aria-label="Show the sidebar shortcuts"');
  });

  it("matches searches for decision, jev, typesafe, routing and auto", async () => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const section = SECTIONS.find((entry) => entry.id === "engines")!;
    for (const query of ["decision", "jev", "typesafe", "routing", "auto"]) expect(sectionMatches(section, query)).toBe(true);
    expect(sectionMatches(section, "backups")).toBe(false);
  });
});
