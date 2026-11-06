// Settings > Experimental: the Data window, off by default. Routines in the
// conversation and Group turns are in General > Advanced (2026-10-14): one
// way to reach them, no second Experimental switch hiding them again. Their
// saved values keep applying whether or not the page is open.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  subPage: null as string | null,
  features: {} as Record<string, boolean>,
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as Array<{ "aria-label"?: string; checked?: boolean; onClick?: (event: never) => void }>,
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({
    state: {
      appSettingsSection: fixture.section,
      appSettingsSubPage: fixture.subPage,
      instances: [],
      bots: [],
      groups: [],
      config: { features: { skillAuthoring: true, ...fixture.features }, rooms: { turnTimeoutMinutes: 12 } },
    },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props as (typeof fixture.switches)[number]);
      return createElement(original.Switch, props);
    },
  };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" } } }) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({ usageMeterEnabled: () => false, setUsageMeterEnabled: () => Promise.resolve(false) }));

beforeEach(async () => {
  fixture.section = "general";
  fixture.subPage = null;
  fixture.features = {};
  fixture.switches = [];
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "openmausbot.settingsCards.v1" ? JSON.stringify({ "experimental.features": true }) : null),
    setItem: () => {},
    removeItem: () => {},
  });
  const { resetSettingsCards } = await import("./SettingsPrimitives");
  resetSettingsCards();
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  const { ExperimentalSettings, OrganizationSettings } = await import("./lazy-settings-sections");
  await Promise.all([ExperimentalSettings.preload(), OrganizationSettings.preload()]);
  return renderToStaticMarkup(createElement(SettingsModal));
};
const switchNamed = (label: string) => fixture.switches.filter((props) => props["aria-label"] === label).at(-1);

describe("Settings > Experimental", () => {
  it("offers the Data window, off by default, and no longer a switch for routine and group settings", async () => {
    fixture.section = "experimental";
    fixture.features = { dataWindow: false };
    const html = await render();
    expect(html).toContain('data-experimental-feature="dataWindow"');
    expect(html).toContain("Data window");
    expect(html).not.toContain('data-experimental-feature="routineGroupSettings"');
    expect(html).not.toContain("Advanced routine and group settings");
    expect(switchNamed("Turn on the Data window")?.checked).toBe(false);
    expect(html).not.toMatch(/[–—]/);
  });

  it("keeps the Data window row on a server that predates it, greyed with the reason", async () => {
    // An organization server older than Sagax 0.5.3 does not know the
    // feature: its config has no dataWindow, and it refuses to save one.
    fixture.section = "experimental";
    const html = await render();
    expect(html).toContain('data-experimental-feature="dataWindow"');
    expect(html).toContain("This server does not offer the Data window yet");
    const toggle = switchNamed("Turn on the Data window")!;
    expect(toggle.checked).toBe(false);
    expect((toggle as { disabled?: boolean }).disabled).toBe(true);
  });

  it("is laid out as the reference design's pages: one group, a label and a switch per feature, no help paragraphs", async () => {
    fixture.section = "experimental";
    fixture.features = { dataWindow: false, decisionModel: true };
    const html = await render();
    expect(html).toContain('data-settings-group="experimental"');
    expect(html).toContain(">Experimental features</h3>");
    // skill authoring and the decision model are on
    expect(html).toContain("· 2 of 6 on");
    for (const feature of ["skillAuthoring", "decisionModel", "dataWindow", "meetingNotetaker", "devPods"]) {
      expect(html, feature).toContain(`data-experimental-feature="${feature}"`);
    }
    expect(html).not.toContain("Early features may change");
    expect(html).not.toContain("Save a bot's verification run as a skill");
    expect(html).not.toContain("Adds the Decision model card");
    // the deep link of the browser notes still lands here
    expect(html).toContain('data-settings-card="experimental.features"');
    expect(html).not.toMatch(/[–—]/);
  });

  it("greys a feature this server cannot run, with the reason on demand", async () => {
    fixture.section = "experimental";
    const html = await render();
    const row = /data-experimental-feature="dataWindow"[\s\S]*?<\/button><\/div><\/div><\/div><\/div>/.exec(html)?.[0] ?? html;
    expect(row).toContain('data-unavailable=""');
    expect(row).toContain("Not available on this server");
    expect(row).toContain('aria-label="More about Data window"');
  });

  it("saves each switch as its own server feature", async () => {
    fixture.section = "experimental";
    fixture.features = { dataWindow: false };
    fixture.api.mockResolvedValue({ features: {} });
    await render();
    switchNamed("Turn on the Data window")!.onClick!({} as never);
    expect(fixture.api).toHaveBeenLastCalledWith("/api/config", { method: "PATCH", body: JSON.stringify({ features: { dataWindow: true } }) });
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalled());
  });

  it("gives generated conversation titles a switch: no more hand edit of config.json (2026-10-26)", async () => {
    fixture.section = "experimental";
    fixture.features = { llmThreadTitles: false };
    fixture.api.mockResolvedValue({ features: {} });
    const html = await render();
    expect(html).toContain('data-experimental-feature="llmThreadTitles"');
    expect(html).not.toMatch(/[–—]/);
    switchNamed("Turn on generated conversation titles")!.onClick!({} as never);
    expect(fixture.api).toHaveBeenLastCalledWith("/api/config", { method: "PATCH", body: JSON.stringify({ features: { llmThreadTitles: true } }) });
  });
});

