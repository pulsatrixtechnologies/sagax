import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot as BotIcon, Loader2, Plus } from "lucide-react";
import { useAdvancedMode } from "@/lib/interface-mode";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOrgMemoryAuto } from "@/lib/org-memory";
import { openBot, openNotificationTarget, StoreProvider, useStore, type AppSettingsSection } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { useWelcomeViewer, WelcomeGate } from "@/components/onboarding/WelcomeGate";
import { mainConversation } from "@/lib/main-view";
import { GuidedTour } from "@/components/onboarding/GuidedTour";
import { OpenAtLoginOffer } from "@/components/OpenAtLoginOffer";
import { LiveCallHost } from "@/components/LiveCallHost";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { initAnalytics } from "@/lib/analytics";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { SplitWorkspace, useBotPanelBot } from "@/components/SplitWorkspace";
import { PersonPanel } from "@/components/PersonPanel";
import { SideThreadPanel } from "@/components/SideThreadPanel";
import { ComposeToPicker } from "@/components/ComposeToPicker";
import { BotWizard } from "@/components/bot-wizard/BotWizard";
import { PluginsPanel } from "@/components/PluginsPanel";
import {
  AchievementsScreen, ActivityPanel, ApprovalsPage, BotCatalogModal, BotSettingsDialog, CodePage, InspectorPanel, KeyboardShortcutsModal, LocalVmWorkspace, NewBotDialog,
  PersonaEditorModal, preloadScreens, RemoteAgentSettingsPanel, RemoteDesktopPanel, RemoteSessionsAdminPage, RoutinesPage, SettingsModal, TeamMapPage, TriggersPanel,
} from "@/components/lazy-screens";
import { WorkspaceBackupRecovery } from "@/components/WorkspaceBackupSettings";
import { ReleaseNotesPrompt } from "@/components/ReleaseNotesPrompt";
import { TermsGate } from "@/components/TermsGate";
import { UpdateBanner } from "@/components/UpdateBanner";
import { DesktopCapabilitiesProvider, useCaptionChrome, useDesktopCapabilities, WindowDragStrip } from "@/components/DesktopCapabilities";
import { WindowCaptionButtons } from "@/components/WindowCaptionButtons";
import { NoEngines } from "@/components/NoEngines";
import { OrgEngineNotice } from "@/components/OrgEngineSetup";

