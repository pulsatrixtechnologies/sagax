// Settings > Developer (#2636, JC 2026-11-07: « move every item that is
// technical into the developer section »). One page of the App group, open
// to every member in Simple and Advanced mode, holds the technical options
// that were spread over Appearance, General, Usage, Experimental, About and
// Backups. Each option lives there only; the old card ids and search words
// land on Developer; each origin page keeps one discreet link.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "developer" as AppSettingsSection,
  config: { rooms: { turnTimeoutMinutes: 5 } } as Record<string, unknown> | undefined,
  advanced: true,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, appSettingsSubPage: null, instances: [], bots: [], groups: [], config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
  usageMeterEnabled: () => false,
  setUsageMeterEnabled: async () => false,
}));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => ({ status: "idle", allowPrerelease: false }) }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

const { SettingsModal, SECTIONS, sectionMatches } = await import("./SettingsModal");
const { CARD_HOME, currentSettingsSection } = await import("@/lib/settings-sections");
const lazy = await import("./lazy-settings-sections");
const render = () => renderToStaticMarkup(createElement(SettingsModal));

const DEVELOPER_CARDS = [
  "developer.conversation", "general.usage", "organization.roomTurns", "organization.mcpCalls",
  "general.loopGuard", "general.telemetry", "general.threadCleanup", "developer.diagnostics",
  "general.diagnostics", "general.logs", "developer.devPods",
  // #2658 (lot 2): the bot page's technical cards and the Claude Code switches
  "developer.bot", "developer.claudeCode",
];