describe("Settings > Account and App Advanced (#2080 L2)", () => {
  it("keeps the technical cards off Account itself", async () => {
    fixture.features = { routinesInConversation: true };
    const html = await render();
    expect(html).not.toContain('data-settings-card="general.advanced"');
    expect(html).not.toContain("Routines in the conversation");
    expect(html).not.toContain('data-settings-card="organization.roomTurns"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
    expect(html).not.toContain('data-settings-card="general.toolAccess"');
    expect(switchNamed("Run routines in the conversation")).toBeUndefined();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("mounts cleanup and diagnostics on App; routines, group turns and MCP stay on Organization when it shows", async () => {
    fixture.features = { routinesInConversation: true };
    fixture.section = "about";
    const html = await render();
    expect(html).toContain('data-settings-card="about.holding"');
    expect(html).toContain('data-settings-card="general.threadCleanup"');
    expect(html).toContain('data-settings-card="about.help"');
    for (const card of ["general.toolAccess", "general.threads", "general.recovery"]) expect(html, card).not.toContain(`data-settings-card="${card}"`);
    expect(html).not.toContain("Routines in the conversation");
    expect(html).not.toContain('data-settings-card="organization.roomTurns"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
    expect(fixture.api).not.toHaveBeenCalled();
  });
});

describe("Settings > Organization (cards from General > Advanced, 2026-10-15)", () => {
  it("shows routines, group turns and MCP calls with their current values", async () => {
    fixture.features = { routinesInConversation: true };
    fixture.section = "organization";
    const html = await render();
    expect(html).toContain('data-settings-card="organization.routinesInConversation"');
    expect(html).toContain("Routines in the conversation");
    expect(switchNamed("Run routines in the conversation")?.checked).toBe(true);
    expect(html).toContain('data-settings-card="organization.roomTurns"');
    // 0.5.6: a row with its minutes field, no folded card
    expect(html).toMatch(/id="room-turn-timeout"[^>]*value="12"/);
    expect(html).toContain('data-settings-card="organization.mcpCalls"');
    expect(html.indexOf("Routines in the conversation")).toBeLessThan(html.indexOf("Group turns"));
    // the cards another branch moves to each bot are not here
    expect(html).not.toContain('data-settings-card="general.toolAccess"');
    expect(html).not.toContain('data-settings-card="general.threadCleanup"');
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("keeps them on App on a desktop with no server, where Organization is hidden", async () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: false }, environments: {}, orgJoin: {} } });
    const { isSoloDesktop } = await import("./SettingsModal");
    expect(isSoloDesktop({} as never)).toBe(true);
    fixture.section = "about";
    const html = await render();
    expect(html).toContain('data-settings-card="organization.roomTurns"');
    expect(html).toContain('data-settings-card="organization.mcpCalls"');
    expect(html).toContain('data-settings-card="general.threadCleanup"');
  });

  it("finds them by search and opens them from old and new links", async () => {
    const { cardsMatching, SECTIONS, sectionMatches } = await import("./SettingsModal");
    expect(cardsMatching("mcp")).toContain("organization.mcpCalls");
    const org = SECTIONS.find((entry) => entry.id === "organization")!;
    const general = SECTIONS.find((entry) => entry.id === "account")!;
    for (const word of ["mcp", "group turns", "routines"]) {
      expect(sectionMatches(org, word), word).toBe(true);
      expect(sectionMatches(general, word), word).toBe(false);
    }
    expect(sectionMatches(general, "mcp", ["mcp"])).toBe(true);
    const { currentSettingsSection, currentSettingsCard, isMovedOrganizationCard } = await import("@/lib/settings-sections");
    expect(currentSettingsSection("general", "general.mcpCalls")).toBe("organization");
    expect(currentSettingsSection("general", "organization.roomTurns")).toBe("organization");
    expect(currentSettingsCard("general.roomTurns")).toBe("organization.roomTurns");
    expect(isMovedOrganizationCard("general.threadCleanup")).toBe(false);
    expect(currentSettingsSection("general", "general.threadCleanup")).toBe("about");
  });
});
