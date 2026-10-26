// Settings cleanup for organization servers (2026-10-01): Email is a solo
// server's only (Perspicax manages an organization's mail), "Local VM" reads
// "Computer", and Connected apps is an experiment, off by default.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  features: {} as Record<string, boolean>,
  viewer: undefined as { role: "member" | "admin" | "owner"; operator: boolean } | undefined,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({
    state: { appSettingsSection: fixture.section, instances: [], bots: [], groups: [], config: { features: fixture.features, viewer: fixture.viewer, rooms: { turnTimeoutMinutes: 5 }, ...Object.fromEntries(["openai", "anthropic", "xai", "openrouter", "mistral", "openaiCompat", "box", "vps", "opencodeGo"].map((key) => [key, { configured: false }])) } },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => null,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ useDesktopWorkspace: () => ({ available: false, current: null, open: false, error: "", openMenu: () => {} }) }));
vi.mock("./MailSettings", () => ({ MailSettings: () => "MAIL_SETTINGS_MARKER" }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => "LOCAL_COMPUTER_MARKER" }));

beforeEach(() => {
  fixture.section = "general";
  fixture.org = null;
  fixture.features = {};
  fixture.viewer = undefined;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
};
const ORG = { org: { name: "Example", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } } };

describe("Settings on an organization server", () => {
  it("leaves Email out on an organization server and keeps it on a solo server", async () => {
    const { organizationHidesSection } = await import("./SettingsModal");
    expect(organizationHidesSection("mail", true)).toBe(true);
    expect(organizationHidesSection("mail", false)).toBe(false);
    expect(organizationHidesSection("engines", true)).toBe(false);
    // Privacy (read receipts between people) exists on an organization server only
    expect(organizationHidesSection("privacy", true)).toBe(false);
    expect(organizationHidesSection("privacy", false)).toBe(true);

    // 2026-10-14: Email and Activity are hidden in the app (Sagax Business
    // manages them); Privacy is a card of Notifications
    fixture.section = "people";
    const solo = await render();
    expect(solo).not.toContain("MAIL_SETTINGS_MARKER");
    expect(solo).not.toContain('<option value="mail"');
    expect(solo).not.toContain('<option value="activity"');
    fixture.section = "notifications";
    expect(await render()).not.toContain('data-settings-card="notifications.privacy"');
    fixture.org = ORG;
    const privacy = await render();
    expect(privacy).toContain('data-settings-card="notifications.privacy"');
    expect(privacy).toContain(">Privacy<");
    expect(privacy).not.toContain('<option value="privacy"');
  });

  it("opens an old Email or Activity link on the nearest page, and Privacy on its card", async () => {
    for (const section of ["mail", "activity"] as const) {
      fixture.section = section;
      const html = await render();
      expect(html, section).not.toContain("MAIL_SETTINGS_MARKER");
      expect(html, section).toContain('<option value="general" selected="">General</option>');
    }
    fixture.org = ORG;
    fixture.section = "privacy";
    expect(await render()).toContain('data-settings-card="notifications.privacy"');
  });

  it("names the Local VM page Computer (Ordinateur), with the same content", async () => {
    fixture.section = "computer";
    const html = await render();
    expect(html).toContain(">Computer<");
    expect(html).not.toContain(">Local VM<");
    expect(html).toContain("LOCAL_COMPUTER_MARKER");
    setLocale("fr");
    expect(await render()).toContain(">Ordinateur<");
  });

  it("finds the Computer page by its old name", async () => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const computer = SECTIONS.find((entry) => entry.id === "computer")!;
    expect(sectionMatches(computer, "local vm")).toBe(true);
    expect(sectionMatches(computer, "computer")).toBe(true);
  });
});

describe("an organization member", () => {
  const member = { role: "member" as const, operator: false };

  it("does not see installation sections the server refuses", async () => {
    fixture.viewer = member;
    fixture.org = ORG;
    const { memberHidesSection } = await import("./SettingsModal");
    const hidden = { editConfig: false, manageComputers: false, manageBackups: false, organization: true };
    expect(memberHidesSection("experimental", hidden)).toBe(true);
    expect(memberHidesSection("decisionModel", hidden)).toBe(true);
    // 2026-10-15: Usage is the person's own (GET /api/me/usage): every member sees it
    expect(memberHidesSection("usage", hidden)).toBe(false);
    expect(memberHidesSection("backups", hidden)).toBe(true);
    expect(memberHidesSection("general", hidden)).toBe(false);
    expect(memberHidesSection("computer", hidden)).toBe(false);
    expect(memberHidesSection("computer", { ...hidden, organization: false })).toBe(true);
    expect(memberHidesSection("engines", hidden)).toBe(false);

    const nav = await render();
    expect(nav).not.toContain(">Experimental<");
    expect(nav).not.toContain(">API keys<");
    expect(nav).not.toContain(">Decision model<");
    expect(nav).toContain(">Usage<");
    expect(nav).not.toContain(">Backups<");
    expect(nav).toContain(">General<");
    expect(nav).toContain(">Computer<");
  });

  it("opens Usage on the member's own usage", async () => {
    fixture.viewer = member;
    fixture.org = ORG;
    fixture.section = "usage";
    const html = await render();
    expect(html).toContain('<option value="usage" selected="">Usage</option>');
    expect(html).toContain('data-settings-card="usage.cost"');
    // the link to the organization's console is an admin's
    expect(html).not.toContain("data-usage-org-link");
  });

  it("hides the General and Appearance rows that write the installation", async () => {
    fixture.viewer = member;
    fixture.section = "general";
    const general = await render();
    expect(general).not.toContain("Effort for new bots");
    expect(general).not.toContain("Defaults for new bots");
    expect(general).not.toContain("Routines in the conversation");
    expect(general).not.toContain("Group turns");
    expect(general).toContain("Language");

    fixture.section = "appearance";
    expect(await render()).not.toContain("Tool calls");
    expect(await render()).toContain("Interface font");
  });
});

// 2026-10-15 (JC): People and Installations are hidden in the app, like
// Email, Activity and Pair devices; managing several people or
// installations is Sagax Business's job. Their server routes stay.
describe("People and Installations are hidden in the app", () => {
  it("lists neither page, for an owner or a member, solo or organization", async () => {
    const { SECTIONS } = await import("./SettingsModal");
    expect(SECTIONS.map((entry) => entry.id)).not.toContain("people");
    expect(SECTIONS.map((entry) => entry.id)).not.toContain("workspaces");
    for (const org of [null, ORG]) {
      for (const viewer of [undefined, { role: "member" as const, operator: false }]) {
        fixture.org = org;
        fixture.viewer = viewer;
        const html = await render();
        expect(html).not.toContain('<option value="people"');
        expect(html).not.toContain('<option value="workspaces"');
        expect(html).not.toContain(">People<");
        expect(html).not.toContain(">Installations<");
      }
    }
  });

  it("opens an old People, Installations or Email link on General", async () => {
    for (const section of ["people", "workspaces", "mail"] as const) {
      fixture.section = section;
      const html = await render();
      expect(html, section).toContain('<option value="general" selected="">General</option>');
      expect(html, section).not.toContain("MAIL_SETTINGS_MARKER");
      expect(html, section).not.toContain('data-settings-card="people.list"');
    }
  });
});

