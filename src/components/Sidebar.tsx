import { equalRows, peerBots, peerGroups } from "@/state/view-slices";
import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { useThreadPrefetch, type ThreadPrefetchIntent } from "@/state/thread-prefetch";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  BellDot,
  ListChecks,
  Check,
  ChevronRight,
  ClipboardCopy,
  ArrowLeftRight,
  Star,
  EyeOff,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Share2,
  Trash2,
  Users,
  X,
  PictureInPicture2,
  UserRoundPen,
} from "lucide-react";
import {
  api,
  formatTime,
  visibleMessages,
  currentTaskBot,
  openBot,
  startNewTopic,
  type AppState,
  type Bot,
  type BotProject,
  type ConfigStatus,
  type FolderOwnerKind,
  type Group,
  type GroupTaskUpdatePatch,
  type InstanceInfo,
  type Message,
} from "@/state/store";

import { viewerMayDeleteGroup, viewerOwnsGroup } from "@/lib/group-owner";
import { canLeaveGroup } from "@/lib/group-leave";
import { otherAuthorName, viewerActorId } from "@/lib/viewer";
import { showBotArchive, showBotDelete, showBotRename, showServerSectionMove } from "@/lib/bot-capabilities";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";
import { useAdvancedMode } from "@/lib/interface-mode";

