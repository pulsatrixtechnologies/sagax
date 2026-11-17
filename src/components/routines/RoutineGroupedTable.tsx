// Group by Bot or by Folder on the Routines page (2026-11-17, owner): a real grouping,
// one level at a time, in the SAME table as the ungrouped view. Each group is its
// own block: a filled header band (mascot or folder icon, name, count, running and
// problem figures, "..." menu; a click folds or opens the block, open by default and
// remembered per person), its routines as rows directly under it, then space
// before the next block. The column titles show once at the top. The column the
// block already says is hidden: Bot when grouped by bot (the folder becomes a
// column), Folder when grouped by folder. A bot's rows run by folder then name.
//
// A folder action from a band (rename, pause, delete) reaches EVERY routine of that
// folder the person owns, not only the rows a search or a filter leaves on screen,
// and never another person's bot (a wider scope shows them, but they are not the
// person's to change). A delete says so with its Undo, like the bot panel's.
import { Bot as BotIcon, ChevronLeft, ChevronRight, Folder, FolderInput, FolderPlus, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BotAvatar } from "@/components/Avatar";
import { MENU_ROW, MenuDivider, menuRow } from "@/components/menu-look";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { api, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { flipRoutine } from "@/lib/routine-toggle";
import { postFolderAction, folderMoveTargets, moveRoutinesToFolder } from "@/lib/routine-folder-actions";
import { collapsedRoutineGroups, groupRoutinesAcrossFolders, groupRoutinesByBot, routineGroupHealth, saveCollapsedRoutineGroups, botGroupKey, folderGroupKey, type RoutineGroupBy } from "@/lib/routine-grouping";
import type { RoutineTableRow } from "@/lib/routine-table";
import { orderedRoutineFolders, routineFolderKey, type RoutineFolderUndo } from "../../../shared/routine-folders";
import { FolderMenuItems, FolderNameInput, FolderNotices, SectionMenuBody } from "./RoutineFolders";
import { routineRowActions, RoutineMenuPortal, RoutineRowMenuItems } from "./RoutineRowMenu";
import { GroupBand, RoutineTableHead, RoutineTableRowView, type ColumnsMode, type RowMenu } from "./RoutineTable";
import { useRoutineFolders } from "./useRoutineFolders";

interface Shared {
  now: number;
  viewerPrincipalId: string | null;
  onOpen: (routine: Routine) => void;
  onOpenRun: (run: RoutineRun) => void;
  onCreate: (botId: string, folder?: string) => void;
  onDuplicate: (routine: Routine) => void;
  /** The run log, filtered to this routine. */
  onViewRuns: (routine: Routine) => void;
  /** A team goal's room: the way to open it, when the routine has one. */
  openRoomOf?: (routine: Routine) => (() => void) | undefined;
  renamingId: string | null;
  onRenameStart: (routine: Routine) => void;
  onRenameSave: (routine: Routine, name: string) => void;
  onRenameCancel: () => void;
}

type Menu =
  | { kind: "row"; routine: Routine; x: number; y: number; trigger: HTMLElement }
  | { kind: "band"; x: number; y: number; trigger: HTMLElement; naming?: boolean; /** A folder of the bot, its own actions shown */ folder?: string; renamingFolder?: boolean };

/** A folder delete's notice: one Undo for every bot it reached. */
interface DeleteNotice { text: string; undos: RoutineFolderUndo[] }

const settled = (runs: readonly RoutineRun[], routines: readonly Routine[]) => routines.filter((routine) => runs.some((run) => run.routineId === routine.id && run.status === "running")).length;

export function RoutineGroupedTable({ groupBy, rows, allRoutines, runs, bots, ...shared }: Shared & {
  groupBy: Exclude<RoutineGroupBy, "none">;
  rows: readonly RoutineTableRow[];
  allRoutines: readonly Routine[];
  runs: readonly RoutineRun[];
  bots: readonly Bot[];
}) {
  const dispatch = useStoreDispatch();
  const folderOrders = useStoreSelector((state) => state.routineFolders);
  const [collapsed, setCollapsed] = useState(() => collapsedRoutineGroups(shared.viewerPrincipalId));
  const [notice, setNotice] = useState<DeleteNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
    saveCollapsedRoutineGroups(shared.viewerPrincipalId, next);
  };
  const byId = useMemo(() => new Map(rows.map((row) => [row.routine.id, row])), [rows]);
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const byBot = useMemo(() => groupBy === "bot" ? groupRoutinesByBot(routines, bots, shared.viewerPrincipalId) : [], [groupBy, routines, bots, shared.viewerPrincipalId]);
  const byFolder = useMemo(() => groupBy === "folder" ? groupRoutinesAcrossFolders(routines, bots, folderOrders, shared.viewerPrincipalId) : [], [groupBy, routines, bots, folderOrders, shared.viewerPrincipalId]);
  const columns: ColumnsMode = groupBy === "bot" ? "folder" : "bot";
  const rowOf = (routine: Routine) => byId.get(routine.id)!;
  // A folder of the person's own bots that holds no routine at all is an empty block (nothing invisible), whatever a
  // search or filter hides; "No folder" is always the last block.
  const emptyFolders = useMemo(() => {
    if (groupBy !== "folder") return [];
    const shown = new Set(byFolder.flatMap((group) => group.folder === null ? [] : [routineFolderKey(group.folder)]));
    const out: string[] = [];
    for (const bot of bots) {
      for (const name of folderOrders?.[bot.id] ?? []) {
        const key = routineFolderKey(name);
        if (shown.has(key) || allRoutines.some((routine) => routine.folder && routineFolderKey(routine.folder) === key)) continue;
        shown.add(key);
        out.push(name);
      }
    }
    return out;
  }, [groupBy, byFolder, bots, folderOrders, allRoutines]);
  const folderBlocks = [...byFolder.filter((group) => group.folder !== null), ...emptyFolders.map((folder) => ({ folder, routines: [] as Routine[] })), ...byFolder.filter((group) => group.folder === null)];
  // The person's own bots only: a routine of another person's bot, shown in a wider scope, is never theirs to change.
  const own = useCallback((routine: Routine) => routine.canEdit !== false && bots.some((bot) => bot.id === routine.botId)
    && !(routine.owner?.id && shared.viewerPrincipalId && routine.owner.id.toLowerCase() !== shared.viewerPrincipalId.toLowerCase()), [bots, shared.viewerPrincipalId]);
  const undo = async () => {
    if (!notice) return;
    setBusy(true);
    try {
      const answers = await Promise.all(notice.undos.map((snapshot) => postFolderAction(dispatch, { action: "restore", botId: snapshot.botId, undo: snapshot })));
      if (answers.every((answer) => answer.ok)) setNotice(null);
    } finally { setBusy(false); }
  };
  return <>
    {notice && <FolderNotices serverNote={false} setServerNote={() => {}} notice={{ text: notice.text, undo: notice.undos[0]! }} setNotice={(next) => { if (!next) setNotice(null); }} busy={busy} undo={undo}
      showOffer={false} offerCount={0} offerFolders={0} sortByPrefix={async () => {}} dismissOffer={() => {}} />}
    <div role="table" aria-label={t("routines.list")} data-routine-groups={groupBy}>
      <RoutineTableHead columns={columns} />
      {groupBy === "bot"
        ? byBot.map((group, index) => <BotBlock key={group.botId} first={index === 0} bot={bots.find((candidate) => candidate.id === group.botId)} rows={group.routines.map(rowOf)} allRoutines={allRoutines} runs={runs}
          order={folderOrders?.[group.botId] ?? []} collapsed={collapsed.has(botGroupKey(group.botId))} onToggle={() => toggle(botGroupKey(group.botId))} {...shared} />)
        : folderBlocks.map((group, index) => <FolderBlock key={folderGroupKey(group.folder)} first={index === 0} folder={group.folder} rows={group.routines.map(rowOf)} allRoutines={allRoutines} runs={runs} bots={bots} folderOrders={folderOrders}
          own={own} onDeleted={setNotice} collapsed={collapsed.has(folderGroupKey(group.folder))} onToggle={() => toggle(folderGroupKey(group.folder))} {...shared} />)}
      {groupBy === "folder" && <NewFolderRow bots={bots} />}
    </div>
  </>;
}

