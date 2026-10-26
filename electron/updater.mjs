// In-app auto-updater (electron-updater). Updates download by themselves as
// soon as a check finds one (macOS also stages the ZIP at once) and install
// on the person's confirmed "Restart to install" (macOS and AppImage also
// when the app quits; Windows never installs on quit, see below). Nothing
// restarts by itself in the middle of a call or a turn. One state object is
// broadcast on every transition, to this app's own page (the local page, or
// the bundle drawn on an organization server).
//
// Only runs in the packaged, signed+notarized app (mac auto-update requires
// signing). In dev it's a no-op so the browser/dev shell is unaffected.
// electron-updater is vendored (electron/vendor/electron-updater.cjs) because
// the packaged app ships no node_modules.
import { app, clipboard, dialog, ipcMain, net, powerMonitor } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  HAND_OFF_PACKAGE_TYPES,
  linuxPackageType,
  packageInstallCommand,
  stagedInstallFile,
} from "./package-install-command.mjs";
import { openBlankTerminal } from "./terminal-launch.mjs";
import { createUpdaterCoordinator } from "./updater-coordinator.mjs";
import { configureUpdateFeed, fetchReleaseNotes, readUpdatePrefs, updateChannel, writeUpdatePrefs } from "./update-feed.mjs";
import { ACTIVITY_STALE_MS, AWAY_INSTALL_IDLE_SECONDS, awayInstallDecision, cleanActiveBots } from "./update-away.mjs";
import { systemIdleSnapshot } from "./system-idle.mjs";
import { confirmLanguage, confirmedInstall, updateConfirmOptions } from "./update-confirm.mjs";
import { readDesktopLanguage } from "./desktop-language.mjs";
import { DISPLAY_NAME } from "./app-name.mjs";

const require = createRequire(import.meta.url);

let autoUpdater = null;
let win = null;
// status: idle | checking | downloading | preparing | downloaded | installing | handed-off | error
let state = { status: "idle" };
let updaterCoordinator = null;
// Which page may read and drive the updater (main.mjs updaterPageAllowed).
// Until main says, none may.
let pageAllowed = () => false;
// The working bots the page last reported (null: never), and when. A restart
// never goes on a guess: see update-away.mjs.
let activeBots = null;
let activeReportedAt = 0;
let handOffInstallMode = false;

function updaterLogger() {
  const directory = app.getPath("logs");
  const file = join(directory, "updater.log");
  const write = (level, values) => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const message = values
        .map((value) => (value instanceof Error ? value.stack ?? value.message : String(value)))
        .join(" ");
      appendFileSync(file, `[${new Date().toISOString()}] [${level}] ${message}\n`, { mode: 0o600 });
    } catch {
      // Logging must never make updating unavailable.
    }
  };
  return Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (...values) => write(level, values)]));
}

// A system package is the distro's to install, not ours. Left to
// electron-updater, a .deb update raises a polkit root prompt out of a chat
// app, runs `dpkg -i` (which resolves no dependencies) and replaces
// /opt/Sagax while this very process is still running.
const HAND_OFF_TYPES = new Set(HAND_OFF_PACKAGE_TYPES);

// Do what this app already does for engine installs: put the exact command on
// the clipboard and open a blank terminal to paste it into. The command is
// never executed for the user, so nothing here becomes a process argument.
export function handOffDownloadedPackage(packageType) {
  return async (files) => {
    const target = stagedInstallFile(files);
    const command = packageInstallCommand(packageType, target);
    await clipboard.writeText(command);
    return { command, terminalOpened: await openBlankTerminal() };
  };
}

function setState(patch) {
  state = { ...state, ...patch };
  try {
    const contents = win?.webContents;
    // Only the page the window shows now, and only if it may read the state.
    if (contents && pageAllowed({ sender: contents, senderFrame: contents.mainFrame })) contents.send("update:state", state);
  } catch {
    /* window gone */
  }
}

/** The updater changes THIS app: `allowed(event)` says which page may read
 * and drive it: this app's own UI, the local page or the bundle drawn on an
 * organization server (bundled-ui.cjs; main.mjs updaterPageAllowed). */
