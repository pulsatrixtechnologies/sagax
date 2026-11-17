// Group by Bot or by Folder on the Routines page (2026-11-17, owner): a real grouping,
// one level at a time, in the SAME table as the ungrouped view. Each group is its
// own block: a filled header band (mascot or folder icon, name, count, problem
// figure, "..." menu; a click folds or opens the block, open by default and
// remembered per person), its routines as rows directly under it, then space
// before the next block. The column titles show once at the top. The column the
// block already says is hidden: Bot when grouped by bot (the folder becomes a
// column), Folder when grouped by folder. A bot's rows run by folder then name.
import { Bot as BotIcon, Folder, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
import { orderedRoutineFolders, routineFolderKey } from "../../../shared/routine-folders";
import { FolderNameInput, FolderNotices, SectionMenuBody } from "./RoutineFolders";
import { routineRowActions, RoutineMenuPortal, RoutineRowMenuItems } from "./RoutineRowMenu";
import { GroupBand, RoutineTableHead, RoutineTableRowView, type ColumnsMode, type RowMenu } from "./RoutineTable";
import { useRoutineFolders } from "./useRoutineFolders";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";

interface Shared {
  now: number;
  viewerPrincipalId: string | null;
  onOpen: (routine: Routine) => void;
  onOpenRun: (run: RoutineRun) => void;
  onCreate: (botId: string, folder?: string) => void;
  onDuplicate: (routine: Routine) => void;
  renamingId: string | null;
  onRenameStart: (routine: Routine) => void;
  onRenameSave: (routine: Routine, name: string) => void;
  onRenameCancel: () => void;
}

type Menu =
  | { kind: "row"; routine: Routine; x: number; y: number; trigger: HTMLElement }
  | { kind: "band"; x: number; y: number; trigger: HTMLElement; naming?: boolean };

export function RoutineGroupedTable({ groupBy, rows, allRoutines, runs, bots, ...shared }: Shared & {
  groupBy: Exclude<RoutineGroupBy, "none">;
  rows: readonly RoutineTableRow[];
  allRoutines: readonly Routine[];
  runs: readonly RoutineRun[];
  bots: readonly Bot[];
}) {
  const folderOrders = useStoreSelector((state) => state.routineFolders);
  const [collapsed, setCollapsed] = useState(() => collapsedRoutineGroups(shared.viewerPrincipalId));
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
  // "No folder" is always the last block.
  const folderBlocks = [...byFolder.filter((group) => group.folder !== null), ...byFolder.filter((group) => group.folder === null)];
  return <div role="table" aria-label={t("routines.list")} data-routine-groups={groupBy}>
    <RoutineTableHead columns={columns} />
    {groupBy === "bot"
      ? byBot.map((group, index) => <BotBlock key={group.botId} first={index === 0} bot={bots.find((candidate) => candidate.id === group.botId)} rows={group.routines.map(rowOf)} allRoutines={allRoutines} runs={runs}
        order={folderOrders?.[group.botId] ?? []} collapsed={collapsed.has(botGroupKey(group.botId))} onToggle={() => toggle(botGroupKey(group.botId))} {...shared} />)
      : folderBlocks.map((group, index) => <FolderBlock key={folderGroupKey(group.folder)} first={index === 0} folder={group.folder} rows={group.routines.map(rowOf)} runs={runs} bots={bots} folderOrders={folderOrders}
        collapsed={collapsed.has(folderGroupKey(group.folder))} onToggle={() => toggle(folderGroupKey(group.folder))} {...shared} />)}
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
        moveTo: folderMoveTargets(menu.routine, folderOf(menu.routine), (folder) => void moveRoutinesToFolder(dispatch, menu.routine.botId, [menu.routine], folder)),
      })} />
      : band?.(menu)}
  </RoutineMenuPortal>;
  return { menu, setMenu, close, portal, dispatch };
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
  const name = bot?.name ?? routines[0]?.bot?.name ?? t("routines.group.unknownBot");
  const lead = bot ? <BotAvatar bot={bot} size={20} animated={false} /> : <BotIcon size={16} />;
  const className = first ? "" : "mt-6";
  if (!bot) {
    // A bot this list does not know (another person's routine in a wider scope): no folder logic.
    return <BotBlockBody className={className} id={routines[0]?.botId ?? ""} band={<GroupBand data-routine-group-header={name} lead={lead} name={name} count={rows.length} failing={failing} collapsed={collapsed} onToggle={onToggle} />}
      rows={collapsed ? [] : sorted} shared={shared} onRowMenu={undefined} />;
  }
  return <KnownBotBlock className={className} bot={bot} name={name} lead={lead} rows={rows} sorted={sorted} allRoutines={allRoutines} failing={failing} collapsed={collapsed} onToggle={onToggle} {...shared} />;
}

