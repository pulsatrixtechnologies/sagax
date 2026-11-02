import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CheckCheck, Folder, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { NewThreadChoice } from "@/lib/confidential-thread";
import { useStore, type Bot, type BotProject, type FolderOwnerKind } from "@/state/store";
import { cn } from "@/lib/cn";
import { useHeldMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const FOLDER_EMOJI = ["📁", "💼", "🏠", "📬", "💡", "🚀", "🎨", "🧪", "📚", "🌱", "⭐", "🛠️"];

export function FolderIcon({ emoji, size = 13 }: { emoji?: string; size?: number }) {
  return emoji ? <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center leading-none" style={{ width: size, fontSize: size }}>{emoji}</span>
    : <Folder aria-hidden="true" size={size} className="shrink-0" />;
}

export function navigateThreadMenu(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

export function FolderActions({ project, canMoveUp, canMoveDown, canMarkRead, saving, menu, onMenuChange, onEdit, onMove, onMarkRead, onNewThread, onDelete }: {
  project: BotProject;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMarkRead: boolean;
  saving: boolean;
  menu: { left: number; top: number } | null;
  onMenuChange: (menu: { left: number; top: number } | null) => void;
  onEdit: () => void;
  onMove: (direction: -1 | 1, onSaved: () => void) => void;
  onMarkRead: (onSaved: () => void) => void;
  onNewThread?: () => void;
  /** Absent: delete stays out of this menu (the create popover never offers it). */
  onDelete?: () => void;
}) {
  const actionRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => { onMenuChange(null); actionRef.current?.focus(); };
  useEffect(() => {
    if (saving && menu) menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [saving, menu]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !actionRef.current?.contains(event.target)) onMenuChange(null);
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [menu]);
  const move = (direction: -1 | 1) => onMove(direction, close);
  const motion = useHeldMenuMotion(menu);
  const shown = motion.value;
  const position = shown && {
    left: Math.max(8, Math.min(shown.left, window.innerWidth - 228)),
    top: Math.max(8, Math.min(shown.top, window.innerHeight - 180)),
  };
  return <>
    <button ref={actionRef} type="button" aria-label={t("folder.actions", { name: project.name })} title={t("folder.actions", { name: project.name })} aria-haspopup="menu" aria-expanded={Boolean(menu)}
      onClick={(event) => { if (menu) { close(); return; } const rect = event.currentTarget.getBoundingClientRect(); onMenuChange({ left: rect.left, top: rect.bottom + 4 }); }}
      className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/folder:opacity-100 max-md:opacity-70 touch:opacity-70"><MoreHorizontal size={13} /></button>
    {motion.shown && position && createPortal(<div ref={menuRef} role="menu" aria-label={t("folder.actions", { name: project.name })} aria-busy={saving || undefined} data-thread-overlay style={position}
      className={cn("fixed z-50 w-[220px] rounded-lg border border-hairline/50 popover-surface bg-card p-1 shadow-xl", motion.className)} {...motion.exitProps}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } else navigateThreadMenu(event); }}>
      {onNewThread && <button type="button" role="menuitem" onClick={() => { close(); onNewThread(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised"><Plus size={12} />{t("task.newIn", { name: project.name })}</button>}
      <button type="button" role="menuitem" onClick={() => { close(); onEdit(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised"><Pencil size={12} />{t("folder.rename")}</button>
      <button type="button" role="menuitem" disabled={!canMarkRead || saving} onClick={() => onMarkRead(close)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised disabled:opacity-40"><CheckCheck size={12} />{t("folder.markRead")}</button>
      <button type="button" role="menuitem" disabled={!canMoveUp || saving} onClick={() => move(-1)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised disabled:opacity-40"><ArrowUp size={12} />{t("folder.moveUp")}</button>
      <button type="button" role="menuitem" disabled={!canMoveDown || saving} onClick={() => move(1)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-ink hover:bg-raised disabled:opacity-40"><ArrowDown size={12} />{t("folder.moveDown")}</button>
      {onDelete && <button type="button" role="menuitem" onClick={() => { close(); onDelete(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] text-danger hover:bg-raised"><Trash2 size={12} />{t("folder.delete")}</button>}
    </div>, document.body)}
  </>;
}

/** Who owns a set of thread folders, as the folder dialog and the new
 * thread button read it: a bot, or with `owner: "group"` a conversation
 * with a person (its threads and folders have the same shape). */
export type FolderOwner = Pick<Bot, "id" | "name" | "threadId" | "projects"> & { tasks?: ReadonlyArray<{ threadId: string; projectId?: string }> };

/** Rename a folder where its name shows (2026-11-01 lot 7). Enter saves,
 * Escape restores. */
export function FolderRenameField({ name, onSave, onCancel }: {
  name: string;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    const next = draft.trim();
    if (save && next && next !== name) onSave(next);
    else onCancel();
  };
  return (
    <input
      ref={inputRef}
      data-folder-rename=""
      aria-label={t("folder.name")}
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      className="min-w-0 flex-1 rounded-md border border-hairline/50 bg-inset px-1.5 py-0.5 text-[13px] font-semibold text-ink outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

/** Icon chooser anchored to the folder's icon button (lot 7). */
export function FolderIconPopover({ project, bot, owner, anchorRef, onClose }: {
  project: BotProject;
  bot: FolderOwner;
  owner?: FolderOwnerKind;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [emoji, setEmoji] = useState(project.emoji ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = anchorRef.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  usePopoverDismiss(!saving, dismissRoot, onClose);

  const apply = (next: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setEmoji(next);
    dispatch({
      type: "updateProject",
      botId: bot.id,
      owner,
      projectId: project.id,
      patch: { emoji: next.trim() || null },
      onSaved: onClose,
      onError: (message) => { setSaving(false); setError(message); setEmoji(project.emoji ?? ""); },
    });
  };

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      side="bottom"
      align="start"
      role="dialog"
      aria-label={t("folder.icon")}
      data-folder-icon-popover=""
      className="w-[min(280px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-3 text-ink shadow-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p className="mb-2 text-[12px] text-ink-secondary">{t("folder.emojiHint")}</p>
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={saving} aria-label={t("folder.defaultIcon")} aria-pressed={!emoji} onClick={() => apply("")} className="flex size-8 items-center justify-center rounded hover:bg-hover aria-pressed:bg-hover"><FolderIcon size={18} /></button>
        {FOLDER_EMOJI.map((icon) => <button key={icon} type="button" disabled={saving} aria-label={icon} aria-pressed={emoji === icon} onClick={() => apply(icon)} className="size-8 rounded text-lg hover:bg-hover aria-pressed:bg-hover">{icon}</button>)}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AnchoredPopover>
  );
}

/** Create a thread folder: anchored popover with one name field (lot 7).
 * Rename is in place on the row; icon change is FolderIconPopover. */
export function BotProjectDialog({ bot, owner, project, anchorRef, onClose, onCreated }: {
  bot: FolderOwner;
  owner?: FolderOwnerKind;
  /** Present only for legacy callers; edit is rename-in-place + icon popover. */
  project?: BotProject;
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated?: (project: BotProject) => void;
}) {
  // Edit path kept for a one-release bridge: open the icon popover content
  // with name rename is handled by FolderRenameField at the call site.
  if (project) {
    return <FolderEditPopover bot={bot} owner={owner} project={project} anchorRef={anchorRef} onClose={onClose} />;
  }
  return <FolderCreatePopover bot={bot} owner={owner} anchorRef={anchorRef} onClose={onClose} onCreated={onCreated} />;
}

function FolderCreatePopover({ bot, owner, anchorRef, onClose, onCreated }: {
  bot: FolderOwner;
  owner?: FolderOwnerKind;
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated?: (project: BotProject) => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fallbackAnchor = useRef<HTMLDivElement>(null);
  const resolvedAnchor = anchorRef ?? fallbackAnchor;
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = resolvedAnchor.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  usePopoverDismiss(!saving, dismissRoot, onClose);
  useEffect(() => { nameRef.current?.focus(); }, []);

  return (
    <>
      {!anchorRef && <div ref={fallbackAnchor} className="pointer-events-none fixed left-4 top-24 size-0" aria-hidden="true" />}
      <AnchoredPopover
        anchorRef={resolvedAnchor}
        popoverRef={popoverRef}
        side="bottom"
        align="start"
        role="dialog"
        aria-labelledby="folder-create-title"
        data-folder-create=""
        className="w-[min(320px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          setError(null);
          dispatch({
            type: "createProject",
            botId: bot.id,
            owner,
            name: name.trim(),
            emoji: emoji.trim() || null,
            onError: (message) => { setSaving(false); setError(message); },
            onCreated: (created) => { onCreated?.(created); onClose(); },
          });
        }}>
          <h2 id="folder-create-title" className="text-[14px] font-medium">{t("folder.create")}</h2>
          <label className="mt-3 block text-[12px] text-ink-secondary">{t("folder.name")}
            <input ref={nameRef} value={name} maxLength={80} disabled={saving} onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink focus:border-accent/60 focus:outline-none" />
          </label>
          <div className="mt-3" aria-label={t("folder.icon")}>
            <p className="mb-1.5 text-[12px] text-ink-secondary">{t("folder.emojiHint")}</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" disabled={saving} aria-label={t("folder.defaultIcon")} aria-pressed={!emoji} onClick={() => setEmoji("")} className="flex size-8 items-center justify-center rounded hover:bg-hover aria-pressed:bg-hover"><FolderIcon size={18} /></button>
              {FOLDER_EMOJI.map((icon) => <button key={icon} type="button" disabled={saving} aria-label={icon} aria-pressed={emoji === icon} onClick={() => setEmoji(icon)} className="size-8 rounded text-lg hover:bg-hover aria-pressed:bg-hover">{icon}</button>)}
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("folder.detail", { name: bot.name })}</p>
          {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={!name.trim() || saving} className={PRIMARY_PILL}>{t(saving ? "folder.saving" : "folder.create")}</button>
          </div>
        </form>
      </AnchoredPopover>
    </>
  );
}

/** Legacy edit surface: name field + icon + delete, as a popover (at most
 * two text fields). Prefer FolderRenameField + FolderIconPopover. */
function FolderEditPopover({ bot, owner, project, anchorRef, onClose }: {
  bot: FolderOwner;
  owner?: FolderOwnerKind;
  project: BotProject;
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [name, setName] = useState(project.name);
  const [emoji, setEmoji] = useState(project.emoji ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fallbackAnchor = useRef<HTMLDivElement>(null);
  const resolvedAnchor = anchorRef ?? fallbackAnchor;
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = resolvedAnchor.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  usePopoverDismiss(!saving, dismissRoot, onClose);
  useEffect(() => { nameRef.current?.focus(); }, []);

  return (
    <>
      {!anchorRef && <div ref={fallbackAnchor} className="pointer-events-none fixed left-4 top-24 size-0" aria-hidden="true" />}
      <AnchoredPopover
        anchorRef={resolvedAnchor}
        popoverRef={popoverRef}
        side="bottom"
        align="start"
        role="dialog"
        aria-labelledby="folder-edit-title"
        data-folder-edit=""
        className="w-[min(320px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          setError(null);
          dispatch({
            type: "updateProject",
            botId: bot.id,
            owner,
            projectId: project.id,
            patch: { name: name.trim(), emoji: emoji.trim() || null },
            onSaved: onClose,
            onError: (message) => { setSaving(false); setError(message); },
          });
        }}>
          <h2 id="folder-edit-title" className="text-[14px] font-medium">{t("folder.settings")}</h2>
          <label className="mt-3 block text-[12px] text-ink-secondary">{t("folder.name")}
            <input ref={nameRef} value={name} maxLength={80} disabled={saving} onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink focus:border-accent/60 focus:outline-none" />
          </label>
          <div className="mt-3" aria-label={t("folder.icon")}>
            <p className="mb-1.5 text-[12px] text-ink-secondary">{t("folder.emojiHint")}</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" disabled={saving} aria-label={t("folder.defaultIcon")} aria-pressed={!emoji} onClick={() => setEmoji("")} className="flex size-8 items-center justify-center rounded hover:bg-hover aria-pressed:bg-hover"><FolderIcon size={18} /></button>
              {FOLDER_EMOJI.map((icon) => <button key={icon} type="button" disabled={saving} aria-label={icon} aria-pressed={emoji === icon} onClick={() => setEmoji(icon)} className="size-8 rounded text-lg hover:bg-hover aria-pressed:bg-hover">{icon}</button>)}
            </div>
          </div>
          {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={!name.trim() || saving} className={PRIMARY_PILL}>{t(saving ? "folder.saving" : "folder.save")}</button>
          </div>
        </form>
        <div className="mt-3 border-t border-hairline/40 pt-3">
          {deleting ? <>
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("folder.deleteBody")}</p>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" disabled={saving} onClick={() => {
                setSaving(true); setError(null);
                dispatch({ type: "deleteProject", botId: bot.id, owner, projectId: project.id, onDeleted: onClose, onError: (message) => { setSaving(false); setError(message); } });
              }} className="text-[12px] text-danger hover:underline disabled:opacity-40">{t("folder.deleteConfirm")}</button>
              <button type="button" onClick={() => setDeleting(false)} className="text-[12px] text-ink-secondary hover:underline">{t("common.cancel")}</button>
            </div>
          </> : <button type="button" disabled={saving} onClick={() => setDeleting(true)} className="text-[12px] text-danger hover:underline disabled:opacity-40">{t("folder.delete")}</button>}
        </div>
      </AnchoredPopover>
    </>
  );
}

/** One-click new thread in the current folder. Folder creation lives in the
 * sidebar. `bot` is the threads' owner: a bot, or a group with `owner: "group"`. */
export function NewThreadButton({ bot, owner, className, compact = false, onCreated, kind }: { bot: FolderOwner; owner?: FolderOwnerKind; className?: string; compact?: boolean; onCreated?: () => void;
  /** A bot's New thread kind (src/lib/confidential-thread.ts): its label,
   * and the `confidential` it sends. Absent: the plain New thread, which
   * the server makes confidential when the organization's default says so. */
  kind?: NewThreadChoice }) {
  const { dispatch } = useStore();
  const projects = bot.projects ?? [];
  const currentProject = projects.find((project) => project.id === bot.tasks?.find((task) => task.threadId === bot.threadId)?.projectId);
  const label = t(kind?.label ?? "task.newShort");
  const Icon = kind?.lock ? Lock : Plus;
  return <button type="button" aria-label={label} title={currentProject && !kind ? t("task.newIn", { name: currentProject.name }) : label}
    data-new-thread-kind={kind ? (kind.confidential ? "confidential" : "ordinary") : undefined}
    onClick={() => {
      const projectId = currentProject ? { projectId: currentProject.id } : {};
      dispatch(owner === "group" ? { type: "newGroupTask", groupId: bot.id, ...projectId } : { type: "newTask", botId: bot.id, ...projectId, ...(kind ? { confidential: kind.confidential } : {}) });
      onCreated?.();
    }}
    className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-ink-secondary hover:bg-raised/60 hover:text-ink", compact ? "py-1 @max-4xl/chathead:h-[30px] @max-4xl/chathead:px-2" : "py-2", className)}>
    <Icon aria-hidden="true" size={12} /><span className={cn("truncate", compact && "@max-4xl/chathead:hidden")}>{label}</span>
  </button>;
}