/** "New folder" while grouped by folder: a name, and which bot keeps it when the person has several (a folder
 * belongs to one bot). It shows at once as an empty block. */
function NewFolderRow({ bots }: { bots: readonly Bot[] }) {
  const dispatch = useStoreDispatch();
  const [open, setOpen] = useState(false);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  if (bots.length === 0) return null;
  return <div data-routine-new-folder-row="" className="mt-6">
    {open
      ? <div role="row" className="flex flex-wrap items-center gap-2 rounded-lg bg-inset px-3 py-1.5">
        {bots.length > 1 && <select aria-label={t("routines.group.newFolderBot")} value={botId} onChange={(event) => setBotId(event.target.value)} className="h-7 min-w-0 max-w-[200px] truncate rounded-md border border-hairline/60 bg-panel px-2 text-[12px] text-ink">
          {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>}
        <FolderNameInput label={t("routineFolders.newFolderLabel")} onCancel={() => setOpen(false)}
          onSave={async (name) => { const result = await postFolderAction(dispatch, { action: "create", botId: botId || bots[0]!.id, name }); if (result.ok) setOpen(false); }} />
      </div>
      : <button type="button" data-routine-new-folder="" onClick={() => setOpen(true)} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><FolderPlus size={14} aria-hidden="true" />{t("routineFolders.newFolder")}</button>}
  </div>;
}

/** A routine's menu, shared by both blocks: the page's actions plus Move to folder. */
function useRowMenu(folderOf: (routine: Routine) => readonly string[], bots: readonly Bot[], shared: Shared) {
  const dispatch = useStoreDispatch();
  const [menu, setMenu] = useState<Menu | null>(null);
  const state = useStoreSelector((current) => (menu?.kind === "row" ? current : null));
  const close = (focus = true) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (focus) requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };
  const portal = (band?: (menu: Extract<Menu, { kind: "band" }>) => ReactNode, label = "") => menu && <RoutineMenuPortal x={menu.x} y={menu.y} kind={menu.kind === "row" ? "row" : "section"} label={menu.kind === "row" ? menu.routine.name : label} onClose={close}>
    {menu.kind === "row"
      ? <RoutineRowMenuItems routine={menu.routine} actions={routineRowActions({
        routine: menu.routine, bot: bots.find((candidate) => candidate.id === menu.routine.botId), state: state!, dispatch, close,
        onOpen: () => shared.onOpen(menu.routine), onDuplicate: () => shared.onDuplicate(menu.routine), onRename: () => shared.onRenameStart(menu.routine),
        onViewRuns: () => shared.onViewRuns(menu.routine), onOpenRoom: shared.openRoomOf?.(menu.routine),
        moveTo: folderMoveTargets(menu.routine, folderOf(menu.routine), (folder) => void moveRoutinesToFolder(dispatch, menu.routine.botId, [menu.routine], folder)),
      })} />
      : band?.(menu)}
  </RoutineMenuPortal>;
  const onRowMenu: RowMenu = useCallback((routine, at, trigger) => setMenu({ kind: "row", routine, x: at.x, y: at.y, trigger }), []);
  return { menu, setMenu, close, portal, dispatch, onRowMenu };
}