import { SidebarMascotAvatar, SidebarMascotProvider } from "./SidebarMascotAvatar";
import { stateForBot } from "@/lib/mascot";
import { mascotRowAnimated } from "@/lib/mascot-animate";
import { cn } from "@/lib/cn";
import { SIDEBAR_CIRCLE_BUTTON } from "@/lib/circle-button";
import { searchMatchesThreads, useSearchDisclosure } from "@/lib/search-disclosure";
import { useHeldMenuMotion } from "./MenuMotion";
import { navigate } from "@/lib/view-transitions";
import { lastNonReceipt } from "@/lib/receipts";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { activeLocale, t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { useOrgPeople } from "@/lib/perspicax-org";
import { peopleDmPeer } from "@/lib/people-dm";
import { BotRoleTag, PersonLabelTag } from "./LabelTag";
import { nudgeLineText } from "@/lib/nudge-line";
import { ChevronsRight, LogOut, UserRound } from "lucide-react";
import { hideFromSidebar } from "@/lib/sidebar-hidden";
import { PersonAvatar } from "./MessageAuthor";
import { SidebarSharerBadge } from "./SidebarSharerBadge";
import { botSharer } from "@/lib/bot-sharer";
import { presenceLabel, usePresence } from "@/lib/presence";
import { itemKey, personalSectionNames, personalSectionOf, type SectionItemKind } from "@/lib/personal-sections";
import { useConfirm } from "@/components/ConfirmProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkingDots } from "./WorkingIndicator";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { StatusDot } from "./StatusDot";
import { nextRename } from "@/lib/rename";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { openCommandPalette } from "@/lib/command-palette-open";
import { APP_NAME } from "@/lib/app-links";
import { isBotFloating, subscribeFloatingBots, toggleFloatingBot } from "@/lib/floating-bots";
import { isMacPlatform, SHORTCUT_GROUPS, shortcutKeysForPlatform } from "@/lib/keyboard-shortcuts";
import { RenameTitle } from "./RenameTitle";
import {
  BotProjectDialog,
  FolderActions,
  FolderIcon,
  FolderIconPopover,
  FolderRenameField,
  navigateThreadMenu,
} from "./BotProjects";
import { NewTaskFolderDialog } from "./NewTaskFolderDialog";
import { newThreadChoices, type NewThreadChoice } from "@/lib/confidential-thread";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import {
  draggedFolder,
  draggedThread,
  FOLDER_DRAG_TYPE,
  THREAD_DRAG_TYPE,
  moveFolder,
  placeFolder,
} from "@/lib/folder-order";
import { folderUnreadThreadIds, markFolderRead, markGroupFolderRead } from "@/lib/folder-read";
import { personPickerThreads } from "@/lib/person-threads";
import { approvalModeFor, botApprovalSetting } from "../../shared/approval-mode";
import { liveActivityLabel } from "@/lib/live-activity";
import { FullAccessWarning } from "./FullAccessWarning";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import {
  orderedThreadList,
  SidebarThreadRow,
  stampClock,
  threadRecency,
  useRelativeNow,
  useSnoozeExpiry,
  visibleSidebarThreads,
} from "./SidebarThreadRow";
import { SIDEBAR_RAIL_WIDTH, type SidebarDensity } from "@/lib/sidebar-preferences";
import { sidebarGoalRunPreview } from "@/lib/sidebar-layout";
import { botListItemPointerIntent } from "@/lib/sidebar-selection";
import { phoneSettingsAction, SidebarPhoneButton } from "./SidebarPhoneButton";
import { PulsatrixMark } from "./PulsatrixMark";

import { SidebarFoot, SidebarRailFoot } from "./SidebarFoot";
import { useShowThreads, useThreadsMode } from "@/lib/thread-preferences";
import { openBotConversationActions } from "./thread-home";
import { useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { botShowsUnread, iconUnreadDotPosition, isInterBotThread } from "@/lib/bot-unread";
import { sidebarBotActivityTasks } from "./SidebarBotActivity";
import { citationPreviewText } from "@/lib/citations";
import { groupMemberBots } from "@/lib/group-members";
import { plainPreviewText } from "@/lib/plain-preview";
import { openSideThread } from "@/lib/side-thread";
import { moveRailFocus } from "@/lib/sidebar-rail";
import { isClientCancellation } from "../../shared/client-cancel";
import { readableError } from "@/lib/plain-error";

import {
  COMPOSE_DISMISS,
  useScrollFade,
  usePersonalLayout,
  assignPersonalSection,
  parseItemDrag,
  currentArchivableBot,
  botConfirmCopy,
  roomDeleteCopy,
  type BotConfirmKind,
} from "./Sidebar.tsx-parts/helpers";
import { preview } from "./Sidebar.tsx-parts/preview";
import { sidebarListedBots } from "./Sidebar.tsx-parts/sidebarListedBots";
import { TeamMenuItems } from "./Sidebar.tsx-parts/TeamMenuItems";
import type { MenuState } from "./Sidebar.tsx-parts/types";
import { useSidebarMultiSelect } from "./Sidebar.tsx-parts/useSidebarMultiSelect";
import { useSidebarUnreadPills } from "./Sidebar.tsx-parts/useSidebarUnreadPills";
import { useSidebarWidth } from "./Sidebar.tsx-parts/useSidebarWidth";
import { useSidebarSections, orgViewerId } from "./Sidebar.tsx-parts/useSidebarSections";
import { useSidebarSectionDnD } from "./Sidebar.tsx-parts/useSidebarSectionDnD";
import { useSidebarBotActions } from "./Sidebar.tsx-parts/useSidebarBotActions";
import { useSidebarRoster } from "./Sidebar.tsx-parts/useSidebarRoster";
import { SidebarPinnedGrid } from "./Sidebar.tsx-parts/SidebarPinnedGrid";
import { SidebarSectionList } from "./Sidebar.tsx-parts/SidebarSectionList";
import { SidebarMultiSelectBar } from "./Sidebar.tsx-parts/SidebarMultiSelectBar";
import { SidebarOverlays } from "./Sidebar.tsx-parts/SidebarOverlays";
import { SidebarResizeHandle } from "./Sidebar.tsx-parts/SidebarResizeHandle";
import { SidebarUnreadPillAbove, SidebarUnreadPillBelow } from "./Sidebar.tsx-parts/SidebarUnreadPills";
import { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";

export type { MenuState, BotConfirmKind };
export { parseItemDrag, currentArchivableBot, botConfirmCopy, roomDeleteCopy, sidebarListedBots, TeamMenuItems };

/** The head's round buttons (search, New): the header's 36px circle (share,
 * panel), painted from the sidebar's own tokens (surface, hairline, ink), with
 * the same focus ring as its neighbours. There is no collapse button: dragging
 * the sidebar's edge narrower than the snap width collapses it (see
 * `sidebarDragTarget`). */
export const SIDEBAR_HEAD_BUTTON = cn(
  SIDEBAR_CIRCLE_BUTTON,
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
);
/** The head's brand row: the chat header's height (ChatView's
 * `.content-topbar`: `min-h-[52px] py-2.5` around 36px circles, so 56px with
 * them centred at 28px), flush under the macOS inset strip (36px, the same
 * strip the chat column draws) and with no extra top margin elsewhere, so
 * the search and New circles sit on the same line as share and the panel
 * toggle on every platform. */
export const SIDEBAR_HEAD_ROW = "flex h-14 items-center justify-between gap-2 pl-4 pr-3";
/** The head inside the title bar (macOS inset lights or the browser's dots,
 * no logo): one 48px row, the 36px circles centred 24px down, 8px below the
 * lights' centre, ending 16px from the edge, as the owner's reference window
 * draws them. */
export const SIDEBAR_TITLE_ROW = "flex h-12 items-center justify-between gap-2 pl-4 pr-4";

/** The palette chord as this platform spells it: "⌘K" on macOS, "Ctrl+K"
 * on Windows and Linux, for the search button's tooltip. */
export function paletteShortcutLabel(isMac: boolean = isMacPlatform()): string {
  const item = SHORTCUT_GROUPS.flatMap((group) => group.items).find((entry) => entry.id === "command-palette");
  const keys = item ? shortcutKeysForPlatform(item, isMac) : isMac ? ["⌘", "K"] : ["Ctrl", "K"];
  return keys.join(isMac ? "" : "+");
}

/** The same point the bot row's context menu and "more" button already use. */
function openBotContextMenu(onMenu: (menu: MenuState) => void, botId: string, event: React.MouseEvent) {
  event.preventDefault();
  onMenu({ botId, x: event.clientX, y: event.clientY });
}

/** A room's or a person conversation's sidebar line. A person's message
 * reads "You: ..." only when the viewer wrote it: someone else's message
 * (the other person of a direct conversation, another person in a room)
 * reads as theirs. Before 2026-10-09 every person's message read "You:",
 * a received direct message included. */
export function groupPreview(group: Group, bots: Bot[], config: ConfigStatus | null, instances: InstanceInfo[]): string {
  const viewerId = viewerActorId(config);
  if (group.busyBotId) {
    return t("sidebar.preview.botWorking", {
      name: bots.find((b) => b.id === group.busyBotId)?.name ?? t("sidebar.preview.aBot"),
    });
  }
  if (group.working) return t("sidebar.preview.teamWorking");
  const last = lastNonReceipt(group.messages);
  if (!last) return t("sidebar.preview.noMessages");
  if (last.kind === "nudge" && last.nudge) return nudgeLineText(last.nudge, viewerId);
  if (last.kind === "text" && last.role !== "user" && isClientCancellation(last.text ?? "")) {
    const stopped = t("chat.turnStopped");
    return last.from ? `${last.from.name}: ${stopped}` : stopped;
  }
  const text = last.kind === "activity" && last.tool
    ? activityPreview(last.tool, botEngine(bots.find((bot) => bot.id === last.from?.botId), instances), last.dataResult)
    : last.kind === "goal.run" && last.goalRun
      ? sidebarGoalRunPreview(last.goalRun)
      : (last.text ?? "");
  const readable = plainPreviewText(citationPreviewText(text));
  if (last.role === "user") {
    // Someone else's words (src/lib/viewer.ts): a direct conversation's row
    // already names them, a room's line says who.
    const author = otherAuthorName(last, config);
    if (author) return group.peopleDm ? readable : `${author}: ${readable}`;
    return t("sidebar.preview.you", { text: readable });
  }
  return last.from ? `${last.from.name}: ${readable}` : readable;
}

/** A small member stack identifies a group without turning it into a card. */
export function StackedMauses({ members, density, viewerId }: { members: Bot[]; density: SidebarDensity; viewerId: string }) {
  const iconOnly = density === "icons";
  // Same footprint as a bot row's avatar (BotListItem: 28 compact, 36
  // comfortable, Grok Bot's) so group and bot names share one left edge.
  const slotSize = iconOnly ? "size-12" : density === "compact" ? "size-7" : "size-9";
  const singleSize = iconOnly ? 44 : density === "compact" ? 28 : 36;
  if (members.length <= 1) {
    const b = members[0];
    return (
      <div className={cn("flex shrink-0 items-center justify-center", slotSize)}>
        {b ? <SidebarMascotAvatar botId={b.id} bot={b} primary={isViewersPrimaryBot(b, viewerId)} primaryRingClassName="ring-sidebar" state="happy" size={singleSize} animated={false} /> : <Users size={24} className="text-sidebar-ink-secondary" />}
      </div>
    );
  }
  const shown = members.slice(0, 3);
  const face = iconOnly ? 22 : density === "compact" ? 16 : 20;
  const spots = shown.length === 2
    ? ["left-0 top-0.5", "right-0 bottom-0"]
    : ["left-0 top-0", "left-0 bottom-0", "right-0 bottom-0"];
  return (
    <div className={cn("relative shrink-0", iconOnly ? "size-10" : density === "compact" ? "size-7" : "size-9")}>
      {/* No outline ring: a ring in a fixed color reads as a dark border on
          hover and selected rows. The faces simply overlap. */}
      {shown.map((b, index) => (
        <span key={b.id} className={cn("absolute rounded-full", spots[index])}>
          <SidebarMascotAvatar botId={b.id} bot={b} primary={isViewersPrimaryBot(b, viewerId)} primaryRingClassName="ring-sidebar" state="idle" size={face} animated={false} />
        </span>
      ))}
    </div>
  );
}

/** Personal section overlays may clone a record without changing a row. */
function sameSidebarRow<P extends object>(a: P, b: P): boolean {
  const keys = Object.keys(a) as (keyof P)[];
  return keys.length === Object.keys(b).length && keys.every((key) =>
    key === "bot" || key === "group" ? equalRows([a[key]], [b[key]]) : Object.is(a[key], b[key]));
}

export function GroupListItem({
  group,
  density,
  quiet = false,
  query = "",
  onMenu,
}: {
  group: Group;
  density: SidebarDensity;
  /** Quiet rows: name and status only (see sidebar-preferences). */
  quiet?: boolean;
  query?: string;
  onMenu: (menu: { groupId: string; x: number; y: number }) => void;
}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    activeView: current.activeView,
    bots: peerBots(current),
    config: current.config,
    instances: current.instances,
    selectedId: current.selectedId,
  }), (a, b) => Object.is(a.activeView, b.activeView) && equalRows(a.bots, b.bots) && Object.is(a.config, b.config) && Object.is(a.instances, b.instances) && Object.is(a.selectedId, b.selectedId));
  const showThreads = useShowThreads();
  const selected = state.activeView === "chat" && state.selectedId === group.id;
  // a search opens this room only when it has a matching thread to show,
  // and clearing it puts the room back as it was (MOCA-293)
  const [threadsOpen, setThreadsOpen] = useSearchDisclosure(`group:${group.id}`, showThreads ? query ?? "" : "", searchMatchesThreads(query ?? "", group.tasks), selected);
  const wasSelected = useRef(selected);
  useEffect(() => {
    // Search can unmount the selected room. Only a new selection opens it;
    // remounting must preserve the person's remembered disclosure choice.
    if (showThreads && selected && !wasSelected.current) setThreadsOpen(true);
    wasSelected.current = selected;
  }, [selected, showThreads, setThreadsOpen]);
  // A room and a conversation with a person list their threads like a bot
  // does: under the row only in the sidebar location (the chat header's
  // thread button otherwise, never both), and once there is a list (a
  // second thread, or a person's folder) to open. So every row kind sits at
  // one inset in the header location, the avatar and the name aligned.
  const threadsMode = useThreadsMode();
  const inSidebar = threadsMode === "sidebar";
  const hasThreadList = inSidebar && (group.peopleDm
    ? (group.tasks?.length ?? 1) > 1 || (group.projects?.length ?? 0) > 0 || Boolean(query)
    : (group.tasks?.length ?? 1) > 1 || Boolean(query));
  const expanded = !group.dm && threadsOpen && density !== "icons" && hasThreadList;
  // quiet rows keep the line only while the room reports work in progress
  const groupStatus = Boolean(group.busyBotId) || Boolean(group.working);
  const roomBusy = groupStatus;
  const members = groupMemberBots(group, state.bots);
  const last = group.messages.at(-1);
  // A direct conversation with a person reads as that person.
  const orgPeople = useOrgPeople();
  const peer = peopleDmPeer(group, viewerActorId(state.config), orgPeople);
  const rowName = peer?.name ?? group.name;
  // The person's presence, also in the rail's accessible name (no text there).
  const peerPresence = usePresence(peer?.id);
  // No achievement title or points here: they live in the person panel.
  const previewShown = !expanded && (!quiet || groupStatus);
  return (
    <>
    <div className="group relative">
    <button
      data-sidebar-group-row={group.id}
      // with no thread list open, the row is the conversation being looked at
      aria-current={selected && !expanded ? "page" : undefined}
      onClick={() => navigate(() => dispatch({ type: "select", id: group.id }))}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ groupId: group.id, x: e.clientX, y: e.clientY });
      }}
      // the menu must be reachable without a pointer: Shift+F10, and the
      // dedicated ContextMenu key (whose native event carries no useful
      // coordinates) both open it centered on the row
      onKeyDown={(e) => {
        if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onMenu({ groupId: group.id, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      className={cn(
        "relative flex w-full items-center text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
        density === "icons" ? "justify-center rounded-lg px-1 py-1.5" : density === "compact" ? "gap-2 rounded-lg py-1.5 pr-9" : "h-[54px] gap-2 rounded-[10px] py-2 pr-2",
        // The same box and inset as BotListItem (Grok Bot's 54px row), so
        // every row's avatar and name line up: a room or a person moves like
        // a bot row (#152), only in the sidebar location, where its chevron
        // sits.
        density !== "icons" && (inSidebar ? "pl-6" : "pl-2"),
        selected && !expanded ? "bg-sidebar-selected" : "hover:bg-sidebar-hover",
      )}
      title={density === "icons" ? rowName : undefined}
      aria-label={density === "icons" ? [rowName, peerPresence ? presenceLabel(peerPresence) : null, groupStatus ? t("chat.activity.working") : null, group.unread ? t("task.unread") : null].filter(Boolean).join(" · ") : undefined}
      data-people-dm={peer ? peer.id : undefined}
    >
      {peer
        ? <span data-sidebar-row-avatar className={cn("flex shrink-0 items-center justify-center", density === "icons" ? "size-12" : density === "compact" ? "size-7" : "size-9")}><PersonAvatar avatarUrl={peer.avatarUrl} initials={peer.initials} size={density === "icons" ? 44 : density === "compact" ? 28 : 36} presenceId={peer.id} presenceRing="border-sidebar" /></span>
        : <span data-sidebar-row-avatar className="flex shrink-0"><StackedMauses members={members} density={density} viewerId={viewerActorId(state.config)} /></span>}
      <div data-sidebar-row-name className={cn("min-w-0 flex-1", density === "icons" && "hidden")}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn("flex min-w-0 grow items-center gap-1.5 text-[14px] leading-5 text-sidebar-ink", (selected && !expanded) || group.unread ? "font-semibold" : "font-medium")}>
            <span className="min-w-0 truncate">{rowName}</span>
            {peer && !quiet && <PersonLabelTag principalId={peer.id} className="max-w-[46%] shrink" />}
          </span>
          {selected && last && !expanded && <span className="shrink-0 text-[12px] leading-4 text-sidebar-ink-secondary">{formatTime(last.at)}</span>}
          {group.unread && <span className="sr-only">{t("task.unreadMany")}</span>}
        </div>
        {previewShown && <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-[13px] leading-[18px]", group.unread ? "text-sidebar-ink" : "text-sidebar-ink-secondary")}>{groupPreview(group, state.bots, state.config, state.instances)}</span>
        </div>}
      </div>
      {density === "icons" && group.unread && (
        <span className="absolute bottom-1.5 right-1.5 size-2 rounded-full border border-sidebar bg-unread" />
      )}
      {/* the rail's only sign that the room is at work, like a bot's dot */}
      {density === "icons" && groupStatus && <StatusDot tone="success" testId="room-working-dot" className="absolute right-1.5 top-1.5" sizeClassName="size-3" />}
    </button>
    {!group.dm && density !== "icons" && hasThreadList && <button type="button" aria-label={t(expanded ? "task.collapseNamed" : "task.expandNamed", { name: rowName })} aria-expanded={expanded}
      onClick={() => setThreadsOpen((open) => !open)} className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-ink-secondary outline-none hover:text-sidebar-ink focus-visible:ring-1 focus-visible:ring-accent/60">
      <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform", expanded && "rotate-90")} />
    </button>}
    {/* one conversation: no thread is made or opened from the row */}
    {!group.dm && !group.peopleDm && density !== "icons" && threadsMode !== "one" && <button type="button" disabled={roomBusy} aria-label={t("task.newShort")} title={t(roomBusy ? "task.newBusy" : "task.newShort")}
      onClick={() => { setThreadsOpen(true); dispatch({ type: "newGroupTask", groupId: group.id }); }}
      className="pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-sidebar-ink-secondary opacity-0 hover:bg-sidebar-hover hover:text-sidebar-ink disabled:opacity-40 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70 touch:disabled:opacity-40"><Plus size={14} /></button>}
    </div>
    {expanded && <div className={threadListIndent(density)}>{group.peopleDm
      ? <PersonThreadList group={group} name={rowName} selected={selected} density={density} query={rowName.toLowerCase().includes(query.toLowerCase()) ? "" : query} />
      : <GroupThreadList group={group} selected={selected} density={density} query={group.name.toLowerCase().includes(query.toLowerCase()) ? "" : query} />}</div>}
    </>
  );
}

const MemoGroupListItem = memo(GroupListItem, sameSidebarRow);

/** Sidebar mode: the threads under a bot, a room or a person sit under the
 * row's text, past its avatar and the gap after it (36px + 8px comfortable,
 * 28px + 8px compact), the same for every kind of row. */
export function threadListIndent(density: SidebarDensity): string {
  return density === "compact" ? "ml-9" : "ml-11";
}

/** Scroll the row of a thread the person asked to open into view, once the
 * switch has landed and that thread is the one on screen. `block: nearest`
 * keeps an already-visible row still. */
function useRevealedThreadRow(reveal: AppState["revealThread"], currentThreadId: string | null) {
  useEffect(() => {
    if (!reveal || reveal.threadId !== currentThreadId) return;
    const row = document.querySelector<HTMLElement>(`[data-sidebar-thread-row="${CSS.escape(reveal.threadId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [reveal, currentThreadId]);
}

export function GroupThreadList({ group, selected, density = "comfortable", query = "" }: { group: Group; selected: boolean; density?: SidebarDensity; query?: string }) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    bots: peerBots(current),
    revealThread: current.revealThread,
  }), (a, b) => equalRows(a.bots, b.bots) && Object.is(a.revealThread, b.revealThread));
  const now = useRelativeNow();
  const [showAll, setShowAll] = useState(false);
  const busy = Boolean(group.working || group.busyBotId);
  const waiting = state.bots.find((bot) => bot.id === group.busyBotId)?.activity === "waiting-on-you";
  const tasks = (group.tasks ?? [{ threadId: group.threadId, title: group.name, createdAt: group.createdAt }]).map((task) => ({
    ...task, busy: task.threadId === group.threadId && busy, unread: task.threadId === group.threadId && group.unread,
    activity: task.threadId === group.threadId && waiting ? "waiting-on-you" as const : undefined,
  }));
  const visible = orderedThreadList(visibleSidebarThreads(tasks, group.threadId, query, [], showAll));
  useRevealedThreadRow(state.revealThread, selected ? group.threadId : null);
  // One set of row actions per room; they read the room as it is when used.
  const latest = useRef(group);
  latest.current = group;
  const groupId = group.id;
  const actions = useMemo(() => ({
    onSelect: (task: { threadId: string }) => navigate(() => {
      if (task.threadId !== latest.current.threadId) dispatch({ type: "switchGroupTask", groupId, threadId: task.threadId });
      else dispatch({ type: "select", id: groupId });
    }),
    onRename: (task: { threadId: string }, title: string) => dispatch({ type: "renameGroupTask", groupId, threadId: task.threadId, title }),
    onDelete: (task: { threadId: string }) => dispatch({ type: "deleteGroupTask", groupId, threadId: task.threadId }),
    onPin: (task: { threadId: string; title: string }, pinned: boolean) => dispatch({ type: "pinGroupTask", groupId, threadId: task.threadId, pinned, title: task.title }),
  }), [groupId, dispatch]);
  const locale = activeLocale();
  return <div className="mb-2 space-y-0.5" role="group" aria-label={t("task.namedList", { name: group.name })}>
    {visible.map((task) => <SidebarThreadRow key={task.threadId} task={task} ownerId={group.id} current={selected && task.threadId === group.threadId} compact={density === "compact"}
      now={stampClock(threadRecency(task), now)} locale={locale} {...actions} />)}
    {!query && !showAll && tasks.length > visible.length && <button type="button" onClick={() => setShowAll(true)} className="pl-6 pr-3 py-1.5 text-[11px] text-sidebar-ink-secondary hover:text-sidebar-ink">{t("task.showAll", { count: tasks.length })}</button>}
  </div>;
}

export type MemberMenuItem = "viewProfile" | "copyConversationId" | "hide" | "unpin" | "moveTo" | "markUnread";

/** Right-click on a person row (a people-DM). Unpin only while that row is
 * pinned. No rename, no delete, no force-stop. */
export function memberMenuItems(row: { peer: boolean; pinned: boolean }): MemberMenuItem[] {
  const items: MemberMenuItem[] = [];
  if (row.peer) items.push("viewProfile");
  items.push("copyConversationId", "hide");
  if (row.pinned) items.push("unpin");
  items.push("moveTo", "markUnread");
  return items;
}

/** Copy for the room delete confirmation. Deleting a room drops its messages
 * and every thread in it and turns off the routines that run there; the bots
 * in it are untouched. Bot⇄bot rooms are labelled threads in the menu. */

export function RoomContextMenu({
  menu,
  onClose,
  onMoveToSection,
  onDelete,
  onLeave,
}: {
  menu: { groupId: string; x: number; y: number } | null;
  onClose: () => void;
  onMoveToSection: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  /** #1480: leave a group you were added to (the caller confirms). */
  onLeave?: (groupId: string) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    config: current.config,
    groups: peerGroups(current),
  }), (a, b) => Object.is(a.config, b.config) && equalRows(a.groups, b.groups));
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const group = shown ? state.groups.find((g) => g.id === shown.groupId) : undefined;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group?.name ?? "");

  useEffect(() => {
    if (!menu) return;
    setDraft(state.groups.find((g) => g.id === menu.groupId)?.name ?? "");
    setRenaming(false);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-room-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!motion.shown || !group || !shown) return null;
  const isBotChat = Boolean(group.dm);
  const peerId = group.peopleDm ? peopleDmPeer(group, viewerActorId(state.config), new Map())?.id : undefined;
  const member = group.peopleDm ? memberMenuItems({ peer: Boolean(peerId), pinned: group.pinned === true }) : [];
  const memberHas = (item: MemberMenuItem) => member.includes(item);
  const ownsRoom = viewerOwnsGroup(group, state.config);
  const mayDelete = viewerMayDeleteGroup(group, state.config);
  const saveRename = () => {
    const name = nextRename(group.name, draft);
    if (name) dispatch({ type: "patchGroup", groupId: group.id, patch: { name } });
    onClose();
  };
  const top = Math.min(shown.y, window.innerHeight - (group.peopleDm ? 280 : 240));
  const left = Math.min(shown.x, window.innerWidth - 240);
  return createPortal(
    <div
      data-room-menu
      data-sidebar
      data-member-menu={group.peopleDm ? "" : undefined}
      style={{ top, left }}
      className={cn("fixed z-40 w-[228px] min-w-[200px] overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
    >
      {peerId && (
        <button
          onClick={() => {
            onClose();
            dispatch({ type: "openPersonPanel", personId: peerId });
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
        >
          <UserRound size={16} className="text-ink" />
          {t("personPanel.view")}
        </button>
      )}
      {!group.peopleDm && !remoteClient && ownsRoom && (renaming ? (
        <div className="flex items-center gap-1 px-0.5 py-0.5">
          <input
            autoFocus
            value={draft}
            maxLength={100}
            aria-label={t("sidebar.room.renameAria", { name: group.name })}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                saveRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={saveRename}
            aria-label={isBotChat ? t("sidebar.room.saveChatName") : t("sidebar.room.saveChannelName")}
            title={t("common.save")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isBotChat ? t("sidebar.room.cancelChatRename") : t("sidebar.room.cancelChannelRename")}
            title={t("common.cancel")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(group.name);
            setRenaming(true);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
        >
          <Pencil size={16} className="text-ink" />
          {isBotChat ? t("sidebar.room.renameChat") : t("sidebar.room.renameChannel")}
        </button>
      ))}
      {!remoteClient && !isBotChat && !group.peopleDm && (
        <button
          onClick={() => {
            onClose();
            onMoveToSection(group.id);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
        >
          <FolderPlus size={16} className="text-ink" />
          {t("sidebar.section.moveToContext")}
        </button>
      )}
      <button
        onClick={() => {
          void copyText(group.threadId);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
      >
        <ClipboardCopy size={16} className="text-ink" />
        {t("sidebar.copyConversationId")}
      </button>
      <button
        onClick={() => {
          if (peerId) hideFromSidebar("person", peerId);
          else hideFromSidebar("group", group.id);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
      >
        <EyeOff size={16} className="text-ink" />
        {peerId ? t("sidebar.hidden.close") : t("sidebar.hidden.hide")}
      </button>
      {memberHas("unpin") && (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "patchGroup", groupId: group.id, patch: { pinned: false } });
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
        >
          <PinOff size={16} className="text-ink" />
          {t("sidebar.bot.unpin")}
        </button>
      )}
      {memberHas("moveTo") && (
        <MoveToSectionItem
          itemKind="group"
          itemId={group.id}
          fallbackSection={group.section}
          dismissAttr="data-room-menu"
          label={t("sidebar.bot.moveTo")}
          onAssign={(section) => {
            // Personal folders on an organization server. A people-DM refuses
            // a section patch, so this never writes the server's section.
            const failed = assignPersonalSection("group", group.id, section);
            if (failed) dispatch({ type: "error", message: failed });
            onClose();
          }}
        />
      )}
      {memberHas("markUnread") && (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: "patchGroup", groupId: group.id, patch: { unread: true } });
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
        >
          <BellDot size={16} className="text-ink" />
          {t("sidebar.bot.markUnread")}
        </button>
      )}
      {onLeave && canLeaveGroup(group, state.config, remoteClient) && (
        <button
          type="button"
          data-room-leave=""
          onClick={() => {
            onClose();
            onLeave(group.id);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-danger hover:bg-hover"
        >
          <LogOut size={16} />
          {t("groupPanel.leave")}
        </button>
      )}
      {!group.peopleDm && !remoteClient && mayDelete && <button
        onClick={() => {
          onClose();
          onDelete(group.id);
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-danger hover:bg-hover"
      >
        <Trash2 size={16} />
        {isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel")}
      </button>}
    </div>,
    document.body,
  );
}

/** The "Move to" submenu's content: the existing teams (checkmark on the
 * current one), No team, then New team… which asks for the name in place.
 * Exported for tests. */
export function MoveToTeamList({
  sections,
  current,
  onAssign,
  initialCreating = false,
}: {
  sections: readonly string[];
  /** the target's current team; "" = none */
  current: string;
  /** "" takes it out of its team */
  onAssign: (section: string) => void;
  initialCreating?: boolean;
}) {
  const [creating, setCreating] = useState(initialCreating);
  const [draft, setDraft] = useState("");
  const create = () => {
    const name = draft.trim();
    if (!name || name.length > 60) return;
    onAssign(name);
  };
  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";
  return (
    <>
      {sections.map((section) => (
        <button
          key={section}
          type="button"
          role="menuitemradio"
          aria-checked={section === current}
          data-move-target={section}
          onClick={() => onAssign(section)}
          className={row}
        >
          <Folder size={16} className="shrink-0 text-ink" />
          <span className="min-w-0 flex-1 truncate">{section}</span>
          {section === current && <Check size={14} className="shrink-0 text-ink" />}
        </button>
      ))}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={!current}
        data-move-target=""
        onClick={() => onAssign("")}
        className={row}
      >
        <FolderMinus size={16} className="shrink-0 text-ink" />
        <span className="min-w-0 flex-1">{t("sidebar.bot.noTeam")}</span>
        {!current && <Check size={14} className="shrink-0 text-ink" />}
      </button>
      <div className="mx-2 my-1 h-[0.5px] bg-border" />
      {creating ? (
        <form
          data-move-new-form=""
          className="flex items-center gap-2 px-0.5 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            autoFocus
            maxLength={60}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setCreating(false); setDraft(""); }
            }}
            placeholder={t("sidebar.section.newContextAria")}
            aria-label={t("sidebar.section.newContextAria")}
            className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          data-move-new=""
          onClick={() => setCreating(true)}
          className={row}
        >
          <FolderPlus size={16} className="shrink-0 text-ink" />
          {t("sidebar.section.newContext")}
        </button>
      )}
    </>
  );
}

function MoveToSectionItem({
  itemKind,
  itemId,
  fallbackSection,
  dismissAttr,
  onAssign,
  label = t("sidebar.bot.moveToSection"),
}: {
  itemKind: SectionItemKind;
  itemId: string;
  /** The server's section, used only when sections are not personal. */
  fallbackSection?: string | undefined;
  /** Keeps a click in the submenu from dismissing the menu that opened it. */
  dismissAttr: "data-bot-menu" | "data-room-menu";
  onAssign: (section: string) => void;
  label?: string;
}) {
  const state = useStoreSelector((current) => ({
    bots: peerBots(current),
    groups: peerGroups(current),
    sections: current.sections,
  }), (a, b) => equalRows(a.bots, b.bots) && equalRows(a.groups, b.groups) && Object.is(a.sections, b.sections));
  const personal = usePersonalLayout();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const sections = personal ? personalSectionNames(personal) : [...new Set([
    ...(state.sections ?? []),
    ...state.bots.flatMap((item) => item.section ? [item.section] : []),
    ...state.groups.flatMap((group) => group.section ? [group.section] : []),
  ])];
  const current = (personal ? personalSectionOf(personal, itemKey(itemKind, itemId)) : fallbackSection)?.trim() ?? "";
  const show = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);
  const place = () => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return { top: 8, left: 8 };
    const width = 240;
    const left = trigger.right + width + 8 > window.innerWidth
      ? Math.max(8, trigger.left - width - 4)
      : trigger.right + 4;
    return { top: Math.max(8, trigger.top), left };
  };
  const submenuStyle = open ? place() : undefined;
  return (
    <div onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        data-menu-item="move"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          show();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); show(); }
        }}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
      >
        <FolderInput size={16} className="text-ink" />
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight size={14} className="text-ink-tertiary" />
      </button>
      {open && submenuStyle && createPortal(
        <div
          role="menu"
          {...{ [dismissAttr]: "" }}
          aria-label={label}
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{ top: submenuStyle.top, left: submenuStyle.left }}
          className="fixed z-50 max-h-[calc(100dvh-16px)] w-[240px] min-w-[200px] overflow-y-auto overscroll-contain rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]"
        >
          <MoveToTeamList sections={sections} current={current} onAssign={onAssign} />
        </div>,
        document.body,
      )}
    </div>
  );
}

export function BotContextMenu({
  menu,
  onClose,
  onArchive,
  onDelete,
  onMoveToSection,
  onRename,
  onMakePrimary,
  onReplacePrimary,
  variant = "sidebar",
  onEditPersona,
  onSelect,
}: {
  /** Starts a multi-selection with this bot (the sidebar row menu only). */
  onSelect?: (botId: string) => void;
  menu: MenuState | null;
  onClose: () => void;
  onArchive?: (bot: Bot) => void;
  onDelete?: (bot: Bot) => void;
  onMoveToSection?: (botId: string) => void;
  onRename: (botId: string) => void;
  /** "mascot": the bot panel's mascot menu (Edit persona, Rename, Put on the
   * desktop, Make primary bot). "sidebar": the row menu. */
  variant?: "sidebar" | "mascot";
  /** Mascot menu: open the persona editor on this bot. */
  onEditPersona?: (bot: Bot) => void;
  /** Make this bot the viewer's Primary Bot (one per person). */
  onMakePrimary?: (bot: Bot) => void;
  /** Open "Choose a primary Bot" to hand the role to another of their bots. */
  onReplacePrimary?: (bot: Bot) => void;
}) {
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    bots: peerBots(current),
    config: current.config,
    deletingBots: current.deletingBots,
    selectedId: current.selectedId,
    settingsOpen: current.settingsOpen,
  }), (a, b) => equalRows(a.bots, b.bots) && Object.is(a.config, b.config) && Object.is(a.deletingBots, b.deletingBots) && Object.is(a.selectedId, b.selectedId) && Object.is(a.settingsOpen, b.settingsOpen));
  const showThreads = useShowThreads();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const personal = usePersonalLayout();
  const bot = shown ? state.bots.find((b) => b.id === shown.botId) : undefined;
  const floating = useSyncExternalStore(subscribeFloatingBots, () => (shown ? isBotFloating(shown.botId) : false), () => false);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !shown) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      element.style.top = `${Math.max(8, Math.min(shown.y, window.innerHeight - height - 8))}px`;
      element.style.left = `${Math.max(8, Math.min(shown.x, window.innerWidth - width - 8))}px`;
    };
    // Menu length changes with thread settings, permissions, and locale.
    // Measure after every render; the viewport cap handles short windows.
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  // Focus moves in once per open and back out on close. It stays apart from
  // the listeners below: Sidebar passes a fresh onClose every render, and
  // re-running this with them would pull focus back to the first item.
  useEffect(() => {
    if (!menu) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-bot-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!motion.shown || !bot || !shown) return null;
  const canRename = showBotRename(state.config, bot);
  const canArchive = showBotArchive(state.config, bot);
  const canDelete = showBotDelete(state.config, bot);
  const canMoveSection = showServerSectionMove(state.config, personal !== null, [bot]);
  const deleting = state.deletingBots[bot.id] === true;
  const visibleBotCount = state.bots.filter((candidate) => !candidate.hidden).length;
  const archiveBlocked = Boolean(bot.chiefOfStaff) || visibleBotCount <= 1;
  const archiveHint = bot.chiefOfStaff
    ? t("sidebar.bot.archiveBlockedChief")
    : visibleBotCount <= 1
      ? t("sidebar.bot.archiveBlockedLast")
      : undefined;
  // Another bot opens behind its settings as its row would (openBot); the
  // bot on screen stays on the thread it shows.
  const openForSettings = () => {
    if (state.selectedId === bot.id) dispatch({ type: "select", id: bot.id });
    else openBot(dispatch, bot, showThreads);
  };
  const item = (
    icon: React.ReactNode,
    label: string,
    onClick?: () => void,
    opts?: { danger?: boolean; disabled?: boolean; hint?: string; id?: string; showHint?: boolean; keepOpen?: boolean },
  ) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      data-menu-item={opts?.id}
      disabled={opts?.disabled}
      onClick={() => {
        onClick?.();
        if (!opts?.keepOpen) onClose();
      }}
      title={opts?.hint}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px]",
        opts?.danger ? "text-danger" : "text-ink",
        opts?.disabled ? "cursor-default opacity-40" : "hover:bg-hover",
      )}
    >
      {icon}
      {opts?.showHint && opts.hint ? (
        <span className="flex min-w-0 flex-col">
          <span>{label}</span>
          <span data-menu-item-reason="" className="text-[11.5px] leading-4 text-ink-secondary">{opts.hint}</span>
        </span>
      ) : label}
    </button>
  );
  const divider = (key: string) => <div key={key} className="mx-2 my-1 h-[0.5px] bg-border" />;
  // Put the bot on the desktop (or back): a floating character to chat with.
  const floatItem = item(
    <PictureInPicture2 size={16} className="text-ink" />,
    floating ? t("floatingBots.menu.unfloat") : t("floatingBots.menu.float"),
    () => toggleFloatingBot(bot.id),
    { id: floating ? "remove-from-desktop" : "put-on-desktop" },
  );
  // The Primary Bot (one per person): its own menu offers to hand the role
  // to another of the viewer's bots; the viewer's other bots offer to take
  // it. Someone else's bot shared with the viewer offers neither.
  const viewerId = orgViewerId(state);
  const primaryItem = isViewersPrimaryBot(bot, viewerId)
    ? onReplacePrimary && item(<ArrowLeftRight size={16} className="text-ink" />, t("sidebar.bot.replacePrimary"), () => onReplacePrimary(bot))
    : viewerOwnsBot(bot, viewerId) && !bot.hidden
      ? onMakePrimary && item(<Star size={16} className="text-ink" />, t("sidebar.bot.makePrimary"), () => onMakePrimary(bot))
      : null;

  // Share opens the bot editor on its Sharing page, the flow the bot panel
  // already has (people, teams and their level). Offered wherever the server
  // has an organization to share in; every member shares their own bots, the
  // server keeps its own rules about other people's.
  const shareItem = state.config?.viewer?.principalId
    ? item(<Share2 size={16} className="text-ink" />, t("sidebar.bot.share"), () => dispatch({ type: "toggleSettings", open: true, botId: bot.id, section: "sharing" }), { id: "share" })
    : null;

  const menuFrame = (children: React.ReactNode) => createPortal(
    <div
      ref={menuRef}
      data-bot-menu
      data-sidebar
      data-bot-menu-variant={variant}
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: bot.name })}
      onKeyDown={navigateThreadMenu}
      style={{ top: shown.y, left: shown.x }}
      className={cn("fixed z-[60] max-h-[calc(100dvh-16px)] w-[248px] min-w-[200px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
    >
      {children}
    </div>,
    document.body,
  );
  if (variant === "mascot") {
    // Rename stays where the name shows (the panel), and Make primary bot in
    // the sidebar menu's More: this menu keeps the two avatar actions.
    return menuFrame([
      item(<UserRoundPen size={16} className="text-ink" />, t("botPanel.editBot"), () => onEditPersona?.(bot), { id: "edit-persona" }),
      item(
        <PictureInPicture2 size={16} className="text-ink" />,
        floating ? t("floatingBots.menu.unfloat") : t("floatingBots.menu.float"),
        () => toggleFloatingBot(bot.id),
        { id: floating ? "remove-from-desktop" : "put-on-desktop" },
      ),
    ]);
  }

  const archiveItem = canArchive ? item(
    <Archive size={16} className="text-ink" />,
    t("sidebar.bot.archive"),
    () => onArchive?.(bot),
    { id: "archive", disabled: archiveBlocked, hint: archiveHint },
  ) : null;
  // One label for the bot editor everywhere: "Edit bot". Without the
  // editor (the companion connection) it opens the bot's panel.
  const editItem = item(<UserRoundPen size={16} className="text-ink" />, t("botPanel.editBot"), () => {
    if (onEditPersona && !remoteClient) { onEditPersona(bot); return; }
    openForSettings();
    if (!state.settingsOpen) dispatch({ type: "toggleSettings", open: true });
  }, { id: "edit" });
  // "Move to ›" sits at the first level, right under Pin, in Simple and
  // Advanced alike (2026-10-15): right-click is the way to file a bot.
  const moveItem = canMoveSection ? <MoveToSectionItem
    key="move"
    itemKind="bot"
    itemId={bot.id}
    fallbackSection={bot.section}
    dismissAttr="data-bot-menu"
    label={t("sidebar.bot.moveTo")}
    onAssign={(section) => {
      if (personal) {
        const failed = assignPersonalSection("bot", bot.id, section);
        if (failed) dispatch({ type: "error", message: failed });
      } else {
        dispatch({ type: "updateBot", botId: bot.id, patch: { section: section || undefined } });
      }
      onClose();
    }}
  /> : null;

  // New thread comes first (2026-10-15): #518 had left the sidebar with
  // no way to start a conversation with a bot. newTask selects the bot too.
  // Threads turned off (the single stream): New topic, a fresh context in
  // the same conversation (docs/single-stream-orchestration.md).
  const newThreadItem = showThreads ? item(<Plus size={16} className="text-ink" />, t("task.newShort"), () => {
    dispatch({ type: "newTask", botId: bot.id });
  }, { id: "new-thread" }) : item(<Plus size={16} className="text-ink" />, t("stream.newTopic"), () => {
    // a draft over the conversation, created with its first message
    startNewTopic(dispatch, bot);
  }, { id: "new-topic" });

  // One flat menu, no More (2026-10-15): New thread | Pin, Move to › |
  // Rename, Edit bot, Share, Make primary bot, Put on the desktop | Hide from
  // sidebar, Archive, Delete. Mark as Unread, Mark all as read and Model…
  // left this menu (2026-10-15, for 0.5.7).
  const entries = remoteClient ? [
    ...(newThreadItem ? [newThreadItem] : []),
    floatItem,
    ...(canMoveSection ? [item(<FolderInput size={16} className="text-ink" />, t("sidebar.bot.moveTo"), () => {
      onClose();
      onMoveToSection?.(bot.id);
    }, { id: "move" })] : []),
    editItem,
    ...(shareItem ? [shareItem] : []),
  ] : [
    ...(newThreadItem ? [newThreadItem, divider("d-new")] : []),
    item(
      bot.pinned ? <PinOff size={16} className="text-ink" /> : <Pin size={16} className="text-ink" />,
      bot.pinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin"),
      () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } }),
      { id: "pin" },
    ),
    ...(moveItem ? [moveItem] : []),
    ...(onSelect && variant === "sidebar" ? [item(<ListChecks size={16} className="text-ink" />, t("sidebar.select.start"), () => onSelect(bot.id), { id: "select" })] : []),
    divider("d-name"),
    ...(canRename ? [item(<Pencil size={16} className="text-ink" />, t("persona.menu.rename"), () => onRename(bot.id), { id: "rename" })] : []),
    editItem,
    ...(shareItem ? [shareItem] : []),
    ...(primaryItem ? [primaryItem] : []),
    floatItem,
    divider("d-place"),
    // Only this person's sidebar: the bot, its owner and everyone else
    // keep it; Archive is the bot-wide action.
    item(<EyeOff size={16} className="text-ink" />, t("sidebar.hidden.hide"), () => hideFromSidebar("bot", bot.id), { id: "hide" }),
    ...(archiveItem ? [archiveItem] : []),
    ...(canDelete ? [<BotDeleteMenuItem
      key="delete"
      deleting={deleting}
      onClick={() => {
        onClose();
        onDelete?.(bot);
      }}
    />] : []),
  ];

  return createPortal(
    <div
      ref={menuRef}
      data-bot-menu
      data-sidebar
      role="menu"
      aria-label={t("sidebar.bot.actions", { name: bot.name })}
      onKeyDown={navigateThreadMenu}
      style={{ top: shown.y, left: shown.x }}
      className={cn("fixed z-40 max-h-[calc(100dvh-16px)] w-[228px] min-w-[200px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
    >
      {entries}
    </div>,
    document.body,
  );
}

export function archivedDeleteAllCopy() {
  return {
    title: t("sidebar.archived.deleteAllTitle"),
    body: t("sidebar.archived.deleteAllBody"),
    confirmLabel: t("sidebar.archived.deleteAll"),
    tone: "danger" as const,
  };
}

export function BotDeleteMenuItem({ deleting, onClick }: { deleting: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item="delete"
      disabled={deleting}
      aria-busy={deleting || undefined}
      onClick={onClick}
      title={deleting ? t("sidebar.bot.deleteCheckingTitle") : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-danger",
        deleting ? "cursor-default opacity-40" : "hover:bg-hover",
      )}
    >
      {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
      {deleting ? t("sidebar.bot.deleteChecking") : t("common.delete")}
    </button>
  );
}

/** The bot's visible branch, worked out again only when its transcript or
 * active leaf changes, not on every change to the bot. */
function useVisibleMessages(bot: Bot): Message[] {
  const { messages, activeLeafId } = bot;
  return useMemo(() => visibleMessages({ messages, activeLeafId }), [messages, activeLeafId]);
}

/** One row of a thread tree: what SidebarThreadRow reads, plus the folder
 * the thread is filed under. */
type ThreadTreeTask = Parameters<typeof SidebarThreadRow>[0]["task"] & { projectId?: string; routineRunId?: string };
type ThreadTreeActions = Omit<Parameters<typeof SidebarThreadRow>[0], "task" | "ownerId" | "current" | "compact" | "folders" | "activityLabel" | "now" | "locale">;

/** The thread tree under one sidebar row: project folders (collapsed until
 * opened, or until the selected thread is in that folder), then ungrouped
 * rows. No section titles. Visibility folds old threads away. Pins stay,
 * then the newest update. Waiting and working stay visible as status, not
 * as a sort key.
 * One tree for every owner of threads: a bot (BotThreadList) and a
 * conversation with a person (PersonThreadList); the owner decides only
 * where its actions go. */
function ThreadTree({ ownerId, ownerName, owner, folderOwner, openThreadId, tasks, projects, selected, density, query, hidden, actions, rowState, activeActivityLabel, onNew, onNewKind, onNewInFolder, onReorder, canMarkRead, markRead, children }: {
  ownerId: string;
  ownerName: string;
  owner: FolderOwnerKind;
  /** What the folder dialog edits (a bot, or the group). */
  folderOwner: Parameters<typeof BotProjectDialog>[0]["bot"];
  openThreadId: string;
  tasks: ThreadTreeTask[];
  projects: BotProject[];
  selected: boolean;
  density: SidebarDensity;
  query: string;
  hidden: boolean;
  actions: ThreadTreeActions;
  /** Live state a row shows beside the stored thread (a bot thread's turn). */
  rowState?: (task: ThreadTreeTask) => Partial<ThreadTreeTask>;
  activeActivityLabel?: string;
  onNew: (projectId?: string) => void;
  /** Bot threads: the New thread menu's two kinds, ordinary and confidential
   * (src/lib/confidential-thread.ts newThreadChoices), in place of the
   * single New thread item. Absent: the single item. */
  onNewKind?: { choices: NewThreadChoice[]; create: (confidential: boolean) => void };
  /** A new thread in a working folder the person picks (a bot's owner or an
   * admin, Advanced mode): opens NewTaskFolderDialog. Absent: no such item. */
  onNewInFolder?: () => void;
  onReorder: (projectIds: string[], onSaved: () => void, onError: (message: string) => void) => void;
  canMarkRead: (projectId: string) => boolean;
  markRead: (projectId: string) => Promise<void>;
  children?: React.ReactNode;
}) {
  const confirm = useConfirm();
  const revealThread = useStoreSelector((current) => current.revealThread);
  const dispatch = useStoreDispatch();
  const now = useRelativeNow();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(projects.map((project) => project.id)));
  const [folderMenu, setFolderMenu] = useState<{ projectId: string; left: number; top: number } | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState("");
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderStatus, setReorderStatus] = useState("");
  const [folderDrop, setFolderDrop] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const draggingFolder = useRef<string | null>(null);
  const [threadDrop, setThreadDrop] = useState<string | "out" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [iconProject, setIconProject] = useState<string | null>(null);
  const iconButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const createAnchorRef = useRef<HTMLDivElement>(null);
  const [listMenu, setListMenu] = useState<{ left: number; top: number } | null>(null);
  const listMenuRef = useRef<HTMLDivElement>(null);
  const listMenuMotion = useHeldMenuMotion(listMenu);
  const currentProjectId = tasks.find((task) => task.threadId === openThreadId)?.projectId;
  useEffect(() => {
    if (selected && currentProjectId) setCollapsed((previous) => {
      if (!previous.has(currentProjectId)) return previous;
      const next = new Set(previous);
      next.delete(currentProjectId);
      return next;
    });
  }, [selected, currentProjectId]);
  useSnoozeExpiry(tasks);
  // Pin, then newest update. Search keeps the same order among matches.
  const visibleTasks = orderedThreadList(visibleSidebarThreads(tasks, openThreadId, query, projects, showAll));
  // A folder rises with the thread of its that sits highest in that order.
  // An empty index sorts last. Saved order breaks ties, and still governs
  // move up and down.
  const visibleProjectIndex = (projectId: string) => visibleTasks.findIndex((task) => task.projectId === projectId);
  const folderRank = (projectId: string) => {
    const index = visibleProjectIndex(projectId);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const orderedProjects = query ? projects : [...projects].sort((a, b) => folderRank(a.id) - folderRank(b.id) || projects.indexOf(a) - projects.indexOf(b));
  useRevealedThreadRow(revealThread, selected ? openThreadId : null);
  const locale = activeLocale();
  const renderThread = (task: ThreadTreeTask) => {
    return <SidebarThreadRow key={task.threadId} task={{ ...task, ...rowState?.(task) }} ownerId={ownerId} current={selected && task.threadId === openThreadId} compact={density === "compact"} folders={projects} activityLabel={task.threadId === openThreadId ? activeActivityLabel : undefined}
      now={stampClock(threadRecency(task), now)} locale={locale} {...actions} />;
  };
  const ungrouped = visibleTasks.filter((task) => !projects.some((project) => project.id === task.projectId));
  const projectIds = projects.map((project) => project.id);
  const projectForIcon = projects.find((project) => project.id === iconProject);
  const saveOrder = (ids: string[], onSaved?: () => void) => {
    if (reordering || ids.every((id, index) => id === projectIds[index])) return;
    setReordering(true); setReorderError(null); setReorderStatus(t("folder.reordering"));
    onReorder(ids,
      () => { setReordering(false); setReorderStatus(t("folder.reordered")); onSaved?.(); },
      (message) => { setReordering(false); setReorderStatus(""); setReorderError(message); });
  };
  const resetFolderDrag = () => { draggingFolder.current = null; setFolderDrop(null); };
  const readFolder = async (projectId: string, onSaved: () => void) => {
    if (markingRead) return;
    setMarkingRead(true); setReadError(null); setReadStatus(t("folder.markingRead"));
    try {
      await markRead(projectId);
      setReadStatus(t("folder.markedRead"));
      onSaved();
    } catch (error) {
      setReadError(readableError(error));
      setReadStatus("");
    } finally { setMarkingRead(false); }
  };
  const taskIds = tasks.map((task) => task.threadId);
  const acceptThreadDrop = (event: React.DragEvent, target: string | "out") => {
    if (!event.dataTransfer?.types.includes(THREAD_DRAG_TYPE) || !actions.onMove) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setThreadDrop(target);
    return true;
  };
  const dropThreadOn = (event: React.DragEvent, folderId: string | null) => {
    if (!event.dataTransfer?.types.includes(THREAD_DRAG_TYPE) || !actions.onMove) return false;
    event.preventDefault();
    event.stopPropagation();
    const threadId = draggedThread(event.dataTransfer.getData(THREAD_DRAG_TYPE), ownerId, taskIds);
    setThreadDrop(null);
    if (!threadId) return true;
    const task = tasks.find((entry) => entry.threadId === threadId);
    if (!task) return true;
    const current = projects.some((project) => project.id === task.projectId) ? task.projectId ?? null : null;
    if (current === folderId) return true;
    actions.onMove(task, folderId);
    return true;
  };
  useEffect(() => {
    const clear = () => setThreadDrop(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);
  useEffect(() => {
    if (!listMenu) return;
    listMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !listMenuRef.current?.contains(event.target)) setListMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setListMenu(null); };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", onKey);
    };
  }, [listMenu]);
  const listMenuPosition = listMenuMotion.value && {
    left: Math.max(8, Math.min(listMenuMotion.value.left, window.innerWidth - 228)),
    top: Math.max(8, Math.min(listMenuMotion.value.top, window.innerHeight - 120)),
  };
  return (
    <div hidden={hidden} role="group" aria-label={t("task.namedList", { name: ownerName })}
      onContextMenu={(event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        setListMenu({ left: event.clientX, top: event.clientY });
      }}
      onDragOver={(event) => {
        if (acceptThreadDrop(event, "out")) return;
        if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) event.stopPropagation();
      }}
      onDrop={(event) => {
        if (dropThreadOn(event, null)) return;
        if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); resetFolderDrag(); }
      }}
      data-sidebar-thread-drop={threadDrop === "out" ? "out" : undefined}
      className={cn("relative mb-2 space-y-0.5", threadDrop === "out" && "rounded-md ring-1 ring-inset ring-accent/40")}>
      {!hidden && <>
      {orderedProjects.map((project) => {
        const index = projects.indexOf(project);
        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        const visible = visibleTasks.filter((task) => task.projectId === project.id);
        if (query && visible.length === 0 && !project.name.toLowerCase().includes(query.toLowerCase())) return null;
        const open = Boolean(query) || !collapsed.has(project.id);
        const waiting = projectTasks.some((task) => task.activity === "waiting-on-you");
        const working = projectTasks.some((task) => task.busy);
        return <div key={project.id} data-sidebar-project={project.id}>
          <div data-sidebar-folder-row={project.id} data-sidebar-thread-drop={threadDrop === project.id ? "in" : undefined} draggable={!reordering}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setFolderMenu({ projectId: project.id, left: event.clientX, top: event.clientY }); }}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({ botId: ownerId, projectId: project.id }));
              draggingFolder.current = project.id;
            }}
            onDragEnd={(event) => { event.stopPropagation(); resetFolderDrag(); }}
            onDragOver={(event) => {
              if (acceptThreadDrop(event, project.id)) return;
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.stopPropagation();
              if (!draggingFolder.current || reordering) { event.dataTransfer.dropEffect = "none"; return; }
              event.preventDefault(); event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setFolderDrop({ id: project.id, place: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
            }}
            onDragLeave={(event) => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                setFolderDrop(null);
                setThreadDrop((current) => current === project.id ? null : current);
              }
            }}
            onDrop={(event) => {
              if (dropThreadOn(event, project.id)) return;
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.preventDefault(); event.stopPropagation();
              const from = draggedFolder(event.dataTransfer.getData(FOLDER_DRAG_TYPE), ownerId, projectIds);
              const rect = event.currentTarget.getBoundingClientRect();
              if (from) saveOrder(placeFolder(projectIds, from, project.id, event.clientY < rect.top + rect.height / 2 ? "before" : "after"));
              resetFolderDrag();
            }}
            className={cn("group/folder flex items-center gap-0.5 rounded-md pl-0.5 text-sidebar-ink-secondary hover:bg-sidebar-hover",
              threadDrop === project.id && "bg-sidebar-hover ring-1 ring-inset ring-accent/50",
              folderDrop?.id === project.id && draggingFolder.current !== project.id && (folderDrop.place === "before" ? "shadow-[0_-2px_var(--color-accent)]" : "shadow-[0_2px_var(--color-accent)]"))}>
            <button type="button" aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex size-6 shrink-0 items-center justify-center rounded outline-none hover:text-sidebar-ink focus-visible:ring-1 focus-visible:ring-accent/60" aria-label={t(open ? "task.collapseNamed" : "task.expandNamed", { name: project.name })}>
              <ChevronRight aria-hidden="true" size={11} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
            </button>
            <button type="button" ref={(node) => { if (node) iconButtonRefs.current.set(project.id, node); else iconButtonRefs.current.delete(project.id); }} aria-label={t("folder.iconNamed", { name: project.name })} title={t("folder.iconNamed", { name: project.name })} aria-expanded={iconProject === project.id} aria-haspopup="dialog" onClick={() => setIconProject((current) => current === project.id ? null : project.id)} className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-sidebar-hover"><FolderIcon emoji={project.emoji} size={14} /></button>
            {renamingProject === project.id ? (
              <FolderRenameField
                name={project.name}
                onCancel={() => setRenamingProject(null)}
                onSave={(next) => {
                  dispatch({ type: "updateProject", botId: folderOwner.id, owner, projectId: project.id, patch: { name: next }, onSaved: () => setRenamingProject(null), onError: () => setRenamingProject(null) });
                }}
              />
            ) : (
              <button type="button" data-sidebar-folder-label={project.id} draggable={!reordering} aria-expanded={open} onClick={() => setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                return next;
              })} className="flex min-h-8 min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 py-1 text-left text-[13px] font-semibold active:cursor-grabbing" title={project.name}>
                <span className="truncate">{project.name}</span>
                <span className="shrink-0 text-[10px] font-normal opacity-50">{projectTasks.length}</span>
                {!open && (waiting ? <span className="text-[10px] text-warning">{t("task.waiting")}</span> : working ? <Loader2 size={10} className="shrink-0 animate-spin text-success" /> : projectTasks.some((task) => task.unread) ? <span className="size-1.5 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} /> : null)}
              </button>
            )}
            {/* New thread here is in the folder's "..." menu: one place, not a
                second hover button beside it. */}
            <FolderActions project={project} canMoveUp={index > 0} canMoveDown={index < projects.length - 1} canMarkRead={canMarkRead(project.id)} saving={reordering || markingRead}
              menu={folderMenu?.projectId === project.id ? folderMenu : null} onMenuChange={(menu) => setFolderMenu(menu ? { ...menu, projectId: project.id } : null)}
              onEdit={() => setRenamingProject(project.id)} onMove={(direction, onSaved) => saveOrder(moveFolder(projectIds, project.id, direction), onSaved)}
              onMarkRead={(onSaved) => { void readFolder(project.id, onSaved); }}
              onNewThread={() => onNew(project.id)}
              onDelete={() => {
                void (async () => {
                  if (!(await confirm({ title: t("folder.deleteBody"), confirmLabel: t("common.delete"), tone: "danger" }))) return;
                  dispatch({ type: "deleteProject", botId: folderOwner.id, owner, projectId: project.id });
                })();
              }} />
          </div>
          {open && <div role="group" aria-label={t("task.namedList", { name: project.name })}
            onDragOver={(event) => { acceptThreadDrop(event, project.id); }}
            onDrop={(event) => { dropThreadOn(event, project.id); }}>
            {visible.map(renderThread)}
          </div>}
        </div>;
      })}
      {reorderError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{reorderError}</p>}
      <span role="status" className="sr-only">{reorderStatus}</span>
      {readError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{readError}</p>}
      <span role="status" className="sr-only">{readStatus}</span>
      {ungrouped.map(renderThread)}
      {!query && !showAll && tasks.length > visibleTasks.length && <button type="button" onClick={() => setShowAll(true)} className="pl-6 pr-3 py-1.5 text-[11px] text-sidebar-ink-secondary hover:text-sidebar-ink">{t("task.showAll", { count: tasks.length })}</button>}
      {children}
      {listMenuMotion.shown && listMenuPosition && createPortal(<div ref={listMenuRef} data-sidebar-thread-list-actions role="menu" aria-label={t("task.namedList", { name: ownerName })}
        style={listMenuPosition} className={cn("fixed z-50 w-[220px] rounded-lg border border-hairline/50 popover-surface bg-card p-1 shadow-xl", listMenuMotion.className)} {...listMenuMotion.exitProps}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setListMenu(null); } else navigateThreadMenu(event); }}>
        {onNewKind ? onNewKind.choices.map((choice) => <button key={choice.label} type="button" role="menuitem" data-new-thread-kind={choice.confidential ? "confidential" : "ordinary"} onClick={() => { setListMenu(null); onNewKind.create(choice.confidential); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised">{choice.lock ? <Lock size={12} /> : <Plus size={12} />}{t(choice.label)}</button>)
          : <button type="button" role="menuitem" onClick={() => { setListMenu(null); onNew(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised"><Plus size={12} />{t("task.newShort")}</button>}
        {onNewInFolder && <button type="button" role="menuitem" onClick={() => { setListMenu(null); onNewInFolder(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised"><FolderOpen size={12} />{t("task.folder.new")}</button>}
        <button type="button" role="menuitem" onClick={() => { setListMenu(null); setCreatingProject(true); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised"><FolderPlus size={12} />{t("folder.new")}</button>
      </div>, document.body)}
      <div ref={createAnchorRef} className="pointer-events-none absolute left-2 top-2 size-0" aria-hidden="true" />
      {creatingProject && <BotProjectDialog bot={folderOwner} owner={owner} anchorRef={createAnchorRef} onClose={() => setCreatingProject(false)} />}
      {projectForIcon && (
        <FolderIconPopover
          bot={folderOwner}
          owner={owner}
          project={projectForIcon}
          anchorRef={{ get current() { return iconButtonRefs.current.get(projectForIcon.id) ?? null; } }}
          onClose={() => setIconProject(null)}
        />
      )}
      </>}
    </div>
  );
}

/** The thread tree under one bot row (Settings > Threads location > In the
 * sidebar). */
export function BotThreadList({ bot, selected, density = "comfortable", query = "", hidden = false }: {
  bot: Bot; selected: boolean; density?: SidebarDensity; query?: string; hidden?: boolean;
}) {
  const dispatch = useStoreDispatch();
  const pendingQueued = useStoreSelector((current) => current.pendingQueued);
  const generatedTitles = useStoreSelector((current) => llmThreadTitlesEnabled(current.config));
  const tasks = (bot.tasks ?? [{ threadId: bot.threadId, title: t("task.newShort"), createdAt: 0 }])
    // bot-to-bot threads never show (the selected one stays reachable)
    .filter((task) => !task.routineRunId && (task.threadId === bot.threadId || !isInterBotThread(bot.id, task)))
    .map((task) => ({ ...task, queued: Boolean(pendingQueued[task.threadId]?.length) }));
  const [permissionRefresh, setPermissionRefresh] = useState<{ threadId: string; kind: "full" | "local-auto" } | null>(null);
  // the same live verb the chat pane derives from the visible tail
  // ("Reading a file"), passed to the active thread's row while it works
  const activeActivityLabel = liveActivityLabel(visibleMessages(bot).at(-1));
  // A new thread in a chosen working folder: a host path, so the owner of
  // this computer or an admin, and only in Advanced mode (upstream #2550).
  const canChooseFolder = useOwnerOrAdmin() === true;
  const advanced = useAdvancedMode();
  const [folderDialog, setFolderDialog] = useState(false);
  const confidentialByDefault = useStoreSelector((current) => current.config?.confidentialThreadsByDefault === true);
  // One set of row actions per bot, so memoized rows skip the list's renders;
  // they read the bot as it is when used.
  const latest = useRef(bot);
  latest.current = bot;
  const botId = bot.id;
  const prefetch = useThreadPrefetch();
  const actions = useMemo(() => {
    type Row = { threadId: string };
    const patch = (task: Row, change: Extract<Parameters<typeof dispatch>[0], { type: "updateTask" }>["patch"]) => dispatch({ type: "updateTask", botId, threadId: task.threadId, patch: change });
    return {
      onPrefetch: prefetch ? (task: Row, intent: ThreadPrefetchIntent) => {
        if (intent === "hover") prefetch.hover(task.threadId);
        else if (intent === "leave") prefetch.leave(task.threadId);
        else prefetch.focus(task.threadId);
      } : undefined,
      onSelect: (task: Row) => navigate(() => { if (task.threadId !== latest.current.threadId) dispatch({ type: "switchTask", botId, threadId: task.threadId }); else dispatch({ type: "select", id: botId }); }),
      onRename: (task: Row, title: string) => dispatch({ type: "renameTask", botId, threadId: task.threadId, title }),
      onRegenerateTitle: generatedTitles ? (task: Row, onSettled: (ok: boolean) => void) => dispatch({ type: "regenerateTaskTitle", botId, threadId: task.threadId, onSettled }) : undefined,
      onDelete: (task: Row) => dispatch({ type: "deleteTask", botId, threadId: task.threadId }),
      onMove: (task: Row, projectId: string | null) => patch(task, { projectId }),
      onArchive: (task: Row, archivedAt: number | null) => patch(task, { archivedAt }),
      onPin: (task: Row, pinned: boolean) => patch(task, { pinned }),
      onSnooze: (task: Row, snoozedUntil: number | null) => patch(task, { snoozedUntil }),
      onLink: (task: Row, link: string | null) => patch(task, { link }),
      onOpenAside: (task: Row) => openSideThread({ botId, threadId: task.threadId }),
      onMakeConfidential: (task: Row) => dispatch({ type: "makeTaskConfidential", botId, threadId: task.threadId }),
      onRefreshPermissions: (task: Row) => {
        const current = latest.current;
        const mode = botApprovalSetting(current);
        const threadMode = approvalModeFor(currentTaskBot(current, task.threadId));
        if (mode === "full" && threadMode !== "full") { setPermissionRefresh({ threadId: task.threadId, kind: "full" }); return; }
        if (mode === "auto" && current.computer === "local" && threadMode !== "auto") { setPermissionRefresh({ threadId: task.threadId, kind: "local-auto" }); return; }
        dispatch({ type: "refreshTaskPermissions", botId, threadId: task.threadId });
      },
    };
  }, [botId, dispatch, generatedTitles, prefetch]);
  const rowState = (task: ThreadTreeTask) => {
    const thread = currentTaskBot(bot, task.threadId);
    return {
      busy: thread.busy,
      activity: thread.activity,
      waitingForTeammates: thread.waitingForTeammates,
      ultracode: Boolean(thread.busy && ultracodeFromSelection(thread.modelSelection)),
    };
  };
  return (
    <ThreadTree ownerId={bot.id} ownerName={bot.name} owner="bot" folderOwner={bot} openThreadId={bot.threadId} tasks={tasks} projects={bot.projects ?? []}
      selected={selected} density={density} query={query} hidden={hidden} actions={actions} rowState={rowState} activeActivityLabel={activeActivityLabel}
      onNew={(projectId) => dispatch({ type: "newTask", botId: bot.id, ...(projectId ? { projectId } : {}) })}
      onNewKind={{ choices: newThreadChoices(confidentialByDefault), create: (confidential) => dispatch({ type: "newTask", botId: bot.id, confidential }) }}
      onNewInFolder={canChooseFolder && advanced ? () => setFolderDialog(true) : undefined}
      onReorder={(projectIds, onSaved, onError) => dispatch({ type: "reorderProjects", botId: bot.id, projectIds, onSaved, onError })}
      canMarkRead={(projectId) => folderUnreadThreadIds(bot, projectId).length > 0}
      markRead={(projectId) => markFolderRead(bot, projectId, api, (updated) => dispatch({ type: "botPatched", bot: updated }))}>
      {folderDialog && <NewTaskFolderDialog bot={bot} onClose={() => setFolderDialog(false)} onReturnFocus={() => {
        document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(bot.id)}"]`)?.focus();
      }} />}
      <FullAccessWarning
        open={permissionRefresh?.kind === "full"}
        scope="thread"
        onCancel={() => setPermissionRefresh(null)}
        onConfirm={() => {
          const threadId = permissionRefresh?.threadId;
          setPermissionRefresh(null);
          if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId });
        }}
      />
      <LocalComputerAutoWarning
        open={permissionRefresh?.kind === "local-auto"}
        onCancel={() => setPermissionRefresh(null)}
        onConfirm={() => {
          const threadId = permissionRefresh?.threadId;
          setPermissionRefresh(null);
          if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId, acknowledgeLocalAuto: true });
        }}
      />
    </ThreadTree>
  );
}