function BotBlockBody({ className, id, band, rows, shared, onRowMenu, extra, after }: { className: string; id: string; band: ReactNode; rows: RoutineTableRow[]; shared: Shared; onRowMenu: RowMenu | undefined; extra?: ReactNode; after?: ReactNode }) {
  return <div role="rowgroup" data-routine-group-bot={id} className={className}>
    {band}
    {extra}
    {rows.map((row) => <RoutineTableRowView key={row.routine.id} row={row} {...rowProps(shared, onRowMenu, "folder")}
      renaming={shared.renamingId === row.routine.id} onRenameStart={shared.onRenameStart} onRenameSave={shared.onRenameSave} onRenameCancel={shared.onRenameCancel} />)}
    {after}
  </div>;
}

function KnownBotBlock({ className, bot, name, lead, rows, sorted, allRoutines, failing, collapsed, onToggle, ...shared }: Shared & {
  className: string; bot: Bot; name: string; lead: ReactNode; rows: RoutineTableRow[]; sorted: RoutineTableRow[]; allRoutines: readonly Routine[]; failing: number; collapsed: boolean; onToggle: () => void;
}) {
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const f = useRoutineFolders({ bot, routines, allRoutines: allRoutines as Routine[] });
  const { setMenu, close, portal } = useRowMenu(() => f.folders, [bot], shared);
  const canManage = f.editable && f.supported;
  return <BotBlockBody className={className} id={bot.id} shared={shared}
    onRowMenu={f.editable ? (r, at, trigger) => setMenu({ kind: "row", routine: r, x: at.x, y: at.y, trigger }) : undefined}
    band={<GroupBand data-routine-group-header={name} lead={lead} name={name} count={rows.length} failing={failing} collapsed={collapsed} onToggle={onToggle}
      menuLabel={canManage ? t("routines.group.botMenu", { name }) : undefined} onMenu={canManage ? (at, trigger) => setMenu({ kind: "band", x: at.x, y: at.y, trigger }) : undefined} />}
    extra={<FolderNotices serverNote={f.serverNote} setServerNote={f.setServerNote} notice={f.notice} setNotice={f.setNotice} busy={f.busy} undo={f.undo}
      showOffer={f.showOffer} offerCount={f.prefixPlan.length} offerFolders={f.prefixFolders} sortByPrefix={f.sortByPrefix} dismissOffer={f.dismissOffer} />}
    rows={collapsed ? [] : sorted}
    after={portal((menu) => <SectionMenuBody naming={Boolean(menu.naming)} supported={f.supported} showSortAction={f.showSortAction}
      lead={<button type="button" role="menuitem" autoFocus data-group-new-routine="" className={MENU_ROW} onClick={() => { close(false); shared.onCreate(bot.id); }}><Plus size={14} aria-hidden="true" />{t("routines.group.newFor", { name: bot.name })}</button>}
      onStartNaming={() => setMenu({ ...menu, naming: true })} onCancel={() => close()}
      onCreate={async (folderName) => { const answer = await f.act({ action: "create", botId: bot.id, name: folderName }); if (answer) close(); }}
      onSort={() => { close(); void f.sortByPrefix(); }} />, name)} />;
}

