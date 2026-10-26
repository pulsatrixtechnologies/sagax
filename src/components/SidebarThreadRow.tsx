import { memo, useEffect, useRef, useState } from "react";
import { Clock3, Loader2, MoreHorizontal, Pin } from "lucide-react";
import type { BotProject, Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { nextRename } from "@/lib/rename";
import { threadRefUrl } from "@/lib/thread-refs";
import { copyText } from "@/lib/copy-text";
import { openTeamBotFromThread, teamBotSourceAllowed } from "@/lib/teambot-from-thread";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConfidentialBadge } from "./ConfidentialBanner";
import { ThreadMenu, nextSixPm, tomorrowNineAm } from "./ThreadMenu";
import { THREAD_DRAG_TYPE } from "@/lib/folder-order";
import { threadLinkLabel } from "../../shared/thread-link";
import { wantsSideThread } from "@/lib/side-thread";
import type { ThreadPrefetchIntent } from "@/state/thread-prefetch";

type ThreadRowTask = Pick<Task, "threadId" | "title" | "projectId" | "busy" | "activity" | "unread" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates" | "link" | "confidential"> & {
  queued?: boolean;
  pinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
  /** A turn is running with Ultracode effort. */
  ultracode?: boolean;
};

/** Local date and time. The runtime's timezone and locale are used on
 * purpose: a desktop in Tokyo and one in New York should not be forced
 * onto UTC. */
