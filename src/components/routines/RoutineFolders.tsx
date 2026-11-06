// Routine folders in a bot's Routines list (2026-10-28, shared/routine-folders.ts).
//
// The routines in no folder come first, as the list always was (a section
// with no title); then each folder of the bot, in the person's order, as a
// folding header like the sidebar's sections: a chevron in the gutter, the
// name and a count, its menu (Rename, Move up or down, Pause or Resume all,
// Delete) and its + (a new routine in that folder). A row's menu (right
// click, its "…", Shift+F10; 2026-10-29) acts on the routine: Run now or
// Stop, Pause or Resume, Rename (in place, also F2), Open, Duplicate, Delete.
// Rows move by drag and drop (mouse or trackpad, pointer events) onto a folder,
// its header or the no-folder area; Alt+Up / Alt+Down moves a focused row.
// New folder is in the section's "…". When titles start
// with "[X]", one quiet line offers to sort them into folders; it is marked
// seen only when the sort worked or the person closed it with the x (a failed
// try or an older server leaves it). "Sort by prefix" also stays in the
// section's "..." menu and the folder menu while a [X] title remains. The
// change can be undone. Nothing is filed without that click.
//
// An older server has no folders (shared/server-features.ts): New folder,
// the prefix offer and dragging stay away, and a call that still meets "no
// route" says the neutral "Available after the server update.", never a red
// error.
import { ArrowDown, ArrowUp, Check, ChevronRight, Folder, FolderInput, FolderPlus, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { api, openRoutineRun, useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { flipRoutine } from "@/lib/routine-toggle";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import {
  answerRoutinePrefixOffer,
  collapsedRoutineFolders,
  settleRoutinePrefixOffer,
  saveCollapsedRoutineFolders,
} from "@/lib/routine-folder-prefs";
import {
  groupRoutinesByFolder,
  ROUTINE_FOLDER_MAX,
  routineFolderKey,
  routinePrefixPlan,
  type RoutineFolderAction,
  type RoutineFolderUndo,
} from "../../../shared/routine-folders";
import { RoutineList } from "./RoutineList";
import { routineRowActions, RoutineMenuPortal, RoutineRowMenuItems } from "./RoutineRowMenu";

interface FolderAnswer { folders: string[]; routines: Routine[]; undo?: RoutineFolderUndo }

type MenuState =
  | { kind: "row"; routine: Routine; x: number; y: number; trigger: HTMLElement }
  | { kind: "folder"; folder: string; x: number; y: number; trigger: HTMLElement }
  | { kind: "section"; x: number; y: number; trigger: HTMLElement; naming?: boolean };

/** What the Routines section's "…" asks of the list. */
export interface RoutineFolderControl {
  openSectionMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void;
}

type Notice = { text: string; undo: RoutineFolderUndo };

const EMPTY: string[] = [];

/** Sort by prefix stays on offer while a title starts with [X] and the person
 * may change the routines; a server known to lack folders hides it. */
export function canSortRoutinesByPrefix(routines: Routine[], supported: boolean): boolean {
  const editable = routines.length === 0 || routines.some((routine) => routine.canEdit !== false);
  return editable && supported && routinePrefixPlan(routines).length > 0;
}

/** The section's "…" (New folder, Sort by prefix): a server with folders and
 * a person who may change the routines. */
export function canManageRoutineFolders(routines: Routine[], supported: boolean): boolean {
  return supported && (routines.length === 0 || routines.some((routine) => routine.canEdit !== false));
}

const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50";

export function RoutineFolderList({ bot, routines, allRoutines, runs, grouped, loading, error, viewerPrincipalId, onOpen, onCreateIn, onDuplicate, controlRef, folderIcon = false, collapseAfter, leadingClock }: {
  bot: Bot;
  routines: Routine[];
  /** 2026-11-03 (audit N-4): every routine of the bot, when `routines` is a
   * filtered list. A folder action (pause, delete and its Undo) touches all
   * of them, never only the rows shown. */
  allRoutines?: Routine[];
  runs: RoutineRun[];
  grouped: boolean;
  loading?: boolean;
  error?: boolean;
  viewerPrincipalId: string | null;
  onOpen: (routine: Routine) => void;
  /** The folder's +: a new routine in that folder. */
  onCreateIn: (folder: string) => void;
  /** The row menu's Duplicate: the editor on a copy. */
  onDuplicate?: (routine: Routine) => void;
  controlRef?: RefObject<RoutineFolderControl | null>;
  /** The Automations list (grouped by bot, 2026-11-03): a folder icon before
   * each folder's name, as sub-groups of the bot's section. */
  folderIcon?: boolean;
  /** The bot panel's Upcoming card (#2125): rows past N behind Show more. */
  collapseAfter?: number;
  /** A clock before each row's name. */
  leadingClock?: boolean;
}) {
  const { state, dispatch } = useStore();
  const order = state.routineFolders?.[bot.id] ?? EMPTY;
  // What a folder action reaches: the bot's routines in the store and the
  // caller's full list, the shown rows winning (their copy is the newest).
  const botRoutines = useMemo(() => {
    const byId = new Map<string, Routine>();
    for (const routine of [...(state.routines ?? []), ...(allRoutines ?? [])]) if (routine.botId === bot.id) byId.set(routine.id, routine);
    for (const routine of routines) byId.set(routine.id, routine);
    return [...byId.values()];
  }, [state.routines, allRoutines, routines, bot.id]);
  const groups = useMemo(() => groupRoutinesByFolder(routines, order), [routines, order]);
  const folders = groups.flatMap((group) => group.folder ? [group.folder] : []);
  const editable = routines.length === 0 || routines.some((routine) => routine.canEdit !== false);
  // "unknown" (a server from before the feature list, not yet seen) offers
  // folders; the first answer settles it.
  const supported = useServerFeature("routineFolders") !== "no";
  const [serverNote, setServerNote] = useState(false);
  const [collapsed, setCollapsed] = useState(() => collapsedRoutineFolders(bot.id));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // 2026-10-29: the routine whose name is typed in place (its row).
  const [renamingRoutine, setRenamingRoutine] = useState<string | null>(null);
  const renameRoutine = (routine: Routine, name: string) => {
    setRenamingRoutine(null);
    dispatch({ type: "routinePatched", routine: { ...routine, name } });
    dispatch({ type: "updateRoutine", routineId: routine.id, patch: { name } });
  };
  const rename = {
    renamingId: renamingRoutine,
    onRenameStart: editable ? (routine: Routine) => setRenamingRoutine(routine.id) : undefined,
    onRenameSave: renameRoutine,
    onRenameCancel: () => setRenamingRoutine(null),
  };
  const [notice, setNotice] = useState<Notice | null>(null);
  const prefixPlan = useMemo(() => routinePrefixPlan(routines), [routines]);
  const settle = () => settleRoutinePrefixOffer(bot.id, { loaded: routines.length > 0, hasPrefixTitles: prefixPlan.length > 0, hasFolders: order.length > 0 || routines.some((routine) => !!routine.folder) });
  const [offerAnswered, setOfferAnswered] = useState(settle);
  // A row held with the mouse or trackpad (pointer events): the routine, the
  // pointer (for the preview) and the folder under it ("" = no folder).
  const [drag, setDrag] = useState<{ routine: Routine; x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragging = drag !== null;
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Set<string>());
  useEffect(() => { setCollapsed(collapsedRoutineFolders(bot.id)); setNotice(null); }, [bot.id]);
  // The bot changed, or its routines just loaded: the soft migration runs.
  useEffect(() => { setOfferAnswered(settle()); }, [bot.id, routines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(controlRef, () => ({ openSectionMenu: (at, trigger) => setMenu({ kind: "section", x: at.x, y: at.y, trigger }) }), []);
  const prefixFolders = new Set(prefixPlan.map((step) => routineFolderKey(step.folder))).size;
  const showSortAction = editable && supported && prefixPlan.length > 0;
  const showOffer = editable && supported && !offerAnswered && !notice && prefixPlan.length > 0;

  const act = async (body: RoutineFolderAction): Promise<FolderAnswer | null> => {
    setBusy(true);
    try {
      const answer = await api<FolderAnswer>("/api/routines/folders", { method: "POST", body: JSON.stringify(body) });
      for (const routine of answer.routines) dispatch({ type: "routinePatched", routine });
      dispatch({ type: "routineFoldersPatched", botId: bot.id, folders: answer.folders });
      return answer;
    } catch (failure) {
      if (featureMissingOnServer("routineFolders", failure)) { setServerNote(true); return null; }
      dispatch({ type: "error", message: failure instanceof Error && failure.message ? failure.message : t("routineFolders.failed") });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleFolder = (folder: string) => {
    const key = routineFolderKey(folder);
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
    saveCollapsedRoutineFolders(bot.id, next);
  };
  const expand = (folder: string) => {
    if (!collapsed.has(routineFolderKey(folder))) return;
    toggleFolder(folder);
  };

  // The same call as Move to folder. The row moves at once; if the call
  // fails the row goes back (act has already said why).
  const move = async (routineIds: string[], folder: string | null) => {
    const known = folder === null || folders.some((name) => routineFolderKey(name) === routineFolderKey(folder));
    const before = known ? routines.filter((routine) => routineIds.includes(routine.id)) : [];
    for (const routine of before) {
      const { folder: _old, ...rest } = routine;
      dispatch({ type: "routinePatched", routine: folder === null ? rest : { ...rest, folder } });
    }
    const answer = await act({ action: "move", botId: bot.id, routineIds, folder });
    if (!answer) for (const routine of before) dispatch({ type: "routinePatched", routine });
    if (answer && folder) expand(folder);
  };
  // Alt+Up / Alt+Down on a row: to the previous or next place in the list
  // (no folder, then each folder in order).
  const step = (routine: Routine, direction: -1 | 1) => {
    const places: Array<string | null> = [null, ...folders];
    const at = routine.folder ? places.findIndex((name) => name !== null && routineFolderKey(name) === routineFolderKey(routine.folder!)) : 0;
    const target = places[at + direction];
    if (target === undefined || at < 0) return;
    void move([routine.id], target);
    requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector(`[data-routine-id="${routine.id}"] button`) as HTMLElement | null)?.focus()));
  };

  const reorder = (folder: string, direction: -1 | 1) => {
    const index = folders.indexOf(folder);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folders.length) return;
    const next = [...folders];
    [next[index], next[target]] = [next[target]!, next[index]!];
    dispatch({ type: "routineFoldersPatched", botId: bot.id, folders: next });
    void act({ action: "reorder", botId: bot.id, order: next });
  };
  const setFolderEnabled = (folder: string, enabled: boolean) => {
    const key = routineFolderKey(folder);
    for (const routine of botRoutines) {
      if (routine.folder && routineFolderKey(routine.folder) === key && routine.enabled !== enabled) void flipRoutine(routine, pending.current, api, dispatch);
    }
  };
  const removeFolder = async (folder: string) => {
    const key = routineFolderKey(folder);
    const inside = botRoutines.filter((routine) => routine.folder && routineFolderKey(routine.folder) === key);
    const undo: RoutineFolderUndo = { botId: bot.id, folders: [...folders], routines: inside.map((routine) => ({ id: routine.id, name: routine.name, folder: routine.folder })) };
    const answer = await act({ action: "delete", botId: bot.id, name: folder });
    if (answer) setNotice({ text: t("routineFolders.deleted", { name: folder }), undo });
  };
  const sortByPrefix = async () => {
    const answer = await act({ action: "sort-by-prefix", botId: bot.id });
    // Marked seen only when it worked: a failure, or a server without the
    // route, leaves the offer and the menu action where they were.
    if (!answer) return;
    answerRoutinePrefixOffer(bot.id);
    setOfferAnswered(true);
    if (answer.undo) setNotice({ text: t("routineFolders.sorted", { count: answer.routines.length, folders: prefixFolders }), undo: answer.undo });
  };
  const undo = async () => {
    if (!notice) return;
    const answer = await act({ action: "restore", botId: bot.id, undo: notice.undo });
    if (answer) setNotice(null);
  };

  const closeMenu = (focus = true) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (focus) requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };

  // Pressing a row starts nothing until the pointer has moved a few pixels,
  // so a click and the switch work as before. Once it moves, a preview follows
  // the pointer, the folder under it lights up (a folded one opens after a
  // moment), and letting go over a folder, its header or the no-folder area
  // files the routine there. The click that ends a drag is swallowed.
  const folderUnder = (x: number, y: number, fallback: EventTarget | null): string | null => {
    const hit = (typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null) ?? (fallback instanceof Element ? fallback : null);
    const section = hit?.closest("[data-routine-folder-section]");
    return section ? section.getAttribute("data-routine-folder-section") : null;
  };
  const startDrag = (routine: Routine, down: ReactPointerEvent<HTMLElement>) => {
    dragCleanup.current?.();
    const originX = down.clientX;
    const originY = down.clientY;
    let active = false;
    let target: string | null = null;
    const move = (event: PointerEvent) => {
      if (!active) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < 5) return;
        active = true;
        document.body.style.userSelect = "none";
      }
      setDrag({ routine, x: event.clientX, y: event.clientY });
      target = folderUnder(event.clientX, event.clientY, event.target);
      setDropTarget(target);
    };
    const swallowClick = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      document.body.style.userSelect = "";
      dragCleanup.current = null;
      setDrag(null);
      setDropTarget(null);
      if (!active) return;
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
      if (drop && target !== null && routineFolderKey(routine.folder ?? "") !== routineFolderKey(target)) void move_(routine.id, target === "" ? null : target);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); finish(false); } };
    const move_ = (id: string, folder: string | null) => void moveRef.current(id, folder);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    dragCleanup.current = () => finish(false);
  };
  const moveRef = useRef<(id: string, folder: string | null) => void>(() => {});
  moveRef.current = (id, folder) => { void move([id], folder); };
  // A folded folder under the pointer opens after a short moment.
  useEffect(() => {
    if (!dragging || !dropTarget || !collapsed.has(routineFolderKey(dropTarget))) return;
    const timer = setTimeout(() => expand(dropTarget), 600);
    return () => clearTimeout(timer);
  }, [dragging, dropTarget, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Running" on a row opens that run's chat where the chat is (JC
  // 2026-11-03), never the Automations page.
  const openRunning = (routine: Routine, run: RoutineRun) => openRoutineRun(dispatch, { runId: run.id, routineId: routine.id, botId: run.botId ?? routine.botId });
  const canDrag = editable && supported && folders.length > 0;
  const list = (items: Routine[], label?: string) => <RoutineList
    routines={items}
    viewerPrincipalId={viewerPrincipalId}
    runs={runs}
    grouped={grouped}
    label={label}
    onOpen={onOpen}
    onToggle={(routine) => void flipRoutine(routine, pending.current, api, dispatch)}
    onRowMenu={editable ? (routine, at, trigger) => setMenu({ kind: "row", routine, x: at.x, y: at.y, trigger }) : undefined}
    onRowDragStart={canDrag ? startDrag : undefined}
    onRowStep={canDrag ? step : undefined}
    onOpenRunning={openRunning}
    collapseAfter={collapseAfter}
    leadingClock={leadingClock}
    {...rename}
  />;

  const loose = groups[0]!;
  return <div className="flex flex-col gap-1" data-routine-folders="">
    {drag && createPortal(<div data-routine-drag-preview="" aria-hidden="true"
      style={{ left: drag.x + 12, top: drag.y + 8 }}
      className="pointer-events-none fixed z-50 flex max-w-[260px] items-center gap-2 rounded-lg border-[0.5px] border-border bg-elevated px-3 py-1.5 text-[13px] leading-[18px] text-ink opacity-95 shadow-lg">
      <FolderInput size={14} className="shrink-0 text-accent" /><span className="truncate">{drag.routine.name}</span>
    </div>, document.body)}
    {showOffer && <div data-routine-prefix-offer="" role="note" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <FolderInput size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("routineFolders.offer", { count: prefixPlan.length, folders: prefixFolders })}</span>
      <button type="button" data-routine-prefix-sort="" disabled={busy} onClick={() => void sortByPrefix()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50">{t("routineFolders.offerSort")}</button>
      <button type="button" aria-label={t("routineFolders.offerDismiss")} title={t("routineFolders.offerDismiss")} onClick={() => { answerRoutinePrefixOffer(bot.id); setOfferAnswered(true); }} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}
    {serverNote && <div data-routine-folder-server-note="" role="status" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <FolderInput size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("serverRoute.needsUpdate")}</span>
      <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={() => setServerNote(false)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}
    {notice && <div data-routine-folder-notice="" role="status" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button type="button" data-routine-folder-undo="" disabled={busy} onClick={() => void undo()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50">{t("routineFolders.undo")}</button>
      <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={() => setNotice(null)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}

    {(loose.routines.length > 0 || folders.length === 0 || loading || error) ? (
      <div data-routine-folder-section="" className={cn("rounded-xl", dropTarget === "" && "ring-1 ring-accent/50")}>
        <RoutineList
          routines={loose.routines}
          viewerPrincipalId={viewerPrincipalId}
          runs={runs}
          grouped={grouped}
          loading={loading}
          error={error}
          onOpen={onOpen}
          onToggle={(routine) => void flipRoutine(routine, pending.current, api, dispatch)}
          onRowMenu={editable ? (routine, at, trigger) => setMenu({ kind: "row", routine, x: at.x, y: at.y, trigger }) : undefined}
          onRowDragStart={canDrag ? startDrag : undefined}
          onRowStep={canDrag ? step : undefined}
          onOpenRunning={openRunning}
          collapseAfter={collapseAfter}
          leadingClock={leadingClock}
          {...rename}
        />
      </div>
    ) : dragging && (
      <div data-routine-folder-section="" className={cn("rounded-lg border border-dashed border-hairline/60 px-3 py-2 text-center text-[12px] text-ink-tertiary", dropTarget === "" && "border-accent/60 text-ink-secondary")}>
        {t("routineFolders.dropOut")}
      </div>
    )}

    {groups.slice(1).map((group) => {
      const folder = group.folder!;
      const isCollapsed = collapsed.has(routineFolderKey(folder));
      const index = folders.indexOf(folder);
      const anyOn = group.routines.some((routine) => routine.enabled);
      return <div key={folder} data-routine-folder-section={folder}
        className={cn("flex flex-col rounded-lg", index > 0 || loose.routines.length > 0 ? "pt-1.5" : "", dropTarget === folder && "bg-hover/60 ring-1 ring-accent/50")}>
        {renaming === folder ? (
          <FolderNameInput initial={folder} label={t("routineFolders.renameLabel")} onCancel={() => setRenaming(null)} onSave={async (name) => {
            const answer = await act({ action: "rename", botId: bot.id, from: folder, to: name });
            if (answer) setRenaming(null);
          }} />
        ) : (
          <RoutineFolderHeader
            name={folder}
            count={group.routines.length}
            paused={group.routines.length > 0 && !anyOn}
            collapsed={isCollapsed}
            icon={folderIcon}
            editable={editable && supported}
            onToggle={() => toggleFolder(folder)}
            onMove={(direction) => reorder(folder, direction)}
            onMenu={(at, trigger) => setMenu({ kind: "folder", folder, x: at.x, y: at.y, trigger })}
            onCreate={() => onCreateIn(folder)}
          />
        )}
        {!isCollapsed && (group.routines.length > 0
          ? list(group.routines, folder)
          : <p data-routine-folder-empty="" className="px-3 pb-1 text-[12px] leading-4 text-ink-tertiary">{t("routineFolders.empty")}</p>)}
      </div>;
    })}

    {menu && <RoutineMenuPortal x={menu.x} y={menu.y} kind={menu.kind} label={menu.kind === "row" ? menu.routine.name : menu.kind === "folder" ? menu.folder : t("computer.tab.routines")} onClose={closeMenu}>
        {menu.kind === "section" ? (menu.naming
          ? <FolderNameInput label={t("routineFolders.newFolderLabel")} onCancel={() => closeMenu()} onSave={async (name) => { const answer = await act({ action: "create", botId: bot.id, name }); if (answer) closeMenu(); }} />
          : <>
            {supported && <button type="button" role="menuitem" autoFocus data-routine-new-folder="" className={MENU_ITEM} onClick={() => setMenu({ ...menu, naming: true })}>
              <FolderPlus size={14} aria-hidden="true" />{t("routineFolders.newFolder")}
            </button>}
            {showSortAction && <SortByPrefixItem autoFocus={!supported} onSelect={() => { closeMenu(); void sortByPrefix(); }} />}
          </>)
          : menu.kind === "row" ? <RoutineRowMenuItems routine={menu.routine} actions={routineRowActions({
            routine: menu.routine, bot, state, dispatch, close: closeMenu,
            onOpen: () => onOpen(menu.routine),
            onDuplicate: onDuplicate ? () => onDuplicate(menu.routine) : undefined,
            onRename: () => setRenamingRoutine(menu.routine.id),
          })} />
          : <FolderMenuItems
            canMoveUp={folders.indexOf(menu.folder) > 0}
            canMoveDown={folders.indexOf(menu.folder) < folders.length - 1}
            anyOn={botRoutines.some((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(menu.folder) && routine.enabled)}
            anyRoutine={botRoutines.some((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(menu.folder))}
            onRename={() => { closeMenu(false); setRenaming(menu.folder); }}
            onMove={(direction) => { closeMenu(); reorder(menu.folder, direction); }}
            onSetEnabled={(enabled) => { closeMenu(); setFolderEnabled(menu.folder, enabled); }}
            canSortByPrefix={showSortAction}
            onSortByPrefix={() => { closeMenu(); void sortByPrefix(); }}
            onDelete={() => { closeMenu(false); void removeFolder(menu.folder); }} />}
    </RoutineMenuPortal>}
  </div>;
}

/** A folder's header, the sidebar section's: 30px high, the name at 12px
 * in the secondary ink, the chevron in the gutter before it, then a count. */
export function RoutineFolderHeader({ name, count, paused, collapsed, icon = false, editable, onToggle, onMove, onMenu, onCreate }: {
  name: string;
  count: number;
  paused: boolean;
  collapsed: boolean;
  /** A folder icon after the chevron (the Automations list). */
  icon?: boolean;
  editable: boolean;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void;
  onCreate: () => void;
}) {
  const label = t(collapsed ? "routineFolders.expand" : "routineFolders.collapse", { name });
  return <div data-routine-folder-header={name}
    onContextMenu={editable ? (event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }, event.currentTarget.querySelector("button") ?? event.currentTarget); } : undefined}
    className="group/folder relative flex h-[30px] min-w-0 items-center rounded-md hover:bg-hover">
    <button type="button" aria-expanded={!collapsed} title={label}
      aria-keyshortcuts={editable ? "Alt+ArrowUp Alt+ArrowDown Shift+F10" : undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (!editable) return;
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); onMove(event.key === "ArrowUp" ? -1 : 1); }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ x: rect.left + 8, y: rect.bottom + 4 }, event.currentTarget);
        }
      }}
      className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pb-1.5 pl-0.5 pr-2 pt-2 text-left text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center"><ChevronRight size={12} className={cn("transition-transform", !collapsed && "rotate-90")} /></span>
      {icon && <Folder size={13} aria-hidden="true" data-routine-folder-icon="" className="shrink-0 text-ink-tertiary" />}
      <span className="truncate text-[12px] font-normal leading-4">{name}</span>
      <span data-routine-folder-count={count} className="shrink-0 text-[11px] leading-4 tabular-nums text-ink-tertiary">{count}</span>
      {paused && <span data-routine-folder-paused="" className="shrink-0 text-[11px] leading-4 text-ink-tertiary">· {t("routineFolders.allPaused")}</span>}
      <span className="sr-only">{t("routineFolders.countLabel", { count })}</span>
    </button>
    {editable && <div className="hidden shrink-0 items-center gap-0.5 pr-0.5 group-hover/folder:flex group-focus-within/folder:flex touch:flex">
      <button type="button" data-routine-folder-more="" aria-label={t("routineFolders.folderMenu", { name })} title={t("routineFolders.folderMenu", { name })}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><MoreHorizontal size={14} /></button>
      <button type="button" data-routine-folder-new="" aria-label={t("routineFolders.newIn", { name })} title={t("routineFolders.newIn", { name })} onClick={onCreate}
        className="flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><Plus size={14} /></button>
    </div>}
  </div>;
}