/** One folder's block across the person's bots (a folder is a name; each bot keeps its own): its band, then its rows. Its menu
 * renames, pauses or deletes that folder in every bot that has it. */
function FolderBlock({ first, folder, rows, runs, bots, folderOrders, collapsed, onToggle, ...shared }: Shared & {
  first: boolean; folder: string | null; rows: RoutineTableRow[]; runs: readonly RoutineRun[]; bots: readonly Bot[]; folderOrders: Readonly<Record<string, readonly string[]>> | undefined; collapsed: boolean; onToggle: () => void;
}) {
  const routines = useMemo(() => rows.map((row) => row.routine), [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => a.routine.name.localeCompare(b.routine.name)), [rows]);
  const { setMenu, close, portal, dispatch } = useRowMenu((routine) => orderedRoutineFolders(folderOrders?.[routine.botId] ?? [], []), bots, shared);
  const [renaming, setRenaming] = useState(false);
  const botIds = [...new Set(routines.map((routine) => routine.botId))];
  const name = folder ?? t("routines.group.noFolder");
  const editable = folder !== null && routines.some((routine) => routine.canEdit !== false);
  const anyOn = routines.some((routine) => routine.enabled);
  const pending = useMemo(() => new Set<string>(), []);
  const everyBot = async (action: (botId: string) => Promise<unknown>) => { for (const botId of botIds) await action(botId); };
  return <div role="rowgroup" data-routine-group-folder={folder ?? ""} className={first ? "" : "mt-6"}>
    {renaming && folder !== null
      ? <div role="row" className="rounded-lg bg-inset px-3 py-1.5"><FolderNameInput initial={folder} label={t("routineFolders.renameLabel")} onCancel={() => setRenaming(false)}
        onSave={async (to) => { await everyBot((botId) => postFolderAction(dispatch, { action: "rename", botId, from: folder, to })); setRenaming(false); }} /></div>
      : <GroupBand data-routine-group-header={name} lead={<Folder size={16} data-routine-folder-icon="" />} name={name} count={rows.length} failing={routineGroupHealth(routines, runs).failing} collapsed={collapsed} onToggle={onToggle}
        menuLabel={editable ? t("routineFolders.folderMenu", { name }) : undefined} onMenu={editable ? (at, trigger) => setMenu({ kind: "band", x: at.x, y: at.y, trigger }) : undefined} />}
    {(collapsed ? [] : sorted).map((row) => <RoutineTableRowView key={row.routine.id} row={row} {...rowProps(shared, (r, at, trigger) => setMenu({ kind: "row", routine: r, x: at.x, y: at.y, trigger }), "bot")}
      renaming={shared.renamingId === row.routine.id} onRenameStart={shared.onRenameStart} onRenameSave={shared.onRenameSave} onRenameCancel={shared.onRenameCancel} />)}
    {portal((_menu) => folder === null ? null : <>
      <button type="button" role="menuitem" autoFocus data-routine-folder-action="rename" className={menuRow("idle")} onClick={() => { close(false); setRenaming(true); }}><Pencil size={14} aria-hidden="true" />{t("routineFolders.rename")}</button>
      <button type="button" role="menuitem" data-routine-folder-action={anyOn ? "pause" : "resume"} className={menuRow("idle")}
        onClick={() => { close(); for (const routine of routines) if (routine.enabled === anyOn) void flipRoutine(routine, pending, api, dispatch); }}>
        {anyOn ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{t(anyOn ? "routineFolders.pauseAll" : "routineFolders.resumeAll")}
      </button>
      <MenuDivider />
      <button type="button" role="menuitem" data-routine-folder-action="delete" className={menuRow("danger")} onClick={() => { close(false); void everyBot((botId) => postFolderAction(dispatch, { action: "delete", botId, name: folder })); }}><Trash2 size={14} aria-hidden="true" />{t("routineFolders.delete")}</button>
    </>, name)}
  </div>;
}
