import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { SendKey } from "@/lib/send-key";
import { en, locales } from "@/locales";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { chooseThreadsView, SECTIONS, sectionMatches, SettingsModal } from "./SettingsModal";
import {
  AppearanceSettings,
  NotificationSettings,
  OrganizationSettings,
  WorkspaceBackupSettings,
} from "./lazy-settings-sections";

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
}));
// Cards read the host platform (what a saved sign-in still locked asks for).
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" } } }) }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/thread-preferences", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/thread-preferences")>();
  return {
    ...real,
    useShowThreads: () => fixture.showThreads,
    useThreadsMode: () => ((fixture.showThreads) ? "header" : "one") as "one" | "header" | "sidebar",
    useShowThreadsChoice: () => fixture.showThreads,
    setShowThreads: fixture.setShowThreads,
    useThreadsLocationChoice: () => "header",
    setThreadsLocation: fixture.setThreadsLocation,
    chooseThreadsView: (next: "hidden" | "header" | "sidebar") => {
      if (next === "hidden") {
        fixture.setShowThreads(false);
        return;
      }
      fixture.setThreadsLocation(next);
      fixture.setShowThreads(true);
    },
  };
});
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
    connectionNotices: local("omb-connection-notices"),
    notifyBots: local("omb-notify-bots"),
    notifyPeople: local("omb-notify-people"),
    notifyGroups: local("omb-notify-groups"),
    notifyApprovals: local("omb-notify-approvals"),
    notifyRoutines: local("omb-notify-routines"),
    useLocalSwitch: (choice: { enabled: () => boolean }) => choice.enabled(),
  };
});
vi.mock("@/lib/send-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/send-key")>(),
  useSendKey: () => fixture.sendKey,
  setSendKey: fixture.setSendKey,
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn(), usageMeterEnabled: () => false, setUsageMeterEnabled: vi.fn(async () => false) }));
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