const rowProps = (shared: Shared, onRowMenu: RowMenu | undefined, columns: ColumnsMode) => ({
  columns, now: shared.now, viewerPrincipalId: shared.viewerPrincipalId, onOpen: shared.onOpen, onOpenRun: shared.onOpenRun, onRowMenu,
});

/** One bot's block: its band, then its rows by folder then name. */
function BotBlock({ first, bot, rows, allRoutines, runs, order, collapsed, onToggle, ...shared }: Shared & {
  first: boolean; bot: Bot | undefined; rows: RoutineTableRow[]; allRoutines: readonly Routine[]; runs: readonly RoutineRun[]; order: readonly string[]; collapsed: boolean; onToggle: () => void;
}) {
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const sorted = useMemo(() => {
    const folders = orderedRoutineFolders(order, routines);
    const rank = (routine: Routine) => routine.folder ? folders.findIndex((name) => routineFolderKey(name) === routineFolderKey(routine.folder!)) : folders.length;
    return [...rows].sort((a, b) => rank(a.routine) - rank(b.routine) || a.routine.name.localeCompare(b.routine.name));
  }, [rows, routines, order]);
  const failing = routineGroupHealth(routines, runs).failing;
  const running = settled(runs, routines);
  const name = bot?.name ?? routines[0]?.bot?.name ?? t("routines.group.unknownBot");
  const lead = bot ? <BotAvatar bot={bot} size={20} animated={false} /> : <BotIcon size={16} />;
  const className = first ? "" : "mt-6";
  if (!bot) {
    // A bot this list does not know (another person's routine in a wider scope): no folder logic.
    return <BotBlockBody className={className} id={routines[0]?.botId ?? ""} band={<GroupBand data-routine-group-header={name} lead={lead} name={name} count={rows.length} running={running} failing={failing} collapsed={collapsed} onToggle={onToggle} />}
      rows={collapsed ? [] : sorted} shared={shared} onRowMenu={undefined} />;
  }
  return <KnownBotBlock className={className} bot={bot} name={name} lead={lead} rows={rows} sorted={sorted} allRoutines={allRoutines} running={running} failing={failing} collapsed={collapsed} onToggle={onToggle} {...shared} />;
}

