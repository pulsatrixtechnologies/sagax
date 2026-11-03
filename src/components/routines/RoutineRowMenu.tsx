// A routine's own menu (2026-10-29), the same in the bot panel's list and in
// the Automations list: right click, its "…", Shift+F10 or the context menu
// key. Run now (Stop while a run is in flight), Pause or Resume, Rename,
// Open, Duplicate, then Delete in red, last. Moving a routine between
// folders is drag and drop (RoutineFolders), not this menu.
import { CirclePlay, Copy, PanelRightOpen, Pause, Pencil, Play, Square, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { Routine, RoutineRun } from "@/lib/routines";
import { openRoutineRun, type Action, type AppState, type Bot } from "@/state/store";
import { canRunRoutineNow } from "./RunNowButton";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { navigateThreadMenu } from "../BotProjects";

export const ROUTINE_MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50";

/** The run of this routine still in flight (queued, running or waiting). */
export function routineLiveRun(runs: readonly RoutineRun[], routineId: string): RoutineRun | undefined {
  return runs.find((run) => run.routineId === routineId && (run.status === "running" || run.status === "waiting" || run.status === "queued"));
}

export interface RoutineRowActions {
  /** Absent: this person may not start it. */
  onRunNow?: () => void;
  /** Present while a run is in flight: it replaces Run now. */
  onStop?: () => void;
  onToggle?: () => void;
  onRename?: () => void;
  onOpen: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/** The menu's actions for one routine, wired to the store (the same calls
 * as the routine's page). Each closes the menu first. */
export function routineRowActions({ routine, bot, state, dispatch, close, onOpen, onDuplicate, onRename }: {
  routine: Routine;
  bot: Bot | undefined;
  state: Pick<AppState, "config" | "routineRuns">;
  dispatch: (action: Action) => void;
  close: (focus?: boolean) => void;
  onOpen: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
}): RoutineRowActions {
  const editable = routine.canEdit !== false;
  const live = routineLiveRun(state.routineRuns, routine.id);
  return {
    ...(live && editable ? { onStop: () => { close(); dispatch({ type: "cancelRoutineRun", runId: live.id }); } } : {}),
    ...(!live && canRunRoutineNow(state.config, routine, bot) ? { onRunNow: () => { close(); dispatch({ type: "runRoutine", routineId: routine.id, onStarted: (run) => { dispatch({ type: "routineRunPatched", run }); openRoutineRun(dispatch, { runId: run.id, routineId: routine.id, botId: run.botId }); } }); } } : {}),
    ...(editable ? { onToggle: () => { close(); dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } }); } } : {}),
    ...(editable && onRename ? { onRename: () => { close(false); onRename(); } } : {}),
    onOpen: () => { close(false); onOpen(); },
    ...(onDuplicate ? { onDuplicate: () => { close(false); onDuplicate(); } } : {}),
    ...(editable ? { onDelete: () => { close(false); dispatch({ type: "deleteRoutine", routineId: routine.id }); } } : {}),
  };
}

