import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShowInspectorButton } from "@/lib/inspector-preferences";
import { useAdvancedMode } from "@/lib/interface-mode";
import { currentTaskBot, type Bot, type Message } from "@/state/store";
import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { equalRows, peerBots } from "@/state/view-slices";
import { useShowThreads } from "@/lib/thread-preferences";
import { useRemoteClient } from "@/lib/render-reads";
import { useCaptionChrome, useMacInsetChrome } from "@/components/DesktopCapabilities";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { showPrivateConversationHint } from "@/lib/private-threads";
import { viewerActorId } from "@/lib/viewer";
import { openThreadConfidential } from "@/lib/confidential-thread";
import { useConfidentialDocumentTitle } from "../ConfidentialBanner";
import { useExchangeColumn } from "../BotExchangeChip";
import {
  pageBesideChat,
  pageCoversChat,
  pageStageComposer,
  usePageChatHostWide,
  PAGE_CHAT_SURFACE_DEFAULT,
  type PageChatSurface,
} from "@/lib/page-chat-layout";
import { openPageFor, useOpenPage, usePagePanelHost } from "@/lib/open-page";
import { useComposerDockPad } from "@/lib/composer-dock";
import { useBackgroundEffectShown } from "../BackgroundEffectLayer";
import { useCanWriteIn } from "@/lib/cloud-guest";
import { computerStartLine } from "@/lib/computer-start";
import { useReplyDraft } from "@/lib/drafts";
import { useDataWindowItem } from "../DataWindowButton";
import { isRoutineAutoPausedNotice } from "../../../shared/transient-notices";
import { routineAutoPauseSettled } from "@/lib/transient-notice";
import { useThreadRoutineRun } from "@/state/older-routine-runs";
import type { SideChat } from "./sideChat";