// The settings pages load on demand; a static render shows a page only once its chunk is here.
beforeAll(async () => {
  await Promise.all(Object.values(lazy).map((screen) => (screen as { preload?: () => Promise<unknown> }).preload?.()));
});
beforeEach(() => {
  fixture.section = "developer";
  fixture.config = { rooms: { turnTimeoutMinutes: 5 } };
  fixture.advanced = true;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  // the desktop shell: diagnostics and logs exist (About showed them there)
  vi.stubGlobal("window", { ogb: { exportDiagnostics: async () => "", exportLogs: async () => "" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings > Developer (#2636)", () => {
  it("is a page of the App group, between Updates and About, with no admin gate", () => {
    const entry = SECTIONS.find((section) => section.id === "developer");
    expect(entry?.group).toBe("app");
    expect(entry?.introKey).toBe("settings.intro.developer");
    const app = SECTIONS.filter((section) => section.group === "app").map((section) => section.id);
    expect(app).toEqual(["general", "updates", "developer", "about"]);
    const html = render();
    expect(html).toContain('<option value="developer" selected="">Developer</option>');
  });

  it("holds every technical option in its own card, with a heading each", () => {
    const html = render();
    for (const card of DEVELOPER_CARDS) expect(html, card).toContain(`data-settings-card="${card}"`);
    for (const heading of ["Conversation", "Bots", "Loop guard", "OpenTelemetry", "Event log cleanup", "Diagnostics", "Context pods", "Per bot", "Claude Code"]) {
      expect(html, heading).toMatch(new RegExp(`<h3[^>]*>${heading}</h3>`));
    }
    // nothing folds away on this page: it is the technical page
    expect(html).not.toContain('data-settings-advanced=""');
    expect(html).not.toContain("developer.advancedFold");
    expect(html).not.toMatch(/[–—]/);
  });

  it("shows the same cards in Simple mode (no Advanced fold, no Developer mode switch)", () => {
    fixture.advanced = false;
    const html = render();
    for (const card of ["developer.conversation", "general.loopGuard", "general.telemetry", "developer.diagnostics"]) {
      expect(html, card).toContain(`data-settings-card="${card}"`);
    }
    expect(html).not.toContain("developer.advancedFold");
  });

  it("keeps the installation's options to those who may edit it; the person's own stay", () => {
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    const html = render();
    expect(html).toContain('data-settings-card="developer.conversation"');
    expect(html).toContain('data-settings-card="developer.devPods"');
    expect(html).not.toContain('data-settings-card="general.loopGuard"');
    expect(html).not.toContain('data-settings-card="general.telemetry"');
    expect(html).not.toContain('data-settings-card="organization.mcpCalls"');
  });

  it("removes each option from its origin page, which keeps one discreet link to Developer", () => {
    const origins: Array<[AppSettingsSection, string[]]> = [
      ["appearance", ['data-settings-group="conversationAdvanced"', 'data-settings-row="runCard"', "Inspector button", "Turn timing"]],
      ["general", ['data-settings-card="general.loopGuard"', 'data-settings-card="general.telemetry"', 'data-settings-card="organization.mcpCalls"']],
      ["usage", ['data-settings-card="general.usage"']],
      ["about", ['data-settings-card="general.diagnostics"', 'data-settings-card="general.logs"']],
      ["backups", ['data-settings-card="general.threadCleanup"']],
    ];
    for (const [section, gone] of origins) {
      fixture.section = section;
      const html = render();
      for (const text of gone) expect(html, `${section}: ${text}`).not.toContain(text);
      expect(html, section).toContain('data-developer-link=""');
      expect(html.match(/data-developer-link=""/g), section).toHaveLength(1);
    }
    // Send feedback stays on About; Routines in conversation stays with the bot rules
    fixture.section = "about";
    expect(render()).toContain('data-settings-card="general.feedback"');
  });

  it("sends the old card ids, deep links and search words to Developer, and nowhere else", () => {
    for (const card of ["general.loopGuard", "general.telemetry", "general.usage", "general.threadCleanup", "general.diagnostics", "general.logs", "experimental.developer", "organization.mcpCalls", "organization.roomTurns"]) {
      expect(CARD_HOME[card], card).toBe("developer");
      expect(currentSettingsSection("general", card), card).toBe("developer");
    }
    for (const card of ["developer.bot", "developer.claudeCode"]) {
      expect(CARD_HOME[card], card).toBe("developer");
    }
    for (const query of ["loop guard", "opentelemetry", "usage meter", "diagnostics", "download logs", "inspector", "run card", "turn timing", "context pods", "event log", "retention", "mcp call", "timeout",
      // #2658: the bot page's technical cards and the Claude Code switches
      "webhooks", "export zip", "embeddings", "skills folder", "working folder", "daily logs", "always allowed", "tool selection"]) {
      const found = SECTIONS.filter((entry) => sectionMatches(entry, query)).map((entry) => entry.id);
      expect(found, query).toEqual(["developer"]);
    }
    // Send feedback is still found on About only
    expect(SECTIONS.filter((entry) => sectionMatches(entry, "send feedback")).map((entry) => entry.id)).toEqual(["about"]);
  });

  it("reads in French", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain('<option value="developer" selected="">Développeur</option>');
    expect(html).toContain(">Garde-fou de boucle</h3>");
    expect(html).toContain(">Par bot</h3>");
    expect(html).not.toMatch(/[–—]/);
  });

  // #2658 (lot 2): the bot page's technical cards (working folder, tool
  // selection, webhooks, always-allowed list, memory logs and embeddings,
  // export zip) and the Claude Code switches live on Developer only.
  it("holds the per-bot technical cards behind a bot picker, with no bot yet", () => {
    const html = render();
    expect(html).toContain('data-settings-card="developer.bot"');
    expect(html).toContain('data-developer-bot-picker=""');
    expect(html).toContain("No bot yet");
    expect(html).not.toContain('data-bot-webhooks=""');
  });

  it("keeps the Claude Code switches for those who may edit the config", () => {
    let html = render();
    expect(html).toContain('data-settings-card="developer.claudeCode"');
    expect(html).toContain('data-settings-row="claudeUserMcp"');
    expect(html).toContain('data-settings-row="claudeUserSkills"');
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, viewer: { operator: false, role: "member" } };
    html = render();
    expect(html).not.toContain('data-settings-card="developer.claudeCode"');
  });
});
