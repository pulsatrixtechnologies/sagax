import { useCallback, useEffect, useRef, useState } from "react";
import { useAdvancedMode } from "@/lib/interface-mode";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { openBot } from "@/state/store";
import { shallowEqual, useStoreDispatch, useStoreGetter, useStoreSelector } from "@/state/store-selector";
import { useShowThreads } from "@/lib/thread-preferences";
import { mainConversation } from "@/lib/main-view";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { activeLocale, loadLocale } from "@/lib/i18n";
import { appShortcutFor, shouldOpenKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { focusComposer } from "@/lib/composer-focus";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { openCommandPalette } from "@/lib/command-palette-open";
import { toggleSidebarCollapsed } from "@/lib/sidebar-preferences";
import { botShowsUnread } from "@/lib/bot-unread";
import { navigate } from "@/lib/view-transitions";

/** Drawer, compose, calendar, panel and keyboard navigation for Shell. */
export function useShellNavigation() {
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const state = useStoreSelector((current) => ({
    activeView: current.activeView,
    activityOpen: current.activityOpen,
    appSettingsOpen: current.appSettingsOpen,
    archivedBotsOpen: current.archivedBotsOpen,
    botCatalogOpen: current.botCatalogOpen,
    botWizard: current.botWizard,
    computerOpen: current.computerOpen,
    config: current.config,
    connected: current.connected,
    everConnected: current.everConnected,
    inspectorOpen: current.inspectorOpen,
    memoryManagerOpen: current.memoryManagerOpen,
    notice: current.notice,
    orgImportOpen: current.orgImportOpen,
    orgImportStaged: current.orgImportStaged,
    personPanelId: current.personPanelId,
    personaEditor: current.personaEditor,
    pluginsOpen: current.pluginsOpen,
    selectedId: current.selectedId,
    settingsOpen: current.settingsOpen,
    shortcutsOpen: current.shortcutsOpen,
    hydrated: current.hydrated,
  }), shallowEqual);
  const showThreads = useShowThreads();
  const { capabilities } = useDesktopCapabilities();
  const captionChrome = useCaptionChrome();
  const unreadCount = useStoreSelector((current) =>
    current.bots.filter((bot) => !bot.hidden && botShowsUnread(bot)).length +
    current.groups.filter((group) => group.unread).length);
  const remoteClient = window.ogb?.remoteClient?.active === true;
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
  const conversation = useStoreSelector((current) => {
    const main = mainConversation(current.bots, current.groups, current.selectedId, current.sidebarHiddenKeys);
    return { botId: main.bot?.id, groupId: main.group?.id, threadId: main.bot?.threadId ?? main.group?.threadId };
  }, shallowEqual);
  const bot = conversation.botId ? { id: conversation.botId, threadId: conversation.threadId } : undefined;
  const group = conversation.groupId ? { id: conversation.groupId, threadId: conversation.threadId } : undefined;
  const calendarOpen = state.activeView === "routines";
  // Advanced is the default for everyone (2026-10-16). The choice itself
  // is written only on the switch.
  const advanced = useAdvancedMode();
  const org = usePerspicaxOrg();
  // Nothing on this machine can run a bot. On an organization server the
  // person's own engines decide instead (OrgEngineNotice and the first-run
  // step, shared/org-engine-readiness.ts). A missing cloud login does not
  // count — that CLI can still host a local model. Wait for the first
  // /api/instances response before deciding: an empty list means "not asked
  // yet", and flashing the setup screen at every launch would be worse.
  const noEngines = useStoreSelector((current) => current.connected && current.instances.length > 0 &&
    !current.instances.some((instance) => instance.snapshot.state === "available"));
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
      const bots = getState().bots.filter((b) => !b.hidden);
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
  }, [getState, state.selectedId, state.shortcutsOpen, composeOpen, showThreads, dispatch]);

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
  const panelBotId = useStoreSelector((current) => current.panelOwner ? current.panelOwner.botId : bot?.id);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const botPanelOpen = !remoteClient && (state.settingsOpen || state.computerOpen) && panelBotId !== undefined;
  const mainIsTeamMap = state.activeView === "team-map";
  const mainIsMemory = state.activeView === "memory" || state.memoryManagerOpen;
  const mainIsCode = state.activeView === "code";
  const mainIsApprovals = state.activeView === "approvals";
  const mainIsRemoteSessions = state.activeView === "remote-sessions";
  const mainIsAchievements = state.activeView === "achievements";
  const mainIsApps = state.activeView === "apps" || state.pluginsOpen;
  const archivedBots = useStoreSelector((current) => current.archivedBotsOpen ? current.bots.filter((bot) => bot.hidden) : [], shallowEqual);
  const calendarFillsMain = calendarOpen;

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
    state.personaEditor !== null;

  return {
    dispatch,
    getState,
    state,
    showThreads,
    capabilities,
    captionChrome,
    unreadCount,
    remoteClient,
    drawerOpen,
    setDrawerOpen,
    uiLocale,
    paletteOpen,
    setPaletteOpen,
    composeOpen,
    setComposeOpen,
    openCompose,
    toggleCompose,
    composeGroup,
    setComposeGroup,
    localVmWorkspaceBotId,
    setLocalVmWorkspaceBotId,
    bot,
    group,
    calendarOpen,
    advanced,
    org,
    noEngines,
    panelBotId,
    panelSlot,
    setPanelSlot,
    botPanelOpen,
    mainIsTeamMap,
    mainIsMemory,
    mainIsCode,
    mainIsApprovals,
    mainIsRemoteSessions,
    mainIsAchievements,
    mainIsApps,
    archivedBots,
    calendarFillsMain,
    openLocalVmWorkspace,
    openComputerFromWorkspace,
    closeCalendar,
    openCalendarRoom,
    nativeViewOverlayOpen,
    calendarOriginRef,
    previousViewRef,
  };
}

export type ShellNavigation = ReturnType<typeof useShellNavigation>;
