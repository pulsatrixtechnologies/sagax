// Separate task contexts for an agent or a channel.
//
// One endless thread per bot means every job contaminates the next, and
// the only clean slate is a second bot. A task is a real boundary — its
// own transcript and its own provider session — so sensitive work, a
// long job and a quick question can sit side by side under one agent.
import { copyText } from "@/lib/copy-text";
import { openTeamBotFromThread, teamBotSourceAllowed } from "@/lib/teambot-from-thread";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, MessagesSquare, MoreHorizontal, Plus, Search } from "lucide-react";
import { api, currentTaskBot, useStore, type Bot, type BotProject, type Group, type GroupTaskUpdatePatch, type Task } from "@/state/store";
import { botApprovalSetting, approvalModeFor } from "../../shared/approval-mode";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";
import { moveFolder } from "@/lib/folder-order";
import { folderUnreadThreadIds, markFolderRead, markGroupFolderRead } from "@/lib/folder-read";
import { personPickerThreads } from "@/lib/person-threads";
import { threadRefUrl } from "@/lib/thread-refs";
import { FullAccessWarning } from "./FullAccessWarning";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useMenuMotion } from "./MenuMotion";
import { AnchoredPopover } from "./AnchoredPopover";
import { t } from "@/lib/i18n";
import { keepWarmLine } from "@/lib/cache-keepwarm";
import { formatTaskTokens, headlineTokens, usageDetail } from "@/lib/usage";
import { nextRename } from "@/lib/rename";
import { BotProjectDialog, FolderActions, FolderIcon, NewThreadButton } from "./BotProjects";
import { useShowThreads, useThreadsMode } from "@/lib/thread-preferences";
import { threadsOffReturnTarget } from "./thread-home";
import { formatUpdatedAt, orderedThreadList, threadByline, threadRecency, threadUpdatedLabel, useRelativeNow, useSnoozeExpiry } from "./SidebarThreadRow";
import { ThreadMenu, type ThreadMenuActions } from "./ThreadMenu";
import { ConfidentialBadge } from "./ConfidentialBanner";
import { newThreadChoices } from "@/lib/confidential-thread";
import { readableError } from "@/lib/plain-error";

/** Click-to-switch used to close this menu immediately, which unmounted the
 * row before a double-click (or right-click) could start a rename. Linger
 * just long enough for the second click to land; rename cancels the close. */
export const TASK_PICKER_DISMISS_MS = 500;


/** Decide what a pointer event on a task row should do. The click that
 * accompanies a dblclick (detail >= 2) must not switch/close — that is
 * what used to eat the advertised rename. */
export function taskPickerPointerIntent(
  type: string,
  detail = 1,
): "select" | "rename" | "ignore" {
  if (type === "dblclick" || type === "contextmenu") return "rename";
  if (type === "click" && detail >= 2) return "ignore";
  if (type === "click") return "select";
  return "ignore";
}

/** Filter the task switcher. Prefix matches float first so a few letters
 * still find the right row in a long list; within a tier the caller's
 * order (newest first) is preserved. */
export function filterTasks<T extends { title: string }>(tasks: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tasks];
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const task of tasks) {
    const title = task.title.toLowerCase();
    if (title.startsWith(needle)) prefix.push(task);
    else if (title.includes(needle)) substring.push(task);
  }
  return [...prefix, ...substring];
}

/** The picker row's stamp, sharing the sidebar row's contract: relative
 * label in the flow, the exact date one hover away, ISO for machines. */
function TaskUpdatedTime({ task, now }: { task: { updatedAt?: number; createdAt?: number }; now: number }) {
  const stamp = threadRecency(task);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return <time dateTime={new Date(stamp).toISOString()} title={formatUpdatedAt(stamp)}>{threadUpdatedLabel(stamp, now)}</time>;
}

/** Quiet per-task token tally; the hover title explains the cached share
 * and any prompt-cache keep-warm line for the thread. */
