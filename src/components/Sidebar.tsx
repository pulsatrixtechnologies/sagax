import { approvalCardOutcome } from "./ApprovalCard";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { useThreadPrefetch, type ThreadPrefetchIntent } from "@/state/thread-prefetch";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BellDot,
  CheckCheck,
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
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  PictureInPicture2,
  UserRoundPen,
} from "lucide-react";
import { api, useStore, formatTime, visibleMessages, currentTaskBot, openBot, startNewTopic, type AppState, type Bot, type BotProject, type ConfigStatus, type FolderOwnerKind, type Group, type GroupTaskUpdatePatch, type InstanceInfo, type Message } from "@/state/store";

import { peerLine } from "@/lib/peer-message";
import { viewerMayDeleteGroup, viewerOwnsGroup } from "@/lib/group-owner";
import { canLeaveGroup } from "@/lib/group-leave";
import { LeaveGroupDialog } from "./LeaveGroupDialog";
import { otherAuthorName, viewerActorId, viewerIsOrgMember } from "@/lib/viewer";
import { showBotArchive, showBotDelete, showBotRename, showServerSectionMove } from "@/lib/bot-capabilities";
import { viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { BulkEditBotsDialog } from "./lazy-screens";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";
import { templatesEntryActions } from "@/lib/templates-entry";
import { useAdvancedMode } from "@/lib/interface-mode";

import { SidebarMascotAvatar, SidebarMascotProvider } from "./SidebarMascotAvatar";
import { stateForBot } from "@/lib/mascot";
import { mascotRowAnimated } from "@/lib/mascot-animate";
import { cn } from "@/lib/cn";
import { SIDEBAR_CIRCLE_BUTTON } from "@/lib/circle-button";
import { searchMatchesThreads, useSearchDisclosure } from "@/lib/search-disclosure";
import { useHeldMenuMotion } from "./MenuMotion";
import { animateSidebarSnap } from "@/lib/sidebar-motion";
import { navigate } from "@/lib/view-transitions";
import { scrollMotion } from "@/lib/motion";
import { lastNonReceipt } from "@/lib/receipts";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { activeLocale, t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { requestPrimaryBot } from "@/lib/bot-quick-actions";
import { PrimaryBotPicker } from "./PrimaryBotPicker";
import { useOrgPeople, usePerspicaxOrg } from "@/lib/perspicax-org";
import { peopleDmPeer } from "@/lib/people-dm";
import { BotRoleTag, PersonLabelTag } from "./LabelTag";
import { nudgeLineText } from "@/lib/nudge-line";
import { ChevronsRight, Eye, LogOut, UserRound } from "lucide-react";
import { entriesToUnhide, hiddenKey, hiddenKeySet, hideFromSidebar, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
import { closedDmToReopen, groupHiddenKey, hiddenSidebarRows, withoutHiddenEntries } from "@/lib/sidebar-hidden-entries";
import { PersonAvatar } from "./MessageAuthor";
import { SidebarSharerBadge } from "./SidebarSharerBadge";
import { botSharer } from "@/lib/bot-sharer";
import { presenceLabel, usePresence } from "@/lib/presence";
import { OrgSectionMenuItems, SectionNameInput, orgSectionMenuItems, type OrgSectionMenuActions } from "./OrgSectionMenu";
import {
  EMPTY_PERSONAL_SECTIONS,
  assignToPersonalSection,
  deletePersonalSection,
  editPersonalSections,
  itemKey,
  personalSectionNames,
  personalSectionOf,
  renamePersonalSection,
  seedPersonalSections,
  usePersonalSections,
  withPersonalSections,
  writePersonalSections,
  type PersonalSections,
  type SectionEditError,
  type SectionItemKind,
} from "@/lib/personal-sections";
import type { LocaleKey } from "@/locales";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkingDots } from "./WorkingIndicator";
import { ultracodeFromSelection } from "@/lib/ultracode-chrome";
import { StatusDot } from "./StatusDot";
import { nextRename } from "@/lib/rename";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { MIN_QUERY } from "./SearchResults";
import { openCommandPalette } from "./CommandPalette";
import { APP_NAME } from "@/lib/app-links";
import { isBotFloating, subscribeFloatingBots, toggleFloatingBot } from "@/lib/floating-bots";
import { isMacPlatform, SHORTCUT_GROUPS, shortcutKeysForPlatform } from "@/lib/keyboard-shortcuts";
import { ShareTeamDialog } from "./ShareTeamDialog";
import { TeamDialog } from "./TeamDialog";
import { RenameTitle } from "./RenameTitle";
import { BotProjectDialog, FolderActions, FolderIcon, navigateThreadMenu } from "./BotProjects";
import { NewTaskFolderDialog } from "./NewTaskFolderDialog";
import { newThreadChoices, type NewThreadChoice } from "@/lib/confidential-thread";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { draggedFolder, draggedThread, FOLDER_DRAG_TYPE, THREAD_DRAG_TYPE, moveFolder, placeFolder } from "@/lib/folder-order";
import { addBotCalendarDrag } from "@/lib/bot-drag";
import { SPLIT_DRAG_TYPE, splitDragData } from "@/lib/split-view";
import { folderUnreadThreadIds, markBotRead, markFolderRead, markGroupFolderRead } from "@/lib/folder-read";
import { personPickerThreads } from "@/lib/person-threads";
import { approvalModeFor, botApprovalSetting } from "../../shared/approval-mode";
import { liveActivityLabel } from "@/lib/live-activity";
import { FullAccessWarning } from "./FullAccessWarning";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { orderedThreadList, SidebarThreadRow, stampClock, threadRecency, useRelativeNow, useSnoozeExpiry, visibleSidebarThreads } from "./SidebarThreadRow";
import {
  loadCollapsedSections,
  loadSectionOrder,
  SIDEBAR_COLLAPSED_SECTIONS_KEY,
  SIDEBAR_SECTION_ORDER_KEY,
  saveCollapsedSections,
  saveSectionOrder,
  toggleCollapsedSection,
  toggleSidebarCollapsed,
  useSidebarDensity,
  useSidebarViewport,
  effectiveSidebarDensity,
  sidebarDragTarget,
  SIDEBAR_RAIL_WIDTH,
  type SidebarDensity,
} from "@/lib/sidebar-preferences";
import {
  BOT_CHATS_SECTION_ID,
  BOTS_SECTION_ID,
  BUILT_IN_SECTION_ID,
  CHANNELS_SECTION_ID,
  PEOPLE_SECTION_ID,
  PINNED_SECTION_ID,
  isBuiltInBot,
  isMyTeamSectionName,
  mergeSectionOrder,
  moveSection,
  orderedSidebarSections,
  partitionSidebarBots,
  partitionSidebarGroups,
  placeSection,
  sameSectionOrder,
  sidebarGoalRunPreview,
  sidebarLayoutInteractive,
  sidebarSectionCollapsed,
  sidebarSectionLabel,
  userSectionId,
  userSectionName,
  type SectionDropPlace,
} from "@/lib/sidebar-layout";
import { buildTeamMapSections } from "@/lib/team-map";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import { botListItemPointerIntent } from "@/lib/sidebar-selection";
import { useSidebarPeopleApart } from "@/lib/sidebar-people-apart-preference";
import { phoneSettingsAction, SidebarPhoneButton } from "./SidebarPhoneButton";
import { PulsatrixMark } from "./PulsatrixMark";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

import { SidebarFoot, SidebarRailFoot } from "./SidebarFoot";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { useShowThreads, useThreadsMode } from "@/lib/thread-preferences";
import { openBotConversationActions } from "./thread-home";
import { useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { botShowsUnread, iconUnreadDotPosition, isInterBotThread, offscreenUnread, toggleSelected } from "@/lib/bot-unread";
import { sidebarBotActivityTasks } from "./SidebarBotActivity";
import { citationPreviewText } from "@/lib/citations";
import { groupMemberBots } from "@/lib/group-members";
import { plainPreviewText } from "@/lib/plain-preview";
import { openSideThread } from "@/lib/side-thread";
import { moveRailFocus } from "@/lib/sidebar-rail";
import { isClientCancellation } from "../../shared/client-cancel";
import { readableError } from "@/lib/plain-error";




const GENERAL_SECTION_ID = "builtin:general";
/** A bot or a group dragged onto a section header or its rows. */
const ITEM_DRAG_TYPE = "application/x-sagax-sidebar-item";
const SIDEBAR_WIDTH_KEY = "omb-sidebar-width-v2";
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 400;
const SIDEBAR_DEFAULT_WIDTH = 280;
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

/** Fade the list's edges the way Grok Bot does: the top 28px once there is
 * something scrolled above, the bottom 48px while there is more below. The
 * mask is the only depth effect the dark sidebar has; there is no shadow. */
function useScrollFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure]);
  const mask = `linear-gradient(to bottom, ${edges.top ? "transparent 0, black 28px" : "black 0"}, ${edges.bottom ? "black calc(100% - 48px), transparent 100%" : "black 100%"})`;
  return { ref, onScroll: measure, style: { maskImage: mask, WebkitMaskImage: mask } as React.CSSProperties };
}

function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH) return stored;
  } catch { /* default width */ }
  return SIDEBAR_DEFAULT_WIDTH;
}

const SECTION_LABEL_KEYS: Record<string, LocaleKey> = {
  [PINNED_SECTION_ID]: "sidebar.section.pinned",
  [CHANNELS_SECTION_ID]: "sidebar.section.channels",
  [BOT_CHATS_SECTION_ID]: "sidebar.section.botChats",
  [BOTS_SECTION_ID]: "sidebar.section.bots",
  [PEOPLE_SECTION_ID]: "sidebar.section.people",
};

/** Bot-to-bot threads and People are automatic views, not folders to file into. */
function isAutomaticSidebarSection(id: string): boolean {
  return id === BOT_CHATS_SECTION_ID || id === PEOPLE_SECTION_ID;
}

/** The four built-in section names come from the catalog; a section someone
 * named themselves is their text and stays exactly as typed. */