export function registerUpdaterIpc({ pageAllowed: allowed }) {
  pageAllowed = allowed;
  const guarded = (channel, handler) => (event, ...args) => {
    if (!pageAllowed(event)) throw new Error(`${channel} is only available in this app's window`);
    return handler(...args);
  };
  ipcMain.handle("update:get-state", guarded("update:get-state", () => state));
  ipcMain.handle("update:check", guarded("update:check", () => updaterCoordinator?.check(true)));
  // A download starts by itself after a check. An older page's Download
  // button asks for one: checking again starts it, as the person's own.
  ipcMain.handle("update:download", guarded("update:download", () => updaterCoordinator?.check(true)));
  // `confirmed`: the page's own update dialog asked the person ("Restart to
  // install"). Without it main asks with a native question first, so an
  // older page's menu item never installs unasked.
  ipcMain.handle("update:install", guarded("update:install", (options) =>
    updaterCoordinator?.install({ confirmed: options?.confirmed === true })));
  ipcMain.handle("update:set-prereleases", guarded("update:set-prereleases", (enabled) => setPrereleases(enabled)));
  // The named channel: "stable" or "nightly" (the pre-release feed).
  ipcMain.handle("update:set-channel", guarded("update:set-channel", (channel) => setPrereleases(channel === "nightly")));
  ipcMain.handle("update:set-auto-install-away", guarded("update:set-auto-install-away", (enabled) => setAutoInstallAway(enabled)));
  // The page says how many bots work now (every ~30 s), so a restart can warn
  // or wait for them.
  ipcMain.handle("update:report-activity", guarded("update:report-activity", (count) => reportActivity(count)));
  // "Restart when the bots have finished": one-shot, cleared by the install
  // or by the person.
  ipcMain.handle("update:install-when-idle", guarded("update:install-when-idle", (enabled) => setWaitingForBots(enabled === true)));
}

function reportActivity(count) {
  const clean = cleanActiveBots(count);
  if (clean === null) return;
  activeBots = clean;
  activeReportedAt = Date.now();
  if (state.activeBots !== clean) setState({ activeBots: clean });
  evaluateAwayInstall();
}

function setAutoInstallAway(enabled) {
  let prefs = { ...readUpdatePrefs(app.getPath("userData")), autoInstallWhenAway: enabled === true };
  try {
    prefs = writeUpdatePrefs(app.getPath("userData"), prefs);
  } catch {
    /* holds for this session even if it cannot be saved */
  }
  setState({ autoInstallWhenAway: prefs.autoInstallWhenAway });
  return state;
}

let waitingVersion = null;

function setWaitingForBots(waiting) {
  // Only for the update now ready; anything else would wait on nothing.
  const on = waiting && state.status === "downloaded";
  waitingVersion = on ? state.version ?? null : null;
  setState({ waitingForBots: on });
  evaluateAwayInstall();
  return state;
}

/** Installs a downloaded update by itself only when the person is away (or
 * asked to wait for the bots) and no bot works. Same confirmed path as the
 * person's own click: cookies are flushed on before-quit-for-update and
 * Windows shows the installer. */
function evaluateAwayInstall() {
  // The wait belongs to the update the person saw: an error or another
  // version ends it, so a later update never installs on an old click.
  if (state.waitingForBots && (state.status !== "downloaded" || (state.version ?? null) !== waitingVersion)) {
    waitingVersion = null;
    setState({ waitingForBots: false });
  }
  if (!updaterCoordinator || state.status !== "downloaded") return;
  let idle = null;
  try {
    idle = systemIdleSnapshot(powerMonitor, AWAY_INSTALL_IDLE_SECONDS);
  } catch {
    idle = null;
  }
  const decision = awayInstallDecision({
    status: state.status,
    handOff: handOffInstallMode,
    systemIdle: idle,
    activeBots,
    reportedAt: activeReportedAt,
    now: Date.now(),
    enabled: state.autoInstallWhenAway === true,
    waiting: state.waitingForBots === true,
  });
  if (!decision.install) return;
  void updaterCoordinator.install({ confirmed: true });
  // The wait ends once the install started; a blocked install keeps it.
  if (state.status === "installing") {
    waitingVersion = null;
    setState({ waitingForBots: false });
  }
}

// Pre-releases are opt-in. The choice is this computer's, stored next to the
// app's data, and applies from the next check.
function setPrereleases(enabled) {
  let prefs = { ...readUpdatePrefs(app.getPath("userData")), allowPrerelease: enabled === true };
  try {
    prefs = writeUpdatePrefs(app.getPath("userData"), prefs);
  } catch {
    /* holds for this session even if it cannot be saved */
  }
  if (autoUpdater) autoUpdater.allowPrerelease = prefs.allowPrerelease;
  setState({ allowPrerelease: prefs.allowPrerelease, channel: updateChannel(prefs) });
  return state;
}