function TaskUsage({ usage, cacheKeepWarm }: { usage: Task["usage"]; cacheKeepWarm?: Task["cacheKeepWarm"] }) {
  const warm = keepWarmLine(cacheKeepWarm);
  const detail = [usage ? usageDetail(usage) : null, warm].filter(Boolean).join(" · ") || undefined;
  if (!usage && !warm) return null;
  const label = usage ? formatTaskTokens(headlineTokens(usage)) : null;
  if (!label && !warm) return null;
  return (
    <span title={detail}>
      {" · "}
      {label ?? warm}
    </span>
  );
}

type PickerTask = Pick<Task, "threadId" | "title" | "createdAt" | "updatedAt" | "pinned" | "busy" | "activity" | "unread" | "projectId" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates" | "confidential" | "cacheKeepWarm"> & { usage?: Task["usage"] };

/** The full picker searches both thread titles and their project names.
 * Legacy/orphaned project IDs remain visible under Ungrouped. */
export function groupThreadTasks(tasks: PickerTask[], projects: BotProject[], query: string) {
  const needle = query.trim().toLowerCase();
  return [...projects, { id: "", name: t("folder.none") } as BotProject].map((project) => {
    const members = tasks.filter((task) => project.id ? task.projectId === project.id : !projects.some((item) => item.id === task.projectId));
    return { project, tasks: project.name.toLowerCase().includes(needle) ? members : filterTasks(members, query) };
  }).filter((group) => group.tasks.length > 0);
}

export type PickerThreadActions = {
  onCopyLink?: (threadId: string) => void;
  /** Present only where generated titles are on. Calls back once settled. */
  onRegenerateTitle?: (threadId: string, onSettled: (ok: boolean) => void) => void;
  onArchive?: (threadId: string, archivedAt: number | null) => void;
  onSnooze?: (threadId: string, snoozedUntil: number | null) => void;
  onRefreshPermissions?: (threadId: string) => void;
  onCreateTeamBot?: (threadId: string) => void;
  /** Bot threads: make one confidential (the menu asks first). */
  onMakeConfidential?: (threadId: string) => void;
};

export type PickerFolderActions = {
  saving: boolean;
  canMove: (projectId: string, direction: -1 | 1) => boolean;
  canMarkRead: (projectId: string) => boolean;
  onEdit: (projectId: string) => void;
  onMove: (projectId: string, direction: -1 | 1, onSaved: () => void) => void;
  onMarkRead: (projectId: string, onSaved: () => void) => void;
};

/** A picker row's actions, from the owner's callbacks: the same menu as the
 * sidebar's thread rows (ThreadMenu), opened from the row's one "..." button. */
export function pickerRowActions(task: Pick<PickerTask, "threadId"> & { confidential?: true }, given: {
  onRename: () => void;
  onDelete: (threadId: string) => void;
  onMove?: (threadId: string, projectId: string | null) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
  threadActions?: PickerThreadActions;
}): ThreadMenuActions {
  const id = task.threadId;
  const extra = given.threadActions;
  return {
    onRename: given.onRename,
    onDelete: () => given.onDelete(id),
    ...(given.onPin ? { onPin: (pinned: boolean) => given.onPin!(id, pinned) } : {}),
    ...(given.onMove ? { onMove: (folderId: string | null) => given.onMove!(id, folderId) } : {}),
    ...(extra?.onArchive ? { onArchive: (archivedAt: number | null) => extra.onArchive!(id, archivedAt) } : {}),
    ...(extra?.onSnooze ? { onSnooze: (until: number | null) => extra.onSnooze!(id, until) } : {}),
    ...(extra?.onCopyLink ? { onCopyLink: () => extra.onCopyLink!(id) } : {}),
    ...(extra?.onRegenerateTitle ? { onRegenerateTitle: (onSettled: (ok: boolean) => void) => extra.onRegenerateTitle!(id, onSettled) } : {}),
    ...(extra?.onRefreshPermissions ? { onRefreshPermissions: () => extra.onRefreshPermissions!(id) } : {}),
    ...(extra?.onCreateTeamBot ? { onCreateTeamBot: () => extra.onCreateTeamBot!(id) } : {}),
    ...(extra?.onMakeConfidential && task.confidential !== true ? { onMakeConfidential: () => extra.onMakeConfidential!(id) } : {}),
  };
}

