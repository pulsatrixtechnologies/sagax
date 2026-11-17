import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { SettingsModal } from "./SettingsModal";

// 2026-10-14 (owner): Settings > Pair devices is hidden. Every device signs in
// with the organization (OAuth through Sagax Business), so the app offers no
// pairing code and no phone flow any more. The server's pairing routes stay
// (the iOS app or an older build may still use them); an old link or
// "Connect your phone" request opens General.
const fixture = vi.hoisted(() => ({ section: "companion" as AppSettingsSection, config: undefined as { cloudHome?: boolean; signIn?: object } | undefined, phonePairing: 0 }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, config: fixture.config, appSettingsPhonePairing: fixture.phonePairing }, dispatch: vi.fn() }),
}));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: () => null }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => "COMPANION_SECTION" }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => "SERVER_PAIRING_CARD_MARKER" }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "companion";
  fixture.config = undefined;
  fixture.phonePairing = 0;
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe("Settings > Pair devices is hidden", () => {
  it.each([
    ["a browser", {}],
    ["the desktop app on its own server", { ogb: { companion: {} } }],
  ])("is not in the menu and an old link opens General, in %s", (_where, win) => {
    vi.stubGlobal("window", win);
    fixture.phonePairing = 2;
    const html = render();
    expect(html).not.toContain('<option value="companion"');
    expect(html).not.toContain(">Pair devices<");
    expect(html).toContain('<option value="general" selected="">General</option>');
    expect(html).not.toContain("SERVER_PAIRING_CARD_MARKER");
    expect(html).not.toContain("COMPANION_SECTION");
  });

  it("lands a remote client on General (its Appearance card) instead", () => {
    vi.stubGlobal("window", { ogb: { companion: {}, remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('<option value="general" selected="">General</option>');
    expect(html).toContain('data-settings-group="generalAppearance"');
    expect(html).not.toContain("SERVER_PAIRING_CARD_MARKER");
  });

  // 2026-10-15: People is hidden in the app too, even where the server
  // serves a sign-in list (its routes stay).
  it("leaves People out even where the server serves a sign-in list", () => {
    vi.stubGlobal("window", {});
    fixture.config = { signIn: {} };
    expect(render()).not.toContain(">People<");
  });
});
