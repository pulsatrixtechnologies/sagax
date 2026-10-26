// The narrow bridge the Electron preload exposes. Absent in the browser.

declare global {
  /** electron/main.mjs signInState: the system-browser sign-in /pair waits on. */
  type PulsatrixSignInState =
    | { status: "idle" }
    | { status: "waiting"; origin: string }
    | { status: "error"; origin: string; error: "timeout" | "unsupported" | "browser" | "unreachable" };
  type CompanyBackupEntry = Omit<import("../../electron/company-backups.mjs").CompanyBackupMetadata, "status"> & { status: "creating" | "uploading" | "completing" | "ready" | "cleanup" };
  interface CompanyBackupScheduleState {
    enabled: boolean;
    status: "off" | "waiting" | "running" | "paused" | "error";
    nextBackupAt?: number;
    lastAttemptAt?: number;
    lastBackupAt?: number;
    message?: string;
  }
  interface CompanyBackupState {
    busy: boolean;
    pendingRestore?: boolean;
    kind?: "backup" | "restore";
    progress?: import("../../electron/company-backups.mjs").CompanyBackupProgress;
    message?: string;
    lastBackupAt?: number;
    schedule?: CompanyBackupScheduleState;
  }
/** Fork version inlined by Vite. Official base is __BASE_VERSION__. */
const __APP_VERSION__: string;
const __BASE_VERSION__: string;

  type DesktopSharedFolder = import("../../electron/computer-sharing.mjs").SharedFolder;
  type DesktopComputerSharing = import("../../electron/computer-sharing.mjs").SharingState;
  type DesktopLendingActivity = import("../../electron/computer-sharing.mjs").LendingActivityEntry;

  type DesktopCapabilities = {
    host: {
      platform: "darwin" | "linux" | "win32" | "other";
      /** The user's home folder, for showing paths as ~/… */
      homeDir?: string;
      label: string;
      session: "x11" | "wayland" | "headless" | "unknown";
      packaged: boolean;
    };
    windowChrome: "mac-inset" | "win-caption" | "native";
    screenPreview: {
      available: boolean;
      interaction: "direct" | "portal-picker" | "none";
      reasonCode?: string;
    };
    dictation: {
      available: boolean;
      engine: "apple-speech" | "none";
      onDevice: boolean;
      reasonCode?: string;
    };
    localComputer: {
      available: boolean;
      support: "supported" | "limited" | "unsupported";
      enabled: boolean;
      status: "disabled" | "checking" | "starting" | "ready" | "error" | "stopped" | "unavailable";
      reasonCode?: string;
      message?: string;
      driverPath?: string;
      driverVersion?: string;
      driverSource?: "bundled" | "environment" | "user-local" | "path";
      session?: "x11" | "wayland" | "headless" | "unknown";
      compositor?: "gnome-mutter";
    };
  };

  interface DesktopWorkspaceBounds {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface BrowserSurfaceState {
    botId: string;
    open: boolean;
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward?: boolean;
    visible: boolean;
    partition?: string | null;
    profile?: string | null;
    mode?: "compact" | "expanded" | null;
    code?: "renderer-gone" | "profile-deleted" | "evicted";
  }

  interface DesktopWorkspaceState {
    contextId: string;
    open: boolean;
    status: "opening" | "ready" | "error" | "closed";
    interactive: boolean;
    code?: "load-failed" | "renderer-gone";
  }

  /** Whether the desktop is holding this computer awake for routines. */
  interface DesktopRoutineWake {
    /** the toggle */
    keepAwake: boolean;
    /** a power assertion is held right now */
    hold: boolean;
    /** "due" | "running" while held; "off" | "battery" | "idle" | "stopped" otherwise */
    reason: string;
    /** the due routine's time, when the hold is for a due routine */
    at: number | null;
    onBattery: boolean;
  }
  interface DesktopRemoteClientState {
    active: boolean;
    endpoint?: string;
    serverName?: string;
    deviceId?: string;
  }

  interface Window {
    /** Only in the detached Hibou 98 assistant window (electron/retro-assistant-preload.cjs). */
    retroAssistantWindow?: import("../components/retro-assistant/detached-protocol").AssistantWindowBridge;
    /** Only in a floating bot's window (electron/floating-bot-preload.cjs). */
    floatingBotWindow?: import("../components/floating-bots/protocol").FloatingWindowBridge;
    ogb?: {
      platform: NodeJS.Platform;
      /** Desktop only: true once when the main process handed this exact
       * credential to /pair from a "Sign in with Pulsatrix" return it was
       * waiting for (electron/oidc-system-sign-in.cjs createSignInHandoff). */
      takeSignInReturn?: (code: string) => Promise<boolean>;
      /** Desktop only: "Sign in with Pulsatrix" waiting in the system browser. */
      pulsatrixSignIn?: {
        state(): Promise<PulsatrixSignInState>;
        cancel(): Promise<boolean>;
        reopen(): Promise<boolean>;
        onChange(cb: (state: PulsatrixSignInState) => void): () => void;
      };
      organization?: import("../../electron/managed-desktop.mjs").ManagedDesktopBridge;
      companyBackups?: {
        state(): Promise<CompanyBackupState>;
        list(): Promise<{ backups: CompanyBackupEntry[]; usedBytes: number; limits: { ownerQuotaBytes: number; retainedSnapshots: number } }>;
        create(input: { clientState: import("../../shared/workspace-backup").WorkspaceBackupClientState }): Promise<CompanyBackupEntry>;
        configureSchedule?(input: { enabled: false } | { enabled: true; confirmation: "BACK UP THIS WORKSPACE DAILY" }): Promise<CompanyBackupState>;
        prepareRestore(input: { id: string; password?: string }): Promise<{ id: string; summary: import("../../shared/workspace-backup").WorkspaceBackupSummary }>;
        restore(input: { id: string; confirmation: "REPLACE" }): Promise<{ restoreId: string }>;
        delete(input: { id: string; confirmation: "DELETE" }): Promise<unknown>;
        cancel(): Promise<void>;
        onState(callback: (state: CompanyBackupState) => void): () => void;
      };
      workspaces?: {
        state: () => Promise<{ local: boolean; name: string; origin?: string; serverMode?: boolean }>;
        menu: () => Promise<void>;
      };
      /** Server mode (electron/environments.cjs): the organization server
       * this app is locked to, and leaving it (signs out, back to the launch
       * screen). This app's own UI only. */
      serverMode?: {
        state: () => Promise<{ active: false } | { active: true; id: string; name: string; origin: string }>;
        leave: () => Promise<{ left: boolean }>;
        /** Probe this computer's loopback model servers now and publish
         * them to the server (electron/desktop-bridge.mjs). Absent on an
         * older desktop. */
        refreshLocalModels?: () => Promise<{ refreshed: boolean }>;
      };
      /** Saved servers and the active one (desktop Server menu). Present on
       * the local server's UI; a remote server's page sees a reduced bridge. */
      environments?: {
        state: () => Promise<{
          localOrigin: string;
          remote: boolean;
          /** Named local environments exist only in a packaged build. */
          packaged: boolean;
          activeId: string;
          environments: Array<{
            id: string;
            kind?: "local" | "remote";
            name: string;
            origin?: string;
            /** An organization server (signs people in with Pulsatrix). */
            org?: boolean;
            dataDir?: string;
            missing?: boolean;
          }>;
        }>;
        /** Local targets answer {ok, error?} (error strings are an open set); remote ones answer nothing. */
        switch: (id: string) => Promise<{ ok: boolean; error?: string } | void>;
        addFromLink: (link: string, name?: string) => Promise<boolean | void>;
        /** Register a named local environment; an omitted dataDir lands beside the app's own. */
        create: (name: string, dataDir?: string) => Promise<{ ok: boolean; error?: string; state: unknown }>;
        /** Native folder chooser for the create form; { ok: false } on cancel. */
        pickDir: () => Promise<{ ok: boolean; path?: string }>;
        /** {ok:false} when main refused (active local, failed folder delete); a
         * cancelled remote confirm and remote success answer nothing. */
        forget: (id: string, purge?: boolean) => Promise<{ ok: boolean; error?: string } | void>;
        /** `panel` "copy": that server's Copy this computer here panel; otherwise its Computer access. */
        onOpenSettings?: (callback: (computerId?: string | null, panel?: "copy") => void) => () => void;
      };
      /** Slice 8, "Join a Perspicax server": probe, stage and join answer
       * only the local renderer; staged, take, finished and removeLocal answer only
       * the main frame of the organization server the copy was staged for. */
      orgJoin?: {
        probe(address: string): Promise<{ origin: string; issuer: string }>;
        stage(input: { origin: string; document: unknown }): Promise<{ ok: true }>;
        /** Save the probed server, open it and start "Sign in with Pulsatrix", copying nothing.
         * `serverMode: true` (the launch screen) locks the app to that server. */
        join(input: { origin: string; serverMode?: boolean; preferences?: Record<string, string> }): Promise<{ ok: true }>;
        /** Server mode: the preferences this computer's solo app had, handed
         * once to the organization server's page that joined (never asked). */
        takePreferences?(): Promise<Record<string, string> | null>;
        staged(): Promise<{ origin: string; bots: number; name: string } | null>;
        take(): Promise<unknown>;
        finished(input: { report: unknown }): Promise<{ ok: true }>;
        removeLocal(keys: string[]): Promise<{ removed: string[] }>;
      };
      /** Local main-window only. Hosted renderers cannot grant themselves access. */
      computerSharing?: {
        state(id: string): Promise<DesktopComputerSharing>;
        chooseFolder(): Promise<DesktopSharedFolder | null>;
        save(id: string, grant: Pick<DesktopComputerSharing, "folders" | "terminal" | "computer">): Promise<DesktopComputerSharing | null>;
        revoke(id: string): Promise<DesktopComputerSharing>;
        /** This computer's own record of what that server's bots did here, newest first. */
        activity(id: string): Promise<DesktopLendingActivity[]>;
      };
      confirm(message: string): Promise<boolean>;
      getCapabilities(): Promise<DesktopCapabilities>;
      onCapabilitiesChanged(cb: (capabilities: DesktopCapabilities) => void): () => void;
      remoteClient?: {
        active: boolean;
        state(): Promise<DesktopRemoteClientState>;
        pair(endpoint: string, code: string): Promise<DesktopRemoteClientState>;
        disconnect(): Promise<DesktopRemoteClientState>;
      };
      /** Keep this computer awake for scheduled routines; absent on remote
       * server pages and in older desktop builds. */
      routines?: {
        wakeState(): Promise<DesktopRoutineWake>;
        keepAwake(enabled: boolean): Promise<DesktopRoutineWake>;
      };
      companionAccount?: {
        state(): Promise<CompanionAccountState>;
        requestCode(email: string): Promise<CompanionAccountState>;
        verifyCode(email: string, code: string): Promise<CompanionAccountState>;
        retry(): Promise<CompanionAccountState>;
        signOut(): Promise<CompanionAccountState>;
      };
      /** Local-shell-only bridge for trusted approval-mode transitions. It is
       * absent on remote server pages and in older desktop builds. */
      approvals?: {
        setMode(
          botId: string,
          mode: import("../../shared/approval-mode").ApprovalMode,
          options?: { acknowledgeLocalAuto?: boolean; threadId?: string; threadOnly?: boolean; allThreads?: boolean;
            refreshPermissions?: boolean;
            modelSelection?: import("../state/store").ModelSelection; updateBotDefault?: boolean },
        ): Promise<import("../state/store").Bot>;
      };
      /** Per-loopback-server API keys for local models, kept encrypted on
       * this computer only. `keyBases` lists which loopback bases have a key
       * (never the key value); `setKey`/`clearKey` store or remove one and
       * re-probe. Absent on remote server pages and in older desktop builds. */
      localModels?: {
        keyBases(): Promise<string[]>;
        setKey(base: string, key: string): Promise<boolean>;
        clearKey(base: string): Promise<boolean>;
      };
      localControl: {
        status(): Promise<LinuxLocalControlStatus>;
        enable(): Promise<LinuxLocalControlStatus>;
        disable(): Promise<LinuxLocalControlStatus>;
        retry(): Promise<LinuxLocalControlStatus>;
      };
      /** Arms one user-initiated display capture request from this frame. */
      beginScreenPreviewIntent(): boolean;
      screenFrame(): Promise<string | null>;
      androidDevice?: {
        status(): Promise<AndroidDeviceStatus>;
        frame(serial: string): Promise<{ serial: string; dataUrl: string }>;
        input(serial: string, payload: AndroidDeviceInput): Promise<void>;
      };
      /** Start native dictation. Call mode supplies endpointMs so silence
       * finalizes a turn; composer dictation omits it and remains manual. */
      speechStart(options?: { endpointMs?: number }): Promise<void>;
      speechStop(): Promise<void>;
      /** Finish capture and emit the recognizer's final transcript. */
      speechFinish?(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null; reason?: string }) => void): () => void;
      /** Absolute path of a dropped File ("" when the drag carried no
       * file on disk). Absent in older builds of the shell. */
      getPathForFile?(file: File): string;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. `pageMic`: whether
       * this app lets the asking page use the microphone (this computer's
       * page always; a server's page only on the person's own Cloud).
       * Absent in older builds of the shell. */
      permStatus(): Promise<{ mic: string; pageMic?: "allowed" | "refused" }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech|accessibility. */
      permOpenSettings(pane: "mic" | "screen" | "speech" | "accessibility"): Promise<void>;
      /** Relaunch the local desktop app through its normal shutdown cleanup. */
      relaunch?(): Promise<boolean>;
      /** Copies an engine install command and opens a blank terminal. False
       * when no terminal could be launched; the clipboard still has it. */
      openInstallTerminal?(command: string): Promise<boolean>;
      /** Writes plain text to the system clipboard; false on failure. Absent on older builds. */
      copyText?(text: string): Promise<boolean>;
      /** Opens an http(s) link in the user's default browser. */
      openExternal?(url: string): Promise<boolean>;
      /** A Connect card's sign-in page; main allows grok.com and claude.ai only. */
      openConnectorSetup?(url: string): Promise<boolean>;
      /** Recolor the native window chrome for a skin; absent on older builds. */
      applySkin?(skin: string): Promise<boolean>;
      /** Settings > Appearance > App icon (electron/app-icon.mjs). */
      /** Settings > Memory: the organization memory cached for Obsidian
       * (electron/org-memory-cache.mjs). */
      orgMemory?: import("../lib/org-memory").OrgMemoryBridge;
      /** A security key ceremony in the system browser (Electron cannot
       * ask Touch ID, a passkey or a key's PIN): `open` opens the
       * ceremony page there, `returned` brings this app back to the front. */
      securityKey?: {
        open(pageUrl: string): Promise<{ ok: boolean; error?: string }>;
        returned(): Promise<boolean>;
      };
      /** The language last chosen in this app on any of its pages (local
       * page or an organization server's page from this bundle), kept by
       * main: a locale code, "" for the system language, null if never. */
      desktopLanguage?: {
        get(): string | null;
        set(language: string): Promise<string | null>;
      };
      /** Hardware acceleration and the spell checker (kept by main). */
      shellPreferences?: {
        get(): { hardwareAcceleration: boolean; spellcheck: boolean; botHotkeys?: boolean; botHotkeyModifier?: "cmd-shift" | "cmd-alt" | "ctrl-alt" } | null;
        set(patch: { hardwareAcceleration?: boolean; spellcheck?: boolean; botHotkeys?: boolean; botHotkeyModifier?: "cmd-shift" | "cmd-alt" | "ctrl-alt" }): Promise<{ hardwareAcceleration: boolean; spellcheck: boolean } | null>;
        /** The window's own zoom for the Text size choice (1 to 1.5). */
        setZoom?(factor: number): boolean;
      };
      appIcon?: {
        get(): Promise<{ platform: string; id: string | null; updatedAt: number | null }>;
        set(request: { id: string; images: Array<{ size: number; png: string }> }): Promise<{ platform: string; id: string | null; updatedAt: number | null }>;
        reset(): Promise<{ platform: string; id: null; updatedAt: null }>;
      };
      /** Hibou 98: the assistant in its own always-on-top window (local desktop page only). */
      retroAssistant?: {
        setDetached(on: boolean): Promise<boolean>;
        update(snapshot: import("../components/retro-assistant/detached-protocol").DetachedSnapshot): void;
        onEvent(cb: (event: import("../components/retro-assistant/detached-protocol").DetachedEvent) => void): () => void;
        onDetachedChanged(cb: (on: boolean) => void): () => void;
      };
      /** Floating bots: one always-on-top window per bot (local desktop page only). */
      floatingBots?: import("../components/floating-bots/protocol").FloatingBotsBridge;
      /** The Data window: one window per bot on the /data-window route
       * (electron/data-window.mjs). Main refuses while the experimental
       * switch is off. */
      dataWindow?: {
        open(request: { botId: string; title: string; cardId?: string }): Promise<"created" | "focused" | "refused">;
      };
      /** The renderer-drawn Windows caption buttons; absent outside the
       * frameless Windows shell (macOS/Linux/browser keep native chrome). */
      windowControls?: {
        minimize(): Promise<boolean>;
        toggleMaximize(): Promise<boolean>;
        close(): Promise<boolean>;
        state(): Promise<{ maximized: boolean }>;
        onMaximizedChanged(cb: (maximized: boolean) => void): () => void;
      };
      /** Receives a GitHub package URL opened through openmausbot://install. */
      onPackageInstall?(cb: (url: string) => void): () => void;
      /** Receives a chat link (openmausbot://thread/… or openmausbot://bot/…)
       * opened from outside the app. */
      onChatLink?(cb: (link: string) => void): () => void;
      /** The desktop shell's app-menu Preferences… item was activated; open
       * app Settings. Local-shell only: remote server pages never receive
       * the channel, and the bridge is absent in the browser. "cloud" is the
       * openmausbot://cloud link (Settings → OMB Cloud, opened by the link). */
      onOpenAppSettings?(cb: (section?: "organization" | "cloud" | "cloud-settings") => void): () => void;
      /** Help → Release notes. Absent in the browser and on a remote page. */
      /** Updates the native Dock/taskbar unread indicator. */
      setUnreadCount?(count: number): void;
      /** A nudge here: bring the main window to the very front (restore,
       * show, top most for a moment, focus taken from the other app) and
       * shake it once unless `shake` is false. `role: "received"` (the
       * default) also bounces the Dock / flashes the taskbar; `"sent"` is
       * the sender's own window. The shell ignores a second call while a
       * shake is running. */
      nudgeWindow?(options?: { shake?: boolean; role?: "received" | "sent" }): void;
      /** A native notification shown by the shell (src/lib/attention.ts). */
      notify?(request: {
        id: string;
        title: string;
        body: string;
        sound: boolean;
        persistent: boolean;
        bounce: "critical" | "informational" | null;
        flash: boolean;
        target?: { botId?: string; threadId?: string; groupId?: string; routineRunId?: string };
        /** Lets withdrawNotification take it down (an approval answered elsewhere). */
        withdrawKey?: string;
      }): void;
      /** Close the shell notifications shown with this withdraw key. */
      withdrawNotification?(withdrawKey: string): void;
      /** The id of a shell notification the person clicked. */
      onNotificationClick?(cb: (id: string, target?: { botId?: string; threadId?: string; groupId?: string; routineRunId?: string } | null) => void): () => void;
      /** The menu bar's bot list (electron/system-tray.mjs). */
      setTrayRoster?(roster: Array<{ id: string; name: string; color: string; working: boolean; unread: number }>, labels?: Record<string, string>): void;
      /** A bot chosen in the menu bar list or by its global shortcut. */
      onOpenBot?(cb: (botId: string) => void): () => void;
      /** A picture of the screen from the bots' chord with 0 (base64 PNG), or why there is none. */
      onScreenCapture?(cb: (capture: { png: string } | { error: "permission" | "unavailable"; platform: "darwin" | "win32" | "other" }) => void): () => void;
      /** Presence: the computer's idle state and seconds since the last
       * input (Electron powerMonitor). Null outside the main window. */
      systemIdle?(): Promise<{ state: "active" | "idle" | "locked" | "unknown"; idleSeconds: number } | null>;
      /** Opens a live desktop as a sandboxed window owned by Sagax. */
      desktopViewer?: {
        open(url: string, title: string, contextId: string): Promise<boolean>;
        /** Closes the live-desktop window, but only when it belongs to this bot. */
        close(contextId: string): Promise<boolean>;
        /** The current viewer state, for a panel to initialize from on mount. */
        currentState(): Promise<{ open: boolean; contextId: string | null }>;
        onState(cb: (state: { open: boolean; contextId: string | null }) => void): () => void;
      };
      /** Two Local VM viewers embedded in one app window. URLs are accepted
       * only by main-process validation and never return over this bridge. */
      desktopWorkspace?: {
        open(input: {
          contextId: string;
          url: string;
          title: string;
          bounds: DesktopWorkspaceBounds;
        }): Promise<DesktopWorkspaceState>;
        layout(items: Array<{
          contextId: string;
          bounds: DesktopWorkspaceBounds;
          visible: boolean;
        }>): Promise<boolean>;
        setInteractive(contextId: string | null): Promise<boolean>;
        close(contextId?: string): Promise<boolean>;
        onState(cb: (state: DesktopWorkspaceState) => void): () => void;
      };
      /** Native folder picker; resolves null when the user cancels. */
      pickFolder?(current?: string): Promise<string | null>;
      /** Writes the redacted diagnostics report to a user-chosen file;
       * resolves the path, or null when cancelled. */
      exportDiagnostics?(): Promise<string | null>;
      /** Download logs: one redacted text file of the recent logs (server
       * log window, server.log, this window's console, updater, crashes) at
       * a path the person picks; resolves it, or null when cancelled. */
      exportLogs?(rendererLines: string[]): Promise<string | null>;
      /** Asks where to save a bot-created file (inside ~/.sagax), copies
       * it there and reveals it. Resolves the chosen path, or null if the
       * user cancelled the dialog. */
      saveFile?(filePath: string): Promise<string | null>;
      /** Points this computer's file manager at a file a bot linked outside
       * its workspace, without opening or reading it. Local app only. */
      revealInFolder?(filePath: string): Promise<"shown" | "missing" | "invalid">;
      /** Opens a PDF the viewer shows in this computer's default PDF app:
       * main writes the bytes to a new private temp .pdf and opens it.
       * Resolves true, or rejects with a short message. */
      openPdf?(bytes: Uint8Array, name: string): Promise<boolean>;
      /** Save a provider credential through Electron's OS-backed store. */
      setCredential?(
        name: "xaiApiKey" | "boxToken" | "opencodeGoApiKey" | "ttsKey" | "fishAudioKey" | "xaiVoiceKey" | "jevApiKey" | "openaiImageApiKey" | "customImageApiKey" | "openaiLiveKey",
        value: string,
      ): Promise<ConfigStatus>;
      /** In-app auto-update (packaged app only; dormant in dev). Updates
       * download by themselves. On this computer's page and the person's own
       * Cloud page; any other server's page gets no state. onState fires
       * with the current state, then on transitions. */
      updater?: {
        check(): Promise<void>;
        /** apply the download: quit-and-install, or copy the command and open
         * a terminal. On a server's page, only from the person's click.
         * `confirmed`: the person chose "Restart to install" in the update
         * dialog; without it the desktop app asks natively first. */
        install(options?: { confirmed?: boolean }): Promise<void>;
        /** opt in or out of pre-release versions from Sagax's GitHub releases */
        setPrereleases?(enabled: boolean): Promise<UpdaterState>;
        setChannel?(channel: "stable" | "nightly"): Promise<UpdaterState>;
        setAutoInstallAway?(enabled: boolean): Promise<UpdaterState>;
        reportActivity?(count: number): Promise<void>;
        installWhenIdle?(enabled: boolean): Promise<UpdaterState>;
        onState(cb: (s: UpdaterState) => void): () => void;
      };
    };
  }
}