/** The thread tree under a person's row: a conversation with a person has
 * threads like a bot (server/people/people-dms.ts), with the same rows, menus and
 * folders. No generated title (it would send the pair's words to a model)
 * and no approval refresh (no bot). */
export function PersonThreadList({ group, name, selected, density = "comfortable", query = "", hidden = false }: {
  group: Group;
  /** The person, as their row reads. */
  name: string;
  selected: boolean; density?: SidebarDensity; query?: string; hidden?: boolean;
}) {
  const dispatch = useStoreDispatch();

  const tasks = personPickerThreads(group);
  const latest = useRef(group);
  latest.current = group;
  const groupId = group.id;
  const actions = useMemo(() => {
    type Row = { threadId: string };
    const patch = (task: Row, change: GroupTaskUpdatePatch) => dispatch({ type: "updateGroupTask", groupId, threadId: task.threadId, patch: change });
    return {
      onSelect: (task: Row) => navigate(() => { if (task.threadId !== latest.current.threadId) dispatch({ type: "switchGroupTask", groupId, threadId: task.threadId }); else dispatch({ type: "select", id: groupId }); }),
      onRename: (task: Row, title: string) => dispatch({ type: "renameGroupTask", groupId, threadId: task.threadId, title }),
      onDelete: (task: Row) => dispatch({ type: "deleteGroupTask", groupId, threadId: task.threadId }),
      onMove: (task: Row, projectId: string | null) => patch(task, { projectId }),
      onArchive: (task: Row, archivedAt: number | null) => patch(task, { archivedAt }),
      onPin: (task: Row, pinned: boolean) => patch(task, { pinned }),
      onSnooze: (task: Row, snoozedUntil: number | null) => patch(task, { snoozedUntil }),
    };
  }, [groupId, dispatch]);
  return (
    <ThreadTree ownerId={group.id} ownerName={name} owner="group" folderOwner={group} openThreadId={group.threadId} tasks={tasks} projects={group.projects ?? []}
      selected={selected} density={density} query={query} hidden={hidden} actions={actions}
      onNew={(projectId) => dispatch({ type: "newGroupTask", groupId: group.id, ...(projectId ? { projectId } : {}) })}
      onReorder={(projectIds, onSaved, onError) => dispatch({ type: "reorderProjects", botId: group.id, owner: "group", projectIds, onSaved, onError })}
      canMarkRead={(projectId) => folderUnreadThreadIds(group, projectId).length > 0}
      markRead={(projectId) => markGroupFolderRead(group, projectId, api, (updated) => dispatch({ type: "groupPatched", group: updated }))} />
  );
}