function ConversationTaskPicker({
  threadId,
  tasks,
  busy,
  folders,
  newButton,
  onNew,
  onSwitch,
  onRename,
  onDelete,
  onMove,
  onPin,
  threadActions,
  folderActions,
  initialOpen = false,
}: {
  threadId: string;
  tasks: PickerTask[];
  busy: boolean;
  /** The owner's folders (a bot's, or a conversation with a person's): the
   * list groups by them and a row can move between them. Absent: no folders. */
  folders?: BotProject[];
  /** The owner's own New thread control (it opens in the current folder);
   * absent: a plain New thread row that calls onNew. */
  newButton?: (close: () => void) => ReactNode;
  onNew: () => void;
  onSwitch: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onMove?: (threadId: string, projectId: string | null) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
  /** The thread actions the sidebar rows used to carry, behind a row's "...". */
  threadActions?: PickerThreadActions;
  /** Folder header actions: edit (name and icon), mark read, move up/down. */
  folderActions?: PickerFolderActions;
  /** Opens on mount (tests render the open popover this way). */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const motion = useMenuMotion(open);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rowMenu, setRowMenu] = useState<{ threadId: string; left: number; top: number } | null>(null);
  const rowMenuAnchor = useRef<HTMLElement | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ projectId: string; left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The list is drawn on <body> (AnchoredPopover), so a narrow column or a
  // short window no longer cuts it; a press in it is not outside.
  const popoverRef = useRef<HTMLElement | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingRename = useRef(false);
  const now = useRelativeNow();
  // a timed snooze ends on the clock: re-render then so "Snoozed" lifts
  useSnoozeExpiry(tasks);

  const current = tasks.find((t) => t.threadId === threadId);

  const clearDismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const closeMenu = () => {
    clearDismiss();
    setRowMenu(null);
    setFolderMenu(null);
    setRenaming(null);
    setQuery("");
    setOpen(false);
  };

  const queueDismiss = () => {
    clearDismiss();
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setRenaming(null);
      setOpen(false);
    }, TASK_PICKER_DISMISS_MS);
  };

  const startRename = (task: PickerTask) => {
    clearDismiss();
    finishingRename.current = false;
    setDraft(task.title);
    setRenaming(task.threadId);
  };

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setRowMenu(null);
      setFolderMenu(null);
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setQuery("");
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      // SAFETY: a mousedown target inside a document is always a DOM Node
      if (!ref.current?.contains(e.target as Node) && !popoverRef.current?.contains(e.target as Node)) {
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = null;
        }
        setRenaming(null);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      if (renaming) return;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, renaming]);

  const commitRename = (threadId: string, save: boolean) => {
    // Escape unmounts the input, which fires blur. Without this guard the
    // blur would save the draft the user just cancelled.
    if (finishingRename.current) return;
    finishingRename.current = true;
    const currentTitle = tasks.find((task) => task.threadId === threadId)?.title ?? "";
    const title = save ? nextRename(currentTitle, draft) : null;
    setRenaming(null);
    if (title) onRename(threadId, title);
  };

  // the picker button stays as-is — a token count next to a truncated title
  // and count would crowd it; the open task's tally rides the hover title
  const u = current?.usage;
  const currentLabel = u ? formatTaskTokens(headlineTokens(u)) : null;
  const switchTitle =
    u && currentLabel
      ? t("task.switchWithUsageDetail", {
          label: currentLabel,
          detail: usageDetail(u),
        })
      : t("task.switch");
  const grouped = folders ? groupThreadTasks(tasks, folders, query) : null;
  // Only this conversation's own threads: no other bot's or room's thread
  // ever rides in here (2026-10-08). The sidebar's inbox panel
  // is the cross-bot view.
  const visible = grouped ? grouped.flatMap((group) => group.tasks) : filterTasks(tasks, query);
  const looking = query.trim();

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        title={switchTitle}
        aria-label={t("task.switch")}
        aria-expanded={open}
        className={cn(CIRCLE_BUTTON, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-elevated-hover")}
      >
        <MessagesSquare size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {motion.shown && (
        <AnchoredPopover anchorRef={buttonRef} popoverRef={popoverRef} align="end" data-task-picker-menu="" className={cn("w-[300px] overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 shadow-2xl shadow-black/50", motion.className)} {...motion.exitProps}>
          <div className="px-2 pb-1 pt-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-popover-border bg-popover-field px-2.5 py-1.5 focus-within:border-focus">
              <Search size={13} className="shrink-0 text-popover-ink-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (looking) setQuery("");
                    else closeMenu();
                    return;
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const first = visible[0];
                    if (!first) return;
                    if (first.threadId !== threadId) onSwitch(first.threadId);
                    closeMenu();
                  }
                }}
                placeholder={t("task.search")}
                aria-label={t("task.search")}
                className="w-full bg-transparent text-[12.5px] text-popover-ink placeholder:text-popover-placeholder focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto" role="group" aria-label={looking ? t("task.matching", { count: visible.length }) : t("task.list")}>
            {visible.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-popover-ink-secondary">
                {t("task.noMatch", { query: looking })}
              </div>
            ) : visible.map((task, index) => {
              const active = task.threadId === threadId;
              const opener = threadByline(task);
              const heading = grouped?.find((group) => group.tasks[0]?.threadId === task.threadId)?.project;
              return (
                <Fragment key={task.threadId}>
                {folders?.length && heading ? <div data-picker-folder={heading.id || undefined} className={cn("group/folder flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-medium text-popover-ink-secondary", index > 0 && "border-t border-popover-hairline")}>{heading.id && <FolderIcon emoji={heading.emoji} size={12} />}<span className="min-w-0 flex-1 truncate">{heading.name}</span>
                  {heading.id && folderActions && <FolderActions project={heading} canMoveUp={folderActions.canMove(heading.id, -1)} canMoveDown={folderActions.canMove(heading.id, 1)}
                    canMarkRead={folderActions.canMarkRead(heading.id)} saving={folderActions.saving}
                    menu={folderMenu?.projectId === heading.id ? folderMenu : null}
                    onMenuChange={(menu) => { clearDismiss(); setFolderMenu(menu ? { ...menu, projectId: heading.id } : null); }}
                    onEdit={() => folderActions.onEdit(heading.id)} onMove={(direction, onSaved) => folderActions.onMove(heading.id, direction, onSaved)}
                    onMarkRead={(onSaved) => folderActions.onMarkRead(heading.id, onSaved)} />}
                </div> : null}
                <div
                  className={cn("group flex items-center gap-2 px-2.5 py-2", active ? "bg-popover-hover" : "hover:bg-popover-hover")}
                >
                  <Check size={13} className={cn("shrink-0", active ? "text-popover-accent" : "opacity-0")} />
                  {renaming === task.threadId ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={80}
                      aria-label={t("task.renameAria")}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={() => commitRename(task.threadId, true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, true);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, false);
                        }
                      }}
                      className="min-w-0 flex-1 rounded bg-popover-field px-1.5 py-0.5 text-[13px] text-popover-ink focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      data-sidebar-thread-row={task.threadId}
                      aria-current={active ? "page" : undefined}
                      onClick={(e) => {
                        if (taskPickerPointerIntent("click", e.detail) !== "select") return;
                        if (!active) onSwitch(task.threadId);
                        queueDismiss();
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      className="min-w-0 flex-1 text-left"
                      title={t("task.renameHint")}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span dir="auto" className="truncate text-[13px] text-popover-ink">{task.title}</span>
                        {task.confidential === true && <ConfidentialBadge />}
                      </div>
                      <div className="text-[11px] text-popover-ink-secondary">
                        {task.activity === "waiting-on-you" ? `${t("task.waiting")} · ` : task.waitingForTeammates ? `${t("task.waitingOnTeammate")} · ` : task.busy ? `${t("chat.activity.working")} · ` : task.unread ? `${t("task.unread")} · ` : ""}
                        <TaskUpdatedTime task={task} now={now} />
                        <TaskUsage usage={task.usage} cacheKeepWarm={task.cacheKeepWarm} />
                        {opener && ` · ${opener}`}
                      </div>
                    </button>
                  )}
                  {renaming !== task.threadId && (
                    <button
                      type="button"
                      data-picker-row-menu={task.threadId}
                      onClick={(event) => {
                        clearDismiss();
                        if (rowMenu?.threadId === task.threadId) { setRowMenu(null); return; }
                        rowMenuAnchor.current = event.currentTarget;
                        const rect = event.currentTarget.getBoundingClientRect();
                        setRowMenu({ threadId: task.threadId, left: rect.left, top: rect.bottom + 4 });
                      }}
                      aria-label={t("task.actions", { title: task.title })}
                      title={t("task.actions", { title: task.title })}
                      aria-haspopup="menu"
                      aria-expanded={rowMenu?.threadId === task.threadId}
                      className={cn("rounded p-1 text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70", rowMenu?.threadId === task.threadId ? "opacity-100" : "opacity-0")}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  )}
                </div>
                <ThreadMenu tone="popover" task={task} folders={folders} anchorRef={rowMenuAnchor} onClose={() => setRowMenu(null)}
                  position={rowMenu?.threadId === task.threadId ? { left: rowMenu.left, top: rowMenu.top } : null}
                  actions={pickerRowActions(task, {
                    onRename: () => startRename(task),
                    onDelete: (id) => { if (!(busy && id === threadId)) onDelete(id); },
                    ...(onMove && folders?.length ? { onMove } : {}),
                    ...(onPin ? { onPin } : {}),
                    ...(threadActions ? { threadActions } : {}),
                  })} />
                </Fragment>
              );
            })}
          </div>
          {newButton ? newButton(closeMenu) : <button
            type="button"
            onClick={() => {
              onNew();
              closeMenu();
            }}
            disabled={busy}
            className="mt-1 flex w-full items-center gap-2 border-t border-popover-hairline px-3 py-2 text-left text-[13px] text-popover-ink hover:bg-popover-hover disabled:opacity-40"
          >
            <Plus size={13} className="text-popover-ink-secondary" /> {t("task.newShort")}
          </button>}
        </AnchoredPopover>
      )}
    </div>
  );
}

