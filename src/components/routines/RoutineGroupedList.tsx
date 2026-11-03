// The Automations list grouped (2026-11-03, JC: "per bot grouping, and
// inside the bots ... routine grouping, so it's easier to understand and
// find things").
//
// Group by Bot (the default): one folding section per bot, in the sidebar's
// order, headed like a sidebar section (a chevron in the gutter, the bot's
// avatar, its name, a count, and how many run or fail right now). Inside, the
// bot's own folder list (RoutineFolders.tsx): the routines in no folder
// first, then each folder of the bot in its saved order as a folding
// sub-group with a folder icon and a count, rows that drag between folders,
// the row and folder menus. Group by Folder: one section per folder name
// across the bots, each row naming its bot. Group by None is the flat list
// (RoutineList), drawn by the page as before.
//
// Folded sections are kept per person on this device (src/lib/routine-grouping.ts);
// a bot's folded folders stay where the bot panel keeps them.
import { Bot as BotIcon, ChevronRight, Folder, Loader2, MoreHorizontal, Plus, Repeat2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import {
  botGroupKey,
  collapsedRoutineGroups,
  folderGroupKey,
  groupRoutinesAcrossFolders,
  groupRoutinesByBot,
  routineGroupHealth,
  saveCollapsedRoutineGroups,
  type RoutineGroupBy,
} from "@/lib/routine-grouping";
import { useServerFeature } from "@/lib/server-features";
import { useStoreSelector } from "@/state/store-selector";
import type { Bot } from "@/state/store";
import { canManageRoutineFolders, RoutineFolderList, type RoutineFolderControl } from "./RoutineFolders";
import { RoutineList } from "./RoutineList";

type RowMenu = (routine: Routine, at: { x: number; y: number }, trigger: HTMLElement) => void;

export function RoutineGroupedList({ groupBy, routines, allRoutines, runs, bots, viewerPrincipalId, loading, error, onOpen, onCreate, onDuplicate, onRowMenu, renamingId, onRenameStart, onRenameSave, onRenameCancel }: {
  groupBy: Exclude<RoutineGroupBy, "none">;
  routines: Routine[];
  /** 2026-11-03 (audit N-4): the unfiltered routines, for folder actions. */
  allRoutines?: Routine[];
  runs: RoutineRun[];
  bots: Bot[];
  viewerPrincipalId: string | null;
  loading?: boolean;
  error?: boolean;
  onOpen: (routine: Routine) => void;
  /** A bot section's + (no folder) or a folder's + (that folder). */
  onCreate: (botId: string, folder?: string) => void;
  onDuplicate: (routine: Routine) => void;
  /** The page's row menu, for rows outside a bot's own folder list (Group by
   * Folder, a bot this list does not know). */
  onRowMenu: RowMenu;
  renamingId: string | null;
  onRenameStart: (routine: Routine) => void;
  onRenameSave: (routine: Routine, name: string) => void;
  onRenameCancel: () => void;
}) {
  const folderOrders = useStoreSelector((state) => state.routineFolders);
  const [collapsed, setCollapsed] = useState(() => collapsedRoutineGroups(viewerPrincipalId));
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
    saveCollapsedRoutineGroups(viewerPrincipalId, next);
  };
  const byBot = useMemo(() => groupBy === "bot" ? groupRoutinesByBot(routines, bots, viewerPrincipalId) : [], [groupBy, routines, bots, viewerPrincipalId]);
  const byFolder = useMemo(() => groupBy === "folder" ? groupRoutinesAcrossFolders(routines, bots, folderOrders, viewerPrincipalId) : [], [groupBy, routines, bots, folderOrders, viewerPrincipalId]);
  const rename = { renamingId, onRenameStart, onRenameSave, onRenameCancel };

  if (error || loading || routines.length === 0) {
    return <div aria-label={t("routines.list")}>
      {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
      {loading && <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
      {!loading && !error && <div className="rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" />{t("routines.empty")}</div>}
    </div>;
  }

  return <div aria-label={t("routines.list")} data-routine-groups={groupBy} className={cn("flex flex-col", groupBy === "bot" ? "gap-3" : "gap-2")}>
    {groupBy === "bot" ? byBot.map((group) => {
      const bot = bots.find((candidate) => candidate.id === group.botId);
      const key = botGroupKey(group.botId);
      return <BotSection key={group.botId} botId={group.botId} bot={bot} routines={group.routines} allRoutines={allRoutines} runs={runs} collapsed={collapsed.has(key)} onToggle={() => toggle(key)}
        viewerPrincipalId={viewerPrincipalId} onOpen={onOpen} onCreate={onCreate} onDuplicate={onDuplicate} onRowMenu={onRowMenu} rename={rename} />;
    }) : byFolder.map((group) => {
      const key = folderGroupKey(group.folder);
      const isCollapsed = collapsed.has(key);
      const name = group.folder ?? t("routines.group.noFolder");
      return <section key={key} data-routine-group-folder={group.folder ?? ""} aria-label={name} className="flex flex-col">
        <GroupHeader name={name} count={group.routines.length} collapsed={isCollapsed} onToggle={() => toggle(key)}
          lead={<Folder size={14} aria-hidden="true" data-routine-folder-icon="" className="shrink-0 text-ink-tertiary" />} />
        {!isCollapsed && <div className="pl-4">
          <RoutineList routines={group.routines} viewerPrincipalId={viewerPrincipalId} runs={runs} bots={bots} showBot label={name} onOpen={onOpen} onRowMenu={onRowMenu} {...rename} />
        </div>}
      </section>;
    })}
  </div>;
}

function BotSection({ botId, bot, routines, allRoutines, runs, collapsed, onToggle, viewerPrincipalId, onOpen, onCreate, onDuplicate, onRowMenu, rename }: {
  botId: string;
  bot: Bot | undefined;
  routines: Routine[];
  allRoutines?: Routine[];
  runs: RoutineRun[];
  collapsed: boolean;
  onToggle: () => void;
  viewerPrincipalId: string | null;
  onOpen: (routine: Routine) => void;
  onCreate: (botId: string, folder?: string) => void;
  onDuplicate: (routine: Routine) => void;
  onRowMenu: RowMenu;
  rename: { renamingId: string | null; onRenameStart: (routine: Routine) => void; onRenameSave: (routine: Routine, name: string) => void; onRenameCancel: () => void };
}) {
  const control = useRef<RoutineFolderControl | null>(null);
  const supported = useServerFeature("routineFolders") !== "no";
  const name = bot?.name ?? routines[0]?.bot?.name ?? t("routines.group.unknownBot");
  const health = useMemo(() => routineGroupHealth(routines, runs), [routines, runs]);
  const editable = routines.some((routine) => routine.canEdit !== false);
  const manage = Boolean(bot) && canManageRoutineFolders(routines, supported);
  return <section data-routine-group-bot={botId} aria-label={name} className="flex flex-col">
    <GroupHeader name={name} count={routines.length} collapsed={collapsed} onToggle={onToggle} strong
      lead={bot ? <BotAvatar bot={bot} size={20} animated={false} /> : <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-inset text-ink-tertiary"><BotIcon size={12} /></span>}
      status={<>
        {health.running > 0 && <span data-routine-group-running={health.running} className="shrink-0 text-[11px] leading-4 text-success">· {t("routines.group.running", { count: health.running })}</span>}
        {health.failing > 0 && <span data-routine-group-failing={health.failing} className="shrink-0 text-[11px] leading-4 text-warning">· {t("routines.group.failing", { count: health.failing })}</span>}
      </>}
      actions={bot && editable ? <>
        {manage && <button type="button" data-routine-group-more="" aria-haspopup="menu" aria-label={t("routines.group.botMenu", { name })} title={t("routines.group.botMenu", { name })}
          onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); control.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
          className={HEADER_ICON_BUTTON}><MoreHorizontal size={14} /></button>}
        <button type="button" data-routine-group-new="" aria-label={t("routines.group.newFor", { name })} title={t("routines.group.newFor", { name })} onClick={() => onCreate(botId)}
          className={HEADER_ICON_BUTTON}><Plus size={14} /></button>
      </> : undefined} />
    {!collapsed && <div className="pl-4">
      {bot
        ? <RoutineFolderList bot={bot} routines={routines} allRoutines={allRoutines} runs={runs} grouped={false} folderIcon viewerPrincipalId={viewerPrincipalId} controlRef={control}
          onOpen={onOpen} onCreateIn={(folder) => onCreate(botId, folder)} onDuplicate={onDuplicate} />
        : <RoutineList routines={routines} viewerPrincipalId={viewerPrincipalId} runs={runs} label={name} onOpen={onOpen} onRowMenu={onRowMenu} {...rename} />}
    </div>}
  </section>;
}

const HEADER_ICON_BUTTON = "flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** A section header as the sidebar draws them: 30px high, muted, the
 * chevron in the gutter, then the lead (an avatar or a folder), the name and
 * a count; its buttons show on hover or focus. */
function GroupHeader({ name, count, collapsed, onToggle, lead, status, actions, strong = false }: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  lead: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  strong?: boolean;
}) {
  const label = t(collapsed ? "routineFolders.expand" : "routineFolders.collapse", { name });
  return <div data-routine-group-header={name} className={cn("group/section relative flex min-w-0 items-center rounded-md hover:bg-hover", strong ? "h-9" : "h-[30px]")}>
    <button type="button" aria-expanded={!collapsed} title={label} onClick={onToggle}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-0.5 pr-2 text-left text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center"><ChevronRight size={12} className={cn("transition-transform", !collapsed && "rotate-90")} /></span>
      {lead}
      <span className={cn("truncate leading-4", strong ? "text-[13px] font-medium" : "text-[12px] font-normal")}>{name}</span>
      <span data-routine-group-count={count} className="shrink-0 text-[11px] leading-4 tabular-nums text-ink-tertiary">{count}</span>
      {status}
      <span className="sr-only">{t("routineFolders.countLabel", { count })}</span>
    </button>
    {actions && <div className="hidden shrink-0 items-center gap-0.5 pr-0.5 group-hover/section:flex group-focus-within/section:flex touch:flex">{actions}</div>}
  </div>;
}