function sectionLabel(id: string): string {
  if (id === GENERAL_SECTION_ID) return t("sidebar.section.general");
  if (id === BUILT_IN_SECTION_ID) return t("sidebar.section.builtIn");
  const name = userSectionName(id);
  if (name !== null && isMyTeamSectionName(name)) return t("sidebar.section.myTeam");
  const key = SECTION_LABEL_KEYS[id];
  return key ? t(key) : sidebarSectionLabel(id);
}

/** `visible` is the bot's visible branch (visibleMessages), which the row
 * already works out once per transcript. */
function preview(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  if (bot.activity === "waiting-on-you") return t("sidebar.preview.waiting");
  if (bot.waitingForTeammates) return t("sidebar.preview.waitingOnTeammate");
  if (bot.busy) return t("sidebar.preview.working");
  // the visible branch's tail — bot.messages holds every fork, so its last
  // entry can belong to a version the user switched away from — read past
  // the harness's receipts (digest, compaction) to the reply a person reads
  const last = lastNonReceipt(visible);
  if (!last) return "";
  // a settled approval card says what happened, as the card itself does;
  // its title is the question it asked, which nobody is waiting on now
  if (last.kind === "options" && last.card) {
    return (last.card.requestId && last.card.tool && !last.card.questionRequest && approvalCardOutcome(last.card)) || last.card.title;
  }
  // a failed turn reads as the chat row says it, never "error: …"
  if (last.kind === "activity" && last.tool) return activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  if (last.kind === "screen") return t("sidebar.preview.screenFrame");
  // one line of what the reply says, never the Markdown that draws it
  // (`**[repo](https://…)**` reads as "repo")
  const peer = peerLine(last);
  if (peer) return `${peer.name}: ${plainPreviewText(peer.body)}`;
  if (last.role !== "user" && isClientCancellation(last.text ?? "")) return t("chat.turnStopped");
  return plainPreviewText(citationPreviewText(last.text ?? ""));
}

export interface MenuState {
  botId: string;
  x: number;
  y: number;
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
  const { state, dispatch } = useStore();
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
  const { state, dispatch } = useStore();
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
export function roomDeleteCopy(group: Pick<Group, "name" | "dm">) {
  const isBotChat = Boolean(group.dm);
  return {
    title: t("sidebar.room.deleteConfirmTitle", { name: group.name }),
    body: isBotChat
      ? t("sidebar.room.deleteChatBody", { name: group.name })
      : t("sidebar.room.deleteChannelBody", { name: group.name }),
    confirmLabel: isBotChat ? t("sidebar.room.deleteChat") : t("sidebar.room.deleteChannel"),
    tone: "danger" as const,
  };
}

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
  const { state, dispatch } = useStore();
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

const COMPOSE_DISMISS = new Set([
  "select",
  "showTeamMap",
  "showRoutines",
  "showAchievements",
  "switchTask",
  "switchGroupTask",
  "newTask",
  "togglePlugins",
  "toggleAppSettings",
]);

/** The bot or group a sidebar drag carries, or null. */
export function parseItemDrag(raw: string): { kind: SectionItemKind; id: string } | null {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    if ((parsed.kind === "bot" || parsed.kind === "group") && typeof parsed.id === "string" && parsed.id) return { kind: parsed.kind, id: parsed.id };
  } catch {
    /* not ours */
  }
  return null;
}

/** On an organization server the sidebar's sections are the viewer's own
 * folders (src/lib/personal-sections.ts): they share nothing. Null on a
 * solo server, where the server's sections are the one person's. */
function usePersonalLayout(): PersonalSections | null {
  const org = usePerspicaxOrg() !== null;
  const stored = usePersonalSections();
  return org ? stored ?? EMPTY_PERSONAL_SECTIONS : null;
}

function sectionEditMessage(code: SectionEditError): string {
  if (code === "reserved") return t("sidebar.section.reserved");
  if (code === "exists") return t("sidebar.section.exists");
  if (code === "full") return t("sidebar.section.full");
  return t("sidebar.section.namePlaceholder");
}

/** Files a bot or a group in one of the viewer's own sections ("" puts it
 * back in Unassigned). An error text, or null. */
function assignPersonalSection(kind: SectionItemKind, id: string, name: string, known?: ReadonlySet<string>): string | null {
  const code = editPersonalSections((prefs) => assignToPersonalSection(prefs, itemKey(kind, id), name, known));
  return code ? sectionEditMessage(code) : null;
}

/** Move-to-section popover: existing sections as chips (checkmark on the
 * target's current one), a create field, and a remove action. Serves bots
 * and channels alike — the caller supplies the assignment. Mirrors the
 * context menu's fixed positioning + dismiss-on-outside-click contract. */
