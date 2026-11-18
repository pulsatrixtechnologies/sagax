import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { SettingsModal } from "./SettingsModal";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

// Server mode (src/lib/launch.ts): the desktop app shows its organization's
// server only. Settings > General names that server with the one way out,
// and a section about this computer says the organization manages it.
const fixture = vi.hoisted(() => ({
  section: "account" as AppSettingsSection,
  serverMode: null as null | { active: false } | { active: true; name: string; origin: string },
  viewer: undefined as undefined | Record<string, unknown>,
  workspace: { available: false, current: null as null | { local: boolean; name: string; origin?: string }, open: false, error: "", openMenu: () => {} },
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, appSettingsSubPage: null, instances: [], bots: [], groups: [], config: fixture.viewer ? { rooms: { turnTimeoutMinutes: 5 }, viewer: fixture.viewer, profile: { aboutMe: "I run IT at Example.\nAnswer in French." } } : undefined }, dispatch: vi.fn() }),
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => fixture.serverMode,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ useDesktopWorkspace: () => fixture.workspace }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => "LOCAL_COMPANION_MARKER" }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => "SERVER_PAIRING_CARD_MARKER" }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: () => null }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "account";
  fixture.serverMode = null;
  fixture.viewer = undefined;
  fixture.workspace = { available: false, current: null, open: false, error: "", openMenu: () => {} };
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  // this app's bundle on the organization server: a reduced bridge, no remoteClient
  vi.stubGlobal("window", { ogb: { serverMode: { state: vi.fn(), leave: vi.fn() } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

const CONTAINER_BORDER = /[\s"]rounded-(?:\[14px\]|\[20px\]|xl|lg)(?=[\s"]).*?\s(?:border|border-\[0\.5px\])(?=[\s"])/;
/** Bordered containers drawn inside another bordered container (a card in
 * a card). Not counted: a field's own frame (focus-within) and a popover
 * (absolute), which frame an input or float rather than nest a card. */
function nestedCardBorders(html: string): string[] {
  const body = html.slice(html.indexOf('<div class="flex flex-col gap-3 px-4'));
  const found: string[] = [];
  const stack: boolean[] = [];
  for (const [tag] of body.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (tag === "</div>") { stack.pop(); continue; }
    const container = CONTAINER_BORDER.test(tag) && !/[\s"](?:absolute|focus-within:)/.test(tag);
    if (container && stack.includes(true)) found.push(tag);
    stack.push(container);
  }
  return found;
}

describe("Settings in server mode", () => {
  it("General's Account card is the reference's: name, email, pills, then Team; the server and the managed note in Team's tooltip", () => {
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    fixture.viewer = { principalId: "pr_jean", name: "Jean Tremblay", email: "jean@example.com", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
    const html = render();
    const card = html.slice(html.indexOf('data-settings-card="general.account"'));
    expect(html.match(/data-settings-card="general\.(?:account|profile|serverMode)"/g)).toEqual(['data-settings-card="general.account"']);
    // the identity row is name then email; the pills sit at its right; Team comes below
    const order = [">Jean Tremblay<", ">jean@example.com<", "Sign out</button>", "data-account-team"];
    const positions = order.map((text) => card.indexOf(text));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    // the owner 2026-11-17: no Server row and no managed line; the address,
    // then the managed note, are the tooltip of the organization's name,
    // which opens the Perspicax profile
    expect(card).toMatch(/data-account-team[^>]*><span[^>]*>Team<\/span><button type="button" title="Connected to bot\.example\.test · Managed by your organization · Edit in Perspicax"[^>]*>Example<\/button>/);
    expect(html).not.toContain("data-server-connected");
    expect(html).not.toContain("data-account-managed");
    expect(html).not.toMatch(/>Managed by your organization</);
    expect(html).not.toMatch(/>Edit in Perspicax</);
    expect(html).not.toContain("Signed in as");
    expect(html.match(/Jean Tremblay/g)).toHaveLength(1);
    expect(html.match(/jean@example\.com/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="button" class="ui-button[^"]*">.*?Sign out<\/button>/);
    expect(html).not.toContain("Your bots run on this server.");
    expect(html).not.toContain("data-account-help");
    expect(card).toContain('aria-label="Copy email"');
    expect(html).not.toMatch(/>Change<\/button>/);
    expect(html).not.toContain("Switch server");
    expect(html.indexOf(">Account<")).toBeLessThan(html.indexOf('data-settings-card="general.account"'));
    // About me left the settings: the person's bots keep it
    expect(html).not.toContain('data-settings-card="general.aboutMe"');
  });

  it("reads Se déconnecter in French", () => {
    setLocale("fr");
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    fixture.viewer = { principalId: "pr_jean", name: "Jean Tremblay", email: "jean@example.com", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
    const html = render();
    expect(html).toContain("Se déconnecter");
    expect(html).toContain("Équipe");
    expect(html).not.toContain("Ajouter une étiquette");
    expect(html).not.toContain("À propos de moi");
    expect(html).toContain('title="Connecté à bot.example.test · Géré par ton organisation · Modifier dans Perspicax"');
  });

  it("a server whose profile is not managed: the address is the tooltip of the organization on Team", () => {
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    fixture.viewer = { principalId: "pr_jean", name: "Jean Tremblay", email: "jean@example.com" };
    const html = render();
    expect(html).toMatch(/data-account-team[^>]*><span[^>]*>Team<\/span><span title="Connected to bot\.example\.test"[^>]*>Example<\/span>/);
    expect(html).not.toContain("data-server-connected");
    expect(html).not.toContain("Managed by your organization");
    expect(html).toContain("Sign out</button>");
  });

  it("General draws one card level: no bordered container inside a card", () => {
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    fixture.viewer = { name: "Jean Tremblay", email: "jean@example.com", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
    const html = render();
    expect(html).toContain('data-testid="account-identity"');
    expect(nestedCardBorders(html)).toEqual([]);
    // the owner 2026-11-17: About me is no row here any more (the bots keep it)
    expect(html).not.toContain('data-settings-card="general.aboutMe"');
    expect(html).not.toContain("I run IT at Example.");
    expect(html).not.toContain("<textarea");
  });

  it("on a personal server: editable name and email, the label and the server switcher", () => {
    fixture.serverMode = { active: false };
    fixture.viewer = { principalId: "pr_me", operator: true };
    fixture.workspace = { available: true, current: { local: true, name: "This Mac" }, open: false, error: "", openMenu: () => {} };
    const html = render();
    expect(html.match(/data-settings-card="general\.(?:account|profile|serverMode)"/g)).toEqual(['data-settings-card="general.account"']);
    expect(html).toContain('aria-label="Your name"');
    expect(html).not.toContain("Add a label");
    expect(html).toMatch(/<button type="button" aria-haspopup="menu" aria-expanded="false" class="ui-button[^"]*">Add account<\/button>/);
    expect(html).not.toContain("Switch server");
    expect(html).not.toContain("data-account-team");
    expect(html).not.toContain("data-account-help");
    expect(html).not.toContain("Managed by your organization");
    expect(html).not.toContain("Edit in Perspicax");
    expect(html).not.toContain("Sign out</button>");
  });

  // 2026-10-14: Pair devices is hidden (devices sign in with the
  // organization): an old link to it opens General, in French as well.
  it("opens General for an old Pair devices link, with no pairing card", () => {
    fixture.section = "companion";
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    const html = render();
    expect(html).toContain('<option value="general" selected="">General</option>');
    expect(html).not.toContain('<option value="companion"');
    expect(html).not.toContain("SERVER_PAIRING_CARD_MARKER");
    expect(html).not.toContain("LOCAL_COMPANION_MARKER");
  });

  it("reads in French", () => {
    setLocale("fr");
    fixture.section = "companion";
    fixture.serverMode = { active: true, name: "Example", origin: "https://bot.example.test" };
    const html = render();
    expect(html).toContain('<option value="general" selected="">Général</option>');
    expect(html).not.toContain("Jumeler des appareils");
  });
});