export function BotListItem({
  bot,
  density,
  quiet = false,
  onMenu,
  startRename = false,
  onRenameStarted,
  selection,
  query = "",
}: {
  bot: Bot;
  density: SidebarDensity;
  /** Multi-select: while `active`, a click toggles the row instead of opening it. */
  selection?: { active: boolean; selected: boolean; onToggle: () => void };
  query?: string;
  /** Quiet rows: name and status only (see sidebar-preferences). */
  quiet?: boolean;
  onMenu: (menu: MenuState) => void;
  startRename?: boolean;
  onRenameStarted?: () => void;
}) {
  const dispatch = useStoreDispatch();
  const config = useStoreSelector((current) => current.config);
  const selected = useStoreSelector((current) => current.activeView === "chat" && current.selectedId === bot.id);
  const deleting = useStoreSelector((current) => current.deletingBots[bot.id] === true);
  const mascotMotion = useStoreSelector((current) => selected && current.mascotMotion?.botId === bot.id ? current.mascotMotion : null);
  const pendingQueued = useStoreSelector((current) => Object.fromEntries([bot.threadId, ...(bot.tasks ?? []).map((task) => task.threadId)].map((id) => [id, current.pendingQueued[id]])), shallowEqual);
  const instances = useStoreSelector((current) => current.instances.filter((instance) => instance.instanceId === bot.modelSelection.instanceId), shallowEqual);
  const showThreads = useShowThreads();
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const [renaming, setRenaming] = useState(false);
  // Settings > Conversation threads (useThreadsMode), one reader for the
  // row: "sidebar" folds the bot open on its threads (a chevron, the choice
  // remembered per bot); "header" and "one" draw one line per bot, nothing
  // under it and no chevron.
  const threadsMode = useThreadsMode();
  const iconOnly = density === "icons";
  const comfortable = density === "comfortable";
  useEffect(() => {
    if (iconOnly) setRenaming(false);
  }, [iconOnly]);
  // Grok Bot's row (comfortable): 54px tall, 8px padding, 10px corners, a
  // 36px portrait 8px from the name. Compact and the rail keep theirs.
  const avatarSize = iconOnly ? 36 : density === "compact" ? 28 : 36;
  // the visible branch, so a version switch changes the row with the chat
  const visible = useVisibleMessages(bot);
  // The role (Bot settings > Title) is the pill beside the name, as Grok
  // Bot draws it ("Service Desk Ops").
  const title = bot.title.trim();
  const inSidebar = threadsMode === "sidebar" && !iconOnly;
  const [threadsOpen, setThreadsOpen] = useSearchDisclosure(`bot:${bot.id}`, inSidebar ? query : "", searchMatchesThreads(query, bot.tasks, bot.projects), true);
  const threadsListed = inSidebar && threadsOpen;
  const rowClass = cn(
    "flex items-center text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/60",
    iconOnly
      // Grok Bot's rail: a 54px square, 9px around the 36px portrait
      ? "mx-auto h-[54px] w-[54px] shrink-0 justify-center rounded-[10px] p-[9px]"
      : cn("w-full", comfortable
        ? "h-[54px] gap-2 rounded-[10px] py-2 pl-2 pr-2"
        : "gap-2 rounded-lg py-1.5 pl-2 pr-9",
        // room for the chevron, at the inset a room's row has there
        inSidebar && "pl-6"),
    // room for New thread and the "..." while they show (hover, focus, touch)
    !iconOnly && !selection?.active && "group-hover:pr-[64px] group-focus-within:pr-[64px] max-md:pr-[64px] touch:pr-[64px]",
    // room for the selection check
    !iconOnly && selection?.active && "pr-9",
    // The Primary Bot is called out by the star on its avatar, not by
    // tinting the whole row.
    // folded open on its threads, the thread on screen carries the one
    // highlight (BotThreadList), as a room's does
    (selected && !threadsListed) || selection?.selected ? "bg-sidebar-selected" : "hover:bg-sidebar-hover",
  );
  const activityTasks = sidebarBotActivityTasks(bot, pendingQueued);
  const waiting = bot.activity === "waiting-on-you" || activityTasks.some((task) => task.activity === "waiting-on-you");
  // Real work in a sibling still outranks an idle coordination wait.
  const working = !waiting && (Boolean(bot.busy) || activityTasks.some((task) => task.busy || task.activity === "working"));
  // A routine run is shown in Automations, not in the sidebar: while the bot's
  // open thread is only a run's thread, its work keeps the mascot dot but
  // leaves the row's status line alone.
  const routineOnlyWork = working && Boolean(bot.tasks?.some((task) => task.threadId === bot.threadId && task.routineRunId))
    && !activityTasks.some((task) => task.busy || task.activity === "working");
  const lineWorking = working && !routineOnlyWork;
  const teammateWait = !waiting && !working && (Boolean(bot.waitingForTeammates) || activityTasks.some((task) => Boolean(task.waitingForTeammates)));
  const queued = activityTasks.some((task) => task.queued);
  const unread = botShowsUnread(bot);
  // quiet rows drop the last-message preview but keep a line that reports
  // something happening now; an idle bot is just its name
  const statusLine = deleting || lineWorking || waiting || teammateWait || queued;
  // The viewer's own Primary Bot wears the orange star at the avatar's
  // bottom-right corner; a status dot then sits at the top-right instead.
  const primary = isViewersPrimaryBot(bot, orgViewerId({ config }));
  // A bot shared with the viewer wears its sharer's face at the bottom-right
  // (as in Browse Bots), so the status dot moves up, like beside the star.
  const sharer = botSharer(bot, orgViewerId({ config }), useOrgPeople());
  const dotCorner = primary || sharer ? "-top-0.5" : "-bottom-0.5";
  // Grok Bot marks an unread bot with a blue dot at the row's end, the name
  // keeps its weight.
  const trailingDot = !iconOnly && unread && !renaming && !deleting && !selection?.active;
  const body = (
    <>
      {/* flex, not inline: an inline wrapper adds a baseline gap under the
          avatar and makes the row taller than before the presence dot. */}
      <span data-sidebar-row-avatar className="relative flex shrink-0" title={iconOnly ? undefined : [bot.name, title].filter(Boolean).join(" · ")}>
        <SidebarMascotAvatar
          botId={bot.id}
          bot={bot}
          primary={primary}
          primaryRingClassName="ring-sidebar"
          state={stateForBot({ ...bot, messages: visible })}
          size={avatarSize}
          motion={mascotMotion?.kind ?? "none"}
          motionKey={mascotMotion?.nonce ?? 0}
          animated={mascotRowAnimated(bot, pendingQueued, mascotMotion?.kind)}
        />
        {/* status dot (StatusDot, the same one a person's presence wears):
            green while the bot is working, ringed in the row's ground so it
            reads on both a photo and the mascot. Also the only activity
            signal in icons-only density, where the text is hidden. */}
        {working && <StatusDot tone="success" testId="working-dot" className={cn("absolute -right-0.5", dotCorner)} sizeClassName={iconOnly ? "size-3" : "size-2.5"} />}
        {waiting && <StatusDot tone="warning" testId="waiting-dot" role="status" label={t("sidebar.preview.waiting")} className={cn("absolute -right-0.5", dotCorner)} sizeClassName={iconOnly ? "size-3" : "size-2.5"} />}
        {sharer && !primary && <SidebarSharerBadge sharer={sharer} avatarSize={avatarSize} />}
        {teammateWait && <StatusDot tone="accent" testId="teammate-wait-dot" role="status" label={t("sidebar.preview.waitingOnTeammate")} className={cn("absolute -right-0.5", dotCorner)} sizeClassName={iconOnly ? "size-3" : "size-2.5"} />}
        {!teammateWait && !waiting && !working && queued && <StatusDot tone="queued" testId="queued-dot" role="status" label={t("task.queued")} className={cn("absolute -right-0.5", dotCorner)} sizeClassName={iconOnly ? "size-3" : "size-2.5"} />}
      </span>
      <div data-sidebar-row-name className={cn("flex min-w-0 flex-1 flex-col", iconOnly && "hidden", trailingDot && "mr-4 group-hover:mr-0 group-focus-within:mr-0 max-md:mr-0 touch:mr-0")}>
        <div data-sidebar-bot-title className="flex min-w-0 items-center gap-1.5">
          <span className="flex min-w-0 shrink items-center gap-1 text-[14px] font-medium leading-5 text-sidebar-ink">
            {bot.pinned && <Pin size={12} className="shrink-0 text-sidebar-ink-secondary" />}
            <RenameTitle
              key={iconOnly ? "icons" : "expanded"}
              value={bot.name}
              onCommit={(name) => {
                if (remoteClient) {
                  void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                    .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                    .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
                } else {
                  dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
                }
              }}
              onEditingChange={(editing) => {
                setRenaming(editing);
                if (!editing) onRenameStarted?.();
              }}
              forceEditing={startRename}
              className="min-w-0 truncate"
              inputClassName="w-full rounded bg-inset px-1 py-0.5 text-[14px] font-medium"
            />
          </span>
          {title && !renaming && <BotRoleTag text={title} />}
          {unread && <span className="sr-only">{t("task.unreadMany")}</span>}
        </div>
        {(!quiet || statusLine) && <div className="flex min-h-[18px] min-w-0 items-center gap-1">
          {deleting ? (
            <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-sidebar-ink-secondary">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              {t("sidebar.bot.deletingRow")}
            </span>
          ) : (
            <span className="flex min-h-[18px] min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-sidebar-ink-secondary">
              {lineWorking ? (
                // the same typing dots as the chat header; sized to the text's
                // line box so the row does not jump when work starts or ends
                <span className="flex h-[18px] items-center" role="status">
                  <WorkingDots size={3.5} />
                  <span className="sr-only">{t("sidebar.preview.working")}</span>
                </span>
              ) : (
                <span dir="auto" className="truncate">{waiting ? t("sidebar.preview.waiting") : teammateWait ? t("sidebar.preview.waitingOnTeammate") : queued ? t("task.queued") : preview(routineOnlyWork ? { ...bot, busy: false } : bot, visible, instances)}</span>
              )}
            </span>
          )}
        </div>}
      </div>
    </>
  );
  const onContextMenu = (event: React.MouseEvent) => {
    openBotContextMenu(onMenu, bot.id, event);
  };
  // Threads off: an untouched extra thread never strands the person; the row
  // lands back on their latest conversation (see thread-home.ts).
  // With threads hidden a server that names the bot's main thread decides
  // (openBot, server/threads/main-thread.ts); an older one without it keeps that rule.
  const openConversation = () => navigate(() => {
    if (showThreads || bot.mainThreadId) openBot(dispatch, bot, showThreads);
    else for (const action of openBotConversationActions(bot, showThreads)) dispatch(action);
  });
  const onSelect = (event: React.MouseEvent) => {
    if (renaming) return;
    // Cmd/Ctrl-click starts a selection; once one is open, a click joins it.
    if (selection && (selection.active || event.metaKey || event.ctrlKey || event.shiftKey)) {
      event.preventDefault();
      selection.onToggle();
      return;
    }
    const insideRenameInput = event.target instanceof HTMLInputElement;
    if (botListItemPointerIntent(event.type, insideRenameInput) === "select") openConversation();
  };

  const row = (
    <div className="group relative" title={iconOnly ? [bot.name, bot.title?.trim()].filter(Boolean).join(" · ") : undefined}>
      {/* Keep this wrapper mounted while RenameTitle swaps its label for an
          input. Replacing the wrapper tree remounts RenameTitle, loses its
          editing state, and leaves the row stuck in rename mode. Omitting
          role=button also keeps the input visible to assistive technology. */}
      <div
        role={renaming ? undefined : "button"}
        tabIndex={renaming ? undefined : 0}
        aria-label={
          !renaming && iconOnly
            ? deleting
              ? t("sidebar.bot.deletingAria", { name: bot.name })
              : `${bot.name}${waiting ? ` · ${t("sidebar.preview.waiting")}` : working ? ` · ${t("chat.activity.working")}` : teammateWait ? ` · ${t("sidebar.preview.waitingOnTeammate")}` : queued ? ` · ${t("task.queued")}` : ""}${unread ? ` · ${t("task.unread")}` : ""}`
            : undefined
        }
        aria-busy={deleting || undefined}
        aria-current={selected && !threadsListed && !renaming && !selection?.active ? "page" : undefined}
        aria-pressed={selection?.active ? selection.selected : undefined}
        data-sidebar-bot-row={bot.id}
        data-sidebar-unread={unread ? "" : undefined}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selection?.active) { selection.onToggle(); return; }
            openConversation();
          }
        }}
        onContextMenu={onContextMenu}
        className={rowClass}
      >
        {body}
      </div>
      {trailingDot && (
        <span data-sidebar-unread-dot aria-hidden="true" className="absolute right-2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-unread pointer-events-none transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 max-md:opacity-0 touch:opacity-0" />
      )}
      {selection?.active && !renaming && (
        <span data-sidebar-select-mark aria-hidden="true" className={cn("pointer-events-none absolute top-1/2 flex size-[18px] -translate-y-1/2 items-center justify-center rounded-full border", iconOnly ? "right-1 top-3" : "right-3", selection.selected ? "border-accent bg-accent text-accent-ink" : "border-sidebar-ink-secondary/60")}>
          {selection.selected && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      {!renaming && iconOnly && unread && (
        <span data-sidebar-unread-icon className={cn("pointer-events-none absolute size-2 rounded-full border border-sidebar bg-unread", iconUnreadDotPosition(Boolean(primary || sharer)))} />
      )}
      {!renaming && !deleting && !iconOnly && !selection?.active && <>
        {/* direct New thread, beside the "..." (2026-10-15) */}
        {showThreads && <button type="button" data-sidebar-bot-new-thread={bot.id} aria-label={t("task.newShort")} title={t("task.newShort")}
          onClick={() => { if (inSidebar) setThreadsOpen(true); dispatch({ type: "newTask", botId: bot.id }); }}
          className="pointer-events-none absolute right-8 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-sidebar-ink-secondary opacity-0 hover:bg-sidebar-hover hover:text-sidebar-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70"><Plus size={14} /></button>}
        <button type="button" aria-label={t("sidebar.bot.actions", { name: bot.name })} title={t("sidebar.bot.actions", { name: bot.name })} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ botId: bot.id, x: rect.left, y: rect.bottom }); }}
          className="pointer-events-none absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-sidebar-ink-secondary opacity-0 hover:bg-sidebar-hover hover:text-sidebar-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70"><MoreHorizontal size={15} /></button>
      </>}
      {deleting && iconOnly && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-card p-1 text-ink-secondary">
          <Loader2 size={12} className="animate-spin" />
        </span>
      )}
      {inSidebar && !renaming && <button type="button" data-sidebar-bot-threads-toggle={bot.id}
        aria-label={t(threadsOpen ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })} aria-expanded={threadsOpen}
        onClick={() => setThreadsOpen((open) => !open)}
        className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-ink-secondary outline-none hover:text-sidebar-ink focus-visible:ring-1 focus-visible:ring-accent/60">
        <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform", threadsOpen && "rotate-90")} />
      </button>}
    </div>
  );

  // "sidebar": the bot's threads under its row while it is open, the one on
  // screen highlighted. "header" and "one": nothing under the row, of any
  // kind; an unread thread adds to the row's count (botUnreadCount).
  if (!threadsListed) return row;
  return <>
    {row}
    <div className={threadListIndent(density)}>
      <BotThreadList bot={bot} selected={selected} density={density} query={bot.name.toLowerCase().includes(query.toLowerCase()) ? "" : query} />
    </div>
  </>;
}

