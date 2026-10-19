// Renderer bridge. contextIsolation stays on; the renderer only ever sees
// this narrow surface (window.ogb), never Node or ipcRenderer itself.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Sandboxed preloads receive Electron's restricted `require`, which cannot
// load sibling CommonJS files. Keep this tiny predicate inline here; main's
const desktopRemoteClient = process.argv.includes("--openmausbot-remote-client");

let pendingPackageInstallUrl = null;
const packageInstallListeners = new Set();
ipcRenderer.on("package:install", (_event, url) => {
  if (typeof url !== "string") return;
  pendingPackageInstallUrl = url;
  for (const listener of packageInstallListeners) listener(url);
});

// A chat link opened from outside the app. Held until the page subscribes,
// then handed over once: replaying it to a remounted listener would yank the
// person back to that chat.
let pendingChatLink = null;
const chatLinkListeners = new Set();
ipcRenderer.on("chat:open", (_event, link) => {
  if (typeof link !== "string") return;
  if (!chatLinkListeners.size) {
    pendingChatLink = link;
    return;
  }
  for (const listener of chatLinkListeners) listener(link);
});

// Main can finish loading the document before React subscribes. Retain only
// the fixed organisation action, never a destination supplied by a renderer.
const FIXED_SETTINGS_ACTIONS = new Set(["organization"]);
let pendingSettingsAction = null;
const appSettingsListeners = new Set();
ipcRenderer.on("app:open-settings", (_event, section) => {
  const fixedSection = FIXED_SETTINGS_ACTIONS.has(section) ? section : undefined;
  if (fixedSection && !appSettingsListeners.size) pendingSettingsAction = fixedSection;
  if (!appSettingsListeners.size) return;
  pendingSettingsAction = null;
  for (const listener of appSettingsListeners) listener(fixedSection);
});

// The bridge is built once, then exposed in full only to the local server's
// UI. A remote server's page (Server menu) gets the safe subset: nothing that
// captures this screen, touches this computer's files or logins, or runs
// helpers here. Main enforces the same rule on the sensitive channels.
const localOrigin = process.argv.find((arg) => arg.startsWith("--omb-local-origin="))?.slice("--omb-local-origin=".length) ?? null;
const isLocalPage = !localOrigin || location.origin === localOrigin;
const REMOTE_SAFE = new Set(["platform", "getCapabilities", "onCapabilitiesChanged", "applySkin", "setUnreadCount", "nudgeWindow", "notify", "withdrawNotification", "onNotificationClick", "systemIdle", "permStatus", "workspaces", "takeSignInReturn", "pulsatrixSignIn", "orgJoin"]);
// An organization server's page drawn from THIS app's bundle
// (electron/bundled-ui.cjs) is the desktop's own UI on that server, so it
// also gets the desktop-UI parts that hold no local data: floating bots and
// the Hibou 98 assistant (windows that only draw what the page sends), the
// Data window (this same page on its own route, opened by main), the
// window's caption buttons, the app menu's Preferences and Release notes,
// links in the system browser, native confirmations, this app's updater,
// server mode's state and way out, chat links opened from outside the app
// (a listener only: main sends them, the page asks nothing), opening a PDF
// the viewer shows in the default app (bytes only, written to a new temp
// .pdf by main), and in server
// mode the person's own "Share this computer" for that server (each grant
// confirmed in a native dialog). Main checks
// every one of these channels again (local-origin.cjs desktopUiOnly, and
// sharingUiOnly for the server-mode server only). Nothing that reads this
// computer's files, screen, logins or secrets is handed to the page.
const BUNDLED_EXTRA = new Set(["floatingBots", "dataWindow", "retroAssistant", "windowControls", "onOpenAppSettings", "openExternal", "confirm", "updater", "serverMode", "computerSharing", "appIcon", "orgMemory", "securityKey", "onChatLink", "desktopLanguage", "openPdf"]);
let bundledPage = false;
// main.mjs always answers this channel: a sendSync nobody answers would
// block this page for good (a test harness must answer it too).
if (!isLocalPage) {
  try {
    bundledPage = ipcRenderer.sendSync("workspace:bundled-ui") === true;
  } catch {
    bundledPage = false;
  }
}