function SectionPicker({
  current,
  anchor,
  onClose,
  onAssign,
  names,
}: {
  /** the viewer's own sections (organization server); else the server's */
  names?: readonly string[] | undefined;
  /** the target's current section; undefined = none */
  current: string | undefined;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  /** "" clears — the server drops an empty section */
  onAssign: (section: string) => void;
}) {
  const { state } = useStore();
  const [name, setName] = useState("");
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const heldCurrent = useRef(current);
  if (anchor) heldCurrent.current = current;
  const trimmed = name.trim();

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-section-picker]")) onClose();
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
  }, [anchor, onClose]);

  // Hidden bots can carry a stale assignment; don't offer it as a context.
  // Channels and bots share one namespace, so Work or Personal can hold both.
  const sections = names ? [...names] : [
    ...new Set([
      ...(state.sections ?? []),
      ...state.bots.filter((b) => !b.hidden && b.section).map((b) => b.section!),
      ...state.groups.filter((g) => g.section).map((g) => g.section!),
    ]),
  ];

  const assign = (section: string) => {
    onAssign(section);
    onClose();
  };

  if (!motion.shown || !shown) return null;
  const sectionCurrent = heldCurrent.current;
  const top = Math.max(8, Math.min(shown.y, window.innerHeight - 300));
  const left = Math.min(shown.x, window.innerWidth - 260);

  return (
    <div
      data-section-picker
      style={{ top, left }}
      className={cn("fixed z-40 w-[236px] min-w-[200px] overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
    >
      <div className="px-2 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">
        {t("sidebar.section.moveToContext")}
      </div>
      {sections.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => assign(section)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px]",
                section === sectionCurrent ? "bg-selected text-ink" : "text-ink hover:bg-hover",
              )}
            >
              <span className="truncate">{section}</span>
              {section === sectionCurrent && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5 px-0.5 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed || trimmed.length > 60) return;
          assign(trimmed);
        }}
      >
        <input
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("sidebar.section.newContext")}
          aria-label={t("sidebar.section.newContextAria")}
          className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={!trimmed || trimmed.length > 60}
          className={cn(
            "shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
            trimmed ? "bg-accent text-accent-ink" : "bg-hover text-ink-secondary",
          )}
        >
          {t("common.add")}
        </button>
      </form>
      {sectionCurrent && (
        <>
          <div className="mx-2 my-1 h-[0.5px] bg-border" />
          <button
            onClick={() => assign("")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-danger hover:bg-hover"
          >
            <FolderMinus size={15} />
            {t("sidebar.section.removeFromContext")}
          </button>
        </>
      )}
    </div>
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
  const { state } = useStore();
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
  const { state, dispatch } = useStore();
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

export type BotConfirmKind = "archive" | "delete";

/** A confirmation may span live fleet updates; never authorize from its snapshot. */
export function currentArchivableBot(bots: readonly Bot[], id: string): Bot | undefined {
  const active = bots.filter((candidate) => !candidate.hidden);
  if (active.length <= 1) return undefined;
  return active.find((candidate) => candidate.id === id && !candidate.chiefOfStaff);
}

/** Copy for the archive / delete confirmation dialogs. Archiving keeps
 * everything and is reversible from Archived bots; deleting is not — the
 * server drops every task transcript, the workspace (files + memory), staged
 * skill state, and any private computer the bot owns. Shared team computers
 * remain. */
export function botConfirmCopy(kind: BotConfirmKind, name: string) {
  return kind === "archive"
    ? {
        title: t("sidebar.confirm.archiveTitle", { name }),
        body: t("sidebar.confirm.archiveBody", { name }),
        confirmLabel: t("sidebar.bot.archive"),
        tone: "neutral" as const,
      }
    : {
        title: t("sidebar.confirm.deleteTitle", { name }),
        body: t("sidebar.confirm.deleteBody", { name }),
        confirmLabel: t("common.delete"),
        tone: "danger" as const,
      };
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
  const revealThread = useStoreSelector((current) => current.revealThread);
  const now = useRelativeNow();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(projects.map((project) => project.id)));
  const [editingProject, setEditingProject] = useState<string | null>(null);
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
  const projectToEdit = projects.find((project) => project.id === editingProject);
  const projectIds = projects.map((project) => project.id);
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
      className={cn("mb-2 space-y-0.5", threadDrop === "out" && "rounded-md ring-1 ring-inset ring-accent/40")}>
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
            <button type="button" aria-label={t("folder.iconNamed", { name: project.name })} title={t("folder.iconNamed", { name: project.name })} onClick={() => setEditingProject(project.id)} className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-sidebar-hover"><FolderIcon emoji={project.emoji} size={14} /></button>
            <button type="button" data-sidebar-folder-label={project.id} draggable={!reordering} aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex min-h-8 min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 py-1 text-left text-[13px] font-semibold active:cursor-grabbing" title={project.name}>
              <span className="truncate">{project.name}</span>
              <span className="shrink-0 text-[10px] font-normal opacity-50">{projectTasks.length}</span>
              {!open && (waiting ? <span className="text-[10px] text-warning">{t("task.waiting")}</span> : working ? <Loader2 size={10} className="shrink-0 animate-spin text-success" /> : projectTasks.some((task) => task.unread) ? <span className="size-1.5 shrink-0 rounded-full bg-unread" aria-label={t("task.unreadMany")} /> : null)}
            </button>
            {/* New thread here is in the folder's "..." menu: one place, not a
                second hover button beside it. */}
            <FolderActions project={project} canMoveUp={index > 0} canMoveDown={index < projects.length - 1} canMarkRead={canMarkRead(project.id)} saving={reordering || markingRead}
              menu={folderMenu?.projectId === project.id ? folderMenu : null} onMenuChange={(menu) => setFolderMenu(menu ? { ...menu, projectId: project.id } : null)}
              onEdit={() => setEditingProject(project.id)} onMove={(direction, onSaved) => saveOrder(moveFolder(projectIds, project.id, direction), onSaved)}
              onMarkRead={(onSaved) => { void readFolder(project.id, onSaved); }}
              onNewThread={() => onNew(project.id)} />
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
      {creatingProject && <BotProjectDialog bot={folderOwner} owner={owner} onClose={() => setCreatingProject(false)} />}
      {projectToEdit && <BotProjectDialog bot={folderOwner} owner={owner} project={projectToEdit} onClose={() => setEditingProject(null)} />}
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
 * threads like a bot (server/people-dms.ts), with the same rows, menus and
 * folders. No generated title (it would send the pair's words to a model)
 * and no approval refresh (no bot). */
export function PersonThreadList({ group, name, selected, density = "comfortable", query = "", hidden = false }: {
  group: Group;
  /** The person, as their row reads. */
  name: string;
  selected: boolean; density?: SidebarDensity; query?: string; hidden?: boolean;
}) {
  const { dispatch } = useStore();
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
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const [renaming, setRenaming] = useState(false);
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  // Settings > Conversation threads (useThreadsMode), one reader for the
  // row: "sidebar" folds the bot open on its threads (a chevron, the choice
  // remembered per bot); "header" and "one" draw one line per bot, nothing
  // under it and no chevron.
  const threadsMode = useThreadsMode();
  const deleting = state.deletingBots[bot.id] === true;
  const mascotMotion = selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const pendingQueued = state.pendingQueued;
  const instances = state.instances;
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
  const primary = isViewersPrimaryBot(bot, orgViewerId(state));
  // A bot shared with the viewer wears its sharer's face at the bottom-right
  // (as in Browse Bots), so the status dot moves up, like beside the star.
  const sharer = botSharer(bot, orgViewerId(state), useOrgPeople());
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
          animated={mascotRowAnimated(bot, state.pendingQueued, mascotMotion?.kind)}
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
  // (openBot, server/main-thread.ts); an older one without it keeps that rule.
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
  const { state, dispatch } = useStore();
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
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
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
    </div>,
    document.body,
  );
}

/** A named team's context menu: add bots, rename, share the whole team,
 * delete. Exported for a markup test. */
export function TeamMenuItems({ onAddBots, onRename, onShare, onDelete }: {
  onAddBots: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";
  return (
    <>
      <button type="button" role="menuitem" autoFocus className={item} onClick={onAddBots}><Users size={14} />{t("team.addBots")}</button>
      <button type="button" role="menuitem" className={item} onClick={onRename}><Pencil size={14} />{t("team.rename")}</button>
      <button type="button" role="menuitem" className={item} onClick={onShare}><Share2 size={14} />{t("team.share")}</button>
      <button type="button" role="menuitem" className={cn(item, "text-danger")} onClick={onDelete}><Trash2 size={14} />{t("team.delete")}</button>
    </>
  );
}

function orgViewerId(state: AppState): string {
  // The server's principal for this viewer; older servers: the profile
  // email, else the same "local-owner" fallback as the server actor id.
  return viewerActorId(state.config);
}

function isExternalBot(bot: Bot, viewerId: string): boolean {
  const owner = bot.ownerUserId?.trim().toLowerCase();
  if (!owner || owner === "local-owner") return false;
  return owner !== viewerId.trim().toLowerCase();
}

/** The bots the sidebar lists. On a shared workspace a bot someone else
 * owns reaches you only through a room, so it stays out of the list. In an
 * organization the server lists only bots you may open (yours and the ones
 * shared with you), so all of them show; a shared bot filed in a section of
 * its owner that you do not see goes to Unassigned. */
export function sidebarListedBots(bots: Bot[], viewerId: string, orgMode: boolean, sections: readonly string[] = []): Bot[] {
  if (!orgMode) return bots.filter((bot) => !isExternalBot(bot, viewerId));
  return bots.map((bot) => (isExternalBot(bot, viewerId) && bot.section && !sections.includes(bot.section) ? { ...bot, section: undefined } : bot));
}

/** The "Hidden (N)" row at the foot of the list: closed by default; each
 * entry comes back with Show. */
function HiddenEntriesRow({ rows }: { rows: ReturnType<typeof hiddenSidebarRows> }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div data-sidebar-hidden className="mt-3 flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] font-medium text-sidebar-ink-secondary hover:text-sidebar-ink"
      >
        <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform", open && "rotate-90")} />
        <EyeOff aria-hidden="true" size={12} />
        {t("sidebar.hidden.title", { count: rows.length })}
      </button>
      {open && rows.map((row) => (
        <div key={row.key} data-sidebar-hidden-row={row.key} className="flex items-center gap-2 rounded-md py-1 pl-7 pr-1 text-[13px] text-sidebar-ink-secondary hover:bg-sidebar-hover">
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <button
            type="button"
            onClick={() => showInSidebar(row.key)}
            aria-label={t("sidebar.hidden.showNamed", { name: row.name })}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-sidebar-ink hover:bg-sidebar-selected"
          >
            <Eye aria-hidden="true" size={12} />
            {t("sidebar.hidden.show")}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({ open, onClose, onCompose, composeOpen = false }: {
  open: boolean;
  onClose: () => void;
  /** Opens or closes the main-column To: picker. Navigation closes it too. */
  onCompose?: () => void;
  composeOpen?: boolean;
}) {
  const store = useStore();
  const { state } = store;
  const listFade = useScrollFade();
  const dispatch: typeof store.dispatch = (action) => {
    store.dispatch(action);
    if (composeOpen && COMPOSE_DISMISS.has(action.type)) onCompose?.();
  };
  const showThreads = useShowThreads();
  const showLogo = useShowSidebarLogo();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const { capabilities } = useDesktopCapabilities();
  const sidebarRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renameBotId, setRenameBotId] = useState<string | null>(null);
  const [sectionPicker, setSectionPicker] = useState<MenuState | null>(null);
  // Multi-select (Cmd/Ctrl-click or "Select" in a row's menu): grouped actions
  // on bots. `selecting` stays on while the bar is open, even at zero.
  const [selecting, setSelecting] = useState(false);
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([]);
  const [batchEdit, setBatchEdit] = useState(false);
  const [batchSectionPicker, setBatchSectionPicker] = useState<MenuState | null>(null);
  const [batchArchiveConfirm, setBatchArchiveConfirm] = useState(false);
  // a member archives only the bots they own (showBotArchive)
  const archivableByViewer = (id: string) => {
    const bot = state.bots.find((candidate) => candidate.id === id);
    return Boolean(bot) && currentArchivableBot(state.bots, id) && showBotArchive(state.config, bot!);
  };
  const clearSelection = () => {
    setSelecting(false);
    setSelectedBotIds([]);
    setBatchSectionPicker(null);
  };
  // Unread bots scrolled out of the list: the "more unread" pills.
  const [moreUnread, setMoreUnread] = useState({ above: 0, below: 0 });
  const measureUnread = useCallback(() => {
    const list = listFade.ref.current;
    if (!list) return;
    const view = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")).map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, unread: row.hasAttribute("data-sidebar-unread") };
    });
    const { above, below } = offscreenUnread(rows, { top: view.top, bottom: view.bottom });
    setMoreUnread((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, [listFade.ref]);
  const jumpToUnread = (direction: "above" | "below") => {
    const list = listFade.ref.current;
    if (!list) return;
    const view = list.getBoundingClientRect();
    const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-sidebar-bot-row][data-sidebar-unread]"));
    const offscreen = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      const middle = (box.top + box.bottom) / 2;
      return direction === "above" ? middle < view.top : middle > view.bottom;
    });
    const target = direction === "above" ? offscreen[offscreen.length - 1] : offscreen[0];
    target?.scrollIntoView({ block: "center", behavior: scrollMotion() });
  };
  const selectionFor = (botId: string) => ({
    active: selecting,
    selected: selectedBotIds.includes(botId),
    onToggle: () => {
      setSelecting(true);
      setSelectedBotIds((current) => toggleSelected(current, botId));
    },
  });
  // The pills follow the list: bots changing, the window resizing, a row
  // opening or closing. Plain scrolling is measured by the list's onScroll.
  useLayoutEffect(() => {
    measureUnread();
    const list = listFade.ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureUnread);
    observer.observe(list);
    for (const child of Array.from(list.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measureUnread, state.bots, state.groups, selecting]);
  // The rail has no bar: leaving the wide sidebar ends the selection.
  useEffect(() => {
    if (density === "icons" && selecting) clearSelection();
  });
  // Escape leaves the selection (unless a menu or dialog already took it).
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
      if (event.key === "Escape" && !typing && !event.defaultPrevented && !document.querySelector("[role=dialog], [role=menu], [data-section-picker]")) clearSelection();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const [teamMenu, setTeamMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const teamMotion = useHeldMenuMotion(teamMenu);
  const teamMenuReturn = useRef<HTMLElement | null>(null);
  const closeTeamMenu = () => {
    (teamMenuReturn.current?.isConnected ? teamMenuReturn.current : sidebarRef.current)?.focus();
    setTeamMenu(null);
  };
  const renamedTeam = (oldName: string, newName: string) => {
    const replace = (ids: string[]) => [...new Set(ids.map(id => id === userSectionId(oldName) ? userSectionId(newName) : id))];
    setCollapsedSections(current => { const next = replace(current); saveCollapsedSections(next); return next; });
    setSectionOrder(current => { const next = replace(current); saveSectionOrder(next); return next; });
    requestAnimationFrame(() => {
      const header = [...(sidebarRef.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [])]
        .find(element => element.dataset.section === newName);
      (header?.querySelector<HTMLElement>("button") ?? header ?? sidebarRef.current)?.focus();
    });
  };
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [teamDeletePending, setTeamDeletePending] = useState(false);
  const teamDeleteRunning = useRef(false);
  const [moveToTeam, setMoveToTeam] = useState<string | null>(null);
  const [renameTeam, setRenameTeam] = useState<string | null>(null);
  const [shareTeam, setShareTeam] = useState<string | null>(null);
  // Slice 4: sections are channels on a server signed in with Perspicax.
  const perspicaxOrg = usePerspicaxOrg();
  const orgMode = perspicaxOrg !== null;
  const sidebarHidden = useSidebarHidden();
  const sidebarPeople = useOrgPeople();
  const peopleApart = useSidebarPeopleApart();
  // A new message brings a hidden entry back, per the person's setting
  // (people on, bots off by default; Settings > Appearance).
  useEffect(() => {
    if (!sidebarHidden.items.length) return;
    const me = orgViewerId(state);
    const keys = entriesToUnhide(sidebarHidden, {
      bots: state.bots,
      groups: state.groups,
      personGroup: (personId) => state.groups.find((group) => group.peopleDm && groupHiddenKey(group, me) === hiddenKey("person", personId)),
    });
    if (keys.length) showInSidebar(keys);
  }, [sidebarHidden, state.bots, state.groups, state.config]);
  // Selecting a closed direct conversation (person panel, To: picker,
  // search, a nudge) brings it back. Only a change of selection counts, so
  // closing the conversation that is open leaves it closed.
  useEffect(() => {
    if (state.activeView !== "chat" || !state.selectedId) return;
    const key = closedDmToReopen(state.groups.find((candidate) => candidate.id === state.selectedId), hiddenKeySet(sidebarHidden), orgViewerId(state));
    if (key) showInSidebar(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedId, state.activeView]);
  const [orgMenu, setOrgMenu] = useState<{ name: string | null; id: string | null; x: number; y: number } | null>(null);
  const [sectionEdit, setSectionEdit] = useState<{ mode: "rename"; name: string } | null>(null);
  // Organization: the viewer's own sections (personal-sections.ts). The
  // first time, they start from the sections the server gave their bots.
  const personalStored = usePersonalSections();
  const personal: PersonalSections | null = orgMode ? personalStored ?? EMPTY_PERSONAL_SECTIONS : null;
  const loaded = state.config !== null && state.config !== undefined;
  useEffect(() => {
    if (!orgMode || personalStored !== null || !loaded) return;
    if (!state.bots.length && !state.groups.length) return;
    writePersonalSections(seedPersonalSections({ bots: state.bots, groups: state.groups, sections: state.sections ?? [], viewerId: orgViewerId(state) }));
  }, [orgMode, personalStored, loaded, state.bots, state.groups, state.sections, state.config]);
  // What the sidebar lays out: on an organization server each bot and group
  // sits in the viewer's own section (undefined: Unassigned), whatever the
  // server's section field says.
  const personalView = personal ? withPersonalSections(state.bots, state.groups, personal) : null;
  const layoutBots = personalView?.bots ?? state.bots;
  const layoutGroups = personalView?.groups ?? state.groups;
  const layoutSections = personal ? personalSectionNames(personal) : state.sections ?? [];
  const knownItems = new Set([...state.bots.map((bot) => itemKey("bot", bot.id)), ...state.groups.map((group) => itemKey("group", group.id))]);
  const openOrgMenu = (event: React.MouseEvent<HTMLElement>, name: string | null, id: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    teamMenuReturn.current = event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget;
    // Shift+F10 and the ContextMenu key arrive with no pointer position.
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || rect.left + 16;
    const y = event.clientY || rect.bottom;
    setOrgMenu({ name, id, x: Math.max(8, Math.min(x, window.innerWidth - 230)), y: Math.max(8, Math.min(y, window.innerHeight - 280)) });
  };
  const closeOrgMenu = () => {
    (teamMenuReturn.current?.isConnected ? teamMenuReturn.current : sidebarRef.current)?.focus();
    setOrgMenu(null);
  };
  const renameOrgSection = async (oldName: string, name: string): Promise<string | null> => {
    const code = editPersonalSections((prefs) => renamePersonalSection(prefs, oldName, name));
    if (code) return sectionEditMessage(code);
    setSectionEdit(null);
    renamedTeam(oldName, name.trim());
    return null;
  };
  /** Files a bot or a group in a section ("" = Unassigned): the viewer's own on
   * an organization server, the server's otherwise. */
  const assignSection = (kind: SectionItemKind, id: string, section: string) => {
    if (personal) {
      const failed = assignPersonalSection(kind, id, section, knownItems);
      if (failed) setTeamFeedback({ error: true, text: failed });
      return;
    }
    if (kind === "group") {
      dispatch({ type: "patchGroup", groupId: id, patch: { section } });
      return;
    }
    if (!remoteClient) {
      dispatch({ type: "updateBot", botId: id, patch: { section } });
      return;
    }
    void api("/api/sidebar-sections", {
      method: "POST",
      body: JSON.stringify({ name: section, botIds: [id] }),
    })
      .then(({ bots }) => bots.forEach((bot: Bot) => dispatch({ type: "botPatched", bot })))
      .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
  };
  const [roomMenu, setRoomMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [roomSectionPicker, setRoomSectionPicker] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [leavingRoomId, setLeavingRoomId] = useState<string | null>(null);
  const deletingRoom = deletingRoomId ? state.groups.find((g) => g.id === deletingRoomId) : undefined;
  const [archivedBotsOpen, setArchivedBotsOpen] = useState(false);
  const [teamFeedback, setTeamFeedback] = useState<{
    error: boolean;
    text: string;
    restoreBot?: { id: string; name: string };
  } | null>(null);
  const searchTitle = `${t("sidebar.search")} (${paletteShortcutLabel()})`;
  // null on 404 and on any other failure, so the roster stays.
  // Chosen in Settings > Appearance or by dragging the edge; one store.
  // Between the phone drawer and 768px the window draws the rail instead
  // (Grok Bot's narrow window), without touching the person's choice.
  const savedDensity = useSidebarDensity();
  const viewport = useSidebarViewport();
  const autoRail = viewport === "medium";
  const density = effectiveSidebarDensity(savedDensity, viewport);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  // `collapsed` follows the drag itself: the density store answers a beat
  // later, and a second crossing in that beat must not toggle twice.
  const sidebarResize = useRef<{ x: number; width: number; current: number; collapsed: boolean } | null>(null);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  // The person's density as of the last toggle, ahead of the store's re-render.
  const densityNow = useRef(savedDensity);
  densityNow.current = savedDensity;
  const setSidebarCollapsed = (collapsed: boolean) => {
    // the automatic rail is the window's, not a choice to save
    if (autoRail) return;
    if ((densityNow.current === "icons") === collapsed) return;
    densityNow.current = toggleSidebarCollapsed();
  };
  // Rail in or out (the edge, its double-click, ⌘B, Settings): the width
  // changes at once and the snap is drawn with transforms for 200ms
  // (src/lib/sidebar-motion.ts), so the chat column is laid out once.
  // A window resized into or out of the automatic rail just lays out again.
  const railed = density === "icons";
  const wasRailed = useRef(railed);
  const wasViewport = useRef(viewport);
  useLayoutEffect(() => {
    const was = wasRailed.current;
    wasRailed.current = railed;
    const viewportChanged = wasViewport.current !== viewport;
    wasViewport.current = viewport;
    const aside = sidebarRef.current;
    if (was === railed || !aside || viewportChanged || viewport !== "wide") return;
    const follower = aside.parentElement?.querySelector<HTMLElement>(":scope > [data-sidebar-follower]") ?? null;
    return animateSidebarSnap(aside, follower, was ? SIDEBAR_RAIL_WIDTH : sidebarWidth, railed ? SIDEBAR_RAIL_WIDTH : sidebarWidth);
    // the width is read when the rail flips, not followed during a drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railed, viewport]);
  const resizeSidebar = (clientX: number) => {
    const from = sidebarResize.current;
    if (!from) return;
    const target = sidebarDragTarget(from.width + (clientX - from.x), { min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH });
    if (target.collapsed !== from.collapsed) setSidebarCollapsed(target.collapsed);
    if (target.collapsed) {
      sidebarResize.current = { ...from, collapsed: true };
      return;
    }
    sidebarResize.current = { ...from, current: target.width, collapsed: false };
    setSidebarWidth(target.width);
  };
  // Compact is the quiet sidebar: a row is its name and its status, nothing
  // else (see the `quiet` prop on BotListItem and GroupListItem).
  const quietRows = density === "compact";
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => loadCollapsedSections());
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => loadSectionOrder());
  // Folds and order follow the person (shared/user-preferences.ts): another
  // device's change arrives as a storage event for its key and shows here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SIDEBAR_COLLAPSED_SECTIONS_KEY) setCollapsedSections(loadCollapsedSections());
      if (event.key === null || event.key === SIDEBAR_SECTION_ORDER_KEY) setSectionOrder(loadSectionOrder());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: SectionDropPlace } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const sectionDragRef = useRef<{
    from: string | null;
    over: { id: string; place: SectionDropPlace } | null;
  }>({ from: null, over: null });

  // Esc closes the drawer, mirroring ApiKeys.tsx:75-85. Bound only while the
  // drawer is open — on mobile, exactly when a bot/room context menu or the
  // New Room panel can be open on top of it, so the same Escape press closes
  // them together. Fine, since both directions are "get me out of here."
  useEffect(() => {
    if (!open || confirm || deletingRoom) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirm, deletingRoom]);


  // An install link (openmaus://, a team's address) opens Browse Bots on
  // its Templates section, where Import previews it before anything is added.
  useEffect(() => {
    if (remoteClient) return;
    return window.ogb?.onPackageInstall?.((url) => {
      for (const action of templatesEntryActions("installLink", url)) dispatch(action);
    });
  }, [remoteClient, dispatch]);

  useEffect(() => {
    if (!teamFeedback) return;
    const timer = window.setTimeout(() => setTeamFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [teamFeedback]);

  // Archive and delete share one pending confirmation at a time.
  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async ({ id }: Pick<Bot, "id">) => {
    const bot = currentArchivableBot(state.bots, id);
    if (!bot) return;
    const activeBots = state.bots.filter((candidate) => !candidate.hidden);
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      if (state.selectedId === bot.id) {
        const next = activeBots.find((candidate) => candidate.id !== bot.id);
        if (next) openBot(dispatch, next, showThreads);
      }
      setTeamFeedback({
        error: false,
        text: t("sidebar.bot.archived", { name: bot.name }),
        restoreBot: { id: bot.id, name: bot.name },
      });
    } catch (cause) {
      setTeamFeedback({ error: true, text: readableError(cause) });
    }
  };

  // One Primary Bot per person: the server hands the role over from the
  // previous one (POST /api/bots/:id/primary) and sends both bots' frames.
  const [primaryPicker, setPrimaryPicker] = useState<{ currentId: string; pending: boolean; error: string | null } | null>(null);
  const makePrimaryBot = async (botId: string, fromPicker = false) => {
    if (fromPicker) setPrimaryPicker((open) => (open ? { ...open, pending: true, error: null } : open));
    try {
      const primary = await requestPrimaryBot(botId);
      dispatch({ type: "botPatched", bot: primary });
      setPrimaryPicker(null);
      setTeamFeedback({ error: false, text: t("primaryBot.made", { name: primary.name }) });
    } catch (cause) {
      const text = readableError(cause);
      if (fromPicker) setPrimaryPicker((open) => (open ? { ...open, pending: false, error: text } : open));
      else setTeamFeedback({ error: true, text });
    }
  };

  const undoBotArchive = async (bot: { id: string; name: string }) => {
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      setTeamFeedback({ error: false, text: t("sidebar.archived.restored", { name: bot.name }) });
    } catch (cause) {
      setTeamFeedback({ error: true, text: readableError(cause) });
    }
  };

  const macInset = capabilities.windowChrome === "mac-inset";
  const browser = capabilities.host.label === "Browser";
  // Search and New ride in the title bar's row when there is one and no
  // brand row asks for its own (see the head below).
  const titleBarHead = (macInset || browser) && !showLogo;
  // macOS owns inset traffic lights; Windows hides the native bar and draws
  // caption buttons over the header's right end. Either way this top row is
  // the window's drag handle (`.window-drag`, see styles.css).
  const q: string = "";

  const viewerId = orgViewerId(state);
  const hiddenEntries = hiddenKeySet(sidebarHidden);
  const sidebarShown = withoutHiddenEntries(layoutBots, layoutGroups, hiddenEntries, viewerId);
  const sidebarBots = sidebarListedBots(sidebarShown.bots, viewerId, orgMode, layoutSections);
  // The pin grid at the top: the viewer's Primary Bot first, always there
  // with its orange star and role (Grok Bot's head of the list), then the
  // pinned bots. A bot in the grid is not a row below.
  const inTopGrid = (bot: Bot) => Boolean(bot.pinned) || isViewersPrimaryBot(bot, viewerId);
  const pinnedBots = sidebarBots
    .filter((bot) => !bot.hidden && inTopGrid(bot))
    .sort((a, b) => Number(isViewersPrimaryBot(b, viewerId)) - Number(isViewersPrimaryBot(a, viewerId)));
  const matchingBots = sidebarBots
    .filter((b) => !b.hidden)
    .filter(
      (b) =>
        !q ||
        b.name.toLowerCase().includes(q) ||
        (b.title ?? "").toLowerCase().includes(q) ||
        preview(b, visibleMessages(b), state.instances).toLowerCase().includes(q) ||
        b.tasks?.some((task) => !task.routineRunId && task.title.toLowerCase().includes(q)) ||
        b.projects?.some((folder) => folder.name.toLowerCase().includes(q)),
    );
  // Built-in bots get their own section under the person's teams.
  const builtInBots = matchingBots.filter((bot) => isBuiltInBot(bot) && !inTopGrid(bot));
  const teamBots = matchingBots.filter((bot) => !isBuiltInBot(bot));
  const visibleGroups = sidebarShown.groups.filter((g) => !q || g.name.toLowerCase().includes(q) || g.tasks?.some((task) => task.title.toLowerCase().includes(q)));
  const {
    sectionChiefs,
    sectionedBots,
  } = partitionSidebarBots(teamBots);
  const { botChats, peopleDms, sectionedRooms, unsectionedRooms } = partitionSidebarGroups(visibleGroups, { peopleApart });

  // User sections keep first-appearance order. The saved layout keeps an
  // empty section's former slot so it returns there when content comes back.
  const sectionNames: string[] = layoutSections.filter((name) => !q || name.toLowerCase().includes(q.toLowerCase()));
  for (const bot of sectionedBots) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const bot of sectionChiefs) {
    if (!sectionNames.includes(bot.section!)) sectionNames.push(bot.section!);
  }
  for (const group of sectionedRooms) {
    if (!sectionNames.includes(group.section!)) sectionNames.push(group.section!);
  }
  const teamNames = [...new Set([
    ...sectionNames,
    ...sectionedRooms.map((group) => group.section!),
  ])];
  const teamOrder = (key: string) => key === "" ? -1 : teamNames.includes(key) ? teamNames.indexOf(key) : teamNames.length;
  const teamMap = buildTeamMapSections(teamBots, teamNames, { general: unsectionedRooms.length > 0 })
    .sort((a, b) => teamOrder(a.key) - teamOrder(b.key))
    .filter((team) => {
      if (team.key) return true;
      // Pinned bots already sit in the pin grid, so they are not rows here.
      // An Unassigned header with nothing under it stays off. A room still keeps it.
      const botRows = [...team.chiefs, ...team.members].filter((bot) => !inTopGrid(bot)).length;
      return botRows + unsectionedRooms.length > 0;
    });
  const naturalSectionIds = [
    ...teamMap.map((team) => (team.key ? userSectionId(team.key) : GENERAL_SECTION_ID)),
    ...(peopleDms.length > 0 ? [PEOPLE_SECTION_ID] : []),
    ...(botChats.length > 0 ? [BOT_CHATS_SECTION_ID] : []),
  ];
  const orderedSectionIds = orderedSidebarSections(naturalSectionIds, sectionOrder);
  // Organization: Unassigned (what is in no section of yours) stays on top.
  const generalOnTop = orgMode && orderedSectionIds.includes(GENERAL_SECTION_ID);
  const sectionIds = generalOnTop ? [GENERAL_SECTION_ID, ...orderedSectionIds.filter((id) => id !== GENERAL_SECTION_ID)] : orderedSectionIds;
  // With no team of the person's own, Unassigned is the whole list: its
  // rows show without a header (2026-10-15). Bot-to-bot threads alone do
  // not count; People does, so Unassigned keeps its header next to it.
  const loneGeneral = !sectionIds.some((sid) => sid !== GENERAL_SECTION_ID && sid !== BOT_CHATS_SECTION_ID);
  const layoutInteractive = sidebarLayoutInteractive(density, q);
  const sectionCollapsed = (id: string) =>
    sidebarSectionCollapsed(id, collapsedSections, density, q);

  const toggleSection = (id: string) => {
    if (!layoutInteractive) return;
    const next = toggleCollapsedSection(collapsedSections, id);
    setCollapsedSections(next);
    saveCollapsedSections(next);
  };

  const commitSectionOrder = (visibleOrder: string[]) => {
    if (!layoutInteractive) return;
    const next = mergeSectionOrder(sectionOrder, visibleOrder);
    if (sameSectionOrder(next, sectionOrder)) return;
    setSectionOrder(next);
    saveSectionOrder(next);
  };

  const announceSectionPosition = (id: string, visibleOrder: string[]) => {
    const position = visibleOrder.indexOf(id);
    if (position < 0) return;
    setReorderAnnouncement(
      t("sidebar.section.moved", {
        name: sectionLabel(id),
        position: position + 1,
        count: visibleOrder.length,
      }),
    );
  };

  const moveSidebarSection = (id: string, direction: -1 | 1) => {
    const next = moveSection(sectionIds, id, direction);
    if (sameSectionOrder(next, sectionIds)) return;
    commitSectionOrder(next);
    announceSectionPosition(id, next);
  };

  const resetSectionDrag = () => {
    sectionDragRef.current = { from: null, over: null };
    setDraggingSectionId(null);
    setDropTarget(null);
  };

  const updateSectionDropTarget = (event: React.DragEvent<HTMLDivElement>, id: string) => {
    if (!layoutInteractive || !sectionDragRef.current.from) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const place: SectionDropPlace = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const next = { id, place };
    sectionDragRef.current.over = next;
    setDropTarget(next);
  };

  // Dragging a bot or a group onto a section files it there (Unassigned: in
  // none). Bot-to-bot chats are a view, not something to file.
  const [itemDropId, setItemDropId] = useState<string | null>(null);
  // A bot row also carries the calendar's payload (2026-10-18): dropped on a
  // time of Automations it schedules that bot, the same routine and dialog
  // as the calendar's own drag. That one works in every density and while
  // searching; filing into a section keeps its own rule. Every bot and group
  // row also carries the split view's payload (#1504): dropped on the
  // conversation area, it opens in a section of its own.
  const itemDragProps = (kind: SectionItemKind, itemId: string) => ({
    draggable: true,
    "data-sidebar-item-drag": kind,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest("[data-sidebar-folder-row],[data-sidebar-folder-label],[data-sidebar-thread-row],[data-sidebar-thread-drag]")) return;
      event.dataTransfer.effectAllowed = "move";
      if (layoutInteractive) event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify({ kind, id: itemId }));
      event.dataTransfer.setData(SPLIT_DRAG_TYPE, splitDragData({ kind, id: itemId }));
      if (kind === "bot") addBotCalendarDrag(event.dataTransfer, itemId);
    },
    onDragEnd: () => setItemDropId(null),
  });
  const acceptItemDrag = (event: React.DragEvent<HTMLDivElement>, id: string): boolean => {
    if (!event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return false;
    if (isAutomaticSidebarSection(id)) return true;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (itemDropId !== id) setItemDropId(id);
    return true;
  };
  const dropItem = (event: React.DragEvent<HTMLDivElement>, id: string, section: string): boolean => {
    if (!event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return false;
    event.preventDefault();
    setItemDropId(null);
    if (isAutomaticSidebarSection(id)) return true;
    const item = parseItemDrag(event.dataTransfer.getData(ITEM_DRAG_TYPE));
    if (item) assignSection(item.kind, item.id, section);
    return true;
  };

  const dropSection = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) || event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
    event.preventDefault();
    const from =
      event.dataTransfer.getData("application/x-openmausbot-sidebar-section") ||
      event.dataTransfer.getData("text/plain") ||
      sectionDragRef.current.from;
    const over = sectionDragRef.current.over;
    if (from && over) {
      const next = placeSection(sectionIds, from, over.id, over.place);
      if (!sameSectionOrder(next, sectionIds)) {
        commitSectionOrder(next);
        announceSectionPosition(from, next);
      }
    }
    resetSectionDrag();
  };
  const archivedBots = state.bots.filter((bot) => bot.hidden);
  // Every thread across every bot that needs the person right now — the
  // same rule and order as the sidebar tree, so the bell can never
  // disagree with it.
  const pendingBotUndo = teamFeedback?.restoreBot;
  // Grok Bot's foot (2026-10-15): the avatar and the Connect apps pill,
  // nothing else. Archived bots, when there are any, join Achievements
  // in the account menu; Browse bots is in Connect apps' header
  // (2026-10-16).
  const accountPlaces: SidebarMenuItem[] = !remoteClient && archivedBots.length > 0 ? [{
    key: "archived",
    label: t("sidebar.archived.title"),
    icon: <Archive size={18} />,
    trailing: <span className="text-[11.5px] text-ink-secondary">{archivedBots.length}</span>,
    onSelect: () => setArchivedBotsOpen(true),
  }] : [];
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

      {density !== "icons" && moreUnread.above > 0 && (
        <div className="relative z-10 h-0">
          <button type="button" data-sidebar-more-unread="above" onClick={() => jumpToUnread("above")}
            aria-label={t("sidebar.unreadAbove", { count: moreUnread.above })}
            className="absolute left-1/2 top-1 flex whitespace-nowrap -translate-x-1/2 items-center gap-1 rounded-full bg-unread px-2.5 py-1 text-[12px] font-medium leading-4 text-accent-ink shadow-md hover:brightness-110">
            <ArrowUp size={12} aria-hidden="true" />{t("sidebar.unreadAbove", { count: moreUnread.above })}
          </button>
        </div>
      )}
      {/* Bot list. GET /api/org 404 keeps this roster. */}
      <div ref={listFade.ref} onScroll={() => { listFade.onScroll(); measureUnread(); }} style={listFade.style} className={cn("flex-1 overflow-y-auto overflow-x-hidden pb-6 pt-1", density === "icons" ? "px-2" : "pl-3 pr-[13px]")}
        data-sidebar-rail={density === "icons" ? "" : undefined}
        onKeyDown={density === "icons" ? moveRailFocus : undefined}
        onContextMenu={orgMode ? (event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).dataset?.sidebarEmpty !== undefined) openOrgMenu(event, null, null); } : undefined}>
        {pinnedBots.length > 0 && (
          // The reference window's tiles: 95 x 115, 4px apart and centred as
          // a group, the first 16px under the head's row.
          <div className={cn("grid", density === "icons" ? "mb-2 grid-cols-1 gap-1 py-1.5" : "mb-4 grid-cols-[repeat(auto-fit,95px)] justify-center gap-x-1 gap-y-3 pb-1.5 pt-3")}>
            {pinnedBots.map((bot) => {
              const selected = state.activeView === "chat" && state.selectedId === bot.id;
              const title = bot.title.trim();
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => { for (const action of openBotConversationActions(bot, showThreads)) dispatch(action); }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenu({ botId: bot.id, x: event.clientX, y: event.clientY });
                  }}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    density === "icons"
                      ? "mx-auto flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 pb-1 pt-1.5"
                      // Grok Bot's pinned tile: 95px wide, 10px corners,
                      // 6px over a 60px portrait, 6px to the name, 4px
                      // between name and role, 4px under, 8px aside
                      : "flex w-[95px] shrink-0 flex-col items-center gap-1.5 rounded-[10px] px-2 pb-1 pt-1.5",
                    density === "icons"
                      ? selected ? "bg-sidebar-selected" : "hover:bg-sidebar-hover"
                      : selected ? "bg-sidebar-card" : "hover:bg-sidebar-hover/60",
                  )}
                >
                  <SidebarMascotAvatar botId={bot.id} bot={bot} primary={isViewersPrimaryBot(bot, viewerId)} primaryRingClassName={selected && density !== "icons" ? "ring-sidebar-card" : "ring-sidebar"} state="idle" size={density === "icons" ? 36 : 60} animated={false} />
                  {density !== "icons" && (
                    <span data-sidebar-tile-labels="" className="flex w-full min-w-0 flex-col items-center gap-1">
                      <span className="w-full truncate text-center text-[12px] leading-4 text-sidebar-ink">{bot.name}</span>
                      {title ? <BotRoleTag text={title} tile /> : null}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-col gap-1">
          {matchingBots.length === 0 && visibleGroups.length === 0 && q && q.length < MIN_QUERY && (
            <div className="px-3 py-6 text-center text-[13px] text-sidebar-ink-secondary">{t("sidebar.noMatch", { query: q })}</div>
          )}
          {sectionIds.map((id, index) => {
            const team = teamMap.find((item) => (item.key ? userSectionId(item.key) : GENERAL_SECTION_ID) === id);
            const sectionName = team?.key || userSectionName(id);
            const sectionDisplayName = team?.key && !isMyTeamSectionName(team.key) ? team.key : sectionLabel(id);
            const sectionChiefItems = (team?.chiefs ?? []).filter((bot) => !inTopGrid(bot));
            const sectionGroupItems =
              id === BOT_CHATS_SECTION_ID
                ? botChats
                : id === PEOPLE_SECTION_ID
                  ? peopleDms
                  : team
                    ? (team.key ? sectionedRooms.filter((group) => group.section === team.key) : unsectionedRooms)
                    : [];
            const sectionBotItems = (team?.members ?? []).filter((bot) => !inTopGrid(bot));
            const collapsed = sectionCollapsed(id);
            const queued = collapsed ? [...sectionChiefItems, ...sectionBotItems].flatMap((bot) =>
              sidebarBotActivityTasks(bot, state.pendingQueued).filter((task) => task.queued).map((task) => `${bot.name}: ${task.title}`)) : [];
            const attention = collapsed
              ? sidebarSectionAttention(
                  [...sectionChiefItems, ...sectionBotItems],
                  sectionGroupItems,
                )
              : undefined;
            return (
              <div
                key={id}
                data-sidebar-section-id={id}
                onDragOver={(event) => { if (!acceptItemDrag(event, id)) updateSectionDropTarget(event, id); }}
                onDragLeave={(event) => { if (itemDropId === id && !event.currentTarget.contains(event.relatedTarget as Node | null)) setItemDropId(null); }}
                onDrop={(event) => { if (!dropItem(event, id, team?.key ?? "")) dropSection(event); }}
                data-item-drop={itemDropId === id ? "" : undefined}
                className={cn(
                  "flex flex-col gap-1",
                  density !== "icons" && index > 0 && "pt-2.5",
                  itemDropId === id && "rounded-lg bg-sidebar-hover/70 ring-1 ring-accent/50",
                )}
              >
                {dropTarget?.id === id && dropTarget.place === "before" && draggingSectionId !== id && (
                  <div className="mx-2 h-0.5 rounded-full bg-accent" />
                )}
                {density !== "icons" && sectionEdit?.mode === "rename" && team?.key && sectionEdit.name === team.key ? (
                  <SectionNameInput initial={team.key} onSave={(name) => renameOrgSection(team.key!, name)} onCancel={() => setSectionEdit(null)} />
                ) : density !== "icons" && !(id === GENERAL_SECTION_ID && loneGeneral) && (
                  <SidebarSectionHeader
                    name={sectionDisplayName}
                    onContextMenu={orgMode && layoutInteractive && !isAutomaticSidebarSection(id) ? (event) => openOrgMenu(event, team?.key || null, id) : !remoteClient && layoutInteractive && sectionName ? (event) => {
                      event.preventDefault();
                      teamMenuReturn.current = event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget;
                      setTeamMenu({ name: sectionName, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)) });
                    } : undefined}
                    collapsed={collapsed}
                    attention={attention}
                    onToggle={layoutInteractive ? () => toggleSection(id) : undefined}
                    reorderable={layoutInteractive && sectionIds.length > 1}
                    dragging={draggingSectionId === id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-openmausbot-sidebar-section", id);
                      event.dataTransfer.setData("text/plain", id);
                      sectionDragRef.current = { from: id, over: null };
                      setDraggingSectionId(id);
                    }}
                    onDragEnd={resetSectionDrag}
                    onMove={(direction) => moveSidebarSection(id, direction)}
                  />
                )}
                {collapsed && queued.length > 0 && <button type="button" onClick={() => toggleSection(id)}
                  title={`${t("task.queued")} · ${queued.join(", ")}`} aria-label={`${t("sidebar.section.expand", { name: sectionLabel(id) })} · ${t("task.queued")} · ${queued.join(", ")}`}
                  className="mx-3 mb-1 self-start rounded bg-sidebar-hover px-2 py-0.5 text-[10px] text-sidebar-ink-secondary hover:text-sidebar-ink">{t("task.queued")} · {queued.length}</button>}
                {!collapsed && (
                  <div
                    data-sidebar-nest
                    role="group"
                    aria-label={sectionDisplayName}
                    className="flex flex-col gap-1"
                  >
                    {sectionChiefItems.map((bot) => (
                      <div key={bot.id} {...itemDragProps("bot", bot.id)}>
                        <BotListItem
                          bot={bot}
                          density={density}
                          quiet={quietRows}
                          query={q}
                          onMenu={setMenu}
                          startRename={renameBotId === bot.id}
                          onRenameStarted={() => setRenameBotId(null)}
                          selection={selectionFor(bot.id)}
                        />
                      </div>
                    ))}
                    {sectionGroupItems.map((group) => (
                      <div key={group.id} {...(group.dm ? {} : itemDragProps("group", group.id))}>
                        <GroupListItem
                          group={group}
                          density={density}
                          quiet={quietRows}
                          query={q}
                          onMenu={setRoomMenu}
                        />
                      </div>
                    ))}
                    {sectionBotItems.map((bot) => (
                      <div key={bot.id} {...itemDragProps("bot", bot.id)}>
                        <BotListItem
                          bot={bot}
                          density={density}
                          quiet={quietRows}
                          query={q}
                          onMenu={setMenu}
                          startRename={renameBotId === bot.id}
                          onRenameStarted={() => setRenameBotId(null)}
                          selection={selectionFor(bot.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {dropTarget?.id === id && dropTarget.place === "after" && draggingSectionId !== id && (
                  <div className="mx-2 h-0.5 rounded-full bg-accent" />
                )}
              </div>
            );
          })}

          {builtInBots.length > 0 && (() => {
            const collapsed = sectionCollapsed(BUILT_IN_SECTION_ID);
            return (
              <div data-sidebar-section-id={BUILT_IN_SECTION_ID} className={cn("flex flex-col gap-1", density !== "icons" && sectionIds.length > 0 && "pt-2.5")}>
                {density !== "icons" && (
                  <SidebarSectionHeader
                    name={sectionLabel(BUILT_IN_SECTION_ID)}
                    collapsed={collapsed}
                    reorderable={false}
                    dragging={false}
                    onToggle={layoutInteractive ? () => toggleSection(BUILT_IN_SECTION_ID) : undefined}
                  />
                )}
                {!collapsed && (
                  <div data-sidebar-nest role="group" aria-label={sectionLabel(BUILT_IN_SECTION_ID)} className="flex flex-col gap-1">
                    {builtInBots.map((bot) => (
                      <div key={bot.id} {...itemDragProps("bot", bot.id)}>
                        <BotListItem
                          bot={bot}
                          density={density}
                          quiet={quietRows}
                          query={q}
                          onMenu={setMenu}
                          startRename={renameBotId === bot.id}
                          onRenameStarted={() => setRenameBotId(null)}
                          selection={selectionFor(bot.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {density !== "icons" && <HiddenEntriesRow rows={hiddenSidebarRows(sidebarHidden.items, { bots: state.bots, groups: state.groups, viewerId, people: sidebarPeople })} />}
        </div>
      </div>
      {density !== "icons" && moreUnread.below > 0 && (
        <div className="relative z-10 h-0">
          <button type="button" data-sidebar-more-unread="below" onClick={() => jumpToUnread("below")}
            aria-label={t("sidebar.unreadBelow", { count: moreUnread.below })}
            className="absolute bottom-2 left-1/2 flex whitespace-nowrap -translate-x-1/2 items-center gap-1 rounded-full bg-unread px-2.5 py-1 text-[12px] font-medium leading-4 text-accent-ink shadow-md hover:brightness-110">
            <ArrowDown size={12} aria-hidden="true" />{t("sidebar.unreadBelow", { count: moreUnread.below })}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </p>
      {selecting && density !== "icons" && (() => {
        const chosen = selectedBotIds.flatMap((id) => state.bots.filter((bot) => bot.id === id));
        const count = chosen.length;
        const allPinned = count > 0 && chosen.every((bot) => bot.pinned);
        const canMove = showServerSectionMove(state.config, personal !== null, chosen);
        const archivable = chosen.filter((bot) => currentArchivableBot(state.bots, bot.id) && showBotArchive(state.config, bot));
        const button = "flex h-8 min-w-0 flex-1 items-center justify-center rounded-full text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink disabled:pointer-events-none disabled:opacity-40";
        return (
          <div className="px-4 pb-2">
          <div data-sidebar-select-bar role="toolbar" aria-label={t("sidebar.select.count", { count })} className="flex h-9 w-full items-center justify-evenly rounded-full border border-sidebar-hairline-weak bg-sidebar-card px-1">
            <button type="button" className={button} disabled={count === 0} title={t("sidebar.select.markRead")} aria-label={t("sidebar.select.markRead")}
              onClick={() => {
                for (const bot of chosen) {
                  void markBotRead(bot, api, (updated) => dispatch({ type: "botPatched", bot: updated }))
                    .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
                }
                clearSelection();
              }}><CheckCheck size={16} /></button>
            <button type="button" className={button} disabled={count === 0} title={allPinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")} aria-label={allPinned ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
              onClick={() => {
                for (const bot of chosen) dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !allPinned } });
                clearSelection();
              }}>{allPinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
            {/* Edit N bots: the bot editor's sections, changed for all of them (BulkEditBotsDialog) */}
            <button type="button" data-sidebar-select-edit className={cn(button, "flex-[1.6] gap-1 text-[12.5px] font-medium text-sidebar-ink")} disabled={chosen.every((bot) => viewerLocalBotSettings(state.config, bot))} title={t("sidebar.select.edit", { count })} aria-label={t("sidebar.select.edit", { count })} aria-haspopup="dialog"
              onClick={() => setBatchEdit(true)}><SlidersHorizontal size={15} aria-hidden="true" /><span className="truncate">{t("sidebar.select.editShort")}</span></button>
            {canMove && <button type="button" className={button} disabled={count === 0} title={t("sidebar.select.move", { count })} aria-label={t("sidebar.select.move", { count })} aria-haspopup="menu"
              onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setBatchSectionPicker({ botId: "", x: rect.left, y: rect.top - 260 }); }}><FolderInput size={16} /></button>}
            {(!viewerIsOrgMember(state.config) || archivable.length > 0) && <button type="button" className={button} disabled={archivable.length === 0} title={t("sidebar.bot.archive")} aria-label={t("sidebar.bot.archive")}
              onClick={() => setBatchArchiveConfirm(true)}><Archive size={16} /></button>}
            <button type="button" className={button} title={t("sidebar.select.clear")} aria-label={t("sidebar.select.clear")} onClick={clearSelection}><X size={16} /></button>
          </div>
          </div>
        );
      })()}

      {/* Footer. Collapsing the sidebar keeps the places and the avatar at
          the same y: the same bottom padding, the same row metrics
          (SidebarPlaces) and an account row of the same h-10 height in both
          layouts. The rail's extra buttons (archived bots, phone) sit above
          the places so they never push them. */}
      <div
        data-sidebar-foot
        data-tour="tools"
        className={cn(density === "icons" ? "px-2 pb-3 pt-1" : "px-4 pb-4")}
      >
        {density === "icons" && !remoteClient && archivedBots.length > 0 && (
          <button
            type="button"
            onClick={() => setArchivedBotsOpen(true)}
            aria-label={t("sidebar.archived.title")}
            title={t("sidebar.archived.title")}
            className="flex h-9 w-full items-center justify-center rounded-lg px-2 text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink"
          >
            <Archive size={20} />
          </button>
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
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={requestArchive}
          onDelete={(bot) => setConfirm({ kind: "delete", bot })}
          onMoveToSection={(botId) => {
            if (!menu) return;
            setSectionPicker({ botId, x: menu.x, y: menu.y });
          }}
          onRename={(botId) => setRenameBotId(botId)}
          onSelect={(botId) => { setSelecting(true); setSelectedBotIds((current) => current.includes(botId) ? current : [...current, botId]); }}
          // Edit bot opens the bot editor (2026-10-16: it did nothing
          // visible since the panel fallback lost its settings view)
          onEditPersona={(target) => dispatch({ type: "openPersonaEditor", botId: target.id })}
          onMakePrimary={(bot) => void makePrimaryBot(bot.id)}
          onReplacePrimary={(bot) => setPrimaryPicker({ currentId: bot.id, pending: false, error: null })}
        />
      <PrimaryBotPicker
        open={primaryPicker !== null}
        bots={sidebarBots}
        viewerId={orgViewerId(state)}
        currentId={primaryPicker?.currentId ?? null}
        pending={primaryPicker?.pending}
        error={primaryPicker?.error}
        onCancel={() => setPrimaryPicker(null)}
        onConfirm={(botId) => void makePrimaryBot(botId, true)}
      />
      <ConfirmDialog
        open={confirm !== null}
        {...(confirm ? botConfirmCopy(confirm.kind, confirm.bot.name) : botConfirmCopy("archive", ""))}
        icon={confirm?.kind === "delete" ? <Trash2 size={18} /> : <Archive size={18} />}
        onCancel={cancelConfirm}
        returnFocusRef={sidebarRef}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, bot } = confirm;
          setConfirm(null);
          if (kind === "archive") void archiveBot(bot);
          else dispatch({ type: "deleteBot", botId: bot.id });
        }}
      />
      {renameTeam && <TeamDialog section={renameTeam} rename onRenamed={renamedTeam} onClose={() => setRenameTeam(null)} />}
      {orgMenu && createPortal(<div className="fixed inset-0 z-40" onMouseDown={closeOrgMenu} onContextMenu={(event) => { event.preventDefault(); closeOrgMenu(); }}>
        <div role="menu" aria-label={orgMenu.name ?? t("teamLibrary.general")} style={{ left: orgMenu.x, top: orgMenu.y }} data-org-section-menu
          className="absolute w-[220px] min-w-[200px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px] text-ink"
          onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeOrgMenu(); return; }
            navigateThreadMenu(event);
          }}>
          {(() => {
            const position = orgMenu.id ? sectionIds.indexOf(orgMenu.id) : -1;
            const anyExpanded = sectionIds.some((sid) => !collapsedSections.includes(sid));
            const actions: OrgSectionMenuActions = {
              onRename: () => { closeOrgMenu(); if (orgMenu.name) setSectionEdit({ mode: "rename", name: orgMenu.name }); },
              onMoveUp: () => { closeOrgMenu(); if (orgMenu.id) moveSidebarSection(orgMenu.id, -1); },
              onMoveDown: () => { closeOrgMenu(); if (orgMenu.id) moveSidebarSection(orgMenu.id, 1); },
              onCollapseAll: () => { closeOrgMenu(); setCollapsedSections([...sectionIds]); saveCollapsedSections([...sectionIds]); },
              onExpandAll: () => { closeOrgMenu(); setCollapsedSections([]); saveCollapsedSections([]); },
              onDelete: () => { closeOrgMenu(); if (orgMenu.name) setDeletingTeam(orgMenu.name); },
            };
            const items = orgSectionMenuItems({
              named: Boolean(orgMenu.name),
              canMoveUp: position > (generalOnTop ? 1 : 0) && layoutInteractive,
              canMoveDown: position >= (generalOnTop ? 1 : 0) && position < sectionIds.length - 1 && layoutInteractive,
              anyExpanded,
            });
            return <OrgSectionMenuItems items={items} actions={actions} />;
          })()}
        </div>
      </div>, document.body)}
      {teamMotion.shown && teamMotion.value && createPortal(<div className={cn("fixed inset-0 z-40", teamMotion.closing && "pointer-events-none")} onMouseDown={closeTeamMenu}>
        <div role="menu" aria-label={teamMotion.value.name} style={{ left: teamMotion.value.x, top: teamMotion.value.y }}
          className={cn("absolute w-[220px] min-w-[200px] rounded-xl border-[0.5px] border-border bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px] text-ink", teamMotion.className)} {...teamMotion.exitProps}
          onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeTeamMenu(); return; }
            navigateThreadMenu(event);
          }}>
          <TeamMenuItems
            onAddBots={() => { closeTeamMenu(); setMoveToTeam(teamMotion.value!.name); }}
            onRename={() => { closeTeamMenu(); setRenameTeam(teamMotion.value!.name); }}
            onShare={() => { closeTeamMenu(); setShareTeam(teamMotion.value!.name); }}
            onDelete={() => { closeTeamMenu(); setDeletingTeam(teamMotion.value!.name); }}
          />
        </div>
      </div>, document.body)}
      <ConfirmDialog open={deletingTeam !== null} title={t("team.deleteTitle", { name: deletingTeam ?? "" })}
        body={t("team.deleteKeepBotsDescription")} confirmLabel={t("team.delete")} returnFocusRef={sidebarRef}
        pending={teamDeletePending}
        onCancel={() => { if (!teamDeleteRunning.current) setDeletingTeam(null); }} onConfirm={() => {
          const name = deletingTeam;
          if (!name || teamDeleteRunning.current) return;
          // Organization: the viewer's own section goes, its bots, groups and
          // conversations go back to Unassigned; nothing else changes.
          if (personal) {
            writePersonalSections(deletePersonalSection(personal, name));
            setDeletingTeam(null);
            return;
          }
          teamDeleteRunning.current = true;
          setTeamDeletePending(true);
          void api<{ sections: string[] }>(`/api/sidebar-sections?section=${encodeURIComponent(name)}`, { method: "DELETE" })
            .then(({ sections }) => { dispatch({ type: "sectionDeleted", section: name, sections }); setDeletingTeam(null); })
            .catch(cause => setTeamFeedback({ error: true, text: readableError(cause) }))
            .finally(() => { teamDeleteRunning.current = false; setTeamDeletePending(false); });
        }} />
      {moveToTeam && <TeamDialog section={moveToTeam} onClose={() => setMoveToTeam(null)} />}
      {shareTeam !== null && <ShareTeamDialog team={shareTeam} onClose={() => setShareTeam(null)} />}
      {batchEdit && (
        <BulkEditBotsDialog
          botIds={selectedBotIds}
          onClose={() => setBatchEdit(false)}
        />
      )}
      <SectionPicker
          current={undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={batchSectionPicker}
          onClose={() => setBatchSectionPicker(null)}
          onAssign={(section) => {
            const ids = selectedBotIds.filter((id) => state.bots.some((bot) => bot.id === id));
            if (!personal && remoteClient) {
              // one request for the whole selection
              void api("/api/sidebar-sections", { method: "POST", body: JSON.stringify({ name: section, botIds: ids }) })
                .then(({ bots }) => bots.forEach((bot: Bot) => dispatch({ type: "botPatched", bot })))
                .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
            } else {
              for (const id of ids) assignSection("bot", id, section);
            }
            clearSelection();
          }}
        />
      <ConfirmDialog
        open={batchArchiveConfirm}
        title={t("sidebar.select.archiveTitle", { count: selectedBotIds.filter((id) => archivableByViewer(id)).length })}
        body={t("sidebar.select.archiveBody")}
        confirmLabel={t("sidebar.bot.archive")}
        icon={<Archive size={18} />}
        onCancel={() => setBatchArchiveConfirm(false)}
        returnFocusRef={sidebarRef}
        onConfirm={() => {
          setBatchArchiveConfirm(false);
          // never the last active bot: the guard reads one snapshot, so cap here
          const keep = state.bots.filter((bot) => !bot.hidden).length - 1;
          const ids = selectedBotIds.filter((id) => archivableByViewer(id)).slice(0, Math.max(0, keep));
          clearSelection();
          void (async () => { for (const id of ids) await archiveBot({ id }); })();
        }}
      />
      <SectionPicker
          current={sectionPicker ? layoutBots.find((b) => b.id === sectionPicker.botId)?.section : undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={sectionPicker}
          onClose={() => setSectionPicker(null)}
          onAssign={(section) => {
            if (sectionPicker) assignSection("bot", sectionPicker.botId, section);
          }}
        />
      <RoomContextMenu
          menu={roomMenu}
          onClose={() => setRoomMenu(null)}
          onMoveToSection={(groupId) => {
            if (!roomMenu) return;
            setRoomSectionPicker({ groupId, x: roomMenu.x, y: roomMenu.y });
          }}
          onDelete={(groupId) => {
            // The closing menu remains mounted briefly for its exit animation.
            // Give the dialog a stable opener instead of that disappearing item.
            sidebarRef.current?.focus();
            setDeletingRoomId(groupId);
          }}
          onLeave={(groupId) => {
            sidebarRef.current?.focus();
            setLeavingRoomId(groupId);
          }}
        />
      <LeaveGroupDialog groupId={leavingRoomId} onClose={() => setLeavingRoomId(null)} returnFocusRef={sidebarRef} />
      <ConfirmDialog
        open={deletingRoom !== undefined}
        {...roomDeleteCopy(deletingRoom ?? { name: "" })}
        icon={<Trash2 size={18} />}
        returnFocusRef={sidebarRef}
        onCancel={() => setDeletingRoomId(null)}
        onConfirm={() => {
          // Read the room from live state: it may have been removed elsewhere
          // while the dialog was open.
          const groupId = deletingRoom?.id;
          setDeletingRoomId(null);
          if (groupId) dispatch({ type: "deleteGroup", groupId });
        }}
      />
      <SectionPicker
          current={roomSectionPicker ? layoutGroups.find((g) => g.id === roomSectionPicker.groupId)?.section : undefined}
          names={personal ? personalSectionNames(personal) : undefined}
          anchor={roomSectionPicker}
          onClose={() => setRoomSectionPicker(null)}
          onAssign={(section) => {
            if (roomSectionPicker) assignSection("group", roomSectionPicker.groupId, section);
          }}
        />
      {!remoteClient && archivedBotsOpen && (
        <ArchivedBotsPanel
          bots={archivedBots}
          onClose={() => setArchivedBotsOpen(false)}
          onRestored={(message) => setTeamFeedback({ error: false, text: message })}
        />
      )}
      {teamFeedback &&
        createPortal(
          <div
            role="status"
            className={cn(
              "fixed bottom-4 left-4 z-[60] flex max-w-[300px] items-center gap-2 rounded-[9px] bg-elevated px-3 py-[9px] text-[12.5px]",
              teamFeedback.error ? "text-danger" : "text-ink",
            )}
          >
            <div className="flex items-center gap-2">
              <span>{teamFeedback.text}</span>
              {pendingBotUndo && (
                <button
                  onClick={() => void undoBotArchive(pendingBotUndo)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover"
                >
                  {t("common.undo")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      {/* The edge: drag to resize, narrower than the snap width to collapse
          to the rail and back out of it to expand; double-click toggles.
          Invisible at rest (the aside's hairline border is the edge); a 2px
          line shows on hover, drag and keyboard focus (`.app-resize-handle`).
          Not on the automatic rail: there the window's width decides, and
          the person's own width and density wait for a wider window. */}
      {!autoRail && <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("sidebar.resize")}
        aria-description={t("sidebar.compact.edgeHint")}
        aria-valuemin={SIDEBAR_RAIL_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={density === "icons" ? SIDEBAR_RAIL_WIDTH : sidebarWidth}
        tabIndex={0}
        data-resizing={sidebarResizing || undefined}
        onPointerDown={(event) => {
          const collapsed = density === "icons";
          const width = collapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth;
          sidebarResize.current = { x: event.clientX, width, current: sidebarWidth, collapsed };
          setSidebarResizing(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => resizeSidebar(event.clientX)}
        onPointerUp={(event) => {
          const from = sidebarResize.current;
          if (from && !from.collapsed) {
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(from.current)); } catch { /* session only */ }
          }
          sidebarResize.current = null;
          setSidebarResizing(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          sidebarResize.current = null;
          setSidebarResizing(false);
        }}
        onDoubleClick={() => setSidebarCollapsed(density !== "icons")}
        onKeyDown={(event) => {
          // Enter toggles the compact sidebar (the icons rail), as a
          // window splitter does, like the double-click.
          if (event.key === "Enter") {
            event.preventDefault();
            setSidebarCollapsed(density !== "icons");
            return;
          }
          const delta = event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0;
          if (!delta) return;
          event.preventDefault();
          if (density === "icons") {
            if (delta > 0) setSidebarCollapsed(false);
            return;
          }
          if (delta < 0 && sidebarWidth <= SIDEBAR_MIN_WIDTH) {
            setSidebarCollapsed(true);
            return;
          }
          const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth + delta));
          setSidebarWidth(next);
          try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next)); } catch { /* session only */ }
        }}
        className="app-resize-handle -right-[3px]"
      />}
    </aside>
    </SidebarMascotProvider>
  );
}