export function RoutineRowMenuItems({ routine, actions }: { routine: Routine; actions: RoutineRowActions }) {
  const items: Array<{ key: string; label: string; icon: ReactNode; onSelect: () => void; group: number; danger?: boolean }> = [
    ...(actions.onStop
      ? [{ key: "stop", label: t("routineRun.stop"), icon: <Square size={13} fill="currentColor" />, onSelect: actions.onStop, group: 0 }]
      : actions.onRunNow ? [{ key: "run-now", label: t("routines.runNow"), icon: <Play size={14} fill="currentColor" />, onSelect: actions.onRunNow, group: 0 }] : []),
    ...(actions.onToggle ? [routine.enabled
      ? { key: "pause", label: t("botPanel.routines.pause"), icon: <Pause size={14} />, onSelect: actions.onToggle, group: 0 }
      : { key: "resume", label: t("botPanel.routines.resume"), icon: <CirclePlay size={14} />, onSelect: actions.onToggle, group: 0 }] : []),
    ...(actions.onRename ? [{ key: "rename", label: t("routineFolders.rename"), icon: <Pencil size={14} />, onSelect: actions.onRename, group: 1 }] : []),
    { key: "open", label: t("routines.menu.open"), icon: <PanelRightOpen size={14} />, onSelect: actions.onOpen, group: 1 },
    ...(actions.onDuplicate ? [{ key: "duplicate", label: t("routineDetail.duplicate"), icon: <Copy size={14} />, onSelect: actions.onDuplicate, group: 1 }] : []),
    ...(actions.onDelete ? [{ key: "delete", label: t("common.delete"), icon: <Trash2 size={14} />, onSelect: actions.onDelete, group: 2, danger: true }] : []),
  ];
  return <>{items.map((item, index) => <Fragment key={item.key}>
    {index > 0 && items[index - 1]!.group !== item.group && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
    <button type="button" role="menuitem" autoFocus={index === 0} data-routine-action={item.key} className={cn(ROUTINE_MENU_ITEM, item.danger && "text-danger")} onClick={item.onSelect}>
      <span aria-hidden="true" className="flex size-3.5 items-center justify-center">{item.icon}</span>{item.label}
    </button>
  </Fragment>)}</>;
}

/** The menu's floating card at the pointer (or under its trigger). No
 * full-window catcher: a press outside the card, or Escape, closes it and
 * the press still reaches whatever was under it. */
export function RoutineMenuPortal({ x, y, label, kind, onClose, children }: { x: number; y: number; label: string; kind: string; onClose: (focus?: boolean) => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(true, menuRef, () => onClose(false));
  return createPortal(
    <div ref={menuRef} role="menu" data-routine-folder-menu={kind} aria-label={label}
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - 248)), top: Math.max(8, Math.min(y, window.innerHeight - 320)) }}
      className="popover-surface fixed z-40 flex max-h-[min(420px,80vh)] w-[240px] flex-col gap-0.5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] text-ink shadow-lg"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (!(event.target instanceof HTMLInputElement)) navigateThreadMenu(event);
      }}>
      {children}
    </div>,
    document.body,
  );
}

/** A routine's name typed in place (2026-10-29): Enter saves, Escape
 * cancels, an empty name is refused (the field stays, says why). Leaving
 * the field cancels. */
export function RoutineNameInput({ initial, onSave, onCancel, className }: { initial: string; onSave: (name: string) => void; onCancel: () => void; className?: string }) {
  const [value, setValue] = useState(initial);
  const [empty, setEmpty] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => {
    const name = value.trim();
    if (!name) { setEmpty(true); return; }
    if (name === initial.trim()) { onCancel(); return; }
    onSave(name);
  };
  return <span className="flex min-w-0 flex-1 flex-col" data-routine-name-input="">
    <input ref={ref} value={value} maxLength={120} aria-label={t("routines.rename.label")} aria-invalid={empty || undefined} placeholder={t("routines.rename.label")}
      onChange={(event) => { setValue(event.target.value); if (empty) setEmpty(false); }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); save(); }
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      }}
      onBlur={onCancel}
      className={cn("h-7 w-full min-w-0 rounded-md border border-hairline/60 bg-inset px-2 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", empty && "border-danger/60", className)} />
    {empty && <span role="alert" data-routine-name-empty="" className="px-0.5 pt-0.5 text-[12px] leading-4 text-danger">{t("routines.rename.empty")}</span>}
  </span>;
}

/** A routine's title that renames in place on double-click (the routine's
 * page). Not editable: plain text. */
export function RoutineTitle({ name, editable, onRename, className }: { name: string; editable: boolean; onRename: (name: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <RoutineNameInput initial={name} onCancel={() => setEditing(false)} onSave={(next) => { setEditing(false); onRename(next); }} />;
  return <span data-routine-title="" title={editable ? t("routines.rename.hint") : undefined}
    onDoubleClick={editable ? () => setEditing(true) : undefined}
    className={className}>{name}</span>;
}