// Sandboxed preload cannot import TS or sibling modules. Keep this list in
// parity with shared/workspace-backup-client.ts (covered by the preload test).
// Only main can request a fresh snapshot; there is no renderer-callable method.
const COMPANY_BACKUP_CLIENT_KEYS = [
  "omb-drafts", "omb-draft-attachments", "omb-draft-send-ids", "omb-draft-channel-modes",
  "omb-skin", "omb-show-threads", "omb-show-run-card", "omb-show-unready-providers", "omb-send-key", "omb-color-user-bubbles", "openmausbot.sidebarDensity",
  "openmausbot.sidebarCollapsedSections.v1", "openmausbot.sidebarSectionOrder.v1",
  "omb-analytics-opt-out", "openmausbot.remote-voice.v1",
];
if (isLocalPage && !desktopRemoteClient && process.argv.includes("--omb-company-desktop=1")) {
  ipcRenderer.on("company-backups:collect-client-state", (_event, request) => {
    if (!request || typeof request.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(request.requestId)) return;
    try {
      // Check the origin again; a later navigation must not export remote data.
      if (!localOrigin || location.origin !== localOrigin) throw new Error("Not the local workspace");
      const clientState = {};
      for (const key of COMPANY_BACKUP_CLIENT_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) clientState[key] = value;
      }
      if (new TextEncoder().encode(JSON.stringify(clientState)).byteLength > 2 * 1024 ** 2) throw new Error("Browser state too large");
      ipcRenderer.send("company-backups:client-state", { requestId: request.requestId, clientState });
    } catch {
      ipcRenderer.send("company-backups:client-state", { requestId: request.requestId, unavailable: true });
    }
  });
}

// undefined until the page first asks main (desktopLanguage.get).
let desktopLanguageCache;

