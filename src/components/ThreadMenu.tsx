// The one menu of a thread (2026-10-14): the sidebar's thread rows and
// the header's "All threads" picker open this same component, so a thread
// offers the same actions wherever it is listed. One menu, no More (the maintainer,
// 2026-10-15), in short sections like the reference design's (2026-10-16):
// Open beside | Rename, Regenerate title, Pin, Move to folder › | Archive, Snooze › |
// Copy link, Create a Team Bot, Remove link | Refresh permissions | Delete in red. Only Snooze
// and Move to folder open a page, one level down.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, BellOff, Check, ChevronLeft, ChevronRight, Clock, FolderInput, Link2, Link2Off, Loader2, Lock, PanelRight, Pencil, Pin, PinOff, RefreshCw, Trash2, UsersRound } from "lucide-react";
import type { BotProject, Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useHeldMenuMotion } from "./MenuMotion";
import { FolderIcon, navigateThreadMenu } from "./BotProjects";
import { ConfirmDialog } from "./ConfirmDialog";

export type ThreadMenuTask = Pick<Task, "threadId" | "title"> & Partial<Pick<Task, "projectId" | "busy" | "activity" | "archivedAt" | "snoozedUntil" | "link" | "confidential">> & { pinned?: boolean };

export type ThreadMenuPage = "main" | "snooze" | "move";

/** What a thread menu can do. Each action is offered only when its owner
 * gives it; Rename and Delete are always there. */
export type ThreadMenuActions = {
  onRename: () => void;
  onDelete: () => void;
  onPin?: (pinned: boolean) => void;
  onArchive?: (archivedAt: number | null) => void;
  onSnooze?: (snoozedUntil: number | null) => void;
  /** Move into one of `folders`; null takes it out of any folder. */
  onMove?: (folderId: string | null) => void;
  onCopyLink?: () => void;
  /** Present only where generated titles are on. Calls back once settled. */
  onRegenerateTitle?: (onSettled: (ok: boolean) => void) => void;
  /** Present for a linked thread's owner: removes the link. */
  onRemoveLink?: () => void;
  /** Copy the bot's current approval level onto this thread. */
  /** Start a Team Bot from this conversation (TeamBotFromThreadDialog). */
  onCreateTeamBot?: () => void;
  /** Show the thread beside the main chat (src/lib/side-thread.ts). */
  onOpenAside?: () => void;
  /** Make this thread confidential (src/lib/confidential-thread.ts). The
   * menu asks first, because it is permanent; there is no way back, so no
   * action turns it off. */
  onMakeConfidential?: () => void;
};

/** The next local 6 PM, rolling to tomorrow once tonight's is past. */
export const nextSixPm = () => {
  const when = new Date();
  when.setHours(18, 0, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
  return when.getTime();
};

/** Tomorrow morning at 9 local. */
export const tomorrowNineAm = () => {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(9, 0, 0, 0);
  return when.getTime();
};

const working = (task: ThreadMenuTask) => task.activity === "working" || Boolean(task.busy);
const archivedNow = (task: ThreadMenuTask) => task.archivedAt !== undefined;
const snoozedNow = (task: ThreadMenuTask, now = Date.now()) =>
  task.snoozedUntil !== undefined && (task.snoozedUntil === 0 || task.snoozedUntil > now);

const ITEM = "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] hover:bg-raised disabled:opacity-40";

function Item({ icon, label, onClick, id, danger, disabled, title, busy, trailing }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  id: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" data-thread-menu-item={id} disabled={disabled ?? false} aria-busy={busy || undefined} title={title} onClick={onClick}
      className={cn(ITEM, danger ? "text-danger" : "text-ink")}>
      {icon}<span className="min-w-0 flex-1 truncate">{label}</span>{trailing}
    </button>
  );
}

/** The items of one page of the menu. Pure: the page, the busy title
 * request and the close live in ThreadMenu (and tests pass them in). */