function BotBlockBody({ className, id, band, rows, shared, onRowMenu, extra, after, drag }: { className: string; id: string; band: ReactNode; rows: RoutineTableRow[]; shared: Shared; onRowMenu: RowMenu | undefined; extra?: ReactNode; after?: ReactNode;
  /** Drag and drop of a row onto a folder, and Alt+Up / Alt+Down (the bot's own folder logic) */
  drag?: { start: (routine: Routine, event: React.PointerEvent<HTMLElement>) => void; step: (routine: Routine, direction: -1 | 1) => void; target: string | null } }) {
  return <div role="rowgroup" data-routine-group-bot={id} className={className}>
    {band}
    {extra}
    {rows.map((row) => <RoutineTableRowView key={row.routine.id} row={row} {...rowProps(shared, onRowMenu, "folder")}
      {...(drag ? { onDragStart: drag.start, onStep: drag.step, dropSection: { active: drag.target !== null && routineFolderKey(row.routine.folder ?? "") === routineFolderKey(drag.target) } } : {})}
      renaming={shared.renamingId === row.routine.id} onRenameStart={shared.onRenameStart} onRenameSave={shared.onRenameSave} onRenameCancel={shared.onRenameCancel} />)}
    {after}
  </div>;
}

function KnownBotBlock({ className, bot, name, lead, rows, sorted, allRoutines, running, failing, collapsed, onToggle, ...shared }: Shared & {
  className: string; bot: Bot; name: string; lead: ReactNode; rows: RoutineTableRow[]; sorted: RoutineTableRow[]; allRoutines: readonly Routine[]; running: number; failing: number; collapsed: boolean; onToggle: () => void;
}) {
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const f = useRoutineFolders({ bot, routines, allRoutines: allRoutines as Routine[] });
  const { setMenu, close, portal, onRowMenu } = useRowMenu(() => f.folders, [bot], shared);
  const canManage = f.editable && f.supported;
  return <BotBlockBody className={className} id={bot.id} shared={shared}
    onRowMenu={f.editable ? onRowMenu : undefined}
    drag={f.editable && f.canDrag ? { start: f.startDrag, step: f.step, target: f.dropTarget } : undefined}
    band={<GroupBand data-routine-group-header={name} lead={lead} name={name} count={rows.length} running={running} failing={failing} collapsed={collapsed} onToggle={onToggle}
      menuLabel={canManage ? t("routines.group.botMenu", { name }) : undefined} onMenu={canManage ? (at, trigger) => setMenu({ kind: "band", x: at.x, y: at.y, trigger }) : undefined} />}
    extra={<>
      {f.drag && createPortal(<div data-routine-drag-preview="" aria-hidden="true" style={{ left: f.drag.x + 12, top: f.drag.y + 8 }}
        className="pointer-events-none fixed z-50 flex max-w-[260px] items-center gap-2 rounded-lg border-[0.5px] border-border bg-elevated px-3 py-1.5 text-[13px] leading-[18px] text-ink opacity-95 shadow-lg">
        <FolderInput size={14} className="shrink-0 text-accent" /><span className="truncate">{f.drag.routine.name}</span>
      </div>, document.body)}
      <FolderNotices serverNote={f.serverNote} setServerNote={f.setServerNote} notice={f.notice} setNotice={f.setNotice} busy={f.busy} undo={f.undo}
        showOffer={f.showOffer} offerCount={f.prefixPlan.length} offerFolders={f.prefixFolders} sortByPrefix={f.sortByPrefix} dismissOffer={f.dismissOffer} />
    </>}
    rows={collapsed ? [] : sorted}
    after={portal((menu) => {
      // One folder of this bot picked: its own actions (rename, move up or down, pause, delete), with the way back.
      if (menu.folder !== undefined) {
        const folder = menu.folder;
        const index = f.folders.indexOf(folder);
        const inside = f.botRoutines.filter((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(folder));
        if (menu.renamingFolder) return <FolderNameInput initial={folder} label={t("routineFolders.renameLabel")} onCancel={() => close()}
          onSave={async (to) => { const answer = await f.act({ action: "rename", botId: bot.id, from: folder, to }); if (answer) close(); }} />;
        return <>
          <button type="button" role="menuitem" data-routine-folder-back="" className={MENU_ROW} onClick={() => setMenu({ kind: "band", x: menu.x, y: menu.y, trigger: menu.trigger })}><ChevronLeft size={14} aria-hidden="true" /><span className="min-w-0 truncate">{folder}</span></button>
          <MenuDivider />
          <FolderMenuItems canMoveUp={index > 0} canMoveDown={index >= 0 && index < f.folders.length - 1} anyOn={inside.some((routine) => routine.enabled)} anyRoutine={inside.length > 0} canSortByPrefix={false} onSortByPrefix={() => {}}
            onRename={() => setMenu({ ...menu, renamingFolder: true })} onMove={(direction) => { f.reorder(folder, direction); close(); }}
            onSetEnabled={(enabled) => { close(); f.setFolderEnabled(folder, enabled); }} onDelete={() => { close(false); void f.removeFolder(folder); }} />
        </>;
      }
      return <SectionMenuBody naming={Boolean(menu.naming)} supported={f.supported} showSortAction={f.showSortAction}
        lead={<>
          <button type="button" role="menuitem" autoFocus data-group-new-routine="" className={MENU_ROW} onClick={() => { close(false); shared.onCreate(bot.id); }}><Plus size={14} aria-hidden="true" />{t("routines.group.newFor", { name: bot.name })}</button>
          {f.folders.map((folder) => <button key={folder} type="button" role="menuitem" data-group-folder-entry={folder} className={MENU_ROW} onClick={() => setMenu({ ...menu, folder })}><Folder size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{folder}</span><ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" /></button>)}
          {f.folders.length > 0 && <MenuDivider />}
        </>}
        onStartNaming={() => setMenu({ ...menu, naming: true })} onCancel={() => close()}
        onCreate={async (folderName) => { const answer = await f.act({ action: "create", botId: bot.id, name: folderName }); if (answer) close(); }}
        onSort={() => { close(); void f.sortByPrefix(); }} />;
    }, name)} />;
}

/** One folder's block across the person's bots (a folder is a name; each bot keeps its own): its band, then its rows. Its menu
 * renames, pauses or deletes that folder in every one of the person's bots that has it, whatever a search or filter hides. */
function FolderBlock({ first, folder, rows, allRoutines, runs, bots, folderOrders, own, onDeleted, collapsed, onToggle, ...shared }: Shared & {
  first: boolean; folder: string | null; rows: RoutineTableRow[]; allRoutines: readonly Routine[]; runs: readonly RoutineRun[]; bots: readonly Bot[]; folderOrders: Readonly<Record<string, readonly string[]>> | undefined;
  own: (routine: Routine) => boolean; onDeleted: (notice: DeleteNotice) => void; collapsed: boolean; onToggle: () => void;
}) {
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => a.routine.name.localeCompare(b.routine.name)), [rows]);
  const { setMenu, close, portal, dispatch, onRowMenu } = useRowMenu((routine) => orderedRoutineFolders(folderOrders?.[routine.botId] ?? [], []), bots, shared);
  const [renaming, setRenaming] = useState(false);
  const name = folder ?? t("routines.group.noFolder");
  // Every routine of this folder the person owns: not only the rows shown.
  const scope = useMemo(() => folder === null ? [] : [...new Map([...allRoutines, ...routines].filter((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(folder) && own(routine)).map((routine) => [routine.id, routine])).values()], [folder, allRoutines, routines, own]);
  // The person's bots that have this folder: those with a routine in it, and those whose folder list names it (an empty one).
  const botIds = useMemo(() => folder === null ? [] : [...new Set([
    ...scope.map((routine) => routine.botId),
    ...bots.filter((bot) => (folderOrders?.[bot.id] ?? []).some((name) => routineFolderKey(name) === routineFolderKey(folder))).map((bot) => bot.id),
  ])], [folder, scope, bots, folderOrders]);
  const editable = folder !== null && botIds.length > 0;
  const anyOn = scope.some((routine) => routine.enabled);
  const pending = useMemo(() => new Set<string>(), []);
  const everyBot = async (action: (botId: string) => Promise<unknown>) => { for (const botId of botIds) await action(botId); };
  const remove = async () => {
    if (folder === null) return;
    const done: RoutineFolderUndo[] = [];
    for (const botId of botIds) {
      const snapshot: RoutineFolderUndo = { botId, folders: orderedRoutineFolders(folderOrders?.[botId] ?? [], allRoutines.filter((routine) => routine.botId === botId)),
        routines: scope.filter((routine) => routine.botId === botId).map((routine) => ({ id: routine.id, name: routine.name, folder: routine.folder })) };
      const result = await postFolderAction(dispatch, { action: "delete", botId, name: folder });
      if (result.ok) done.push(snapshot);
    }
    if (done.length) onDeleted({ text: t("routineFolders.deleted", { name: folder }), undos: done });
  };
  return <div role="rowgroup" data-routine-group-folder={folder ?? ""} className={first ? "" : "mt-6"}>
    {renaming && folder !== null
      ? <div role="row" className="rounded-lg bg-inset px-3 py-1.5"><FolderNameInput initial={folder} label={t("routineFolders.renameLabel")} onCancel={() => setRenaming(false)}
        onSave={async (to) => { await everyBot((botId) => postFolderAction(dispatch, { action: "rename", botId, from: folder, to })); setRenaming(false); }} /></div>
      : <GroupBand data-routine-group-header={name} lead={<Folder size={16} data-routine-folder-icon="" />} name={name} count={rows.length} running={settled(runs, routines)} failing={routineGroupHealth(routines, runs).failing} collapsed={collapsed} onToggle={onToggle}
        menuLabel={editable ? t("routineFolders.folderMenu", { name }) : undefined} onMenu={editable ? (at, trigger) => setMenu({ kind: "band", x: at.x, y: at.y, trigger }) : undefined} />}
    {(collapsed ? [] : sorted).map((row) => <RoutineTableRowView key={row.routine.id} row={row} {...rowProps(shared, onRowMenu, "bot")}
      renaming={shared.renamingId === row.routine.id} onRenameStart={shared.onRenameStart} onRenameSave={shared.onRenameSave} onRenameCancel={shared.onRenameCancel} />)}
    {!collapsed && folder !== null && rows.length === 0 && <div role="row"><div role="cell" data-routine-folder-empty="" className="py-2.5 text-[12px] leading-4 text-ink-tertiary">{t("routineFolders.empty")}</div></div>}
    {portal((_menu) => folder === null ? null : <>
      <button type="button" role="menuitem" autoFocus data-routine-folder-action="rename" className={menuRow("idle")} onClick={() => { close(false); setRenaming(true); }}><Pencil size={14} aria-hidden="true" />{t("routineFolders.rename")}</button>
      <button type="button" role="menuitem" data-routine-folder-action={anyOn ? "pause" : "resume"} className={menuRow("idle")}
        onClick={() => { close(); for (const routine of scope) if (routine.enabled === anyOn) void flipRoutine(routine, pending, api, dispatch); }}>
        {anyOn ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{t(anyOn ? "routineFolders.pauseAll" : "routineFolders.resumeAll")}
      </button>
      <MenuDivider />
      <button type="button" role="menuitem" data-routine-folder-action="delete" className={menuRow("danger")} onClick={() => { close(false); void remove(); }}><Trash2 size={14} aria-hidden="true" />{t("routineFolders.delete")}</button>
    </>, name)}
  </div>;
}