const bridge = {
  /** Host platform ("darwin" | "win32" | "linux") — for platform-aware UI. */
  platform: process.platform,
  // Safe even on a cloud page: the user chooses in a native menu owned by
  // Electron. No direct switching, saved-list reads, host files or secrets.
  workspaces: {
    state: () => ipcRenderer.invoke("workspaces:state"),
    menu: () => ipcRenderer.invoke("workspaces:menu"),
  },
  getCapabilities: () => ipcRenderer.invoke("desktop:capabilities"),
  /** True once when this is the credential the app just brought back from
   * "Sign in with Pulsatrix" to this page (/pair redeems it without asking).
   * Main checks the window, the frame, the origin and the credential. */
  takeSignInReturn: (code) => ipcRenderer.invoke("auth-return:take", typeof code === "string" ? code : ""),
  /** "Sign in with Pulsatrix" runs in the system browser: /pair shows that
   * it waits, with Cancel and Reopen the browser. Main answers only the main
   * window's top frame. */
  pulsatrixSignIn: {
    state: () => ipcRenderer.invoke("pulsatrix-sign-in:state"),
    cancel: () => ipcRenderer.invoke("pulsatrix-sign-in:cancel"),
    reopen: () => ipcRenderer.invoke("pulsatrix-sign-in:reopen"),
    onChange: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("pulsatrix-sign-in:changed", handler);
      return () => ipcRenderer.removeListener("pulsatrix-sign-in:changed", handler);
    },
  },
  onCapabilitiesChanged: (cb) => {
    const handler = (_event, capabilities) => cb(capabilities);
    ipcRenderer.on("desktop:capabilities-changed", handler);
    return () => ipcRenderer.removeListener("desktop:capabilities-changed", handler);
  },
  /** Pair this desktop app to another Sagax host. The bearer remains in
   * the main process and is never returned over this bridge. */
  remoteClient: {
    active: desktopRemoteClient,
    state: () => ipcRenderer.invoke("desktop-remote:state"),
    pair: (endpoint, code) => ipcRenderer.invoke("desktop-remote:pair", endpoint, code),
    disconnect: () => ipcRenderer.invoke("desktop-remote:disconnect"),
  },
  /** The companion sidecar: the one part of this app that listens off the
   * machine, so it runs as its own process and is off until switched on.
   * Every call answers with the whole state, so the panel never has to
   * stitch two round-trips together. */
  companion: {
    state: () => ipcRenderer.invoke("companion:state"),
    start: () => ipcRenderer.invoke("companion:start"),
    stop: () => ipcRenderer.invoke("companion:stop"),
    keepAwake: (enabled) => ipcRenderer.invoke("companion:keep-awake", enabled),
    refreshTailscale: () => ipcRenderer.invoke("companion:refresh-tailscale"),
    pairing: (open, expectedToken) => ipcRenderer.invoke("companion:pairing", open, expectedToken),
    cloudDesktop: (deviceId, allowed) => ipcRenderer.invoke("companion:cloud-desktop", deviceId, allowed),
    browserControl: (deviceId, allowed) => ipcRenderer.invoke("companion:browser-control", deviceId, allowed),
    revoke: (deviceId) => ipcRenderer.invoke("companion:revoke", deviceId),
  },
  /** Keep this computer awake for scheduled routines. The hold itself lives
   * in the main process; the page reads its state and flips the toggle. */
  routines: {
    wakeState: () => ipcRenderer.invoke("routines:wake-state"),
    keepAwake: (enabled) => ipcRenderer.invoke("routines:keep-awake", enabled),
  },
  /** Optional account-backed HTTPS access for Companion. Secrets stay in the
   * main process; the renderer sees only status and narrow user actions. */
  companionAccount: {
    state: () => ipcRenderer.invoke("companion-account:state"),
    requestCode: (email) => ipcRenderer.invoke("companion-account:request-code", email),
    verifyCode: (email, code) => ipcRenderer.invoke("companion-account:verify-code", email, code),
    retry: () => ipcRenderer.invoke("companion-account:retry"),
    signOut: () => ipcRenderer.invoke("companion-account:sign-out"),
  },
  /** Full/Custom and transitions out of Custom are deliberately unavailable
   * through the loopback API. The local renderer applies those changes over
   * the embedded server's private utilityProcess port. */
  approvals: {
    setMode: (botId, mode, options) => ipcRenderer.invoke("approvals:set-trusted-mode", botId, mode, options),
  },
  localControl: {
    status: () => ipcRenderer.invoke("cua:linux-status"),
    enable: () => ipcRenderer.invoke("cua:linux-enable"),
    disable: () => ipcRenderer.invoke("cua:linux-disable"),
    retry: () => ipcRenderer.invoke("cua:linux-retry"),
  },
  /** Arms exactly one display-media request from the current renderer frame. */
  beginScreenPreviewIntent: () => ipcRenderer.sendSync("screen:preview-intent"),
  /** One frame of this computer's screen as a data: URL when supported. */
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  /** Physical USB Android devices. Network ADB is deliberately excluded. */
  androidDevice: {
    status: () => ipcRenderer.invoke("android-device:status"),
    frame: (serial) => ipcRenderer.invoke("android-device:frame", serial),
    input: (serial, payload) =>
      ipcRenderer.invoke("android-device:input", serial, payload).then(() => undefined),
  },
  speechStart: (options) => ipcRenderer.invoke("speech:start", options),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  speechFinish: () => ipcRenderer.invoke("speech:finish"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  /** The app menu's Preferences… item; local shell only (the remote-safe
   * subset never sees it). */
  onOpenAppSettings: (cb) => {
    appSettingsListeners.add(cb);
    queueMicrotask(() => {
      const section = pendingSettingsAction;
      if (!section || !appSettingsListeners.size) return;
      pendingSettingsAction = null;
      for (const listener of appSettingsListeners) listener(section);
    });
    return () => appSettingsListeners.delete(cb);
  },
  /** Absolute path of a dropped File — Electron 32 removed File.path, and
   * only the preload can ask. "" when the drag carried no file on disk. */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  /** {mic} TCC status strings: granted|denied|not-determined|unknown.
   * No screen field — macOS 15+ caches that status per-process, so any
   * value here would lie for the whole session after a grant. */
  permStatus: () => ipcRenderer.invoke("perm:status"),
  /** Triggers the macOS microphone prompt; resolves true when granted. */
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  /** Opens System Settings on the given privacy pane: mic|screen|speech. */
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),
  /** Relaunch the local desktop app through its normal shutdown cleanup. */
  relaunch: () => ipcRenderer.invoke("desktop:relaunch"),

  /** Copies an engine install command and opens a blank terminal. Resolves
   * false if no terminal could be launched; the clipboard still has it. */
  openInstallTerminal: (command) => ipcRenderer.invoke("engine:open-terminal", command),
  /** Writes plain text to the system clipboard; the copy button's fallback
   * when the web Clipboard API is rejected. Resolves false on failure. */
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  /** Open a web link in the default browser. Unlike renderer window.open,
   * this remains reliable after an asynchronous API request. */
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  /** Tell the window which skin the page wears, so the native chrome the
   * renderer cannot paint (the Windows caption-button overlay) matches. */
  applySkin: (skin) => ipcRenderer.invoke("desktop:skin", skin),
  /** The language last chosen in this app, on any of its pages (the local
   * page or an organization server's page drawn from this bundle), kept by
   * main (electron/desktop-language.mjs). get() is synchronous so the first
   * render already speaks it: a locale code, "" for the system language,
   * or null when never chosen. set() updates the cache at once. */
  desktopLanguage: {
    get: () => {
      if (desktopLanguageCache === undefined) {
        try {
          const value = ipcRenderer.sendSync("desktop-language:get");
          desktopLanguageCache = typeof value === "string" ? value : null;
        } catch {
          desktopLanguageCache = null;
        }
      }
      return desktopLanguageCache;
    },
    set: (language) => {
      if (typeof language !== "string") return Promise.resolve(null);
      desktopLanguageCache = language;
      return ipcRenderer.invoke("desktop-language:set", language).catch(() => null);
    },
  },
  /** The person's custom app icon (Settings > Appearance): the page sends
   * the PNGs it drew through the system template; main keeps and shows
   * them on the Dock (macOS) or the windows and taskbar (Windows). */
  appIcon: {
    get: () => ipcRenderer.invoke("app-icon:get"),
    set: (request) => ipcRenderer.invoke("app-icon:set", request),
    reset: () => ipcRenderer.invoke("app-icon:reset"),
  },
  /** The renderer-drawn Windows caption buttons: minimize / restore /
   * maximize / close, plus live maximize state so the glyph can flip. */
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    state: () => ipcRenderer.invoke("window:state"),
    onMaximizedChanged: (cb) => {
      const handler = (_event, maximized) => cb(maximized);
      ipcRenderer.on("window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("window:maximized-changed", handler);
    },
  },
  /** A reviewed BotMRR package opened through openmausbot://install. */
  onPackageInstall: (cb) => {
    packageInstallListeners.add(cb);
    if (pendingPackageInstallUrl) cb(pendingPackageInstallUrl);
    return () => packageInstallListeners.delete(cb);
  },
  /** A chat link (sagax:// or openmausbot://, thread/… or bot/…) opened from
   * outside the app; main hands it over in the openmausbot:// form. In server
   * mode main sends it to the bundled organization page (BUNDLED_EXTRA). */
  onChatLink: (cb) => {
    chatLinkListeners.add(cb);
    if (pendingChatLink) {
      const link = pendingChatLink;
      pendingChatLink = null;
      cb(link);
    }
    return () => chatLinkListeners.delete(cb);
  },
  /** Mirrors durable unread state into the native Dock/taskbar badge. */
  setUnreadCount: (count) => ipcRenderer.send("desktop:unread-count", count),
  /** Ask the shell to bring this app's main window to the very front and
   * shake it once. `role` "sent" is the sender's own window (no Dock
   * bounce); anything else is a nudge received. Safe on an organization
   * page: it moves no files and reads no secret. Main accepts it only from
   * the main window, and ignores a repeat while the shake is still running. */
  nudgeWindow: (options) => ipcRenderer.send("desktop:nudge", {
    shake: !(options && options.shake === false),
    role: options && options.role === "sent" ? "sent" : "received",
  }),
  /** A native notification shown by the shell (it can stay until it is
   * dismissed, bounce the Dock, flash the taskbar). Safe on an organization
   * page: text the page already shows, capped by main; main accepts it only
   * from the main window's top frame. */
  notify: (request) => ipcRenderer.send("desktop:notify", request),
  withdrawNotification: (withdrawKey) => ipcRenderer.send("desktop:notify-withdraw", withdrawKey),
  /** The person clicked one of those notifications: its id and the
   * conversation it is about ({botId, threadId, groupId, routineRunId}). */
  onNotificationClick: (cb) => {
    const listener = (_event, id, target) => { if (typeof id === "string") cb(id, target && typeof target === "object" ? target : null); };
    ipcRenderer.on("desktop:notification-click", listener);
    return () => ipcRenderer.removeListener("desktop:notification-click", listener);
  },
  /** Presence: whether the person is at this computer ("active", "idle",
   * "locked" or "unknown") and the seconds since their last input. Safe on
   * an organization page: a state and a number, nothing else. */
  systemIdle: () => ipcRenderer.invoke("desktop:system-idle"),
  /** Live VNC/noVNC in a sandboxed window owned by the app window. */
  desktopViewer: {
    open: (url, title, contextId) => ipcRenderer.invoke("desktop-viewer:open", url, title, contextId),
    close: (contextId) => ipcRenderer.invoke("desktop-viewer:close", contextId),
    currentState: () => ipcRenderer.invoke("desktop-viewer:state-now"),
    onState: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("desktop-viewer:state", handler);
      return () => ipcRenderer.removeListener("desktop-viewer:state", handler);
    },
  },
  /** Two sandboxed Local VM viewers embedded in the owning app window. */
  desktopWorkspace: {
    open: (input) => ipcRenderer.invoke("desktop-workspace:open", input),
    layout: (items) => ipcRenderer.invoke("desktop-workspace:layout", items),
    setInteractive: (contextId) => ipcRenderer.invoke("desktop-workspace:set-interactive", contextId),
    close: (contextId) => ipcRenderer.invoke("desktop-workspace:close", contextId),
    onState: (cb) => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("desktop-workspace:state", handler);
      return () => ipcRenderer.removeListener("desktop-workspace:state", handler);
    },
  },
  /** Native folder picker for a bot's working folder; null when cancelled. */
  pickFolder: (current) => ipcRenderer.invoke("desktop:pick-folder", current),
  /** Writes the redacted diagnostics report to a user-chosen file; resolves
   * the path, or null when the save dialog was cancelled. */
  exportDiagnostics: () => ipcRenderer.invoke("desktop:export-diagnostics"),
  /** Download logs: the window's console lines (already redacted) go with
   * the server's log window into one redacted text file the person saves;
   * resolves the path, or null when the save dialog was cancelled. */
  exportLogs: (rendererLines) => ipcRenderer.invoke("desktop:export-logs", Array.isArray(rendererLines) ? rendererLines.filter((line) => typeof line === "string") : []),
  /** Ask where to save a bot-created file (inside ~/.sagax), copy it
   * there and reveal it. Returns the chosen path, or null if the user
   * cancelled the dialog. The chat bubble shows the
   * rejection text verbatim, so strip the "Error invoking remote method"
   * wrapper ipcRenderer adds around a main-process throw. */
  saveFile: (filePath) =>
    ipcRenderer.invoke("desktop:save-file", filePath).catch((error) => {
      const message = String(error?.message ?? error);
      throw new Error(message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    }),
  /** Open a PDF the viewer shows in this computer's default PDF app. Main
   * writes the bytes to a new private temp file (always .pdf) and opens it;
   * no path crosses the bridge. Resolves true, or rejects with a short
   * message the viewer shows. */
  openPdf: (bytes, name) =>
    ipcRenderer.invoke("desktop:open-pdf", bytes, typeof name === "string" ? name : "").catch((error) => {
      const message = String(error?.message ?? error);
      throw new Error(message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    }),
  /** Point the file manager at a file a bot linked outside its workspace,
   * without opening it. Resolves "shown", "missing" or "invalid". */
  revealInFolder: (filePath) => ipcRenderer.invoke("desktop:reveal-file", filePath),
  /** Store a provider credential with OS-backed encryption. */
  setCredential: (name, value) => ipcRenderer.invoke("credential:set", name, value),

  /** In-app auto-update. Updates download by themselves; install is the
   *  person's "Restart to update". State object:
   *  { status: "idle"|"checking"|"downloading"|"preparing"|"downloaded"|"installing"|"handed-off"|"error",
   *    version?, percent?, message? }. onState fires immediately with the
   *    current state, then on every transition. Dormant in dev (no bridge). */
  updater: {
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    // An organization server's page restarts this app only on the person's click.
    install: () => isLocalPage || navigator.userActivation?.isActive === true
      ? ipcRenderer.invoke("update:install") : Promise.reject(new Error("Choose Restart to update.")),
    /** Opt in or out of pre-release versions (our GitHub releases only). */
    setPrereleases: (enabled) => ipcRenderer.invoke("update:set-prereleases", enabled === true),
    onState: (cb) => {
      ipcRenderer
        .invoke("update:get-state")
        .then((s) => cb(s))
        .catch(() => {});
      const handler = (_event, s) => cb(s);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  },

  /** "Join a Perspicax server" (slice 8, electron/org-join.mjs). Main checks
   * every call's sender: probe and stage answer the local page only; the
   * others answer only the organization server the copy was staged for. */
  orgJoin: {
    probe: (address) => ipcRenderer.invoke("org-join:probe", String(address ?? "")),
    stage: (input) => ipcRenderer.invoke("org-join:stage", input),
    join: (input) => ipcRenderer.invoke("org-join:join", input),
    staged: () => ipcRenderer.invoke("org-join:staged"),
    take: () => ipcRenderer.invoke("org-join:take"),
    takePreferences: () => ipcRenderer.invoke("org-join:take-preferences"),
    finished: (input) => ipcRenderer.invoke("org-join:finished", input),
    removeLocal: (keys) => ipcRenderer.invoke("org-join:remove-local", Array.isArray(keys) ? keys.map(String) : []),
  },

  /** Server mode (the launch screen's "Server"): which organization server
   * this app is locked to, and the one way out (Settings > General >
   * Server > Change), which signs out of it and returns to the launch
   * screen. Main answers only the main window's top frame. */
  serverMode: {
    state: () => ipcRenderer.invoke("server-mode:state"),
    leave: () => ipcRenderer.invoke("server-mode:leave"),
    /** Probe this computer's local model servers now (the model picker opened). */
    refreshLocalModels: () => ipcRenderer.invoke("server-mode:refresh-local-models"),
  },

  /** Saved servers, this computer's named local environments, and the active
   * one (Server menu). Switching, creating, adding and forgetting are
   * local-only: a remote page may read the list but not change where this
   * window goes. While server mode is set, main refuses every switch,
   * create and forget (requireNotServerMode). */
  environments: {
    state: () => ipcRenderer.invoke("environments:state"),
    switch: (id) => ipcRenderer.invoke("environments:switch", id),
    addFromLink: (link, name) => ipcRenderer.invoke("environments:add-from-link", link, name),
    create: (name, dataDir) => ipcRenderer.invoke("environments:create", name, dataDir),
    pickDir: () => ipcRenderer.invoke("environments:pick-dir"),
    forget: (id, purge) => ipcRenderer.invoke("environments:forget", id, purge === true),
    /** Settings → Servers, on a saved server's Computer access panel, or
     * ("copy") its Copy this computer here panel. */
    onOpenSettings: (cb) => {
      const handler = (_event, computerId) => cb(computerId);
      ipcRenderer.on("workspaces:open-settings", handler);
      return () => ipcRenderer.removeListener("workspaces:open-settings", handler);
    },
  },
  organization: process.argv.includes("--omb-company-desktop=1") ? {
    settingsOpened: () => ipcRenderer.invoke("organization:settings-opened"),
    state: () => ipcRenderer.invoke("organization:state"),
    begin: input => ipcRenderer.invoke("organization:begin", input),
    reopen: () => ipcRenderer.invoke("organization:reopen"),
    cancelEnrollment: () => ipcRenderer.invoke("organization:cancel"),
    refresh: () => ipcRenderer.invoke("organization:refresh"),
    disconnect: () => ipcRenderer.invoke("organization:disconnect"),
    onState: cb => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("organization:state-changed", handler);
      return () => ipcRenderer.removeListener("organization:state-changed", handler);
    },
  } : undefined,
  companyBackups: process.argv.includes("--omb-company-desktop=1") ? {
    state: () => ipcRenderer.invoke("company-backups:state"),
    list: () => ipcRenderer.invoke("company-backups:list"),
    create: input => ipcRenderer.invoke("company-backups:create", input),
    configureSchedule: input => ipcRenderer.invoke("company-backups:configure-schedule", input),
    prepareRestore: input => ipcRenderer.invoke("company-backups:preview", input),
    restore: input => ipcRenderer.invoke("company-backups:restore", input),
    delete: input => ipcRenderer.invoke("company-backups:delete", input),
    cancel: () => ipcRenderer.invoke("company-backups:cancel"),
    onState: cb => {
      const handler = (_event, state) => cb(state);
      ipcRenderer.on("company-backups:state-changed", handler);
      return () => ipcRenderer.removeListener("company-backups:state-changed", handler);
    },
  } : undefined,
  /** Settings > Memory: the organization memory cached for Obsidian
   * (electron/org-memory-cache.mjs). It sets itself up from the organization
   * server; no token ever crosses this bridge. */
  orgMemory: {
    state: () => ipcRenderer.invoke("org-memory:state"),
    auto: () => ipcRenderer.invoke("org-memory:auto"),
    sync: () => ipcRenderer.invoke("org-memory:sync"),
    erase: () => ipcRenderer.invoke("org-memory:erase"),
    writeObsidianConfig: () => ipcRenderer.invoke("org-memory:obsidian-config"),
    openInObsidian: () => ipcRenderer.invoke("org-memory:open-obsidian"),
    showFolder: () => ipcRenderer.invoke("org-memory:show-folder"),
  },
  /** Settings > Security and approvals that need a security key: Electron
   * cannot ask Touch ID, a passkey or a key's PIN, so the ceremony page
   * opens in the system browser (electron/security-key-browser.mjs) and
   * the page asks the server how it ended. The local page and this app's
   * bundle on an organization server. */
  securityKey: {
    open: pageUrl => ipcRenderer.invoke("security-key:open", pageUrl),
    returned: () => ipcRenderer.invoke("security-key:returned"),
  },
  computerSharing: {
    state: id => ipcRenderer.invoke("sharing:state", id),
    chooseFolder: () => ipcRenderer.invoke("sharing:folder"),
    save: (id, grant) => ipcRenderer.invoke("sharing:save", id, grant),
    revoke: id => ipcRenderer.invoke("sharing:revoke", id),
    activity: id => ipcRenderer.invoke("sharing:activity", id),
  },
  confirm: message => ipcRenderer.invoke("dialog:confirm", message),
  /** Hibou 98: show the assistant in its own always-on-top window, and trade
   * plain snapshots and clicks with it (electron/retro-assistant-window.mjs). */
  retroAssistant: {
    setDetached: on => ipcRenderer.invoke("retro-assistant:set-detached", on === true),
    update: snapshot => ipcRenderer.send("retro-assistant:update", snapshot),
    onEvent: cb => {
      const handler = (_event, value) => cb(value);
      ipcRenderer.on("retro-assistant:event", handler);
      return () => ipcRenderer.removeListener("retro-assistant:event", handler);
    },
    onDetachedChanged: cb => {
      const handler = (_event, on) => cb(on === true);
      ipcRenderer.on("retro-assistant:detached-changed", handler);
      return () => ipcRenderer.removeListener("retro-assistant:detached-changed", handler);
    },
  },
  /** The Data window: a bot's Data results in a window of their own, one
   * per bot (electron/data-window.mjs). Main opens it only for this app's
   * own window and only while the experimental switch is on. */
  dataWindow: {
    open: (request) => ipcRenderer.invoke("data-window:open", {
      botId: String(request?.botId ?? ""),
      title: String(request?.title ?? ""),
      ...(request?.cardId ? { cardId: String(request.cardId) } : {}),
    }),
  },
  /** Floating bots: a bot on its own always-on-top window, one per bot. This
   * page is the brain; the windows only draw and report clicks
   * (electron/floating-bot-window.mjs). */
  floatingBots: {
    open: (botId, alwaysOnTop) => ipcRenderer.invoke("floating-bots:open", { botId: String(botId), alwaysOnTop: alwaysOnTop !== false }),
    close: botId => ipcRenderer.invoke("floating-bots:close", { botId: String(botId) }),
    setAlwaysOnTop: (botId, on) => ipcRenderer.invoke("floating-bots:set-top", { botId: String(botId), on: on === true }),
    list: () => ipcRenderer.invoke("floating-bots:list"),
    // "Switch bot": the window on the desktop now stands for another bot
    rekey: (fromId, toId) => ipcRenderer.invoke("floating-bots:rekey", { from: String(fromId), to: String(toId) }),
    update: (botId, snapshot) => ipcRenderer.send("floating-bots:update", { botId: String(botId), snapshot }),
    level: (botId, levels) => ipcRenderer.send("floating-bots:level", { botId: String(botId), levels }),
    // the mascot's call hotkey (electron/mascot-hotkey.mjs): on or off, its keys, whether holds are read
    hotkey: config => ipcRenderer.invoke("floating-bots:hotkey", config && typeof config === "object" ? { enabled: config.enabled === true, accelerator: String(config.accelerator ?? ""), hold: config.hold === true } : { enabled: false }),
    onHotkey: cb => {
      const handler = (_event, value) => cb(value);
      ipcRenderer.on("floating-bots:hotkey", handler);
      return () => ipcRenderer.removeListener("floating-bots:hotkey", handler);
    },
    onWant: cb => {
      const handler = (_event, value) => cb(value);
      ipcRenderer.on("floating-bots:want", handler);
      return () => ipcRenderer.removeListener("floating-bots:want", handler);
    },
    onEvent: cb => {
      const handler = (_event, value) => cb(value);
      ipcRenderer.on("floating-bots:event", handler);
      return () => ipcRenderer.removeListener("floating-bots:event", handler);
    },
    onClosed: cb => {
      const handler = (_event, value) => cb(value);
      ipcRenderer.on("floating-bots:closed", handler);
      return () => ipcRenderer.removeListener("floating-bots:closed", handler);
    },
  },
};

contextBridge.exposeInMainWorld(
  "ogb",
  isLocalPage ? bridge : Object.fromEntries(Object.entries(bridge).filter(([key]) => REMOTE_SAFE.has(key) || (bundledPage && BUNDLED_EXTRA.has(key)))),
);