const MemoBotListItem = memo(BotListItem, sameSidebarRow);

export function ArchivedBotRow({
  bot,
  restoring,
  deleting,
  disabled,
  showRestore = true,
  showDelete = true,
  onRestore,
  onDelete,
}: {
  bot: Bot;
  restoring: boolean;
  deleting: boolean;
  disabled: boolean;
  /** Absent when archive is refused for this person. */
  showRestore?: boolean;
  /** Absent when delete is refused for this person. */
  showDelete?: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex min-h-[82px] items-center gap-3 border-b border-hairline/35 px-1 py-3">
      <SidebarMascotAvatar botId={bot.id} bot={bot} state="happy" size={42} animated={false} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink">{bot.name}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-ink-secondary">{bot.title || t("sidebar.archived.botFallback")}</div>
      </div>
      {(showRestore || showDelete) && <div className="flex shrink-0 items-center gap-1.5">
        {showRestore && <button
          onClick={onRestore}
          disabled={disabled || deleting}
          className="flex min-w-[78px] items-center justify-center gap-1.5 rounded-full bg-raised px-3.5 py-2 text-[12.5px] text-ink hover:bg-raised-hover disabled:opacity-40"
        >
          {restoring && <Loader2 size={13} className="animate-spin" />}
          {t("sidebar.archived.restore")}
        </button>}
        {showDelete && <button
          type="button"
          onClick={onDelete}
          disabled={disabled || deleting}
          aria-label={t("sidebar.archived.deleteAria", { name: bot.name })}
          className="flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-40"
        >
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          {t("common.delete")}
        </button>}
      </div>}
    </div>
  );
}