/** The conversation a thread chip left behind. Shown in the chat column,
 * threads on or off, until that conversation is on screen again. */
export function ThreadReturnLink({ ownerId, threadId }: { ownerId: string; threadId: string }) {
  const { state, dispatch } = useStore();
  const back = state.threadReturn;
  if (!back || (back.ownerId === ownerId && back.threadId === threadId)) return null;
  const bot = state.bots.find((candidate) => candidate.id === back.ownerId);
  const group = state.groups?.find((candidate) => candidate.id === back.ownerId);
  const title = (bot ?? group)?.tasks?.find((task) => task.threadId === back.threadId)?.title;
  return (
    <div className="flex shrink-0 items-center px-5 py-1" data-thread-return>
      <button
        type="button"
        title={title}
        onClick={() => {
          if (back.ownerId !== ownerId) dispatch({ type: "select", id: back.ownerId });
          if (group) {
            if (group.threadId !== back.threadId) dispatch({ type: "switchGroupTask", groupId: group.id, threadId: back.threadId });
            return;
          }
          if (!bot || bot.threadId !== back.threadId) dispatch({ type: "switchTask", botId: back.ownerId, threadId: back.threadId });
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink hover:bg-raised"
      >
        <ChevronLeft size={13} aria-hidden="true" />
        <span className="truncate">{t("task.backToConversation")}</span>
      </button>
    </div>
  );
}

/** Threads off: one quiet link back to the person's conversation when the
 * open thread is not their latest one (an untouched extra thread, or an
 * older sibling opened from the activity picker). Never creates a thread. */
export function ThreadsOffReturnLink({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  if (showThreads) return null;
  const target = threadsOffReturnTarget(bot);
  if (!target) return null;
  const title = bot.tasks?.find((task) => task.threadId === target)?.title;
  return (
    <div className="flex shrink-0 items-center px-5 py-1" data-threads-off-return>
      <button
        type="button"
        onClick={() => dispatch({ type: "switchTask", botId: bot.id, threadId: target })}
        title={title}
        className="rounded px-1.5 py-0.5 text-[12.5px] text-accent hover:bg-raised"
      >
        {t("task.backToConversation")}
      </button>
    </div>
  );
}

/** The threads the header picker lists for a bot: that bot's own threads
 * (`bot.tasks`, which the server builds from this bot's record only and, on
 * an organization server with private threads, narrows to the viewer's own),
 * minus routine runs, newest first. "opened by <peer>" on a row is a thread
 * a teammate bot opened on this bot, still this bot's thread. */
export function botPickerThreads(bot: Pick<Bot, "tasks">): Task[] {
  return orderedThreadList((bot.tasks ?? []).filter((task) => !task.routineRunId));
}

export function TaskPicker({ bot, initialOpen = false }: { bot: Bot; initialOpen?: boolean }) {
  const { state, dispatch } = useStore();
  // In the chat header mode only (useThreadsMode): the sidebar mode lists a
  // bot's threads under its row instead, and one conversation has none.
  const threadsMode = useThreadsMode();
  const [permissionRefresh, setPermissionRefresh] = useState<{ threadId: string; kind: "full" | "local-auto" } | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  if (threadsMode !== "header") return null;
  const projects = bot.projects ?? [];
  const projectIds = projects.map((project) => project.id);
  const threadActions: PickerThreadActions = {
    onCopyLink: (threadId) => {
      // a refused write leaves the link available to copy again
      void copyText(threadRefUrl({ botId: bot.id, threadId }));
    },
    onMakeConfidential: (threadId) => dispatch({ type: "makeTaskConfidential", botId: bot.id, threadId }),
    onRegenerateTitle: llmThreadTitlesEnabled(state.config)
      ? (threadId, onSettled) => dispatch({ type: "regenerateTaskTitle", botId: bot.id, threadId, onSettled })
      : undefined,
    onArchive: (threadId, archivedAt) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { archivedAt } }),
    onSnooze: (threadId, snoozedUntil) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { snoozedUntil } }),
    // the same checks as the sidebar row had: a wider approval level asks first
    onRefreshPermissions: (threadId) => {
      const mode = botApprovalSetting(bot);
      const threadMode = approvalModeFor(currentTaskBot(bot, threadId));
      if (mode === "full" && threadMode !== "full") { setPermissionRefresh({ threadId, kind: "full" }); return; }
      if (mode === "auto" && bot.computer === "local" && threadMode !== "auto") { setPermissionRefresh({ threadId, kind: "local-auto" }); return; }
      dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId });
    },
    ...(teamBotSourceAllowed(bot.id) ? {
      onCreateTeamBot: (threadId: string) => openTeamBotFromThread({ botId: bot.id, threadId, title: (bot.tasks ?? []).find((task) => task.threadId === threadId)?.title ?? "" }),
    } : {}),
  };
  const folderActions: PickerFolderActions = {
    saving: folderSaving,
    canMove: (projectId, direction) => {
      const index = projectIds.indexOf(projectId);
      return index >= 0 && index + direction >= 0 && index + direction < projectIds.length;
    },
    canMarkRead: (projectId) => folderUnreadThreadIds(bot, projectId).length > 0,
    onEdit: (projectId) => setEditingProject(projectId),
    onMove: (projectId, direction, onSaved) => {
      const ids = moveFolder(projectIds, projectId, direction);
      if (folderSaving || ids.every((id, index) => id === projectIds[index])) return;
      setFolderSaving(true); setFolderError(null);
      dispatch({ type: "reorderProjects", botId: bot.id, projectIds: ids,
        onSaved: () => { setFolderSaving(false); onSaved(); },
        onError: (message) => { setFolderSaving(false); setFolderError(message); } });
    },
    onMarkRead: (projectId, onSaved) => {
      if (folderSaving) return;
      setFolderSaving(true); setFolderError(null);
      markFolderRead(bot, projectId, api, (updated) => dispatch({ type: "botPatched", bot: updated }))
        .then(() => onSaved())
        .catch((error: unknown) => setFolderError(readableError(error)))
        .finally(() => setFolderSaving(false));
    },
  };
  const projectToEdit = projects.find((project) => project.id === editingProject);
  return (
    <>
    <ConversationTaskPicker
      threadId={bot.threadId}
      tasks={botPickerThreads(bot)}
      busy={false}
      folders={bot.projects ?? []}
      newButton={(close) => <div className="mt-1 border-t border-popover-hairline">
        {newThreadChoices(state.config?.confidentialThreadsByDefault === true).map((kind) =>
          <NewThreadButton key={kind.label} bot={bot} kind={kind} onCreated={close} className="w-full rounded-none" />)}
      </div>}
      onNew={() => dispatch({ type: "newTask", botId: bot.id })}
      onSwitch={(threadId) => dispatch({ type: "switchTask", botId: bot.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameTask", botId: bot.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteTask", botId: bot.id, threadId })}
      onMove={(threadId, projectId) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { projectId } })}
      onPin={(threadId, pinned) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { pinned } })}
      threadActions={threadActions}
      folderActions={projects.length ? folderActions : undefined}
      initialOpen={initialOpen}
    />
    {folderError && <p role="alert" data-thread-overlay className="fixed bottom-4 right-4 z-50 max-w-[320px] rounded-lg border border-hairline/50 bg-card px-3 py-2 text-[12px] text-danger shadow-xl" onClick={() => setFolderError(null)}>{folderError}</p>}
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
    {projectToEdit && <BotProjectDialog bot={bot} project={projectToEdit} onClose={() => setEditingProject(null)} />}
    </>
  );
}