export interface LinuxLocalControlStatus {
  enabled: boolean;
  status: "disabled" | "checking" | "starting" | "ready" | "error" | "stopped" | "unavailable";
  reasonCode?: string;
  message?: string;
  driverPath?: string;
  driverVersion?: string;
  driverSource?: "bundled" | "environment" | "user-local" | "path";
  session?: "x11" | "wayland" | "headless" | "unknown";
  compositor?: "gnome-mutter";
  warnings?: Array<{ label: string; status: string; message: string; detail?: string }>;
}

export interface UpdaterState {
  status:
    | "idle"
    | "checking"
    | "downloading"
    /** downloaded bytes are being staged by the native macOS updater */
    | "preparing"
    | "downloaded"
    | "installing"
    /** the command is on the clipboard; the user finishes in a terminal */
    | "handed-off"
    | "error";
  version?: string;
  /**
   * GitHub release body for this update. A string is the latest release.
   * An array is one entry per skipped version. The renderer sorts it
   * newest first and drops anything that is not text.
   */
  notes?: string | Array<{ version: string; note: string }>;
  /** the release's notes as one string (HTML or Markdown), when the feed has them */
  releaseNotes?: string;
  percent?: number;
  message?: string;
  /** pre-release versions are offered (opt-in, this computer only) */
  allowPrerelease?: boolean;
  /** the named update channel (this computer only) */
  channel?: "stable" | "nightly";
  /** a downloaded update installs by itself while the person is away and no bot works */
  autoInstallWhenAway?: boolean;
  /** bots working now, as the page last reported (a restart would cut them short) */
  activeBots?: number;
  /** the person asked to restart once no bot works */
  waitingForBots?: boolean;
  /** native work may still be running; recovery requires an app restart */
  retryable?: boolean;
  /**
   * How the download gets applied. "restart" quits and installs in place;
   * "handoff" copies the install command and opens a terminal so the user
   * can finish — Ubuntu .deb (and rpm/pacman) builds use this.
   */
  installMode?: "restart" | "handoff";
  /** hand-off only: the install command, already on the clipboard */
  command?: string;
  /** hand-off only: whether a terminal was opened to paste it into */
  terminalOpened?: boolean;
}

export interface CompanionAccountState {
  available: boolean;
  status: "signed-out" | "connecting" | "ready" | "error";
  email?: string;
  endpoint?: string;
  message?: string;
}

export type AndroidUsbDevice = {
  serial: string;
  state: string;
  connection: "usb";
  model: string;
  product?: string;
  transportId?: string;
};

export type AndroidDeviceStatus = {
  available: boolean;
  reasonCode?: "adb-unavailable" | "adb-failed";
  message?: string;
  devices: AndroidUsbDevice[];
};

export type AndroidDeviceInput =
  | { type: "tap"; x: number; y: number; width: number; height: number }
  | {
      type: "swipe";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      durationMs: number;
      width: number;
      height: number;
    }
  | { type: "key"; key: string; width?: number; height?: number }
  | { type: "text"; text: string; width?: number; height?: number };
