// Screens that open only on request: Settings, Routines, the Team map, the
// Computer panel and the rest below. Imported directly, every launch would
// parse and run all of them before its first paint; each is its own chunk
// instead, fetched once the launch is idle (preloadScreens).
import { lazyScreen } from "./lazy-screen";
import { NewBotDialog } from "./lazy-new-bot";

export { lazyScreen, type LazyScreen } from "./lazy-screen";
export { NewBotDialog };

export const AchievementsScreen = lazyScreen("AchievementsScreen", async () => (await import("./achievements/AchievementsScreen")).AchievementsScreen);
export const BotCatalogModal = lazyScreen("BotCatalogModal", async () => (await import("./bot-catalog/BotCatalogModal")).BotCatalogModal);
/** Browse Bots inside Connect apps' window (the same chunk as the modal). */
export const BotCatalogPane = lazyScreen("BotCatalogPane", async () => (await import("./bot-catalog/BotCatalogModal")).BotCatalogPane);
export const ActivityPanel = lazyScreen("ActivityPanel", async () => (await import("./ActivityPanel")).ActivityPanel);
export const BulkEditBotsDialog = lazyScreen("BulkEditBotsDialog", async () => (await import("./BulkEditBotsDialog")).BulkEditBotsDialog);
export const BotSettingsDialog = lazyScreen("BotSettingsDialog", async () => (await import("./BotSettingsDialog")).BotSettingsDialog);
export const CodePage = lazyScreen("CodePage", async () => (await import("./code/CodePage")).CodePage);
export const ApprovalsPage = lazyScreen("ApprovalsPage", async () => (await import("./approvals/ApprovalsPage")).ApprovalsPage);
export const RemoteSessionsAdminPage = lazyScreen("RemoteSessionsAdminPage", async () => (await import("./remote-session/RemoteSessionsAdminPage")).RemoteSessionsAdminPage);
export const ComputerPanel = lazyScreen("ComputerPanel", async () => (await import("./ComputerPanel")).ComputerPanel);
export const InspectorPanel = lazyScreen("InspectorPanel", async () => (await import("./InspectorPanel")).InspectorPanel);
export const KeyboardShortcutsModal = lazyScreen("KeyboardShortcutsModal", async () => (await import("./KeyboardShortcutsModal")).KeyboardShortcutsModal);
export const LocalVmWorkspace = lazyScreen("LocalVmWorkspace", async () => (await import("./LocalVmWorkspace")).LocalVmWorkspace);
export const PersonaEditorModal = lazyScreen("PersonaEditorModal", async () => (await import("./persona/PersonaEditorModal")).PersonaEditorModal);
export const RemoteAgentSettingsPanel = lazyScreen("RemoteAgentSettingsPanel", async () => (await import("./RemoteAgentSettingsPanel")).RemoteAgentSettingsPanel);
export const RemoteDesktopPanel = lazyScreen("RemoteDesktopPanel", async () => (await import("./remote-desktop-panel")).RemoteDesktopPanel);
export const RoutinesPage = lazyScreen("RoutinesPage", async () => (await import("./RoutinesPage")).RoutinesPage);
export const SettingsModal = lazyScreen("SettingsModal", async () => (await import("./SettingsModal")).SettingsModal);
export const TeamMapPage = lazyScreen("TeamMapPage", async () => (await import("./TeamMapPage")).TeamMapPage);
export const TriggersPanel = lazyScreen("TriggersPanel", async () => (await import("./TriggersPanel")).TriggersPanel);

const SCREENS = [
  AchievementsScreen, ActivityPanel, ApprovalsPage, BotCatalogModal, BotCatalogPane, BotSettingsDialog, BulkEditBotsDialog, CodePage, ComputerPanel, InspectorPanel, KeyboardShortcutsModal, LocalVmWorkspace, NewBotDialog,
  PersonaEditorModal, RemoteAgentSettingsPanel, RemoteDesktopPanel, RemoteSessionsAdminPage, RoutinesPage, SettingsModal, TeamMapPage, TriggersPanel,
];

// A window opened onto Settings (?desktop-settings=…: the desktop app's
// Workspaces, Organization and Cloud windows, phone pairing) shows it at
// mount, before the launch is idle: fetch it now, beside the session check.
// A failure is logged by preload and shown when Settings mounts.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("desktop-settings")) {
  void SettingsModal.preload().catch(() => {});
}

/** Fetches every screen above once the launch has painted and gone idle, so
 * a later click renders it at once. Returns a cancel for the effect cleanup.
 * Failures are logged by preload and shown when that screen is opened. */
export function preloadScreens(): () => void {
  const run = () => {
    for (const screen of SCREENS) void screen.preload().catch(() => {});
  };
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(run, { timeout: 2_000 });
    return () => cancelIdleCallback(handle);
  }
  // Safari has no requestIdleCallback.
  const timer = setTimeout(run, 1_000);
  return () => clearTimeout(timer);
}
