// Decision model is an experimental card of Settings > Models and voice
// (2026-10-14; it was a section of its own). Off, it is nowhere. On, the
// card shows on that page, findable by what people would type, and an old
// link to the section opens that page.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { resetSettingsCards } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
  decisionModel: false,
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
      config: { features: { skillAuthoring: true, decisionModel: fixture.decisionModel }, rooms: { turnTimeoutMinutes: 5 } },
    },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
}));

beforeEach(() => {
  fixture.section = "appearance";
  fixture.decisionModel = false;
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
  const { DecisionModelSettings, EnginesSettings, ExperimentalSettings } = await import("./lazy-settings-sections");
  await Promise.all([
    DecisionModelSettings.preload(),
    EnginesSettings.preload(),
    ExperimentalSettings.preload(),
  ]);
  return renderToStaticMarkup(createElement(SettingsModal));
};

describe("Settings → Decision model", () => {
  it("is never a menu entry, and a card of Models and voice once the experimental switch is on", async () => {
    fixture.section = "engines";
    const off = await render();
    expect(off).not.toContain('<option value="decisionModel">');
    expect(off).not.toContain("A fast decision model that picks");

    fixture.decisionModel = true;
    const on = await render();
    expect(on).not.toContain('<option value="decisionModel">');
    expect(on).toContain('data-settings-card="engines.decisionModel"');
    expect(on).toContain("A fast decision model that picks");

    // an old link to the section opens the page that holds the card
    fixture.section = "decisionModel";
    const panel = await render();
    expect(panel).toContain('<option value="engines" selected="">');
    expect(panel).toContain("A fast decision model that picks");
  });

  it("hides the VPS and Boat switches and counts the seven that remain; Browse Bots moved to Appearance", async () => {
    fixture.section = "experimental";
    const off = await render();
    expect(off).toContain("1 of 7 on");
    expect(off).toContain('data-experimental-feature="decisionModel"');
    expect(off).toContain("Decision model");
    expect(off).not.toContain("data-experimental-browse-bots");
    expect(off).not.toContain("Browse Bots");
    expect(off).not.toContain("Templates");
    expect(off).not.toContain("VPS Computer");
    expect(off).not.toContain("Boat Computer");
    expect(off).toContain('aria-checked="false"');

    fixture.decisionModel = true;
    expect(await render()).toContain("2 of 7 on");
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
