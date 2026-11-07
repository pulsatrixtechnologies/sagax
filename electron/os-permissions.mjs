// Every operating system permission Sagax needs on this computer, and the one
// action that grants it (#2614). JC 2026-11-07: "Every missing permission ...
// needs to generate action on the OS so its easier to autorise, I dont want
// people to go look themself for the settings". So a missing permission
// always has a button, never a sentence that says where to click:
// - the native prompt when the OS still offers one (not asked yet);
// - otherwise, or once refused, the exact System Settings pane;
// - Screen Recording on macOS: the status is cached per process (macOS 15+
//   keeps "denied" for the whole run after the person allows it), so once
//   the pane was opened the next step is "Relaunch Sagax"; still refused after
//   that relaunch means a stale entry (the app's signature changed with an
//   update while the switch looks on): reset the entry, ask again, reopen the
//   pane.
// Pure: main.mjs reads the statuses and runs the action, the renderer only
// draws it. The same table drives the Swift tests through
// os-permissions.vectors.json.

const MAC_PRIVACY = "x-apple.systempreferences:com.apple.preference.security?";

/** The permissions of each desktop platform, in display order. `prompt`: the
 * OS can still ask in place (before the first refusal). `pane`: where the
 * person allows it. `readable`: the status can be read without a prompt. */
export const OS_PERMISSIONS = Object.freeze({
  darwin: Object.freeze([
    { id: "microphone", prompt: true, readable: true, pane: `${MAC_PRIVACY}Privacy_Microphone` },
    { id: "screen", prompt: true, readable: true, pane: `${MAC_PRIVACY}Privacy_ScreenCapture`, relaunch: true },
    { id: "accessibility", prompt: true, readable: true, pane: `${MAC_PRIVACY}Privacy_Accessibility` },
    { id: "notifications", prompt: true, readable: true, pane: "x-apple.systempreferences:com.apple.Notifications-Settings.extension" },
    { id: "speech", prompt: false, readable: false, pane: `${MAC_PRIVACY}Privacy_SpeechRecognition` },
    { id: "automation", prompt: false, readable: false, pane: `${MAC_PRIVACY}Privacy_Automation` },
    { id: "fullDisk", prompt: false, readable: false, pane: `${MAC_PRIVACY}Privacy_AllFiles` },
  ]),
  win32: Object.freeze([
    { id: "microphone", prompt: false, readable: true, pane: "ms-settings:privacy-microphone" },
    { id: "notifications", prompt: true, readable: true, pane: "ms-settings:notifications" },
  ]),
});

/** @param {string} platform */
export function permissionsFor(platform) {
  return Object.hasOwn(OS_PERMISSIONS, platform) ? OS_PERMISSIONS[platform] : [];
}

/** @param {string} platform @param {string} id */
export function permissionEntry(platform, id) {
  return permissionsFor(platform).find((entry) => entry.id === id) ?? null;
}

/** One status word from what the OS says (Electron media status, a boolean
 * from isTrustedAccessibilityClient, a notification delivery state). */
export function normalizePermissionStatus(raw) {
  if (raw === true || raw === "granted" || raw === "delivered") return "granted";
  if (raw === false || raw === "denied" || raw === "restricted" || raw === "not-delivered") return "denied";
  if (raw === "not-determined") return "not-determined";
  return "unknown";
}

/**
 * The action behind a permission's button.
 * @param {string} id
 * @param {string} platform "darwin" | "win32" | ...
 * @param {string} status normalized status
 * @param {{ asked?: boolean, openedSettings?: boolean, relaunched?: boolean, captureFailed?: boolean }} [run]
 *   asked: the native prompt already ran this session; openedSettings: the
 *   pane was opened this session; relaunched: Sagax was relaunched for this
 *   permission and it is still refused; captureFailed: granted, but the real
 *   capture still fails (the OS applies it at the next launch).
 * @returns {{ kind: "none" | "prompt" | "settings" | "relaunch" | "reset", url?: string, secondary?: { kind: "settings" | "relaunch", url?: string } }}
 */
export function permissionAction(id, platform, status, run = {}) {
  const entry = permissionEntry(platform, id);
  if (!entry) return { kind: "none" };
  const settings = { kind: "settings", url: entry.pane };
  if (status === "granted") {
    if (!entry.relaunch || !run.captureFailed) return { kind: "none" };
    // Allowed, yet the capture fails: this run still sees the old answer
    // (relaunch), or a relaunch already happened and the entry is stale (reset).
    return run.relaunched ? { kind: "reset", url: entry.pane, secondary: settings } : { kind: "relaunch", secondary: settings };
  }
  if (entry.relaunch) {
    // Screen Recording: never a dead end. The switch may already be on and
    // only this run still sees the old answer, so Relaunch is always there.
    if (run.relaunched) return { kind: "reset", url: entry.pane, secondary: settings };
    if (status === "not-determined" && !run.asked) return { kind: "prompt", secondary: { kind: "relaunch" } };
    if (run.openedSettings) return { kind: "relaunch", secondary: settings };
    return { ...settings, secondary: { kind: "relaunch" } };
  }
  const canPrompt = entry.prompt && !run.asked && (status === "not-determined" || (status === "unknown" && entry.readable));
  if (canPrompt) return { kind: "prompt" };
  return settings;
}

/** Only these URL schemes ever reach shell.openExternal from this table. */
export function isPermissionSettingsUrl(url) {
  return typeof url === "string" && (url.startsWith("x-apple.systempreferences:") || url.startsWith("ms-settings:"));
}