/** The same task affordance in a channel. DMs never render it because their
 * transcript is the private bot-to-bot exchange rather than user work. Like
 * the bot's, it shows only while threads are on (Settings > Appearance). */
export function GroupTaskPicker({ group }: { group: Group }) {
  const { dispatch } = useStore();
  // each thread of a room works on its own: its row says so, not the room
  const tasks = useMemo(() => {
    return (group.tasks ?? []).map((task) => ({
      ...task,
      busy: Boolean(task.working || task.busyBotId),
    }));
  }, [group.tasks]);
  // Like a bot's and a person's: in the header location only; the sidebar
  // location lists the room's threads under its row instead, never both.
  if (useThreadsMode() !== "header") return null;
  return (
    <ConversationTaskPicker
      threadId={group.threadId}
      tasks={orderedThreadList(tasks)}
      busy={false}
      onNew={() => dispatch({ type: "newGroupTask", groupId: group.id })}
      onSwitch={(threadId) => dispatch({ type: "switchGroupTask", groupId: group.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameGroupTask", groupId: group.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteGroupTask", groupId: group.id, threadId })}
      onPin={(threadId, pinned) => {
        const title = group.tasks?.find((task) => task.threadId === threadId)?.title ?? "";
        dispatch({ type: "pinGroupTask", groupId: group.id, threadId, pinned, title });
      }}
    />
  );
}