export function useChatViewSession(stored: Bot, side?: SideChat) {
  "use memo";
  const showInspector = useShowInspectorButton();
  const advanced = useAdvancedMode();
  // A switch under way with a cached page of its thread (Bot.switchPreview)
  // draws that thread at once: its page, its composer (locked, as while any
  // snapshot is awaited) and its controls. The transcript is inert until the
  // switch's own page lands and replaces it.
  // The main chat only: a side thread shows its own thread, never the main one's switch.
  const preview = !side && stored.switchPreview && stored.switchPreview.threadId === stored.switchingTo ? stored.switchPreview : null;
  const profile = useMemo(() => preview
    ? { ...stored, threadId: preview.threadId, messages: preview.messages, hasMore: preview.hasMore, activeLeafId: preview.activeLeafId ?? null, awaitingThreadSnapshot: true }
    : stored, [stored, preview]);
  const bot = useMemo(() => currentTaskBot(profile), [profile]);
  useThreadRoutineRun(bot.id, bot.threadId);
  const dataItem = useDataWindowItem(bot);
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    codingChat: current.codingChat,
    routineRunWindow: current.routineRunWindow,
    computerOpen: current.computerOpen,
    config: current.config,
    connected: current.connected,
    disconnectedAt: current.disconnectedAt,
    error: current.error,
    everConnected: current.everConnected,
    inspectorOpen: current.inspectorOpen,
    notice: current.notice,
    panelOwner: current.panelOwner,
    settingsOpen: current.settingsOpen,
  }), shallowEqual);
  const storeBots = useStoreSelector(peerBots, equalRows);
  const engine = useStoreSelector((current) => current.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId));
  const computerStart = useStoreSelector((current) => current.computerStarts[bot.id]);
  const mascotMotion = useStoreSelector((current) => current.mascotMotion?.botId === bot.id ? current.mascotMotion : null);
  const pendingQueued = useStoreSelector((current) => Object.fromEntries([bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId)].map((id) => [id, current.pendingQueued[id]])), shallowEqual);
  const focus = useStoreSelector((current) => current.focusMessage?.threadId === bot.threadId ? current.focusMessage : null);
  const showThreads = useShowThreads();
  const remoteClient = useRemoteClient();
  // 2026-10-26: the failure that paused its routine offers Resume, and its
  // banner leaves once the routine is back on.
  const routineIds = useMemo(() => new Set(bot.messages.flatMap((message) => message.routineRun ? [message.routineRun.routineId] : [])), [bot.messages]);
  const routinesNow = useStoreSelector((current) => current.routines.filter((routine) => routineIds.has(routine.id)), shallowEqual);
  const autoPauseSettled = useCallback((m: Message) => routineAutoPauseSettled(m, routinesNow), [routinesNow]);
  const resumeAutoPaused = (m: Message, close: () => void) => {
    const routine = isRoutineAutoPausedNotice(m) ? routinesNow.find((candidate) => candidate.id === m.routineRun?.routineId) : undefined;
    if (!routine || routine.enabled || routine.canEdit === false) return undefined;
    return () => { close(); dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: true } }); };
  };
  // Without a native title bar (macOS inset lights, frameless Windows) this
  // header is the window drag region. On Windows the icon row also shifts
  // below the 26px-tall corner the renderer-drawn caption buttons occupy.
  const { dragProps: headerDragProps, noDragStyle: headerNoDragStyle, controlsShiftStyle } = useCaptionChrome();
  // Pulsatrix Light's navy top band mirrors the sidebar's own macOS-inset
  // strip, so the two stay vertically aligned; every other skin ignores it.
  const { macInset, browser } = useMacInsetChrome();
  // A split-view section's panel (panelOwner) leaves this chat's controls.
  const panelOpen = !remoteClient && (state.settingsOpen || state.computerOpen) && !state.panelOwner;
  // The pill toggles whichever right panel is showing, the remote one too.
  // A split-view section's panel (panelOwner) is not this chat's: the pill
  // shows it closed, and a click brings the panel back here.
  const pillPanelOpen = (state.settingsOpen || state.computerOpen) && !state.panelOwner;
  // A shared bot on an organization server: each person's conversation is
  // their own; several people talk together in a group.
  const perspicaxOrg = usePerspicaxOrg();
  // A confidential thread wears its classification band, top and bottom,
  // for as long as it lives (src/lib/confidential-thread.ts).
  const confidential = openThreadConfidential(profile);
  useConfidentialDocumentTitle(confidential && !side);
  const privateHint = showPrivateConversationHint({ org: perspicaxOrg !== null, viewerId: viewerActorId(state.config), bot });
  const { node: exchangeColumnNode, ref: exchangeColumnRef } = useExchangeColumn();
  // Beside/cover follows this host's width (split panes, sidebar), not the window.
  const pageHostRef = useRef<HTMLElement | null>(null);
  const pageChatWide = usePageChatHostWide(pageHostRef);
  // Measured HTML Pages default to stage (full page + docked composer). Beside
  // is a deliberate Sagax richer control (Grok canvas chat-pane analogue).
  const [pageChatSurface, setPageChatSurface] = useState<PageChatSurface>(PAGE_CHAT_SURFACE_DEFAULT);
  // A page open in this conversation (src/lib/open-page.ts, lot 5):
  // default stage covers the mounted chat with a docked floating composer
  // (measured Grok HTML/file path). Optional beside keeps a side transcript
  // when the ChatView host is wide. Close restores the same scroll either way.
  // Split-view side chats never host the panel.
  const openPageAny = useOpenPage();
  const openPage = side ? null : openPageFor(openPageAny, bot.id, undefined);
  usePagePanelHost(bot.id, !side);
  const pageBeside = pageBesideChat(Boolean(openPage), pageChatWide, pageChatSurface);
  const pageCover = pageCoversChat(Boolean(openPage), pageChatWide, pageChatSurface);
  const pageStage = pageStageComposer(Boolean(openPage), pageChatSurface);
  // Closing the page gives focus back to what opened it (its card in the
  // transcript, a Library row). Captured at open, before the cover makes the
  // chat inert; given back from this (parent) effect, whose frame runs after
  // the remounted composer's own open-focus frame.
  const pageOpenerRef = useRef<HTMLElement | null>(null);
  const openPageKey = openPage?.pageId ?? null;
  useLayoutEffect(() => {
    if (!openPageKey) return;
    const active = document.activeElement;
    pageOpenerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [openPageKey]);
  useEffect(() => {
    if (openPageKey) return;
    const opener = pageOpenerRef.current;
    pageOpenerRef.current = null;
    if (!opener) return;
    const frame = requestAnimationFrame(() => {
      if (!opener.isConnected || opener.closest("[inert]")) return;
      opener.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [openPageKey]);
  const composerDockRef = useRef<HTMLDivElement>(null);
  // The dock moves onto the page in stage mode and back: re-measure each time.
  const composerDock = useComposerDockPad(composerDockRef, pageStage);
  // Settings > Appearance > Background effects (main conversation only)
  const shownEffect = useBackgroundEffectShown();
  const backgroundEffect = side ? null : shownEffect;
  // A guest on an OMB Cloud home writes only in conversations it opened.
  const canWrite = useCanWriteIn(bot.threadId);

  const computerStarting = computerStartLine(computerStart, bot.name);
  const [findOpen, setFindOpen] = useState(false);
  const { replyTo, selectReply, clearReply, consumeReply, restoreReply } = useReplyDraft(
    bot.threadId,
    `bot:${bot.id}:${bot.threadId}`,
    bot.messages,
  );
  useEffect(() => setFindOpen(false), [bot.threadId]);
  useEffect(() => {
    if (side) return;
    const onFind = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, [side]);

  return {
    showInspector, advanced, preview, profile, bot, dataItem, dispatch, state,
    storeBots, engine, computerStart, mascotMotion, pendingQueued, focus,
    showThreads, remoteClient, routinesNow, autoPauseSettled, resumeAutoPaused,
    headerDragProps, headerNoDragStyle, controlsShiftStyle, macInset, browser,
    panelOpen, pillPanelOpen, perspicaxOrg, confidential, privateHint,
    exchangeColumnNode, exchangeColumnRef, pageHostRef, pageChatWide,
    pageChatSurface, setPageChatSurface, openPageAny, openPage, pageBeside, pageCover, pageStage,
    pageOpenerRef, openPageKey, composerDockRef, composerDock, backgroundEffect, canWrite,
    computerStarting, findOpen, setFindOpen, replyTo, selectReply, clearReply, consumeReply, restoreReply,
  };
}