// Static rendering does not run the effects that load the selected page.
beforeAll(async () => {
  await Promise.all([
    AppearanceSettings.preload(),
    NotificationSettings.preload(),
    OrganizationSettings.preload(),
    WorkspaceBackupSettings.preload(),
  ]);
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

  it("is laid out as Theme, Conversations, Sidebar, Mascots, Accessibility (#2080 L2)", () => {
    const html = render();
    const groups = [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1]);
    expect(groups).toEqual(["theme", "conversation", "conversationAdvanced", "sidebar", "sidebarAdvanced", "mascots", "accessibility"]);
    for (const heading of ["Theme", "Conversations", "Sidebar", "Mascots", "Accessibility"]) expect(html).toContain(`>${heading}</h3>`);
    expect(html).not.toContain('data-settings-group="interface"');
    expect(html).not.toContain('data-settings-group="desktop"');
    const page = html.slice(html.indexOf('data-settings-group="theme"'));
    expect(page).not.toContain("<select");
    for (const label of ["Mode", "Conversation threads", "Choose sidebar density"]) {
      expect(page).toContain(`aria-label="${label}"`);
    }
    expect(html).not.toContain("all conversation history and running work");
    expect(html).not.toContain("Overrides the skin's font");
    expect(html).not.toContain("Applies instantly.");
    // Advanced mode left for App; Theme keeps Mode first and the skin grid
    expect(html).toContain('data-settings-row="skinMode"');
    expect(html).toContain('data-skin-grid=""');
    // Background effects fold until Choose is opened
    expect(html).toContain('data-settings-row="backgroundEffects"');
    expect(html).not.toContain('data-effect-grid=""');
    expect(html).not.toContain('data-settings-row="glyphRipple"');
    expect(html).not.toContain('aria-label="Send messages with"');
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

  it("folds desktop mascot behavior under Mascots (#2080 L2)", () => {
    const html = render();
    expect(html).toContain('data-settings-group="mascots"');
    expect(html).toContain('data-settings-row="hdMascots"');
    // Behavior stays folded until opened; without a desktop shell the row is absent
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

  it("does not offer the retired unconfigured providers toggle", () => {
    const html = render();
    expect(html).not.toContain('aria-label="Show unconfigured providers"');
    expect(html).not.toContain("Unconfigured providers");
  });

  it.each([
    ["enter", "Enter"],
    ["shift-enter", "Shift+Enter"],
    ["mod-enter", "Ctrl+Enter"],
  ] as const)("shows the saved send key (%s) on App > Input (#2080 L2)", (sendKey, label) => {
    fixture.sendKey = sendKey;
    fixture.section = "about";
    const html = render();
    expect(html).toContain("Send messages with");
    expect(html).toContain('aria-label="Send messages with"');
    expect(html).toContain("Ctrl+Enter always sends.");
    const pill = /aria-label="Send messages with"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(pill).toContain(`title="${label}"`);
    expect(fixture.setSendKey).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("asks Japanese speakers in Japanese for the send key on App", () => {
    setLocale("ja");
    fixture.sendKey = "shift-enter";
    fixture.section = "about";
    const html = render();
    expect(html).toContain("メッセージの送信キー");
    const pill = /aria-label="メッセージの送信キー"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(pill).toContain('title="Shift+Enter"');
  });

  it("finds the app icon on App and the dock badge in Notifications", () => {
    const about = SECTIONS.find((section) => section.id === "about")!;
    const notifications = SECTIONS.find((section) => section.id === "notifications")!;
    expect(sectionMatches(about, "icon")).toBe(true);
    expect(sectionMatches(notifications, "icon")).toBe(true);
    expect(sectionMatches(notifications, "icône")).toBe(true);
  });

  it("finds the send key by the keys' names on App", () => {
    const about = SECTIONS.find((section) => section.id === "about")!;
    for (const query of ["enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "send", "new line", "ime"]) {
      expect(sectionMatches(about, query), query).toBe(true);
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

  it("leaves non-appearance Account settings in place", () => {
    fixture.section = "account";
    const html = render();
    expect(html).toContain('aria-label="App language"');
    // technical cards left Account for App (#2080 L2)
    expect(html).not.toContain('data-settings-card="general.advanced"');
    expect(html).toContain('data-settings-group="languageRegion"');
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
    expect(locales.ja["settings.section.appearance"]).toBeTruthy();
    expect(locales.ja["settings.section.appearance"]).not.toBe(en["settings.section.appearance"]);
    expect(html).toContain(locales.ja["settings.section.appearance"]!);
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
  it.each([true, false])("shows the sound pill as System or None when sounds are %s", (enabled) => {
    fixture.notificationSounds = enabled;
    fixture.section = "notifications";
    const html = render();
    expect(html).toContain('aria-label="Notification sound"');
    expect(html).toContain("data-pill-select");
    expect(html).toContain(enabled ? ">System</span>" : ">None</span>");
    expect(html).not.toContain("keep the banners but lose the chime");
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("has its own section with the alert switches on by default (nudges stay folded)", () => {
    fixture.section = "notifications";
    const html = render();
    expect(html).toContain('<option value="notifications" selected="">Notifications</option>');
    for (const label of ["Keep notifications on screen", "Unread count on the app icon"]) {
      const toggle = fixture.switches.find((props) => props["aria-label"] === label);
      expect(toggle?.checked, label).toBe(true);
    }
    expect(html).toContain("Sound and window");
    expect(html).not.toContain('data-nudges-rows');
  });

  it.each([
    ["Keep notifications on screen", "omb-notification-persistent"],
    ["Unread count on the app icon", "omb-dock-badge"],
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

  it("is laid out as Alerts plus Privacy, with nudges and blocked people folded (#2080)", () => {
    fixture.section = "notifications";
    const html = render();
    const groups = [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1]);
    expect(groups).toEqual(["notificationTypes", "alerts", "privacy"]);
    expect(html).toContain(">Alerts</h3>");
    expect(html).toContain(">Privacy</h3>");
    expect(html).toContain(">Nudges</div>");
    expect(html).toContain("Sound and window");
    expect(html).toContain(">Blocked people</div>");
    expect(html).toContain('data-settings-card="notifications.privacy"');
    // "On this computer" lives in the page intro, not as a repeated accessory
    expect(html).not.toContain("· On this computer");
    expect(html).toContain('aria-label="Notification sound"');
    expect(html).toContain(">System</span>");
    expect(html).not.toContain("How a new message or a nudge gets your attention");
    expect(html).not.toContain("Play a sound when a person writes to you");
    expect(html).not.toMatch(/[–—]/);
  });
});