export function ArchivedBotsPanel({
  bots,
  onClose,
  onRestored,
}: {
  bots: Bot[];
  onClose: () => void;
  onRestored: (message: string) => void;
}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    config: current.config,
    deletingBots: current.deletingBots,
  }), shallowEqual);
  const showThreads = useShowThreads();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoringAll, setRestoringAll] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Bot | "all" | null>(null);
  const [error, setError] = useState("");
  const deleting = bots.some((bot) => Boolean(state.deletingBots[bot.id]));
  const locked = restoringAll || Boolean(busyId) || deleting || Boolean(pendingDelete);
  const allowRestore = (bot: Bot) => showBotArchive(state.config, bot);
  const allowDelete = (bot: Bot) => showBotDelete(state.config, bot);

  useEffect(() => {
    if (bots.length === 0) onClose();
  }, [bots.length, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [locked, onClose]);

  const restore = async (bot: Bot) => {
    setBusyId(bot.id);
    setError("");
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      onRestored(t("sidebar.archived.restored", { name: bot.name }));
      if (bots.length === 1) onClose();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const restoreAll = async () => {
    setRestoringAll(true);
    setError("");
    try {
      const responses = await Promise.all(
        bots.map((bot) =>
          api(`/api/bots/${bot.id}`, {
            method: "PATCH",
            body: JSON.stringify({ hidden: false }),
          }),
        ),
      );
      for (const response of responses) dispatch({ type: "botPatched", bot: response.bot });
      const first = responses[0]?.bot;
      if (first) openBot(dispatch, first, showThreads);
      onRestored(
        bots.length === 1
          ? t("sidebar.archived.restoredOne")
          : t("sidebar.archived.restoredMany", { count: bots.length }),
      );
      onClose();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setRestoringAll(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && !locked && onClose()}
      data-archived-bots-backdrop=""
    >
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      data-archived-bots-panel=""
      aria-labelledby="archived-bots-title"
      tabIndex={-1}
      className="animate-pop-in flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[760px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated outline-none"
    >
      <header className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-8 sm:pt-7">
        <div>
          <h2 id="archived-bots-title" className="text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{t("sidebar.archived.title")}</h2>
          <p className="mt-1 text-[13px] text-ink-secondary">{t("sidebar.archived.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1">
          {bots.length > 1 && bots.every(allowRestore) && (
            <button
              onClick={() => void restoreAll()}
              disabled={locked}
              className="ui-button gap-1.5 disabled:opacity-40"
            >
              {restoringAll && <Loader2 size={13} className="animate-spin" />}
              {t("sidebar.archived.restoreAll")}
            </button>
          )}
          {bots.length > 0 && bots.every(allowDelete) && (
            <button
              type="button"
              onClick={() => setPendingDelete("all")}
              disabled={locked}
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] text-danger hover:bg-danger/10 disabled:opacity-40"
            >
              <Trash2 size={13} />
              {t("sidebar.archived.deleteAll")}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={locked}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary disabled:opacity-40"
            aria-label={t("sidebar.archived.close")}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-3 sm:px-8">
        <div className="mb-3 text-[12px] font-medium text-ink-secondary">{t("sidebar.archived.count", { count: bots.length })}</div>
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          {bots.map((bot) => (
            <ArchivedBotRow
              key={bot.id}
              bot={bot}
              restoring={busyId === bot.id}
              deleting={Boolean(state.deletingBots[bot.id])}
              disabled={locked}
              showRestore={allowRestore(bot)}
              showDelete={allowDelete(bot)}
              onRestore={() => void restore(bot)}
              onDelete={() => setPendingDelete(bot)}
            />
          ))}
        </div>
        {error && <div role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        {...(pendingDelete === "all"
          ? archivedDeleteAllCopy()
          : botConfirmCopy("delete", pendingDelete?.name ?? ""))}
        icon={<Trash2 size={18} />}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          setPendingDelete(null);
          if (target === "all") {
            for (const bot of bots) dispatch({ type: "deleteBot", botId: bot.id });
            return;
          }
          dispatch({ type: "deleteBot", botId: target.id });
        }}
      />
    </div>
    </div>,
    document.body,
  );
}

/** A named team's context menu: add bots, rename, share the whole team,
 * delete. Exported for a markup test. */

export function Sidebar({ open, onClose, onCompose, composeOpen = false }: {
  open: boolean;
  onClose: () => void;
  /** Opens or closes the main-column To: picker. Navigation closes it too. */
  onCompose?: () => void;
  composeOpen?: boolean;
}) {
  const storeDispatch = useStoreDispatch();
  const state = useStoreSelector((current) => ({
    activeView: current.activeView,
    bots: current.bots,
    groups: current.groups,
    config: current.config,
    instances: current.instances,
    pendingQueued: current.pendingQueued,
    sections: current.sections,
    selectedId: current.selectedId,
  }), (a, b) => Object.is(a.activeView, b.activeView) && equalRows(a.bots, b.bots) && equalRows(a.groups, b.groups) && Object.is(a.config, b.config) && Object.is(a.instances, b.instances) && Object.is(a.pendingQueued, b.pendingQueued) && Object.is(a.sections, b.sections) && Object.is(a.selectedId, b.selectedId));
  const listFade = useScrollFade();
  const dispatch: typeof storeDispatch = (action) => {
    storeDispatch(action);
    if (composeOpen && COMPOSE_DISMISS.has(action.type)) onCompose?.();
  };
  const showThreads = useShowThreads();
  const showLogo = useShowSidebarLogo();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const { capabilities } = useDesktopCapabilities();
  const sidebarRef = useRef<HTMLElement>(null);
  const width = useSidebarWidth({ sidebarRef });
  const { density, viewport, autoRail, sidebarWidth, quietRows, setSidebarCollapsed } = width;
  const multi = useSidebarMultiSelect({ state, density });
  const unread = useSidebarUnreadPills({ listRef: listFade.ref, state, selecting: multi.selecting });
  const actions = useSidebarBotActions({ state, dispatch, showThreads, open, onClose, remoteClient });
  const sections = useSidebarSections({
    state,
    dispatch,
    remoteClient,
    sidebarRef,
    setTeamFeedback: actions.setTeamFeedback,
  });
  const roster = useSidebarRoster({
    state,
    layoutBots: sections.layoutBots,
    layoutGroups: sections.layoutGroups,
    layoutSections: sections.layoutSections,
    orgMode: sections.orgMode,
    sidebarHidden: sections.sidebarHidden,
    sectionOrder: sections.sectionOrder,
    remoteClient,
    onShowArchived: () => dispatch({ type: "showArchivedBots" }),
  });
  const dnd = useSidebarSectionDnD({
    density,
    q: roster.q,
    sectionIds: roster.sectionIds,
    sectionOrder: sections.sectionOrder,
    setSectionOrder: sections.setSectionOrder,
    collapsedSections: sections.collapsedSections,
    setCollapsedSections: sections.setCollapsedSections,
    assignSection: sections.assignSection,
  });

  const searchTitle = `${t("sidebar.search")} (${paletteShortcutLabel()})`;
  const macInset = capabilities.windowChrome === "mac-inset";
  const browser = capabilities.host.label === "Browser";
  // Search and New ride in the title bar when there is one and no brand row.
  const titleBarHead = (macInset || browser) && !showLogo;
  const { accountPlaces, archivedBots } = roster;

  return (
    <SidebarMascotProvider rootRef={sidebarRef}>
    <aside
      ref={sidebarRef}
      tabIndex={-1}
      aria-label={t("sidebar.aria")}
      data-native-view-overlay
      data-sidebar
      // drawer below 640px, the automatic rail up to 768px, the person's own
      // density above (src/lib/sidebar-preferences.ts)
      data-sidebar-layout={viewport === "phone" ? "drawer" : autoRail ? "auto-rail" : "own"}
      data-sidebar-density={density}
      style={density === "icons" ? { width: SIDEBAR_RAIL_WIDTH } : { width: sidebarWidth }}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r-[0.5px] border-hairline-weak bg-sidebar",
        // The width never transitions: it follows the pointer exactly, and a
        // snap (rail in or out) is drawn with transforms (animateSidebarSnap).
        // Below sm only (a phone): the sidebar leaves the flow and slides in
        // over the chat. From sm to md it stays in the flow as the automatic
        // rail. Scoped with max-sm: rather than cancelled with sm: on purpose — Tailwind
        // v4 emits the native `translate` property, and any value other than
        // `none` turns this element into a containing block for its `fixed`
        // descendants. Cancelling it with an `sm:` prefix still emits a value, which
        // silently reparents a fixed overlay on desktop.
        "max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:z-40",
        "max-sm:transition-transform max-sm:duration-200",
        open ? "max-sm:translate-x-0" : "max-sm:-translate-x-full",
      )}
    >
      {/* The head: the round search button that opens the command palette
          and the round New button (the edge collapses the sidebar, see the
          separator). With a title bar (macOS inset traffic lights, or the
          browser's stand-in dots) and no logo, they sit in the title bar's
          own 48px row, level with the lights, and the pinned tiles start
          right under (the owner's reference window). With the logo on
          (Settings > Appearance, off by default) or no title bar, the brand
          row holds them under the inset strip. The whole head is the
          window's drag handle on macOS and Windows, every control opted out. */}
      <div data-sidebar-head className="window-drag shrink-0">
        {(macInset || browser) && (density === "icons" || showLogo) && (
          <div className={cn("flex h-9 items-center", density === "icons" ? "justify-center" : "px-4")} aria-hidden={browser ? true : undefined}>
            {browser && (
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-[#28c840]" />
              </div>
            )}
          </div>
        )}
        {density === "icons" ? (
          <div className="flex flex-col items-center gap-2 px-2 pb-2 pt-1 window-no-drag">
            <button
              type="button"
              data-sidebar-search
              onClick={openCommandPalette}
              aria-label={t("sidebar.searchAria")}
              aria-keyshortcuts={isMacPlatform() ? "Meta+K" : "Control+K"}
              title={searchTitle}
              className={SIDEBAR_HEAD_BUTTON}
            >
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onCompose?.()}
              aria-expanded={composeOpen}
              aria-label={t("sidebar.new")}
              title={t("sidebar.new")}
              data-sidebar-new
              className={SIDEBAR_HEAD_BUTTON}
            >
              <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className={titleBarHead ? SIDEBAR_TITLE_ROW : SIDEBAR_HEAD_ROW} data-sidebar-title-row={titleBarHead ? "" : undefined}>
              {titleBarHead && browser && (
                <span className="flex items-center gap-2" aria-hidden="true">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                </span>
              )}
              {showLogo && (
                <span className="flex min-w-0 items-center gap-2 text-sidebar-ink" data-sidebar-brand>
                  <PulsatrixMark size={22} />
                  <span className="truncate text-[16px] font-semibold leading-5 tracking-[-0.01em]">{APP_NAME}</span>
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2 window-no-drag">
                <button
                  type="button"
                  data-sidebar-search
                  onClick={openCommandPalette}
                  aria-label={t("sidebar.searchAria")}
                  aria-keyshortcuts={isMacPlatform() ? "Meta+K" : "Control+K"}
                  title={searchTitle}
                  className={SIDEBAR_HEAD_BUTTON}
                >
                  <Search size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onCompose?.()}
                  aria-expanded={composeOpen}
                  aria-label={t("sidebar.new")}
                  title={t("sidebar.new")}
                  data-sidebar-new
                  className={SIDEBAR_HEAD_BUTTON}
                >
                  <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </span>
            </div>
          </>
        )}
      </div>

      <SidebarUnreadPillAbove density={density} count={unread.moreUnread.above} onJump={() => unread.jumpToUnread("above")} />
      {/* Bot list. GET /api/org 404 keeps this roster. */}
      <div ref={listFade.ref} onScroll={() => { listFade.onScroll(); unread.measureUnread(); }} style={listFade.style} className={cn("flex-1 overflow-y-auto overflow-x-hidden pb-6 pt-1", density === "icons" ? "px-2" : "pl-3 pr-[13px]")}
        data-sidebar-rail={density === "icons" ? "" : undefined}
        onKeyDown={density === "icons" ? moveRailFocus : undefined}
        onContextMenu={sections.orgMode ? (event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).dataset?.sidebarEmpty !== undefined) sections.openOrgMenu(event, null, null); } : undefined}>
        <SidebarPinnedGrid
          pinnedBots={roster.pinnedBots}
          density={density}
          state={state}
          viewerId={roster.viewerId}
          showThreads={showThreads}
          dispatch={dispatch}
          setMenu={actions.setMenu}
        />
        <SidebarSectionList
          density={density}
          quietRows={quietRows}
          q={roster.q}
          state={state}
          sectionIds={roster.sectionIds}
          teamMap={roster.teamMap}
          botChats={roster.botChats}
          peopleDms={roster.peopleDms}
          sectionedRooms={roster.sectionedRooms}
          unsectionedRooms={roster.unsectionedRooms}
          builtInBots={roster.builtInBots}
          matchingBots={roster.matchingBots}
          visibleGroups={roster.visibleGroups}
          loneGeneral={roster.loneGeneral}
          sectionCollapsed={dnd.sectionCollapsed}
          inTopGrid={roster.inTopGrid}
          renameBotId={actions.renameBotId}
          setRenameBotId={actions.setRenameBotId}
          setMenu={actions.setMenu}
          setRoomMenu={actions.setRoomMenu}
          selectionFor={multi.selectionFor}
          orgMode={sections.orgMode}
          remoteClient={remoteClient}
          sectionEdit={sections.sectionEdit}
          setSectionEdit={sections.setSectionEdit}
          renameOrgSection={sections.renameOrgSection}
          openOrgMenu={sections.openOrgMenu}
          teamMenuReturn={sections.teamMenuReturn}
          setTeamMenu={sections.setTeamMenu}
          drag={dnd}
          hiddenRows={hiddenSidebarRows(sections.sidebarHidden.items, { bots: state.bots, groups: state.groups, viewerId: roster.viewerId, people: sections.sidebarPeople })}
          renderBot={(props) => <MemoBotListItem {...props} />}
          renderGroup={(props) => <MemoGroupListItem {...props} />}
        />
      </div>
      <SidebarUnreadPillBelow density={density} count={unread.moreUnread.below} onJump={() => unread.jumpToUnread("below")} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {dnd.reorderAnnouncement}
      </p>
      <SidebarMultiSelectBar
        selecting={multi.selecting}
        density={density}
        state={state}
        selectedBotIds={multi.selectedBotIds}
        personal={sections.personal}
        clearSelection={multi.clearSelection}
        setBatchEdit={multi.setBatchEdit}
        setBatchSectionPicker={multi.setBatchSectionPicker}
        setBatchArchiveConfirm={multi.setBatchArchiveConfirm}
        dispatch={dispatch}
      />

      {/* Footer. Collapsing keeps places and avatar at the same y; rail
          extras (archived, phone) sit above so they never push them. */}
      <div
        data-sidebar-foot
        data-tour="tools"
        className={cn(density === "icons" ? "px-2 pb-3 pt-1" : "px-4 pb-4")}
      >
        {density === "icons" && !remoteClient && archivedBots.length > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: "showArchivedBots" })}
            aria-label={t("sidebar.archived.title")}
            title={t("sidebar.archived.title")}
            className="flex h-9 w-full items-center justify-center rounded-lg px-2 text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink"
          >
            <Archive size={20} />          </button>
        )}
        {density === "icons" && !autoRail && (
          <button
            type="button"
            data-sidebar-compact-toggle
            aria-pressed="true"
            onClick={() => setSidebarCollapsed(false)}
            aria-label={t("sidebar.compact.toggle")}
            title={t("sidebar.compact.turnOff")}
            className="flex h-9 w-full items-center justify-center rounded-lg px-2 text-sidebar-ink-secondary outline-none hover:bg-sidebar-hover hover:text-sidebar-ink focus-visible:ring-1 focus-visible:ring-accent/60"
          >
            <ChevronsRight size={20} aria-hidden="true" />
          </button>
        )}
        {density === "icons" && (
          <SidebarPhoneButton
            density={density}
            onOpen={() => dispatch(phoneSettingsAction())}
          />
        )}
        {density === "icons" ? (
          <>
            {/* the wide foot's row, stacked: the avatar and the apps grid */}
            <SidebarRailFoot places={accountPlaces} onOpenApps={() => dispatch({ type: "togglePlugins", open: true })} />
          </>
        ) : (
          // The foot (reference design): the account pill, your avatar and
          // name (it opens the account menu, Browse bots included), 6px,
          // then the Connect apps button, then the update button while an
          // update downloads or waits. Both tiles take their height from
          // --foot-tile-h on the row (styles.css).
          <SidebarFoot places={accountPlaces} onOpenApps={() => dispatch({ type: "togglePlugins", open: true })} />
        )}
      </div>

      <BotContextMenu
          menu={actions.menu}
          onClose={() => actions.setMenu(null)}
          onArchive={actions.requestArchive}
          onDelete={(bot) => actions.setConfirm({ kind: "delete", bot })}
          onMoveToSection={(botId) => {
            if (!actions.menu) return;
            actions.setSectionPicker({ botId, x: actions.menu.x, y: actions.menu.y });
          }}
          onRename={(botId) => actions.setRenameBotId(botId)}
          onSelect={(botId) => { multi.setSelecting(true); multi.setSelectedBotIds((current) => current.includes(botId) ? current : [...current, botId]); }}
          // Edit bot opens the bot editor (2026-10-16: it did nothing
          // visible since the panel fallback lost its settings view)
          onEditPersona={(target) => dispatch({ type: "openPersonaEditor", botId: target.id })}
          onMakePrimary={(bot) => void actions.makePrimaryBot(bot.id)}
          onReplacePrimary={(bot) => actions.setPrimaryPicker({ currentId: bot.id, pending: false, error: null })}
        />
      <ConfirmDialog
        open={actions.confirm !== null}
        {...(actions.confirm ? botConfirmCopy(actions.confirm.kind, actions.confirm.bot.name) : botConfirmCopy("archive", ""))}
        icon={actions.confirm?.kind === "delete" ? <Trash2 size={18} /> : <Archive size={18} />}
        onCancel={actions.cancelConfirm}
        returnFocusRef={sidebarRef}
        onConfirm={() => {
          if (!actions.confirm) return;
          const { kind, bot } = actions.confirm;
          actions.setConfirm(null);
          if (kind === "archive") void actions.archiveBot(bot);
          else dispatch({ type: "deleteBot", botId: bot.id });
        }}
      />
      {actions.teamFeedback &&
        createPortal(
          <div
            role="status"
            className={cn(
              "fixed bottom-4 left-4 z-[60] flex max-w-[300px] items-center gap-2 rounded-[9px] bg-elevated px-3 py-[9px] text-[12.5px]",
              actions.teamFeedback.error ? "text-danger" : "text-ink",
            )}
          >
            <div className="flex items-center gap-2">
              <span>{actions.teamFeedback.text}</span>
              {actions.teamFeedback.restoreBot && (
                <button
                  onClick={() => void actions.undoBotArchive(actions.teamFeedback!.restoreBot!)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover"
                >
                  {t("common.undo")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      <SidebarOverlays
        state={state}
        dispatch={dispatch}
        sidebarRef={sidebarRef}
        remoteClient={remoteClient}
        actions={actions}
        sections={sections}
        multi={multi}
        dnd={dnd}
        roster={roster}
        roomMenuSlot={
          <RoomContextMenu
            menu={actions.roomMenu}
            onClose={() => actions.setRoomMenu(null)}
            onMoveToSection={(groupId) => {
              if (!actions.roomMenu) return;
              actions.setRoomSectionPicker({ groupId, x: actions.roomMenu.x, y: actions.roomMenu.y });
            }}
            onDelete={(groupId) => {
              sidebarRef.current?.focus();
              actions.setDeletingRoomId(groupId);
            }}
            onLeave={(groupId) => {
              sidebarRef.current?.focus();
              actions.setLeavingRoomId(groupId);
            }}
          />
        }
      />
      <SidebarResizeHandle
        autoRail={autoRail}
        density={density}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={width.setSidebarWidth}
        sidebarResizing={width.sidebarResizing}
        setSidebarResizing={width.setSidebarResizing}
        sidebarResize={width.sidebarResize}
        setSidebarCollapsed={setSidebarCollapsed}
        resizeSidebar={width.resizeSidebar}
      />
    </aside>
    </SidebarMascotProvider>
  );
}