import { CommandPalette, openCommandPalette } from "@/components/CommandPalette";
import { ArtifactsHost } from "@/components/artifacts/ArtifactsHost";
import { StagedOrgImport } from "@/components/OrgImportDialog";
import { RetroAssistantHost } from "@/components/RetroAssistantHost";
import { AchievementToaster } from "@/components/achievements/AchievementToaster";
import { MyChromeIndicator } from "@/components/MyChromeIndicator";
import { HostControlIndicator } from "@/components/HostControlIndicator";
import { reportAchievement } from "@/lib/achievements";
import { FloatingBotsHost } from "@/components/FloatingBotsHost";
import { FloatingWindowsHost } from "@/components/floating/FloatingWindowsHost";
import { CallEngineHost } from "@/components/CallView";
import { RetroBootSlot, RetroChromeSlot } from "@/components/RetroChromeHost";
import { activeLocale, loadLocale, t } from "@/lib/i18n";
import { appShortcutFor, shouldOpenKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { focusComposer } from "@/lib/composer-focus";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { normalizeInboxDeepLink } from "@/lib/inbox-deep-link";
import { openThreadVisible, pageOpenThreadTarget, type OpenThreadTarget } from "@/lib/open-thread-hash";
import { clearLeftViewHash, watchViewHash } from "@/lib/view-hash";
import { takeSettingsReturn } from "@/lib/settings-return";
import { saveSidebarAttentionPinned, toggleSidebarCollapsed } from "@/lib/sidebar-preferences";
import { botShowsUnread } from "@/lib/bot-unread";
import { badgeCount } from "@/lib/attention";
import { dockBadge, useLocalSwitch } from "@/lib/notification-preferences";
import { primeNudgeSound } from "@/lib/nudge-sound";
import { viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";
import { phonePairingSettingsAction, takePhonePairingRequest } from "@/lib/phone-pairing";
import { botsReadOnlyText } from "@/lib/permissions";
import { ModelWindowHost } from "./components/ModelWindowHost";
import { DataWindowViewSync } from "@/components/DataWindowButton";
import { useExternalChatLinks } from "@/hooks/use-external-chat-links";
import { ChatNotice } from "@/components/ChatErrorBanner";
import { TeamBotFromThreadHost } from "@/components/TeamBotFromThreadDialog";
import { navigate } from "@/lib/view-transitions";
import { useScreenCaptureToBot } from "@/hooks/use-screen-capture-to-bot";
import { MAUS_COLORS } from "@/lib/mascot";
import { botSwitchActive, useBotAccent, useBotAccentEnabled, useBotSwitch } from "@/lib/bot-accent";
import { usePageLookSync } from "@/lib/page-look-sync";

function Shell() {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { capabilities } = useDesktopCapabilities();
  const captionChrome = useCaptionChrome();
  const unreadCount =
    state.bots.filter((bot) => !bot.hidden && botShowsUnread(bot)).length +
    state.groups.filter((group) => group.unread).length;
  const remoteClient = window.ogb?.remoteClient?.active === true;
  useEffect(() => {
    if (!window.ogb?.environments) return;
    // A saved server's Computer access panel, or ("copy") its Copy this computer here panel.
    const open = (computerId?: string | null, panel?: "copy") => {
      if (computerId) {
        const target = new URL(window.location.href);
        target.searchParams.set(panel === "copy" ? "copy-to" : "share-computer", computerId);
        window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
      }
      dispatch({ type: "toggleAppSettings", open: true, section: "organization" });
    };
    const url = new URL(window.location.href);
    const requestedSettings = url.searchParams.get("desktop-settings");
    // Sagax: the inherited OMB Cloud links ("cloud", "cloud-settings") open nothing.
    if (requestedSettings === "workspaces" || requestedSettings === "organization") {
      url.searchParams.delete("desktop-settings");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      open();
    }
    return window.ogb.environments.onOpenSettings?.(open);
  }, [dispatch]);
  // Slice 7: "Open in Sagax" from the Perspicax console (#thread=…&bot=…):
  // the thread opens once the viewer's lists hold it; a thread they may not
  // see is never listed, so nothing happens and the link is dropped.
  const openThreadTarget = useRef<OpenThreadTarget | null | undefined>(undefined);
  if (openThreadTarget.current === undefined) openThreadTarget.current = pageOpenThreadTarget();
  useEffect(() => {
    if (!openThreadTarget.current) return;
    const timer = setTimeout(() => { openThreadTarget.current = null; }, 30_000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const target = openThreadTarget.current;
    if (!target || !openThreadVisible(target, state)) return;
    openThreadTarget.current = null;
    openNotificationTarget(dispatch, target, state, showThreads);
  }, [state.bots, state.groups, dispatch]);
  // `#approvals` (its filters stay in the address) and `#code` (or
  // `#code/<run>`, which then leaves the address) open their screen, at load
  // and when the hash changes in an open tab.
  useEffect(() => watchViewHash(dispatch), [dispatch]);
  // leaving Approvals or Code drops its address, so the same link opens it
  // again; only on leaving, so a link read at load keeps its filters
  const viewHashFrom = useRef(state.activeView);
  useEffect(() => {
    const from = viewHashFrom.current;
    viewHashFrom.current = state.activeView;
    if (from !== state.activeView && (from === "approvals" || from === "code")) clearLeftViewHash(state.activeView);
  }, [state.activeView]);
  // Back from a sign-in a Settings page asked for (Settings > Security: the
  // first key needs a fresh one): that page opens again.
  useEffect(() => {
    const section = takeSettingsReturn();
    if (section) dispatch({ type: "toggleAppSettings", open: true, section: section as AppSettingsSection });
  }, [dispatch]);
  // "Use your Cloud on your phone" opens the Cloud in this window at
  // /?desktop-settings=phone: its own phone pairing, in any window, on any
  // server. It only opens Settings there; no code is made until a click.
  useEffect(() => {
    const rest = takePhonePairingRequest(window.location.href);
    if (rest === null) return;
    window.history.replaceState(null, "", rest);
    dispatch(phonePairingSettingsAction());
  }, [dispatch]);
  // `?view=inbox` and the legacy `?view=todo` / `#todo` alias pin the inbox
  // panel when it is shown in the sidebar.
  useEffect(() => {
    if (!normalizeInboxDeepLink(window.location)) return;
    saveSidebarAttentionPinned(true);
  }, []);
  useExternalChatLinks(state, dispatch);
  // Phone-only drawer state. From sm up, none of these properties are emitted
  // at all — Sidebar scopes every phone class with max-sm: rather than
  // cancelling them with sm:, which would still emit a translate value and
  // turn the aside into a containing block for its fixed descendants (see
  // Sidebar.tsx's className comment).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Apply this device's language, else the server's default, the moment
  // either changes; "" follows the system. The epoch bump re-renders
  // extracted strings — t() reads a module variable, so React needs this nudge.
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadLocale(language || globalThis.navigator?.language).then(() => {
      if (cancelled) return;
      setLocaleEpoch((epoch) => epoch + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);
  // The conversation views are compiled by the React Compiler, which keeps a
  // catalog string it built once; a language change mounts them afresh.
  const uiLocale = activeLocale();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // the palette and the shortcuts sheet each teach a habit (achievements)
  useEffect(() => {
    if (paletteOpen) reportAchievement("palette.opened");
  }, [paletteOpen]);
  useEffect(() => {
    if (state.shortcutsOpen) reportAchievement("shortcuts.opened");
  }, [state.shortcutsOpen]);
  const [composeOpen, setComposeOpen] = useState(false);
  const openCompose = useCallback(() => setComposeOpen(true), []);
  const toggleCompose = useCallback(() => setComposeOpen((open) => !open), []);
  // ⌘⇧N opens the compose picker straight on "Create group chat".
  const [composeGroup, setComposeGroup] = useState(false);
  useEffect(() => {
    if (!composeOpen) setComposeGroup(false);
  }, [composeOpen]);
  const [localVmWorkspaceBotId, setLocalVmWorkspaceBotId] = useState<string | null>(null);
  // the Browser tab, expanded into the main column (the small preview in
  // the panel hands off to this and back)
  const previousViewRef = useRef(state.activeView);
  const calendarOriginRef = useRef<"chat" | "team-map">("chat");
  // Someone with no bot of their own still opens on a group they are in.
  const { group, bot } = mainConversation(state.bots, state.groups, state.selectedId, state.sidebarHiddenKeys);
  const calendarOpen = state.activeView === "routines";
  // Advanced is the default for everyone (2026-10-16). The choice itself
  // is written only on the switch.
  const advanced = useAdvancedMode();
  const org = usePerspicaxOrg();
  // Settings > Memory sets itself up and syncs on an organization server
  // signed in with Perspicax (desktop app only).
  useOrgMemoryAuto(org !== null);
  // Simple does not offer the inspector or the computer panel. Closing them
  // leaves their saved settings as they were. Connect apps stays open in
  // Simple (2026-10-16): its pill is in every sidebar, and a person who
  // chose Simple must still reach it. What they may change inside is the
  // server's call.
  useEffect(() => {
    if (advanced) return;
    if (state.inspectorOpen) dispatch({ type: "toggleInspector", open: false });
    if (state.computerOpen) dispatch({ type: "toggleComputer", open: false });
  }, [advanced, state.inspectorOpen, state.computerOpen, dispatch]);

  // Nothing on this machine can run a bot. On an organization server the
  // person's own engines decide instead (OrgEngineNotice and the first-run
  // step, shared/org-engine-readiness.ts). A missing cloud login does not
  // count — that CLI can still host a local model. Wait for the first
  // /api/instances response before deciding: an empty list means "not asked
  // yet", and flashing the setup screen at every launch would be worse.
  const noEngines =
    state.connected &&
    state.instances.length > 0 &&
    !state.instances.some((i) => i.snapshot.state === "available");
  // An OMB Cloud home with none of the person's own engines signed in yet:
  // its first run, and every bot until then, is the engine sign-in.

  // App-wide shortcuts: ⌘N new bot · ⌘1–9 jump to bot · ⌘⇧[ / ⌘⇧] prev/next · ⌘/ or ? shortcuts cheat sheet,
  // and the reference design's ⌘B sidebar · ⌘I composer · ⌘⇧F search · ⌘⇧N group chat (appShortcutFor;
  // ⌘L, quote the selection, lives with the selection in CitationUI).
  // Kept deliberately small; every panel already closes on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || state.shortcutsOpen) return;
      if (shouldOpenKeyboardShortcuts(e)) {
        e.preventDefault();
        dispatch({ type: "toggleShortcuts", open: true });
        return;
      }

      const chord = appShortcutFor(e);
      if (chord === "toggle-sidebar") {
        e.preventDefault();
        toggleSidebarCollapsed();
        return;
      }
      if (chord === "focus-composer") {
        if (focusComposer()) e.preventDefault();
        return;
      }
      if (chord === "search-everything") {
        e.preventDefault();
        openCommandPalette();
        return;
      }
      if (chord === "new-group") {
        e.preventDefault();
        setComposeGroup(true);
        setComposeOpen(true);
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const bots = state.bots.filter((b) => !b.hidden);
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        setComposeOpen((open) => !open);
      } else if (composeOpen && /^[1-9]$/.test(e.key)) {
        return;
      } else if (/^[1-9]$/.test(e.key)) {
        const target = bots[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          navigate(() => openBot(dispatch, target, showThreads));
        }
      } else if (e.shiftKey && (e.key === "[" || e.key === "]")) {
        const idx = bots.findIndex((b) => b.id === state.selectedId);
        const next = bots[(idx + (e.key === "]" ? 1 : -1) + bots.length) % bots.length];
        if (next) {
          e.preventDefault();
          navigate(() => openBot(dispatch, next, showThreads), e.key === "]" ? "forward" : "back");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.bots, state.selectedId, state.shortcutsOpen, composeOpen, showThreads, dispatch]);

  // The Dock / taskbar count: every unread conversation (a person's direct
  // message included), unless this computer turned the badge off.
  const showBadge = useLocalSwitch(dockBadge);
  useEffect(() => {
    window.ogb?.setUnreadCount?.(badgeCount(unreadCount, { badge: showBadge }));
  }, [unreadCount, showBadge]);
  // The menu bar's bot list (macOS, Windows): the visible bots in the order
  // of the Cmd+1..9 shortcuts, with their mascot color, whether they work and
  // how many conversations are unread. A pick there opens the bot.
  const trayRoster = useMemo(
    () => state.bots.filter((bot) => !bot.hidden).slice(0, 9).map((bot) => ({
      id: bot.id,
      name: bot.name,
      color: MAUS_COLORS[bot.color as keyof typeof MAUS_COLORS] ?? "#8E8E93",
      working: Boolean(bot.busy),
      unread: botShowsUnread(bot) ? 1 : 0,
    })),
    [state.bots],
  );
  // the menu's words follow the app's language (the shell has no locale files)
  const trayLabels = {
    bots: t("tray.bots"),
    botsUnread: t("tray.botsUnread", { count: "{count}" }),
    working: t("tray.working"),
    unread: t("tray.unread"),
    unreadMany: t("tray.unreadMany", { count: "{count}" }),
    open: t("tray.open"),
    quit: t("tray.quit"),
    tooltipUnread: t("tray.tooltipUnread", { count: "{count}" }),
    tooltipWorking: t("tray.tooltipWorking", { count: "{count}" }),
  };
  const trayKey = JSON.stringify([trayRoster, trayLabels]);
  useEffect(() => {
    window.ogb?.setTrayRoster?.(trayRoster, trayLabels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trayKey]);
  const botsRef = useRef(state.bots);
  botsRef.current = state.bots;
  // The capture key (bots' chord with 0): a picture of the screen in the
  // open bot's composer (parity R7, system 12).
  useScreenCaptureToBot(showThreads);
  useEffect(() => {
    return window.ogb?.onOpenBot?.((botId) => {
      const target = botsRef.current.find((bot) => bot.id === botId);
      if (target) navigate(() => openBot(dispatch, target, showThreads));
    });
  }, [dispatch, showThreads]);
  // Load the nudge sound now: the first nudge rings at once, even before
  // any click in the page.
  useEffect(() => {
    primeNudgeSound();
  }, []);

  // Settings, Routines and the other on-request screens stay out of the
  // launch bundle; fetch them once the first paint is done and the app is idle.
  useEffect(() => preloadScreens(), []);

  // Picking a conversation closes the drawer: on a phone the chat is what you
  // asked for, and leaving the list up would hide it. Watching activeView too
  // catches re-selecting the bot that is already current from another view —
  // the reducer switches the view without changing selectedId. pluginsOpen
  // and settingsOpen cover the same idea from a different trigger: close the
  // drawer whenever an action opens something over the chat.
  useEffect(() => {
    setDrawerOpen(false);
  }, [state.selectedId, bot?.threadId, group?.threadId, state.activeView, state.pluginsOpen, state.settingsOpen]);
  useEffect(() => {
    setComposeOpen(false);
  }, [state.selectedId, state.activeView]);

  if (previousViewRef.current !== state.activeView) {
    if (state.activeView === "routines" && previousViewRef.current !== "routines") {
      calendarOriginRef.current = previousViewRef.current === "team-map" ? "team-map" : "chat";
    }
    previousViewRef.current = state.activeView;
  }
  // The bot panel is the main chat's unless a split-view section's pill
  // opened it (panelOwner): then it is that section's bot. Always at the
  // window's right edge, one panel at a time. A group section's panel
  // portals into panelSlot, at the same place.
  const panelBot = useBotPanelBot(bot);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const botPanelOpen = !remoteClient && (state.settingsOpen || state.computerOpen) && panelBot !== undefined;
  const mainIsTeamMap = state.activeView === "team-map";
  const mainIsCode = state.activeView === "code";
  const mainIsApprovals = state.activeView === "approvals";
  const mainIsRemoteSessions = state.activeView === "remote-sessions";
  const mainIsAchievements = state.activeView === "achievements";
  const calendarFillsMain = calendarOpen;

  useEffect(() => {
    if (
      localVmWorkspaceBotId &&
      (state.activeView !== "chat" || state.selectedId !== localVmWorkspaceBotId)
    ) {
      setLocalVmWorkspaceBotId(null);
    }
  }, [localVmWorkspaceBotId, state.activeView, state.selectedId]);

  const openLocalVmWorkspace = (botId: string) => {
    dispatch({ type: "toggleComputer", open: false });
    setLocalVmWorkspaceBotId(botId);
  };

  const openComputerFromWorkspace = (botId: string) => {
    setLocalVmWorkspaceBotId(null);
    dispatch({ type: "select", id: botId });
    dispatch({ type: "toggleComputer", open: true });
  };

  const closeCalendar = useCallback(() => {
    if (calendarOriginRef.current === "team-map") {
      dispatch({ type: "showTeamMap" });
      return;
    }
    dispatch({ type: "select", id: state.selectedId });
  }, [dispatch, state.selectedId]);
  const openCalendarRoom = useCallback((id: string) => {
    dispatch({ type: "select", id });
  }, [dispatch]);

  const nativeViewOverlayOpen =
    drawerOpen ||
    paletteOpen ||
    state.settingsOpen ||
    state.computerOpen ||
    state.inspectorOpen ||
    state.activityOpen ||
    state.appSettingsOpen ||
    state.personaEditor !== null ||
    state.pluginsOpen ||
    state.triggersOpen;

  // The macOS app menu's Preferences… item lives in the desktop shell, so the
  // shell signals the request over the bridge (Cmd+, accelerates the item).
  // Local-shell only: remote server pages never receive the channel, and ogb
  // is absent in the browser.
  useEffect(() => {
    return window.ogb?.onOpenAppSettings?.(section => {
      dispatch({ type: "toggleAppSettings", open: true, ...(section === "organization" ? { section } : {}) });
    });
  }, [dispatch]);

  // The viewer outlives ComputerPanel and can target any bot, so release control
  // here (always mounted) when a bot's viewer closes. release() is idempotent.
  useEffect(() => {
    return window.ogb?.desktopViewer?.onState((viewer) => {
      if (viewer.open || !viewer.contextId) return;
      const botId = viewer.contextId;
      void fetch(`/api/bots/${botId}/computer/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((snap) => {
          if (snap) dispatch({ type: "computerControl", botId, held: snap.held === true, helpReason: snap.helpReason ?? null });
        })
        .catch(() => {});
      void fetch(`/api/bots/${botId}/computer/viewer-close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => {});
    });
  }, [dispatch]);

  return (
    <div className="flex h-full flex-col" data-app-shell="">
      {/* What's new sits above the update dialog. Both are outside the layout flow. */}
      <ReleaseNotesPrompt />
      {/* The terms of use, once per account (App Store 1.2). */}
      <TermsGate />
      <UpdateBanner />
      {/* A bot driving the person's own Chrome: who, where, and Stop. */}
      <MyChromeIndicator />
      {/* A bot controlling this computer's own screen: who, and Stop. */}
      <HostControlIndicator />
      {/* The one bottom-left card at a time (only the star is left in Sagax). */}
      {/* Hibou 98 only: title bar, menus and toolbar (renders nothing otherwise) */}
      <RetroChromeSlot slot="top" onNewBot={() => setComposeOpen((open) => !open)} />
      <div className="app-shell-row relative flex min-h-0 flex-1">
      {/* the drawer on a phone, the icons rail up to 768px, then the
          person's own sidebar (AppSidebar.tsx) */}
      <AppSidebar
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        composeOpen={composeOpen}
        onCompose={toggleCompose}
      />
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col" data-sidebar-follower="">
      {/* nothing answers this person on an organization server: say so above
          the conversation, with the way back to the first-run step */}
      {org && (group || bot) && !calendarFillsMain && !mainIsTeamMap && !mainIsCode && !mainIsApprovals && !mainIsRemoteSessions && !mainIsAchievements && <OrgEngineNotice />}
      {/* The split view (#1504): the main view below is one section; others
          show more conversations beside it (src/lib/split-view.ts). */}
      <SplitWorkspace panelSlot={panelSlot} main={composeOpen && (group || bot) ? (
        group ? <GroupView key={`${group.id}:${uiLocale}`} group={group} /> : bot ? <ChatView key={uiLocale} bot={bot} /> : null
      ) : calendarFillsMain ? (
        <RoutinesPage fill onBack={closeCalendar} onOpenRoom={openCalendarRoom} />
      ) : mainIsTeamMap ? (
        <TeamMapPage />
      ) : mainIsCode ? (
        <CodePage />
      ) : mainIsApprovals ? (
        <ApprovalsPage />
      ) : mainIsRemoteSessions && org ? (
        <RemoteSessionsAdminPage />
      ) : mainIsAchievements ? (
        <AchievementsScreen />
      ) : !remoteClient && localVmWorkspaceBotId ? (
        <LocalVmWorkspace
          primaryBotId={localVmWorkspaceBotId}
          overlayOpen={nativeViewOverlayOpen}
          onClose={() => setLocalVmWorkspaceBotId(null)}
          onOpenComputer={openComputerFromWorkspace}
        />
      ) : noEngines && !org ? (
        <NoEngines />
      ) : group ? (
        <GroupView key={`${group.id}:${uiLocale}`} group={group} />
      ) : bot ? (
        <ChatView key={uiLocale} bot={bot} />
      ) : (
        state.connected ? (
          // Connected with no bot: an empty state that invites creating one,
          // not a spinner (nothing is loading).
          <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
            <WindowDragStrip />
            {/* a chat link opened with no bots here still says it found nothing */}
            <div className="w-full max-w-md"><ChatNotice notice={state.notice} /></div>
            <BotIcon size={28} aria-hidden />
            <div className="text-center">
              <div className="text-[15px] text-ink">{t("app.empty.title")}</div>
              <div className="mt-1 text-[13px]">{t("app.empty.body")}</div>
            </div>
            {viewerCanCreateBots(state.config) ? (
              <button type="button" className="ui-button mt-1 inline-flex items-center gap-1.5" onClick={() => dispatch({ type: "openBotWizard" })}>
                <Plus size={14} aria-hidden />
                {t("app.empty.create")}
              </button>
            ) : viewerBotsReadOnly(state.config) && (
              <p role="note" data-bots-read-only className="max-w-sm text-center text-[13px]">{botsReadOnlyText(state.config)}</p>
            )}
          </main>
        ) : (
        <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <WindowDragStrip />
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.everConnected ? t("chat.reconnecting") : t("app.connecting")}
          </div>
          {!state.everConnected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
        )
      )} />
      {composeOpen && <ComposeToPicker key={composeGroup ? "group" : "browse"} startInGroup={composeGroup} onClose={() => setComposeOpen(false)} />}
      </div>
      {/* A bot thread opened beside the main chat (Open beside, or
          Option-click on a thread row); one at a time. */}
      <SideThreadPanel />
      {/* The panels below are siblings, so their keys must differ even
          though each is remounted per bot. Two siblings keyed `bot.id`
          collide in React's keyed reconciliation whenever both are open
          (Computer panel, then the usage chip): every re-render mounts a
          fresh settings panel and never removes the previous one, so the
          panels pile up and Close stops working. */}
      {/* One tabbed bot panel (Details, Routines, Files, Computer, Advanced) on the
          desktop; its Computer tab is the store's computer view, so both
          flags render the same panel under one key. */}
      {botPanelOpen && panelBot && (
        <BotSettingsDialog key={`panel:${panelBot.id}`} bot={panelBot} onOpenVmWorkspace={openLocalVmWorkspace} />
      )}
      {/* A split-view group section's panel (GroupView, by a portal): the
          same right edge as every other panel. */}
      <div ref={setPanelSlot} data-split-panel-slot="" className="contents" />
      {remoteClient && state.settingsOpen && panelBot && <RemoteAgentSettingsPanel bot={panelBot} />}
      {state.personPanelId && <PersonPanel key={`person:${state.personPanelId}`} personId={state.personPanelId} />}
      {remoteClient && state.computerOpen && bot && (
        <RemoteDesktopPanel key={`computer:${bot.id}`} bot={bot} />
      )}
      {!remoteClient && state.inspectorOpen && bot && <InspectorPanel key={bot.threadId} bot={bot} />}
      {!remoteClient && state.activityOpen && bot && <ActivityPanel key={`activity:${bot.id}`} bot={bot} />}
      {state.appSettingsOpen && <SettingsModal />}
      {!remoteClient && state.personaEditor && <PersonaEditorModal />}
      {!remoteClient && <ModelWindowHost />}
      {/* the bot creation wizard: its own screen, under Connect apps (opened from its Tools step) */}
      {state.botWizard && <BotWizard />}
      {state.botCatalogOpen && <BotCatalogModal />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.triggersOpen && <TriggersPanel />}
      {state.newBotOpen && <NewBotDialog />}
      {state.shortcutsOpen && (
        <KeyboardShortcutsModal
          open={state.shortcutsOpen}
          onClose={() => dispatch({ type: "toggleShortcuts", open: false })}
        />
      )}
      {/* detached terminals and widgets: over the app, under the modals (z-40) */}
      <FloatingWindowsHost />
      {/* mounted after the modals: same z-50 tier, so DOM order keeps the
          palette on top when one of them is open underneath */}
      <CommandPalette onOpenChange={setPaletteOpen} onNewConversation={openCompose} />
      <ArtifactsHost />
      <StagedOrgImport />
      <TeamBotFromThreadHost />
      <RetroAssistantHost />
      <AchievementToaster />
      <CallEngineHost />
      <FloatingBotsHost />
      <RetroBootSlot />
      {/* The drawer button comes before every header in the DOM, and a later
          drag region wins, so on a narrow window the header's drag region
          swallowed it. This no-drag twin, after the headers, cuts the
          button's corner back out. It paints nothing and takes no clicks. */}
      <span
        aria-hidden
        data-drawer-button-no-drag
        style={captionChrome.noDragStyle}
        className="pointer-events-none absolute left-3 top-3 size-[30px] sm:hidden"
      />
      </div>
      <RetroChromeSlot slot="status" />
      {/* Renderer-drawn caption buttons for the overlay-less frameless
          Windows window. Deliberately the LAST child of the shell: Blink
          resolves -webkit-app-region in DOM-walk order, so these no-drag
          buttons must come after every drag-region header to actually
          subtract from it — earlier placement let the header's drag region
          swallow the buttons (dead clicks, no hover). z-40 keeps true
          modals (z-50, later in DOM) painting above the buttons. */}
      <WindowCaptionButtons
        visible={capabilities.windowChrome === "win-caption" && Boolean(window.ogb?.windowControls)}
      />
    </div>
  );
}

/** The person's look, for the bar and the frame of their published pages
 * (src/lib/page-look-sync.ts). */
function PageLookSync() {
  const { state } = useStore();
  usePageLookSync(state.connected);
  return null;
}

/** The open bot's colour as the accent, when Settings > Appearance says so. */
function BotAccentSync() {
  const { state } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  const color = bot ? MAUS_COLORS[bot.color] : null;
  useBotAccent(color);
  const accentEnabled = useBotAccentEnabled();
  // The switches in the bot's own panel and screens take its colour, setting or not.
  useBotSwitch(
    color,
    botSwitchActive({ hasBot: Boolean(bot), activeView: state.activeView, appSettingsOpen: state.appSettingsOpen, pluginsOpen: state.pluginsOpen, accentEnabled }),
  );
  return null;
}

function Application() {
  useEffect(() => {
    initAnalytics();
  }, []);
  const viewer = useWelcomeViewer();
  return (
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <ThreadRefsProvider>
          <Shell />
        </ThreadRefsProvider>
        <WelcomeGate viewer={viewer} />
        <GuidedTour />
        <OpenAtLoginOffer />
        <LiveCallHost />
        <DataWindowViewSync />
        <BotAccentSync />
        <PageLookSync />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