/** A conversation with a person has threads like a bot (server/people-dms.ts):
 * the same picker, menus and folders, in the chat header while Settings >
 * Appearance puts threads there; in the sidebar location the list sits
 * under the person's row instead, never both. No generated title (that
 * would send the pair's words to a model) and no approval refresh (there is
 * no bot). */
export function PersonThreadPicker({ group, initialOpen = false }: { group: Group; initialOpen?: boolean }) {
  const { dispatch } = useStore();
  const threadsMode = useThreadsMode();
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  if (!group.peopleDm || threadsMode !== "header") return null;
  const projects = group.projects ?? [];
  const projectIds = projects.map((project) => project.id);
  const update = (threadId: string, patch: GroupTaskUpdatePatch) => dispatch({ type: "updateGroupTask", groupId: group.id, threadId, patch });
  const threadActions: PickerThreadActions = {
    onCopyLink: (threadId) => { void copyText(threadRefUrl({ botId: group.id, threadId })); },
    onArchive: (threadId, archivedAt) => update(threadId, { archivedAt }),
    onSnooze: (threadId, snoozedUntil) => update(threadId, { snoozedUntil }),
  };
  const folderActions: PickerFolderActions = {
    saving: folderSaving,
    canMove: (projectId, direction) => {
      const index = projectIds.indexOf(projectId);
      return index >= 0 && index + direction >= 0 && index + direction < projectIds.length;
    },
    canMarkRead: (projectId) => folderUnreadThreadIds(group, projectId).length > 0,
    onEdit: (projectId) => setEditingProject(projectId),
    onMove: (projectId, direction, onSaved) => {
      const ids = moveFolder(projectIds, projectId, direction);
      if (folderSaving || ids.every((id, index) => id === projectIds[index])) return;
      setFolderSaving(true); setFolderError(null);
      dispatch({ type: "reorderProjects", botId: group.id, owner: "group", projectIds: ids,
        onSaved: () => { setFolderSaving(false); onSaved(); },
        onError: (message) => { setFolderSaving(false); setFolderError(message); } });
    },
    onMarkRead: (projectId, onSaved) => {
      if (folderSaving) return;
      setFolderSaving(true); setFolderError(null);
      markGroupFolderRead(group, projectId, api, (updated) => dispatch({ type: "groupPatched", group: updated }))
        .then(() => onSaved())
        .catch((error: unknown) => setFolderError(readableError(error)))
        .finally(() => setFolderSaving(false));
    },
  };
  const projectToEdit = projects.find((project) => project.id === editingProject);
  return (
    <>
    <ConversationTaskPicker
      threadId={group.threadId}
      tasks={personPickerThreads(group)}
      busy={false}
      folders={projects}
      newButton={(close) => <NewThreadButton bot={group} owner="group" onCreated={close} className="mt-1 w-full rounded-none border-t border-popover-hairline" />}
      onNew={() => dispatch({ type: "newGroupTask", groupId: group.id })}
      onSwitch={(threadId) => dispatch({ type: "switchGroupTask", groupId: group.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameGroupTask", groupId: group.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteGroupTask", groupId: group.id, threadId })}
      onMove={(threadId, projectId) => update(threadId, { projectId })}
      onPin={(threadId, pinned) => update(threadId, { pinned })}
      threadActions={threadActions}
      folderActions={projects.length ? folderActions : undefined}
      initialOpen={initialOpen}
    />
    {folderError && <p role="alert" data-thread-overlay className="fixed bottom-4 right-4 z-50 max-w-[320px] rounded-lg border border-hairline/50 bg-card px-3 py-2 text-[12px] text-danger shadow-xl" onClick={() => setFolderError(null)}>{folderError}</p>}
    {projectToEdit && <BotProjectDialog bot={group} owner="group" project={projectToEdit} onClose={() => setEditingProject(null)} />}
    </>
  );
}
