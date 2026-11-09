import { useEffect, useRef } from "react";
import { openNotificationTarget, type AppSettingsSection } from "@/state/store";
import { shallowEqual, useStoreSelector } from "@/state/store-selector";
import { useOrgMemoryAuto } from "@/lib/org-memory";
import { reportAchievement } from "@/lib/achievements";
import { normalizeInboxDeepLink } from "@/lib/inbox-deep-link";
import { openThreadVisible, pageOpenThreadTarget, type OpenThreadTarget } from "@/lib/open-thread-hash";
import { clearLeftViewHash, watchViewHash } from "@/lib/view-hash";
import { requestAbout } from "@/lib/about-ui";
import { takeSettingsReturn } from "@/lib/settings-return";
import { saveSidebarAttentionPinned } from "@/lib/sidebar-preferences";
import { badgeCount } from "@/lib/attention";
import { dockBadge, useLocalSwitch } from "@/lib/notification-preferences";
import { primeNudgeSound } from "@/lib/nudge-sound";
import { phonePairingSettingsAction, takePhonePairingRequest } from "@/lib/phone-pairing";
import { useExternalChatLinks } from "@/hooks/use-external-chat-links";
import { useScreenCaptureToBot } from "@/hooks/use-screen-capture-to-bot";
import { MAUS_COLORS } from "@/lib/mascot";
import { botShowsUnread } from "@/lib/bot-unread";
import { openBot } from "@/state/store";
import { navigate } from "@/lib/view-transitions";
import { preloadScreens } from "@/components/lazy-screens";
import type { ShellNavigation } from "./useShellNavigation";

/** Deep-link, hash, desktop settings, tray, viewer-close and related Shell effects. */
export function useShellEffects(shell: ShellNavigation) {
  const {
    dispatch,
    getState,
    state,
    showThreads,
    unreadCount,
    advanced,
    org,
    paletteOpen,
    localVmWorkspaceBotId,
    setLocalVmWorkspaceBotId,
  } = shell;

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
  const linkedThreadVisible = useStoreSelector((current) => Boolean(openThreadTarget.current && openThreadVisible(openThreadTarget.current, current)));
  useEffect(() => {
    const target = openThreadTarget.current;
    if (!target || !linkedThreadVisible) return;
    openThreadTarget.current = null;
    openNotificationTarget(dispatch, target, getState(), showThreads);
  }, [linkedThreadVisible, getState, showThreads, dispatch]);
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
    if (!section) return;
    if (section === "about") {
      requestAbout();
      return;
    }
    dispatch({ type: "toggleAppSettings", open: true, section: section as AppSettingsSection });
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
  useExternalChatLinks(getState(), dispatch);
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

  // the palette and the shortcuts sheet each teach a habit (achievements)
  useEffect(() => {
    if (paletteOpen) reportAchievement("palette.opened");
  }, [paletteOpen]);
  useEffect(() => {
    if (state.shortcutsOpen) reportAchievement("shortcuts.opened");
  }, [state.shortcutsOpen]);

  // The Dock / taskbar count: every unread conversation (a person's direct
  // message included), unless this computer turned the badge off.
  const showBadge = useLocalSwitch(dockBadge);
  useEffect(() => {
    window.ogb?.setUnreadCount?.(badgeCount(unreadCount, { badge: showBadge }));
  }, [unreadCount, showBadge]);
  // The visible bots in the order of the Cmd+Shift+1..9 shortcuts (macOS),
  // with their mascot color, whether they work and how many conversations
  // are unread. A shortcut opens the bot.
  const botRoster = useStoreSelector(
    (current) => current.bots.filter((bot) => !bot.hidden).slice(0, 9).map((bot) => ({
      id: bot.id, name: bot.name,
      color: MAUS_COLORS[bot.color as keyof typeof MAUS_COLORS] ?? "#8E8E93",
      working: Boolean(bot.busy), unread: botShowsUnread(bot) ? 1 : 0,
    })),
    (a, b) => a.length === b.length && a.every((row, index) => shallowEqual(row, b[index])),
  );
  const botRosterKey = JSON.stringify(botRoster);
  useEffect(() => {
    window.ogb?.setBotRoster?.(botRoster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRosterKey]);
  // The capture key (bots' chord with 0): a picture of the screen in the
  // open bot's composer (parity R7, system 12).
  useScreenCaptureToBot(showThreads);
  useEffect(() => {
    return window.ogb?.onOpenBot?.((botId) => {
      const target = getState().bots.find((bot) => bot.id === botId);
      if (target) navigate(() => openBot(dispatch, target, showThreads));
    });
  }, [dispatch, getState, showThreads]);
  // Load the nudge sound now: the first nudge rings at once, even before
  // any click in the page.
  useEffect(() => {
    primeNudgeSound();
  }, []);

  // Settings, Routines and the other on-request screens stay out of the
  // launch bundle; fetch them once the first paint is done and the app is idle.
  useEffect(() => preloadScreens(), []);

  useEffect(() => {
    if (
      localVmWorkspaceBotId &&
      (state.activeView !== "chat" || state.selectedId !== localVmWorkspaceBotId)
    ) {
      setLocalVmWorkspaceBotId(null);
    }
  }, [localVmWorkspaceBotId, state.activeView, state.selectedId, setLocalVmWorkspaceBotId]);

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
}
