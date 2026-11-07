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
  const { DeveloperSettings, ExperimentalSettings, OrganizationSettings } = await import("./lazy-settings-sections");
  await Promise.all([DeveloperSettings.preload(), ExperimentalSettings.preload(), OrganizationSettings.preload()]);
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

  it("folds a feature this server predates under Needs a server update (#2093)", async () => {
    // An organization server older than Sagax 0.5.3 does not know the
    // feature: its config has no dataWindow, and it refuses to save one.
    fixture.section = "experimental";
    const html = await render();
    expect(html).toContain('data-experimental-feature="dataWindow"');
    expect(html).toContain('data-settings-card="experimental.needsServerUpdate"');
    expect(html).toContain("Arrives with the next server update.");
    expect(html).toContain('data-unavailable=""');
    expect(switchNamed("Turn on the Data window")).toBeUndefined();
  });

  it("is a switch list with a calculated count, no Experimental features heading, no Decision model (#2093)", async () => {
    fixture.section = "experimental";
    fixture.features = { dataWindow: false, meetingNotetaker: false, llmThreadTitles: false };
    const html = await render();
    expect(html).toContain('data-settings-group="experimental"');
    expect(html).not.toContain(">Experimental features</h3>");
    // skill authoring on; browser on Computer (#2080 L3); three served switches off; no Decision model (#2093)
    expect(html).toContain("· 1 of 4 on");
    for (const feature of ["skillAuthoring", "dataWindow", "meetingNotetaker", "llmThreadTitles"]) {
      expect(html, feature).toContain(`data-experimental-feature="${feature}"`);
    }
    // #2636: Context pods are on Settings > Developer; Experimental keeps one link there
    expect(html).not.toContain('data-experimental-feature="devPods"');
    expect(html).toContain('data-developer-link=""');
    expect(html).not.toContain('data-experimental-feature="browser"');
    expect(html).not.toContain('data-experimental-feature="decisionModel"');
    expect(html).not.toContain('data-experimental-feature="browser"');
    expect(html).not.toContain('data-settings-card="experimental.developer"');
    expect(html).not.toContain("Early features may change");
    expect(html).not.toContain("Save a bot's verification run as a skill");
    expect(html).not.toContain("Adds the Decision model card");
    expect(html).toContain('data-settings-card="experimental.features"');
    expect(html).not.toMatch(/[–—]/);
  });

  it("lists an unserved feature under Needs a server update, with the reason on demand", async () => {
    fixture.section = "experimental";
    const html = await render();
    expect(html).toContain('data-experimental-feature="dataWindow"');
    expect(html).toContain('data-unavailable=""');
    expect(html).toContain("Needs a server update");
    expect(html).toContain('aria-label="More about Data window"');
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

  it("mounts system rows on General, cleanup and diagnostics on Developer (#2636); routines stay on Organization when it shows", async () => {
    fixture.features = { routinesInConversation: true };
    fixture.section = "general";
    const general = await render();
    expect(general).toContain('data-settings-card="general.system"');
    expect(general).not.toContain('data-settings-card="general.threadCleanup"');
    expect(general).not.toContain('data-settings-card="about.help"');
    fixture.section = "backups";
    expect(await render()).not.toContain('data-settings-card="general.threadCleanup"');
    fixture.section = "developer";
    expect(await render()).toContain('data-settings-card="general.threadCleanup"');
    fixture.section = "about";
    const html = await render();
    expect(html).toContain('data-settings-card="about.help"');
    expect(html).not.toContain('data-settings-card="general.threadCleanup"');
    for (const card of ["general.toolAccess", "general.threads", "general.recovery"]) expect(html, card).not.toContain(`data-settings-card="${card}"`);
    expect(html).not.toContain("Routines in the conversation");
    expect(html).not.toContain('data-settings-card="organization.roomTurns"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
    expect(fixture.api).not.toHaveBeenCalled();
  });
});

describe("Settings > Organization (cards from General > Advanced, 2026-10-15; timeouts on Developer since #2636)", () => {
  it("shows routines; group turns and MCP calls are on Developer with their current values", async () => {
    fixture.features = { routinesInConversation: true };
    fixture.section = "organization";
    const html = await render();
    expect(html).toContain('data-settings-card="organization.routinesInConversation"');
    expect(html).toContain("Routines in the conversation");
    expect(switchNamed("Run routines in the conversation")?.checked).toBe(true);
    expect(html).not.toContain('data-settings-card="organization.roomTurns"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
    fixture.section = "developer";
    const developer = await render();
    expect(developer).toContain('data-settings-card="organization.roomTurns"');
    // 0.5.6: a row with its minutes field, no folded card
    expect(developer).toMatch(/id="room-turn-timeout"[^>]*value="12"/);
    expect(developer).toContain('data-settings-card="organization.mcpCalls"');
    expect(developer).not.toContain("Routines in the conversation");
    // the cards another branch moves to each bot are not here
    expect(html).not.toContain('data-settings-card="general.toolAccess"');
    expect(html).not.toContain('data-settings-card="general.threadCleanup"');
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("keeps routines on App on a desktop with no server, where Organization is hidden; the timeouts stay on Developer", async () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: false }, environments: {}, orgJoin: {} } });
    const { isSoloDesktop } = await import("./SettingsModal");
    expect(isSoloDesktop({} as never)).toBe(true);
    fixture.section = "general";
    const html = await render();
    expect(html).toContain('data-settings-card="general.bots"');
    expect(html).not.toContain('data-settings-card="organization.roomTurns"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
    fixture.section = "developer";
    const developer = await render();
    expect(developer).toContain('data-settings-card="organization.roomTurns"');
    expect(developer).toContain('data-settings-card="organization.mcpCalls"');
    expect(developer).toContain('data-settings-card="general.threadCleanup"');
    fixture.section = "backups";
    expect(await render()).not.toContain('data-settings-card="general.threadCleanup"');
  });

  it("finds them by search and opens them from old and new links", async () => {
    const { cardsMatching, SECTIONS, sectionMatches } = await import("./SettingsModal");
    expect(cardsMatching("mcp")).toContain("organization.mcpCalls");
    const org = SECTIONS.find((entry) => entry.id === "organization")!;
    const developer = SECTIONS.find((entry) => entry.id === "developer")!;
    const general = SECTIONS.find((entry) => entry.id === "account")!;
    expect(sectionMatches(org, "routines")).toBe(true);
    expect(sectionMatches(developer, "routines")).toBe(false);
    for (const word of ["mcp", "group turns"]) {
      expect(sectionMatches(developer, word), word).toBe(true);
      expect(sectionMatches(org, word), word).toBe(false);
      expect(sectionMatches(general, word), word).toBe(false);
    }
    expect(sectionMatches(general, "mcp", ["mcp"])).toBe(true);
    const { currentSettingsSection, currentSettingsCard, isMovedOrganizationCard } = await import("@/lib/settings-sections");
    expect(currentSettingsSection("general", "general.routinesInConversation")).toBe("organization");
    // #2636: the timeouts' old and new ids open Developer
    expect(currentSettingsSection("general", "general.mcpCalls")).toBe("developer");
    expect(currentSettingsSection("general", "organization.roomTurns")).toBe("developer");
    expect(currentSettingsCard("general.roomTurns")).toBe("organization.roomTurns");
    expect(isMovedOrganizationCard("general.threadCleanup")).toBe(false);
    expect(currentSettingsSection("general", "general.threadCleanup")).toBe("developer");
  });
});