// An install the page did not confirm (an older page's menu item): ask with
// a native question, "Later" by default, parented to the window.
async function confirmInstallNatively({ version } = {}) {
  let language = "en";
  try {
    language = confirmLanguage(readDesktopLanguage(app.getPath("userData")), app.getLocale?.() ?? "");
  } catch {
    /* English */
  }
  const options = updateConfirmOptions({ language, platform: process.platform, version, appName: DISPLAY_NAME, activeBots: Date.now() - activeReportedAt <= ACTIVITY_STALE_MS ? activeBots ?? 0 : 0 });
  const parent = win && !win.isDestroyed?.() ? win : null;
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return confirmedInstall(result);
}

// macOS keeps the process (and updater) alive after its window closes.
// Retarget broadcasts on every window creation without adding more timers
// or event listeners to the process-wide updater.
export function attachUpdaterWindow(mainWindow) {
  win = mainWindow;
}

export function startUpdater() {
  const prefs = readUpdatePrefs(app.getPath("userData"));
  setState({ allowPrerelease: prefs.allowPrerelease, channel: updateChannel(prefs), autoInstallWhenAway: prefs.autoInstallWhenAway });
  // dev / unsigned builds can't auto-update — leave the banner dormant
  if (!app.isPackaged) {
    updaterCoordinator = null;
    setState({ status: "idle" });
    return;
  }
  try {
    ({ autoUpdater } = require("./vendor/electron-updater.cjs"));
  } catch {
    updaterCoordinator = null;
    setState({ status: "error", message: "updater unavailable" });
    return;
  }
  // Our GitHub releases only, whatever app-update.yml says.
  configureUpdateFeed(autoUpdater, prefs);
  // The coordinator starts the download itself the moment a check finds an
  // update, so it owns that download (macOS staging, quiet failures).
  autoUpdater.autoDownload = false;
  // The notes come with the update: the release writes docs/releases/X.Y.Z.md
  // into latest*.yml (releaseNotes). A feed without them (0.5.4 and before)
  // makes electron-updater read every skipped version's body from
  // releases.atom (HTML; our pulsa-v tags are read by
  // scripts/patch-release-notes-updater.mjs). When neither gives markdown,
  // the coordinator reads the release body from GitHub's public API.
  autoUpdater.fullChangelog = true;
  autoUpdater.logger = updaterLogger();

  // Broadcast the install flavour before the first check so the banner never
  // offers a restart it cannot deliver.
  const packageType = linuxPackageType({ readMarker: (file) => (existsSync(file) ? readFileSync(file, "utf8") : null) });
  const handOff = HAND_OFF_TYPES.has(packageType);
  handOffInstallMode = handOff;
  // A downloaded update installs when the app quits on macOS and AppImage,
  // where the swap takes seconds. On macOS this also starts Squirrel.Mac's
  // native staging pass at once, so "Restart to install" never has to begin
  // that slow pass and wait. Windows never installs on quit: electron-updater
  // runs the NSIS installer silently then, which moved the app folder away
  // for minutes with no window (shortcuts and taskbar pins pointing at
  // nothing) and never reopened Sagax (2026-10-19). There the update waits
  // for the person's "Restart to install". A system package (.deb, .rpm,
  // pacman) is the person's to install in a terminal, never ours on quit.
  const windows = process.platform === "win32";
  autoUpdater.autoInstallOnAppQuit = !handOff && !windows;
  // Sagax opens again once the installer is done.
  autoUpdater.autoRunAppAfterInstall = true;
  setState({ installMode: handOff ? "handoff" : "restart" });
  updaterCoordinator = createUpdaterCoordinator(autoUpdater, setState, {
    handOffInstall: handOff ? handOffDownloadedPackage(packageType) : null,
    nativeStaging: process.platform === "darwin",
    // Windows: the installer's own progress window, never a silent run.
    silentInstall: !windows,
    confirmInstall: confirmInstallNatively,
    fetchReleaseNotes: (version) => fetchReleaseNotes(version, { fetch: (url, init) => net.fetch(url, init) }),
  });

  // first check ~15s after launch (let the app settle), then hourly — never
  // the person's own check, hence the arrow: a bare `check` would receive the
  // timer's argument as `manual` and report every passing network failure.
  setTimeout(() => void updaterCoordinator?.check(), 15_000).unref?.();
  setInterval(() => void updaterCoordinator?.check(), 60 * 60 * 1000).unref?.();
  // While away (or waiting for the bots), a downloaded update installs by itself.
  setInterval(evaluateAwayInstall, 60 * 1000).unref?.();
}