function SortByPrefixItem({ onSelect, autoFocus }: { onSelect: () => void; autoFocus?: boolean }) {
  return <button type="button" role="menuitem" autoFocus={autoFocus} data-routine-sort-by-prefix="" className={MENU_ITEM} onClick={onSelect}>
    <span aria-hidden="true"><FolderInput size={14} /></span>{t("routineFolders.offerSort")}
  </button>;
}

function FolderMenuItems({ canMoveUp, canMoveDown, anyOn, anyRoutine, canSortByPrefix, onSortByPrefix, onRename, onMove, onSetEnabled, onDelete }: {
  canMoveUp: boolean; canMoveDown: boolean; anyOn: boolean; anyRoutine: boolean; canSortByPrefix: boolean; onSortByPrefix: () => void;
  onRename: () => void; onMove: (direction: -1 | 1) => void; onSetEnabled: (enabled: boolean) => void; onDelete: () => void;
}) {
  const items: Array<{ key: string; label: string; icon: ReactNode; onSelect: () => void; group: number; danger?: boolean }> = [
    { key: "rename", label: t("routineFolders.rename"), icon: <Pencil size={14} />, onSelect: onRename, group: 0 },
    ...(canMoveUp ? [{ key: "up", label: t("routineFolders.moveUp"), icon: <ArrowUp size={14} />, onSelect: () => onMove(-1), group: 0 }] : []),
    ...(canMoveDown ? [{ key: "down", label: t("routineFolders.moveDown"), icon: <ArrowDown size={14} />, onSelect: () => onMove(1), group: 0 }] : []),
    ...(anyRoutine ? [anyOn
      ? { key: "pause", label: t("routineFolders.pauseAll"), icon: <Pause size={14} />, onSelect: () => onSetEnabled(false), group: 1 }
      : { key: "resume", label: t("routineFolders.resumeAll"), icon: <Play size={14} />, onSelect: () => onSetEnabled(true), group: 1 }] : []),
    ...(canSortByPrefix ? [{ key: "sort-by-prefix", label: t("routineFolders.offerSort"), icon: <FolderInput size={14} />, onSelect: onSortByPrefix, group: 1 }] : []),
    { key: "delete", label: t("routineFolders.delete"), icon: <Trash2 size={14} />, onSelect: onDelete, group: 2, danger: true },
  ];
  return <>{items.map((item, index) => <Fragment key={item.key}>
    {index > 0 && items[index - 1]!.group !== item.group && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
    <button type="button" role="menuitem" autoFocus={index === 0} data-routine-folder-action={item.key} className={cn(MENU_ITEM, item.danger && "text-danger")} onClick={item.onSelect}>
      <span aria-hidden="true">{item.icon}</span>{item.label}
    </button>
  </Fragment>)}</>;
}

/** A folder name typed in place: Enter saves, Escape cancels. */
function FolderNameInput({ initial = "", label, onSave, onCancel }: { initial?: string; label: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    const name = value.trim();
    if (!name || saving) return;
    if (name === initial.trim()) { onCancel(); return; }
    setSaving(true);
    await onSave(name);
    setSaving(false);
  };
  return <div className="flex h-[30px] items-center px-1" data-routine-folder-name-input="">
    <input ref={ref} value={value} maxLength={ROUTINE_FOLDER_MAX} aria-label={label} placeholder={label} disabled={saving}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void save(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
      }}
      onBlur={() => { if (!saving) onCancel(); }}
      className="h-7 w-full rounded-md border border-hairline/60 bg-inset px-2 text-[12px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
  </div>;
}
