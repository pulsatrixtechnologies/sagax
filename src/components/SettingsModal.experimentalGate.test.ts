// Settings > Experimental is gated on server.experimental (2026-10-22, JC):
// an organization member who lacks the right never sees the section; one an
// admin gave it (or server.settings, which implies it) does. The switches
// write features only; the deeper browser-profile controls stay with a
// config editor.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

type Viewer = {
  role: "member" | "admin" | "owner";
  operator: boolean;
  permissions?: string[];
  capabilities?: Record<string, boolean>;
};

const fixture = vi.hoisted(() => ({
  section: "experimental" as AppSettingsSection,
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  features: { dataWindow: false, meetingNotetaker: false } as Record<string, boolean>,
  viewer: undefined as Viewer | undefined,
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
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.viewer?.role !== "member" }));
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
vi.mock("./settings/MyChromeSettings", () => ({ MyChromeSettings: () => "MY_CHROME_MARKER" }));

const ORG = { org: { name: "Example", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } } };

beforeEach(() => {
  fixture.section = "experimental";
  fixture.org = ORG;
  fixture.features = { dataWindow: false, meetingNotetaker: false, browser: true };
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

describe("Settings > Experimental gated on server.experimental", () => {
  it("hides the section from a member who lacks the right", async () => {
    fixture.viewer = { role: "member", operator: false, permissions: [] };
    const html = await render();
    expect(html).not.toContain(">Experimental<");
    expect(html).not.toContain('data-settings-card="experimental.features"');
    expect(html).not.toContain('<option value="experimental"');
  });

  it("hides the section from a server.settings-only delegate (no implication)", async () => {
    // 2026-10-22 (JC): server.experimental is explicit; server.settings alone,
    // even with editConfig, does not reveal Experimental.
    fixture.viewer = { role: "member", operator: false, permissions: ["server.settings"], capabilities: { editConfig: true, manageKeys: true, manageComputers: true, viewUsage: true, manageBackups: true, pairDevices: true } };
    const html = await render();
    expect(html).not.toContain(">Experimental<");
    expect(html).not.toContain('data-settings-card="experimental.features"');
  });

  it("shows the section to a member an admin gave the right", async () => {
    fixture.viewer = { role: "member", operator: false, permissions: ["server.experimental"] };
    const html = await render();
    expect(html).toContain(">Experimental<");
    expect(html).toContain('data-settings-card="experimental.features"');
    // the feature switches are there
    expect(html).toContain('data-experimental-feature="dataWindow"');
  });

  it("hides the deeper browser controls from an experimental-only member (no config edit)", async () => {
    fixture.viewer = { role: "member", operator: false, permissions: ["server.experimental"] };
    const html = await render();
    // the browser switch shows, but not the profiles manager nor the my-Chrome link
    expect(html).toContain('data-experimental-feature="browser"');
    expect(html).not.toContain("MY_CHROME_MARKER");
    expect(html).not.toContain('data-settings-card="experimental.browserProfiles"');
  });

  it("shows the deeper browser controls to a config editor", async () => {
    fixture.viewer = { role: "member", operator: false, permissions: ["server.experimental"], capabilities: { editConfig: true, manageKeys: true, manageComputers: true, viewUsage: true, manageBackups: true, pairDevices: true } };
    const html = await render();
    expect(html).toContain("MY_CHROME_MARKER");
    expect(html).toContain('data-settings-card="experimental.browserProfiles"');
  });

  it("keeps the section for an admin", async () => {
    fixture.viewer = { role: "admin", operator: false };
    const html = await render();
    expect(html).toContain(">Experimental<");
    expect(html).toContain('data-settings-card="experimental.features"');
  });
});
