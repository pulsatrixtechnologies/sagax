import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SendKey } from "@/lib/send-key";
import { en, locales } from "@/locales";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { chooseThreadsView, SECTIONS, sectionMatches, SettingsModal } from "./SettingsModal";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
  showThreads: true,
  setShowThreads: vi.fn(),
  setThreadsLocation: vi.fn(),
  showRunCard: true,
  showSuggestions: true,
  showAllHistory: false,
  setShowSuggestions: vi.fn(),
  setShowAllHistory: vi.fn(),
  setShowRunCard: vi.fn(),
  sidebarDensity: "comfortable" as "comfortable" | "compact" | "icons",
  setSidebarDensity: vi.fn(),
  notificationSounds: true,
  nudgeSound: true,
  setNudgeSound: vi.fn(),
  setNotificationSounds: vi.fn(),
  locals: {} as Record<string, boolean>,
  setLocal: vi.fn(),
  sendKey: "enter" as SendKey,
  setSendKey: vi.fn(),
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as ComponentProps<typeof Switch>[],
  showUnreadyProviders: false,
  setShowUnreadyProviders: vi.fn(),
}));
// Cards read the host platform (what a saved sign-in still locked asks for).
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" } } }) }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/thread-preferences", () => ({
  useShowThreads: () => fixture.showThreads,
  useShowThreadsChoice: () => fixture.showThreads,
  setShowThreads: fixture.setShowThreads,
  useThreadsLocationChoice: () => "header",
  setThreadsLocation: fixture.setThreadsLocation,
}));
vi.mock("@/lib/panel-visibility", () => ({
  useShowSuggestions: () => fixture.showSuggestions,
  setShowSuggestions: fixture.setShowSuggestions,
  useShowAllHistory: () => fixture.showAllHistory,
  setShowAllHistory: fixture.setShowAllHistory,
}));
vi.mock("@/lib/run-card-preferences", () => ({
  useShowRunCard: () => fixture.showRunCard,
  setShowRunCard: fixture.setShowRunCard,
}));
vi.mock("@/lib/unready-providers-preference", () => ({
  useShowUnreadyProviders: () => fixture.showUnreadyProviders,
  setShowUnreadyProviders: fixture.setShowUnreadyProviders,
}));
vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.sidebarDensity,
  setSidebarDensity: fixture.setSidebarDensity,
}));
vi.mock("@/lib/notification-preferences", () => {
  const local = (key: string) => ({ key, enabled: () => fixture.locals[key] ?? true, set: (value: boolean) => fixture.setLocal(key, value), subscribe: () => () => {} });
  return {
    useNotificationSounds: () => fixture.notificationSounds,
    useNudgeSound: () => fixture.nudgeSound,
    setNudgeSound: fixture.setNudgeSound,
    setNotificationSounds: fixture.setNotificationSounds,
    persistentNotifications: local("omb-notification-persistent"),
    dockBadge: local("omb-dock-badge"),
    nudgeShake: local("omb-nudge-shake"),
    approvalChime: local("omb-approval-chime"),
    useLocalSwitch: (choice: { enabled: () => boolean }) => choice.enabled(),
  };
});
vi.mock("@/lib/send-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/send-key")>(),
  useSendKey: () => fixture.sendKey,
  setSendKey: fixture.setSendKey,
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props);
      return createElement(original.Switch, props);
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "appearance";
  fixture.showThreads = true;
  fixture.showRunCard = true;
  fixture.showSuggestions = true;
  fixture.showAllHistory = false;
  fixture.sidebarDensity = "comfortable";
  fixture.notificationSounds = true;
  fixture.nudgeSound = true;
  fixture.locals = {};
  fixture.sendKey = "enter";
  fixture.switches = [];
  fixture.showUnreadyProviders = false;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe("Settings → Appearance", () => {
  it("has the Suggestions and All history switches wired to the panel preferences", () => {
    const html = render();
    expect(html).toContain("Show suggestions");
    expect(html).toContain("Show All history");
    const suggestions = fixture.switches.find((props) => props["aria-label"] === "Show the Suggestions card in the bot panel")!;
    expect(suggestions.checked).toBe(true);
    suggestions.onClick!({} as never);
    expect(fixture.setShowSuggestions).toHaveBeenCalledWith(false);
    const history = fixture.switches.find((props) => props["aria-label"] === "Show the All history row in the bot panel")!;
    expect(history.checked).toBe(false);
    history.onClick!({} as never);
    expect(fixture.setShowAllHistory).toHaveBeenCalledWith(true);
  });

  it("groups skins, thread visibility, and tool-call display with preservation copy", () => {
    const html = render();
    expect(html).toContain('<option value="appearance" selected="">Appearance</option>');
    // the skin families (2026-10-19): Midnight is Studio's Neutral variant
    expect(html).toContain('data-skin-family="studio"');
    // one choice for whether and where threads show (2026-10-14)
    expect(html).toContain('aria-label="Conversation threads"');
    expect(html).not.toContain('aria-label="Show threads"');
    expect(html).not.toContain('aria-label="Threads location"');
    expect(html).toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain("on this device only");
    expect(html).not.toContain("data-settings-scope");
    expect(html).not.toContain("Follows your account");
    expect(html).not.toContain("This device only");
    expect(html).not.toContain("Everyone on this server");
    expect(html).not.toContain("Maximum turn length");
  });

  it("is laid out as Grok Bot's pages: grey headings, compact rows, pill menus, no help text", () => {
    const html = render();
    const groups = [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1]);
    expect(groups).toEqual(["interface", "skin", "backgroundEffects", "conversation", "sidebar", "mascots", "accessibility", "desktop"]);
    for (const heading of ["Interface", "Skin", "Background effects", "Conversations", "Sidebar", "Mascots", "Accessibility", "Desktop"]) expect(html).toContain(`>${heading}</h3>`);
    // no native select on the page itself, only the narrow-window section menu
    const page = html.slice(html.indexOf('data-settings-group="interface"'));
    expect(page).not.toContain("<select");
    for (const label of ["Interface font", "Conversation threads", "Send messages with", "Choose sidebar density"]) {
      expect(page).toContain(`aria-label="${label}" aria-haspopup="listbox"`);
    }
    // the help paragraphs are gone; the short lines that avoid a mistake stay
    expect(html).not.toContain("all conversation history and running work");
    expect(html).not.toContain("Overrides the skin's font");
    expect(html).not.toContain("Applies instantly.");
    expect(html).toContain("Saved choices stay either way.");
    // the Theme menu is General's (#573): the miniatures only here
    expect(html).not.toContain('aria-label="Theme"');
    expect(html).toContain('data-skin-grid=""');
    // the effects behind the conversation, chosen as the skins are (the old
    // glyph ripple switch is one of them now)
    expect(html).toContain('data-effect-grid=""');
    expect(html).not.toContain('data-settings-row="glyphRipple"');
    expect(html).not.toMatch(/[–—]/);
  });

  it.each([true, false])("shows the saved thread choice (shown: %s) as one selector", (enabled) => {
    fixture.showThreads = enabled;
    const html = render();
    const pill = /aria-label="Conversation threads"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(pill).toContain(enabled ? ">In the chat header<" : ">One conversation<");
  });

  it("only updates the local preferences when a thread choice is made", () => {
    chooseThreadsView("hidden");
    expect(fixture.setShowThreads).toHaveBeenCalledWith(false);
    expect(fixture.setThreadsLocation).not.toHaveBeenCalled();
    chooseThreadsView("sidebar");
    expect(fixture.setThreadsLocation).toHaveBeenCalledWith("sidebar");
    expect(fixture.setShowThreads).toHaveBeenLastCalledWith(true);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("folds the desktop mascot rows into one card", () => {
    const html = render();
    expect(html).toContain('data-settings-card="appearance.mascots" data-open="false"');
    expect(html).toContain("Desktop mascots");
    expect(html).toContain('aria-label="Desktop mascots"');
    // folded: the five rows are not drawn, their values still apply
    expect(html).not.toContain("data-mascot-rows");
    expect(html).not.toContain("Fly away during tasks");
  });

  it("no longer holds the notification switches: they have their own section", () => {
    const html = render();
    expect(html).not.toContain('aria-label="Notification sounds"');
    expect(html).not.toContain('aria-label="Nudge sound"');
  });

  it.each([
    ["comfortable", "Comfortable"],
    ["compact", "Compact"],
    ["icons", "Avatars only"],
  ] as const)("shows the saved sidebar density (%s) in Appearance", (density, label) => {
    fixture.sidebarDensity = density;
    const html = render();
    expect(html).toContain('aria-label="Choose sidebar density"');
    expect(html).toContain("Sidebar density");
    expect(html).not.toContain("collapsing the sidebar from its header");
    const pill = /aria-label="Choose sidebar density"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(pill).toContain(`>${label}<`);
    expect(fixture.setSidebarDensity).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("offers the unconfigured providers toggle in Appearance, off by default", () => {
    const html = render();
    expect(html).toContain('aria-label="Show unconfigured providers"');
    expect(html).toContain("Unconfigured providers");
    expect(html).not.toContain("they stay hidden until you turn this on");
    expect(html).not.toContain("folded");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show unconfigured providers")!;
    expect(toggle.checked).toBe(false);
    toggle.onClick!({} as never);
    expect(fixture.setShowUnreadyProviders).toHaveBeenCalledWith(true);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();

    fixture.switches = [];
    fixture.showUnreadyProviders = true;
    render();
    const on = fixture.switches.find((props) => props["aria-label"] === "Show unconfigured providers")!;
    expect(on.checked).toBe(true);
  });

  it.each([
    ["enter", "Enter"],
    ["shift-enter", "Shift+Enter"],
    ["mod-enter", "Ctrl+Enter"],
  ] as const)("shows the saved send key (%s) on this device only", (sendKey, label) => {
    fixture.sendKey = sendKey;
    const html = render();
    expect(html).toContain("Send messages with");
    expect(html).toContain('aria-label="Send messages with"');
    // one short line: the other key still sends (Japanese input)
    expect(html).toContain("Ctrl+Enter always sends.");
    const pill = /aria-label="Send messages with"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    // only the key, so the closed menu fits its column in every language
    expect(pill).toContain(`title="${label}"`);
    expect(fixture.setSendKey).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("asks Japanese speakers in Japanese, with the key named for this computer", () => {
    setLocale("ja");
    fixture.sendKey = "shift-enter";
    const html = render();
    expect(html).toContain("メッセージの送信キー");
    const pill = /aria-label="メッセージの送信キー"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(pill).toContain('title="Shift+Enter"');
  });

  it("finds the send key by the keys' names on every platform", () => {
    const appearance = SECTIONS.find((section) => section.id === "appearance")!;
    for (const query of ["enter", "return", "shift+enter", "ctrl+enter", "cmd", "cmd+enter", "⌘", "⌘+enter", "command", "send", "new line", "ime"]) {
      expect(sectionMatches(appearance, query), query).toBe(true);
    }
  });

  it("offers the run card visibility toggle in Appearance", () => {
    fixture.showRunCard = true;
    const html = render();
    expect(html).toContain('aria-label="Show the run card"');
    expect(html).toContain("This run");
    expect(html).not.toContain("saving the run as a skill");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show the run card")!;
    expect(toggle.checked).toBe(true);
    toggle.onClick!({} as never);
    expect(fixture.setShowRunCard).toHaveBeenCalledWith(false);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();

    fixture.showRunCard = false;
    render();
    const off = fixture.switches.filter((props) => props["aria-label"] === "Show the run card").at(-1)!;
    expect(off.checked).toBe(false);
    off.onClick!({} as never);
    expect(fixture.setShowRunCard).toHaveBeenLastCalledWith(true);
  });

  it("leaves non-appearance General settings in place", () => {
    fixture.section = "general";
    const html = render();
    expect(html).toContain("Profile");
    expect(html).toContain('aria-label="App language"');
    // the technical cards are on General > Advanced (2026-10-14)
    expect(html).toContain('data-settings-card="general.advanced"');
    expect(html).not.toContain("Maximum running threads per bot");
    expect(html).not.toContain("Automatic recovery");
    expect(html).not.toContain('aria-label="Show threads"');
    expect(html).not.toContain('aria-label="Choose sidebar density"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain('aria-label="Show unconfigured providers"');
    expect(html).not.toContain('data-skin-family="studio"');
  });

  it("makes local appearance available remotely without exposing server settings", () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('<option value="appearance" selected="">Appearance</option>');
    // Pair devices is hidden since 2026-10-14
    expect(html).not.toContain('<option value="companion"');
    expect(html).not.toContain('<option value="general">');
    expect(html).not.toContain('<option value="connections">');
    expect(html).not.toContain('<option value="engines">');
    expect(html).not.toContain('<option value="backups">');
    expect(html).toContain('data-skin-family="studio"');
    expect(html).toContain('aria-label="Conversation threads"');
    // this computer's notification switches stay reachable from a remote page
    expect(html).toContain('<option value="notifications">Notifications</option>');
    expect(html).toContain('aria-label="Choose sidebar density"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
  });

  it("offers full backups in local Settings", () => {
    fixture.section = "backups";
    const html = render();
    expect(html).toContain('<option value="backups" selected="">Backups</option>');
    // one card, two actions; each form opens in place (2026-10-14)
    expect(html).toContain('data-backup-action="export"');
    expect(html).toContain('data-backup-action="import"');
  });

  it("renders Appearance and its controls in Japanese", () => {
    setLocale("ja");
    const html = render();
    for (const key of ["settings.section.appearance", "settings.sendKey.title"] as const) {
      expect(locales.ja[key], key).toBeTruthy();
      expect(locales.ja[key], key).not.toBe(en[key]);
      expect(html, key).toContain(locales.ja[key]!);
    }
  });

  it("uses English fallback for new keys in an incomplete language pack", () => {
    locales.zz = {};
    try {
      setLocale("zz");
      const html = render();
      expect(html).toContain("Appearance");
      expect(html).toContain('aria-label="Conversation threads"');
      expect(html).toContain("Sidebar");
      expect(html).not.toContain("settings.group");
      expect(html).not.toContain("settings.threadsView");
    } finally {
      delete locales.zz;
      setLocale("en");
    }
  });

  // The joined-servers list and the join card both wait on the /api/org
  // load, which this suite never flushes (no effects run under
  // renderToStaticMarkup); OrganizationSettings.test.ts covers that content
  // once loaded. This only pins the section itself and its nav visibility.
  it("offers Organisation settings locally and in a browser, folding the joined-servers list into it", () => {
    fixture.section = "organization";
    vi.stubGlobal("window", { ogb: { organization: {} } });
    const local = render();
    expect(local).toContain('<option value="organization" selected="">Organization</option>');
    expect(local).not.toContain('<option value="desktopWorkspaces"');
    // The enterprise Admin connection stays hidden until it is in use.
    expect(local).not.toContain("personal and local models");
    vi.stubGlobal("window", {});
    const browser = render();
    expect(browser).toContain('<option value="organization" selected="">Organization</option>');
  });

  it("keeps Organisation reachable to a remote client instead of hiding it", () => {
    fixture.section = "organization";
    vi.stubGlobal("window", { ogb: { organization: {}, remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('<option value="organization" selected="">Organization</option>');
    fixture.section = "appearance";
    expect(render()).toContain('data-skin-family="studio"');
  });
});

describe("Settings → Notifications", () => {
  it.each([true, false])("mutes notification sounds on this computer only when the switch is %s", (enabled) => {
    fixture.notificationSounds = enabled;
    fixture.section = "notifications";
    const html = render();
    expect(html).toContain('aria-label="Notification sounds"');
    expect(html).not.toContain("keep the banners but lose the chime");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Notification sounds")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setNotificationSounds).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("toggles the nudge sound on this computer only when the switch is %s", (enabled) => {
    fixture.nudgeSound = enabled;
    fixture.section = "notifications";
    render();
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Nudge sound")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setNudgeSound).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("has its own section with every switch on by default", () => {
    fixture.section = "notifications";
    const html = render();
    expect(html).toContain('<option value="notifications" selected="">Notifications</option>');
    for (const label of ["Notification sounds", "Keep notifications on screen", "Unread count on the app icon", "Nudge sound", "Shake on nudge"]) {
      const toggle = fixture.switches.find((props) => props["aria-label"] === label);
      expect(toggle?.checked, label).toBe(true);
    }
  });

  it.each([
    ["Keep notifications on screen", "omb-notification-persistent"],
    ["Unread count on the app icon", "omb-dock-badge"],
    ["Shake on nudge", "omb-nudge-shake"],
  ])("%s turns off on this computer only", (label, key) => {
    fixture.section = "notifications";
    render();
    fixture.switches.find((props) => props["aria-label"] === label)!.onClick!({} as never);
    expect(fixture.setLocal).toHaveBeenCalledWith(key, false);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("says how to keep a notification on screen on macOS", () => {
    fixture.section = "notifications";
    const html = render();
    expect(html).toContain("On macOS, also choose Alerts in System Settings &gt; Notifications.");
  });

  it("is laid out as Grok Bot's Notifications: grey headings, a switch per row, no intro paragraph", () => {
    fixture.section = "notifications";
    const html = render();
    const groups = [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1]);
    // Privacy is an organization server's only
    expect(groups).toEqual(["alerts", "nudges"]);
    expect(html).toContain(">Alerts</h3>");
    expect(html).toContain(">Nudges</h3>");
    expect(html).toContain("· On this computer");
    expect(html).not.toContain("How a new message or a nudge gets your attention");
    expect(html).not.toContain("Play a sound when a person writes to you");
    expect(html).not.toMatch(/[–—]/);
  });
});