export function formatUpdatedAt(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  return new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

/** The visible stamp on a thread row: "just now" for the freshest work, then
 * minutes, hours, and days, then the full date once a thread is a week old.
 * The caller supplies "now" so one clock tick re-renders a whole list
 * instead of each row keeping its own timer. */
export function threadUpdatedLabel(at: number, now: number): string {
  if (stampClock(at, now) === undefined) return formatUpdatedAt(at);
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return t("task.updated.justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("task.updated.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  // Tier on unrounded time like the week gate in stampClock: 23.5 hours
  // rounds to a display of "24 h ago" without a day having actually passed.
  if (seconds < 86_400) return t("task.updated.hours", { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("task.updated.yesterday");
  return t("task.updated.days", { count: days });
}

/** The clock a row's stamp reads: the list's tick while the stamp is
 * relative, nothing once it is a fixed date (a week or more old;
 * threadUpdatedLabel reads it too). A row with no clock keeps its date and
 * skips the list's tick. The week is unrounded elapsed time: six and a half
 * days rounds to "7 d ago" but is still inside the week, so the absolute
 * date waits for a full seven days. */
export function stampClock(at: number, now: number): number | undefined {
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) return undefined;
  return Math.max(0, Math.round((now - at) / 1000)) < 7 * 86_400 ? now : undefined;
}

/** Newest message, else when the thread was created. Missing stamps sort as
 * oldest so a half-loaded row cannot jump the list as NaN. */
export function threadRecency(task: { updatedAt?: number; createdAt?: number }): number {
  if (typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt)) return task.updatedAt;
  if (typeof task.createdAt === "number" && Number.isFinite(task.createdAt)) return task.createdAt;
  return 0;
}

/** Pin, then newest update. Equal stamps keep the caller's order. Attention
 * state does not move a row — the bell and the activity hatch still use
 * orderedSidebarThreads for that. */
export function orderedThreadList<T extends { pinned?: boolean; updatedAt?: number; createdAt?: number }>(tasks: T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const pin = Number(b.task.pinned === true) - Number(a.task.pinned === true);
      if (pin) return pin;
      const recency = threadRecency(b.task) - threadRecency(a.task);
      if (recency) return recency;
      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

/** "opened by Scout" for a thread a bot started, null for the person's own.
 * Shared by the sidebar row and the All-threads picker so both say it the
 * same quiet way. */
export function threadOpenerLabel(task: Pick<Task, "openedBy">): string | null {
  const name = task.openedBy?.name.trim();
  return name ? t("task.openedBy", { name }) : null;
}

/** The one line under a title: "closed by Scout" once a bot has closed the
 * thread, "Archived" once the person put it away, "Snoozed" while it sleeps,
 * otherwise who opened it, otherwise nothing. Closed wins because it is the
 * newer fact; archived and snoozed win over the opener because each explains
 * why the row sits where it does. */
export function threadByline(task: Pick<Task, "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil">): string | null {
  const closer = task.closedBy?.name.trim();
  if (closer) return t("task.closedBy", { name: closer });
  if (isArchived(task)) return t("task.archived");
  return isSnoozed(task) ? t("task.snoozed") : threadOpenerLabel(task);
}

/** Archived means the field is present, not truthy: the task API accepts any
 * epoch number, so a thread persisted with archivedAt: 0 is archived. */
export const isArchived = (task: Pick<Task, "archivedAt">): boolean => task.archivedAt !== undefined;

/** Snoozed means asleep right now: 0 is the "until new activity" sentinel
 * and sleeps until woken, while a timestamp sleeps only until it passes.
 * The server drops expired snoozes from snapshots, but a live event stream
 * never refreshes one, so the client checks the clock too. */
export const isSnoozed = (task: Pick<Task, "snoozedUntil">, now = Date.now()): boolean =>
  task.snoozedUntil !== undefined && (task.snoozedUntil === 0 || task.snoozedUntil > now);

// Snooze presets live with the one thread menu; re-exported for callers.
export { nextSixPm, tomorrowNineAm };

/** Working is activity or flag: the wire can carry either alone, so the
 * visibility filter, the Working status, and the busy-disabled actions must
 * all ask the same question. */
const isWorking = (task: Pick<Task, "activity" | "busy">): boolean => task.activity === "working" || Boolean(task.busy);

/** The current wire distinguishes coordination waits from provider work. */
const isWaitingOnTeammate = (task: Pick<Task, "waitingForTeammates">): boolean =>
  task.waitingForTeammates === true;

/** Whether a row must stay on screen regardless of age or closed state:
 * the person is looking at it, it needs them, or it has something new. */
const demandsAttention = (task: ThreadRowTask, activeId: string) =>
  task.threadId === activeId || task.activity === "waiting-on-you" || isWorking(task) || isWaitingOnTeammate(task) || Boolean(task.queued) || Boolean(task.unread);

/** The default list is the six most recently updated OPEN threads, plus
 * anything pinned or demanding attention. Pins and attention rows do not
 * consume one of the six. A thread a bot closed is folded away — a PM bot
 * that opened ten helper threads and closed them must not leave ten rows
 * behind — but it is never gone: "show all" and search still list it, a
 * closed thread that becomes busy or unread is back at once, and a pin
 * keeps a closed or archived thread in the list. An archived thread is folded
 * away whatever happens in it, unless it is the open one. */
export function visibleSidebarThreads<T extends ThreadRowTask>(tasks: T[], activeId: string, query = "", folders: BotProject[] = [], showAll = false): T[] {
  const needle = query.trim().toLowerCase();
  if (needle) {
    return tasks.filter((task) => task.title.toLowerCase().includes(needle) || folders.some((folder) => folder.id === task.projectId && folder.name.toLowerCase().includes(needle)));
  }
  if (showAll) return tasks;
  let open = 0;
  return orderedThreadList(tasks).filter((task) => {
    if (task.pinned === true) return true;
    // An archived thread stays archived until the person unarchives it, even
    // when something new lands in it; only the open one is shown.
    if (isArchived(task)) return task.threadId === activeId;
    return task.closedBy || isSnoozed(task)
      ? demandsAttention(task, activeId)
      : open++ < 6 || demandsAttention(task, activeId);
  });
}

/** The soonest still-future timed snooze in a list, undefined when nothing
 * is scheduled to wake: 0 sleeps until activity and never ticks, and a
 * timestamp already in the past has nothing left to wait for. */
export const nextSnoozeExpiry = (tasks: readonly Pick<Task, "snoozedUntil">[], now = Date.now()): number | undefined =>
  tasks.reduce<number | undefined>((soonest, task) => {
    const until = task.snoozedUntil;
    return until !== undefined && until > 0 && until > now ? Math.min(soonest ?? Number.POSITIVE_INFINITY, until) : soonest;
  }, undefined);

/** A timed snooze ends on the wall clock, not on a server ping: rerender
 * the list when the nearest one expires so its row folds back in without
 * waiting for the next snapshot. */
export function useSnoozeExpiry(tasks: readonly Pick<Task, "snoozedUntil">[]): void {
  const [tick, rerender] = useState(0);
  const next = nextSnoozeExpiry(tasks);
  useEffect(() => {
    if (next === undefined) return;
    // Timers clamp delays above 2^31-1 to almost zero. Recheck distant
    // deadlines in bounded chunks and also handle expiry before this effect.
    const id = window.setTimeout(() => rerender((count) => count + 1), Math.max(1, Math.min(2_147_483_647, next - Date.now() + 1)));
    return () => window.clearTimeout(id);
  }, [next, tick]);
}

/** One low-frequency clock for every relative stamp in a list: rows stay
 * timer-free and re-render when this tick moves. Paused while the window is
 * hidden, resynced the moment it becomes visible again, and cleared on
 * unmount — the same shape the computer inventory's refresh uses. */
export function useRelativeNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    const timer = window.setInterval(sync, 30_000);
    // a window returning from hours hidden should not show a stale label
    // while it waits for the next tick
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return now;
}
/** Attention outranks recency within a bot: waiting-on-you needs the person
 * most, then working/busy, then a teammate wait, then queued, then unread.
 * The thread being looked at rides just
 * above the idle tail; idle threads keep stored order. Pure and shared so
 * the tree, the collapsed escape hatch, and the pickers agree. */
const attentionRank = (task: ThreadRowTask, activeId: string): number => {
  if (task.activity === "waiting-on-you") return 0;
  if (isWaitingOnTeammate(task)) return 2;
  if (task.busy || task.activity === "working") return 1;
  if (task.queued) return 3;
  if (task.unread) return 4;
  if (task.threadId === activeId) return 5;
  return 6;
};

/** Order, never filter: whatever the caller passes stays visible, only the
 * position changes. Array#sort is stable, so equal ranks keep stored order. */
export function orderedSidebarThreads<T extends ThreadRowTask>(tasks: T[], activeId: string): T[] {
  return tasks
    .map((task, index) => ({ task, index, rank: attentionRank(task, activeId) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.task);
}

type ThreadRowProps = {
  task: ThreadRowTask;
  /** the bot or room that owns the thread: the link's ?bot= */
  ownerId: string;
  current: boolean;
  compact?: boolean;
  folders?: BotProject[];
  /** Live verb the chat pane already derives ("Reading a file"); shown only while the row is working. */
  activityLabel?: string;
  /** The list's clock tick while the stamp reads relative (stampClock).
   * Omit to keep the absolute date. */
  now?: number;
  /** The app language. Rows show catalog strings, so a change re-renders them. */
  locale: string;
  /** The row's actions take the thread they act on, so a list hands every
   * row the same functions and a memoized row skips its list's renders. */
  onSelect: (task: ThreadRowTask) => void;
  onRename: (task: ThreadRowTask, title: string) => void;
  /** Present only where generated titles are available. Calls back once the
   * request settles, ok or not; the new title arrives with the bot event. */
  onRegenerateTitle?: (task: ThreadRowTask, onSettled: (ok: boolean) => void) => void;
  onDelete: (task: ThreadRowTask) => void;
  onMove?: (task: ThreadRowTask, folderId: string | null) => void;
  onArchive?: (task: ThreadRowTask, archivedAt: number | null) => void;
  onPin?: (task: ThreadRowTask, pinned: boolean) => void;
  onSnooze?: (task: ThreadRowTask, snoozedUntil: number | null) => void;
  onLink?: (task: ThreadRowTask, link: string | null) => void;
  /** Copy this bot's current approval level and saved approvals onto this thread. */
  onRefreshPermissions?: (task: ThreadRowTask) => void;
  /** Show the thread beside the main chat: the menu's Open beside, and
   * Option-click (Alt-click) on the row. Bot threads only. */
  onOpenAside?: (task: ThreadRowTask) => void;
  /** Make the thread confidential, for good (the menu asks first). Bot
   * threads only. */
  onMakeConfidential?: (task: ThreadRowTask) => void;
  /** A read-only prefetch of the thread: the pointer rests on the row
   * ("hover"), leaves it ("leave"), or the keyboard reaches it ("focus"). */
  onPrefetch?: (task: ThreadRowTask, intent: ThreadPrefetchIntent) => void;
};

/** Same fields, each the same value: lists build each row's task afresh
 * (with its queued and working state), so the object itself is new on every
 * list render even when nothing in it changed. */
const sameFields = <T extends object>(a: T, b: T): boolean => {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
};

/** A row renders again only when a field of its thread or one of its other
 * props changes. */
const sameThreadRow = ({ task: previousTask, ...previous }: ThreadRowProps, { task, ...next }: ThreadRowProps): boolean =>
  sameFields(previousTask, task) && sameFields(previous, next);

/** One quiet row for bot and group histories. Surface denotes selection;
 * working/waiting/unread remain independent signals, never different cards. */
export const SidebarThreadRow = memo(function SidebarThreadRow({ task, ownerId, current, compact, folders, onSelect, onRename, onRegenerateTitle, onDelete, onMove, onArchive, onPin, onSnooze, onLink, onRefreshPermissions, onOpenAside: openAside, onMakeConfidential, onPrefetch, activityLabel, now }: ThreadRowProps) {
  // The thread on screen in the main chat has nothing to open beside it.
  const onOpenAside = current ? undefined : openAside;
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [deleting, setDeleting] = useState(false);
  const finishing = useRef(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const status = task.activity === "waiting-on-you" ? t("task.waiting") : isWaitingOnTeammate(task) ? t("task.waitingOnTeammate") : isWorking(task) ? activityLabel ?? t("chat.activity.working") : task.queued ? t("task.queued") : null;
  const byline = threadByline(task);
  const updatedAt = threadRecency(task);
  const updatedStamp = formatUpdatedAt(updatedAt);
  const updatedLabel = now === undefined ? updatedStamp : threadUpdatedLabel(updatedAt, now);
  const closed = Boolean(task.closedBy) && !status;
  const archived = isArchived(task);
  const snoozed = isSnoozed(task);
  const openMenu = (x: number, y: number) => setMenu({ left: Math.max(8, Math.min(x, window.innerWidth - 228)), top: Math.max(8, Math.min(y, window.innerHeight - 200)) });
  const canDrag = Boolean(onMove) && !renaming;
  const startRename = () => { finishing.current = false; setDraft(task.title); setRenaming(true); setMenu(null); };
  const finishRename = (save: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    const title = save ? nextRename(task.title, draft) : null;
    setRenaming(false);
    if (title) onRename(task, title);
  };
  return <>
    <div
      draggable={canDrag}
      data-sidebar-thread-drag={canDrag ? "" : undefined}
      onDragStart={(event) => {
        if (!canDrag) return;
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(THREAD_DRAG_TYPE, JSON.stringify({ ownerId, threadId: task.threadId }));
      }}
      onDragEnd={(event) => event.stopPropagation()}
      className={cn("group/thread relative flex min-w-0 items-center rounded-lg", canDrag && "cursor-grab active:cursor-grabbing", current ? "bg-sidebar-selected" : "hover:bg-sidebar-hover")}
    >
      {renaming ? <input autoFocus value={draft} maxLength={80} aria-label={t("task.renameAria")}
        onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={() => finishRename(true)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); finishRename(true); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishRename(false); } }}
        dir="auto" className="m-1 min-w-0 flex-1 rounded border border-accent/50 bg-inset px-2 py-1 text-[12.5px] text-ink outline-none" /> : <button
        type="button" data-sidebar-thread-row={task.threadId} aria-current={current ? "page" : undefined}
        title={[task.title, task.confidential === true ? t("confidential.mark") : null, updatedStamp, status, closed ? t("task.closed") : null, archived ? t("task.archived") : null, snoozed ? t("task.snoozed") : null, task.unread ? t("task.unread") : null].filter(Boolean).join(" · ")}
        onClick={(event) => { if (onOpenAside && wantsSideThread(event)) { event.preventDefault(); onOpenAside(task); } else onSelect(task); }} onDoubleClick={startRename}
        onPointerEnter={onPrefetch && !current ? () => onPrefetch(task, "hover") : undefined}
        onPointerLeave={onPrefetch && !current ? () => onPrefetch(task, "leave") : undefined}
        // keyboard focus only: a click focuses the row too, and the switch it makes reads the page anyway
        onFocus={onPrefetch && !current ? (event) => { if (event.currentTarget.matches(":focus-visible")) onPrefetch(task, "focus"); } : undefined}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY); }}
        onKeyDown={(event) => { if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom); } }}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-lg pl-6 pr-1 text-left text-[13px] font-medium outline-none focus-visible:ring-1 focus-visible:ring-accent/60", compact ? "min-h-7 py-1" : "min-h-8 py-1.5", current ? "font-semibold text-sidebar-ink" : "text-sidebar-ink-secondary hover:text-sidebar-ink")}>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* dir=auto keeps an Arabic title's start and ellipsizes its end.
              max-w-max keeps flex-1 from pushing a byline off a short English title. */}
          <span dir="auto" className={cn("min-w-0 flex-1 max-w-max truncate", task.unread && "font-semibold text-sidebar-ink", (closed || archived || snoozed) && !current && "text-sidebar-ink-secondary/70")}>{task.title}</span>
          {byline && (
            // the same line and size as the title, only quieter: a second
            // line per thread made the list twice as tall as it needs to be
            <span className="min-w-0 max-w-[45%] shrink truncate font-normal text-sidebar-ink-secondary/80">{byline}</span>
          )}
        </span>
        {task.unread && <span className="sr-only">{t("task.unread")}</span>}
      </button>}
      {task.link && <a href={task.link} target="_blank" rel="noreferrer" dir="ltr" title={task.link} aria-label={t("task.openLink", { link: threadLinkLabel(task.link) ?? task.link })}
        className="shrink-0 rounded px-1 font-mono text-[11px] text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink outline-none focus-visible:ring-1 focus-visible:ring-accent/60 [unicode-bidi:isolate]">{threadLinkLabel(task.link) ?? t("task.link")}</a>}
      {!renaming && <span className="flex shrink-0 items-center gap-2 px-1" onClick={() => onSelect(task)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(event.clientX, event.clientY); }}>
        {updatedLabel && <time dateTime={new Date(updatedAt).toISOString()} className="shrink-0 tabular-nums text-[10px] text-sidebar-ink-secondary">{updatedLabel}</time>}
        {task.confidential === true && <ConfidentialBadge compact={compact} />}
        {task.pinned === true && <Pin size={11} className="shrink-0 text-sidebar-ink-secondary" aria-label={t("sidebar.bot.pin")} />}
        {task.activity === "waiting-on-you" ? <span className="shrink-0 text-[10px] font-medium text-warning">{t("task.waiting")}</span> : isWaitingOnTeammate(task) ? <Clock3 size={11} className="shrink-0 text-sidebar-ink-secondary" aria-label={t("task.waitingOnTeammate")} /> : isWorking(task) ? (task.ultracode ? <span className="size-2 shrink-0 rounded-full ultracode-sidebar-dot animate-status-pulse" aria-label={activityLabel ?? t("chat.activity.working")} /> : <Loader2 size={11} className="shrink-0 animate-spin text-success" aria-label={activityLabel ?? t("chat.activity.working")} />) : task.queued ? <span className="shrink-0 text-[10px] text-sidebar-ink-secondary">{t("task.queued")}</span> : null}
      </span>}
      <button ref={actionRef} type="button" aria-label={t("task.actions", { title: task.title })} aria-expanded={Boolean(menu)}
        onClick={(event) => { if (menu) { setMenu(null); return; } const rect = event.currentTarget.getBoundingClientRect(); openMenu(rect.left, rect.bottom); }}
        className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded text-sidebar-ink-secondary opacity-0 hover:bg-sidebar-hover hover:text-sidebar-ink focus-visible:opacity-100 group-hover/thread:opacity-100 max-md:opacity-70 touch:opacity-70">
        <MoreHorizontal size={13} />
      </button>
    </div>
    <ThreadMenu task={task} folders={folders} position={menu} onClose={() => setMenu(null)} anchorRef={actionRef} actions={{
      onRename: startRename,
      onDelete: () => setDeleting(true),
      ...(onPin ? { onPin: (pinned: boolean) => onPin(task, pinned) } : {}),
      ...(onArchive ? { onArchive: (archivedAt: number | null) => onArchive(task, archivedAt) } : {}),
      ...(onSnooze ? { onSnooze: (until: number | null) => onSnooze(task, until) } : {}),
      ...(onMove ? { onMove: (folderId: string | null) => onMove(task, folderId) } : {}),
      // A failed write leaves the link available to copy again.
      onCopyLink: () => { void copyText(threadRefUrl({ botId: ownerId, threadId: task.threadId })); },
      ...(onRegenerateTitle ? { onRegenerateTitle: (onSettled: (ok: boolean) => void) => onRegenerateTitle(task, onSettled) } : {}),
      ...(onLink ? { onRemoveLink: () => onLink(task, null) } : {}),
      ...(onRefreshPermissions ? { onRefreshPermissions: () => onRefreshPermissions(task) } : {}),
      ...(teamBotSourceAllowed(ownerId) ? { onCreateTeamBot: () => openTeamBotFromThread({ botId: ownerId, threadId: task.threadId, title: task.title }) } : {}),
      ...(onOpenAside ? { onOpenAside: () => onOpenAside(task) } : {}),
      ...(onMakeConfidential && task.confidential !== true ? { onMakeConfidential: () => onMakeConfidential(task) } : {}),
    }} />
    <ConfirmDialog open={deleting} title={t("task.deleteConfirm")} body={t("task.deleteBody", { title: task.title })} confirmLabel={t("task.deleteAria")}
      onCancel={() => setDeleting(false)} onConfirm={() => { if (!isWorking(task)) onDelete(task); setDeleting(false); }} returnFocusRef={actionRef} />
  </>;
}, sameThreadRow);
