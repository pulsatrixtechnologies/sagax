// The application menu. It exists for two reasons: the Server submenu,
// where the user switches between the local server and paired remote ones,
// and the macOS Preferences… item (Electron has no role for it, so it is
// built explicitly). Everything else is Electron's standard roles so macOS
// keeps Edit/Window and Windows/Linux get the same items under a visible bar.
import { Menu } from "electron";

import { DISPLAY_NAME } from "./app-name.mjs";

/**
 * @param {object} input
 * @param {{ id: string, name: string, origin: string }[]} input.environments
 * @param {string} input.activeId  "local" or an environment id
 * @param {(id: string) => void} input.onSwitch
 * @param {() => void} input.onAddFromClipboard
 * @param {() => void} input.onConnect
 * @param {(id: string) => void} input.onForget
 * @param {() => void} input.onOpenSettings
 * @param {() => void} [input.onOpenAbout]  in-app About modal (Sagax > About / Help > About)
 * @param {string | null} [input.serverModeId]  server mode: the one server this app shows
 * @param {() => void} [input.onLeaveServerMode]
 * @param {{ artifactId: string, title: string }[]} [input.artifactWindows]  artifacts open in a window of their own
 * @param {(artifactId: string) => void} [input.onShowArtifactWindow]
 * @param {string} [input.platform]
 */
export function buildApplicationMenu(input) {
  return Menu.buildFromTemplate(applicationMenuTemplate(input));
}

/** The Window menu: the standard items, then each artifact open in a window
 * of its own (picking one brings it forward). macOS lists every window there
 * by itself, so it keeps the system's menu and its own list. */
export function windowMenuTemplate({ artifactWindows = [], onShowArtifactWindow, platform = process.platform } = {}) {
  if (platform === "darwin") return { role: "windowMenu" };
  return {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "close" },
      ...(artifactWindows.length > 0
        ? [
          { type: "separator" },
          ...artifactWindows.map((entry) => ({ label: entry.title, click: () => onShowArtifactWindow?.(entry.artifactId) })),
        ]
        : []),
    ],
  };
}

export function applicationMenuTemplate({ environments, activeId, onSwitch, onAddFromClipboard, onConnect, onForget, onOpenSettings, onOpenAbout, serverModeId = null, onLeaveServerMode, artifactWindows = [], onShowArtifactWindow, platform = process.platform }) {
  const isMac = platform === "darwin";
  const active = environments.find((e) => e.id === activeId) ?? null;
  const locked = serverModeId ? environments.find((e) => e.id === serverModeId) ?? null : null;
  // Server mode: the organization's server and this computer's own space
  // (Personal), switched at once without signing out; no other saved server
  // and no way to add one. Change server… signs out of it.
  const server = locked ? {
    label: "Server",
    submenu: [
      { label: "This computer", type: "radio", checked: activeId !== locked.id, click: () => onSwitch("local") },
      { label: `${locked.name} — ${new URL(locked.origin).host}`, type: "radio", checked: activeId === locked.id, click: () => onSwitch(locked.id) },
      { type: "separator" },
      { label: "Change server…", click: () => onLeaveServerMode?.() },
    ],
  } : {
    label: "Server",
    submenu: [
      { label: "This computer", type: "radio", checked: !active, click: () => onSwitch("local") },
      ...environments.map((e) => ({
        label: `${e.name} — ${e.kind === "local" ? e.dataDir : new URL(e.origin).host}`,
        type: "radio",
        checked: e.id === activeId,
        click: () => onSwitch(e.id),
      })),
      { type: "separator" },
      { label: "Connect to a server…", click: onConnect },
      { label: "Add Server from Copied Pairing Link…", click: () => onAddFromClipboard() },
      {
        label: active ? `Forget “${active.name}”` : "Forget Server",
        enabled: Boolean(active),
        click: () => active && onForget(active.id),
      },
    ],
  };
  const aboutItem = {
    label: isMac ? `About ${DISPLAY_NAME}` : "About",
    click: () => onOpenAbout?.(),
  };
  const template = [
    // app.name is the runtime name (openmausbot), which the roles would print
    ...(isMac ? [{ label: DISPLAY_NAME, submenu: [aboutItem, { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, { type: "separator" }, { role: "hide", label: `Hide ${DISPLAY_NAME}` }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit", label: `Quit ${DISPLAY_NAME}` }] }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    server,
    { role: "viewMenu" },
    windowMenuTemplate({ artifactWindows, onShowArtifactWindow, platform }),
    // Windows/Linux: Help > About opens the in-app About modal (macOS uses the app menu).
    // #3299: no Send Feedback item: /feedback in a chat is the one way in.
    { role: "help", submenu: isMac ? [] : [aboutItem] },
  ];
  return template;
}