export function ThreadMenuItems({ task, actions, folders = [], page, onPage, onClose, regenerating, onRegenerate }: {
  task: ThreadMenuTask;
  actions: ThreadMenuActions;
  folders?: readonly BotProject[];
  page: ThreadMenuPage;
  onPage: (page: ThreadMenuPage) => void;
  onClose: () => void;
  regenerating: boolean;
  onRegenerate: () => void;
  /** Advanced mode: the technical actions (Refresh permissions). */
  /** kept for callers; no item depends on it since #4200 */
  advanced?: boolean;
}) {
  const busy = working(task);
  const archived = archivedNow(task);
  const snoozed = snoozedNow(task);
  const run = (action: () => void) => () => { onClose(); action(); };
  const back = (to: ThreadMenuPage, label: string) => (
    <button type="button" role="menuitem" data-thread-menu-item="back" onClick={() => onPage(to)}
      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11.5px] font-medium text-ink-secondary hover:bg-raised">
      <ChevronLeft size={12} aria-hidden="true" />{label}
    </button>
  );
  const sub = <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-ink-tertiary" />;
  const canMove = Boolean(actions.onMove) && folders.length > 0;

  if (page === "snooze" && actions.onSnooze) {
    const snooze = actions.onSnooze;
    return <>
      {back("main", t("task.snooze"))}
      {snoozed && <Item id="stop-snooze" icon={<BellOff size={12} />} label={t("task.stopSnoozing")} onClick={run(() => snooze(null))} />}
      {[
        { id: "snooze-activity", label: t("task.snoozeUntilActivity"), at: () => 0 },
        { id: "snooze-tonight", label: t("task.snoozeTonight"), at: nextSixPm },
        { id: "snooze-tomorrow", label: t("task.snoozeTomorrow"), at: tomorrowNineAm },
      ].map((preset) => <Item key={preset.id} id={preset.id} icon={<Clock size={12} />} label={preset.label} disabled={busy} onClick={run(() => snooze(preset.at()))} />)}
    </>;
  }

  if (page === "move" && canMove) {
    const move = actions.onMove!;
    const current = folders.some((folder) => folder.id === task.projectId) ? task.projectId : undefined;
    return <>
      {back("main", t("folder.move"))}
      {folders.map((folder) => <Item key={folder.id} id={`folder-${folder.id}`} icon={<FolderIcon emoji={folder.emoji} size={12} />} label={folder.name}
        trailing={folder.id === current ? <Check size={12} className="shrink-0 text-accent" /> : null}
        onClick={run(() => { if (folder.id !== current) move(folder.id); })} />)}
      <Item id="folder-none" icon={<FolderInput size={12} />} label={t("folder.none")}
        trailing={current ? null : <Check size={12} className="shrink-0 text-accent" />}
        onClick={run(() => { if (current) move(null); })} />
    </>;
  }

  // The reference design's sections, Cursor's rule (2026-10-16): organize, put
  // away, share, settings, then Delete alone in red. A divider goes only
  // between two sections that have something in them.
  const sections: ReactNode[][] = [
    // open: beside the main chat (side thread), its own section on top
    [
      actions.onOpenAside && <Item key="open-aside" id="open-aside" icon={<PanelRight size={12} />} label={t("sideThread.openAside")} onClick={run(actions.onOpenAside)} />,
    ],
    [
      <Item key="rename" id="rename" icon={<Pencil size={12} />} label={t("task.renameAria")} onClick={run(actions.onRename)} />,
      actions.onRegenerateTitle && <Item key="regenerate" id="regenerate" icon={regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        label={regenerating ? t("task.regeneratingTitle") : t("task.regenerateTitle")} disabled={regenerating} busy={regenerating} onClick={onRegenerate} />,
      actions.onPin && <Item key="pin" id="pin" icon={task.pinned === true ? <PinOff size={12} /> : <Pin size={12} />} label={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
        onClick={run(() => actions.onPin!(task.pinned !== true))} />,
      canMove && <Item key="move" id="move" icon={<FolderInput size={12} />} label={t("folder.move")} trailing={sub} onClick={() => onPage("move")} />,
    ],
    [
      actions.onArchive && <Item key="archive" id="archive" icon={archived ? <ArchiveRestore size={12} /> : <Archive size={12} />} label={archived ? t("task.unarchive") : t("task.archive")} disabled={busy}
        onClick={run(() => actions.onArchive!(archived ? null : Date.now()))} />,
      actions.onSnooze && <Item key="snooze" id="snooze" icon={<Clock size={12} />} label={snoozed ? t("task.snoozed") : t("task.snooze")} trailing={sub} onClick={() => onPage("snooze")} />,
    ],
    [
      actions.onCopyLink && <Item key="copy-link" id="copy-link" icon={<Link2 size={12} />} label={t("task.copyLink")} onClick={run(actions.onCopyLink)} />,
      actions.onCreateTeamBot && <Item key="create-team-bot" id="create-team-bot" icon={<UsersRound size={12} />} label={t("teamBotFromThread.menu")} title={t("teamBotFromThread.menu")} onClick={run(actions.onCreateTeamBot)} />,
      actions.onRemoveLink && task.link && <Item key="remove-link" id="remove-link" icon={<Link2Off size={12} />} label={t("task.removeLink")} onClick={run(actions.onRemoveLink)} />,
    ],
    [
      task.confidential === true
        ? <Item key="confidential" id="confidential-info" icon={<Lock size={12} />} label={t("confidential.menuIs")} title={t("confidential.menuIsHint")} disabled onClick={() => {}} />
        : actions.onMakeConfidential && <Item key="confidential" id="make-confidential" icon={<Lock size={12} />} label={t("confidential.make")} disabled={busy} onClick={run(actions.onMakeConfidential)} />,
    ],
    [
      <Item key="delete" id="delete" icon={<Trash2 size={12} />} label={t("task.deleteAria")} danger disabled={busy} onClick={run(actions.onDelete)} />,
    ],
  ];
  return <>
    {sections.map((section) => section.filter(Boolean)).filter((section) => section.length > 0).map((section, index) => (
      <Fragment key={index}>
        {index > 0 && <div role="separator" className="mx-2 my-1 h-px bg-hairline/50" />}
        {section}
      </Fragment>
    ))}
  </>;
}

/** The menu itself: a fixed popover at `position`, kept on screen, closed
 * by Escape and by a click outside it (and outside `anchorRef`, the button
 * that opened it). `data-thread-overlay` keeps the header picker open while
 * the person works in it. */
export function ThreadMenu({ task, actions, folders, position, onClose, anchorRef, initialPage = "main", tone = "sidebar" }: {
  task: ThreadMenuTask;
  actions: ThreadMenuActions;
  folders?: readonly BotProject[];
  position: { left: number; top: number } | null;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  /** Opens on that page (tests render a page this way). */
  initialPage?: ThreadMenuPage;
  /** The surface it sits on: the sidebar's card, or the picker's popover. */
  tone?: "sidebar" | "popover";
}) {
  const motion = useHeldMenuMotion(position);
  const advanced = useAdvancedMode();
  const [page, setPage] = useState<ThreadMenuPage>(initialPage);
  const [regenerating, setRegenerating] = useState(false);
  // Make confidential is permanent: the menu closes and this asks first.
  const [askConfidential, setAskConfidential] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  // A new opening starts on the first page.
  useEffect(() => { if (position) setPage(initialPage); }, [position === null]);
  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [position === null, page]);
  useEffect(() => {
    if (!position) return;
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      latestClose.current();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [position === null]);
  // Pages differ in height: keep the bottom edge on screen after each one.
  useLayoutEffect(() => {
    const element = menuRef.current;
    const shown = motion.value;
    if (!element || !shown) return;
    const { width, height } = element.getBoundingClientRect();
    element.style.top = `${Math.max(8, Math.min(shown.top, window.innerHeight - height - 8))}px`;
    element.style.left = `${Math.max(8, Math.min(shown.left, window.innerWidth - width - 8))}px`;
  });
  const makeConfidential = actions.onMakeConfidential;
  const confirmConfidential = makeConfidential ? <ConfirmDialog open={askConfidential} tone="neutral" icon={<Lock size={14} />}
    title={t("confidential.confirmTitle")} body={t("confidential.confirmBody")} confirmLabel={t("confidential.confirm")}
    threadOverlay={tone === "popover"} returnFocusRef={anchorRef}
    onCancel={() => setAskConfidential(false)} onConfirm={() => { setAskConfidential(false); makeConfidential(); }} /> : null;
  if (!motion.shown || !motion.value) return confirmConfidential;
  const menuActions = makeConfidential ? { ...actions, onMakeConfidential: () => setAskConfidential(true) } : actions;
  const close = () => { setRegenerating(false); onClose(); };
  const regenerate = () => {
    if (!actions.onRegenerateTitle || regenerating) return;
    setRegenerating(true);
    // The menu stays on "Regenerating…" until the answer lands; a failure
    // keeps it open so the person can rename by hand.
    actions.onRegenerateTitle((ok) => { setRegenerating(false); if (ok) onClose(); });
  };
  return <>{confirmConfidential}{createPortal(
    <div ref={menuRef} data-thread-overlay data-thread-menu={page} role="menu" aria-label={t("task.actions", { title: task.title })}
      style={{ left: motion.value.left, top: motion.value.top }}
      className={cn("fixed z-50 max-h-[calc(100vh-16px)] w-[220px] overflow-y-auto rounded-lg border p-1 shadow-xl popover-surface",
        tone === "popover" ? "border-popover-hairline bg-popover" : "border-hairline/50 bg-card", motion.className)} {...motion.exitProps}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (page !== "main") setPage("main");
          else { close(); anchorRef?.current?.focus(); }
        } else navigateThreadMenu(event);
      }}>
      <ThreadMenuItems task={task} actions={menuActions} folders={folders} page={page} onPage={setPage} onClose={close}
        regenerating={regenerating} onRegenerate={regenerate} advanced={advanced} />
    </div>,
    document.body,
  )}</>;
}
