import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AppState, Bot, Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { showInSidebar } from "@/lib/sidebar-hidden";
import type { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";
import {
  BOT_CHATS_SECTION_ID,
  BUILT_IN_SECTION_ID,
  PEOPLE_SECTION_ID,
  isMyTeamSectionName,
  userSectionId,
  userSectionName,
} from "@/lib/sidebar-layout";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import { SidebarSectionHeader } from "../SidebarSectionHeader";
import { SectionNameInput } from "../OrgSectionMenu";
import { sidebarBotActivityTasks } from "../SidebarBotActivity";
import { MIN_QUERY } from "../SearchResults";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { GENERAL_SECTION_ID, isAutomaticSidebarSection, sectionLabel } from "./helpers";
import type { MenuState, SectionListDrag, SelectionFor, TeamMapEntry } from "./types";

/** The "Hidden (N)" row at the foot of the list: closed by default; each
 * entry comes back with Show. */
export function HiddenEntriesRow({ rows }: { rows: ReturnType<typeof hiddenSidebarRows> }) {
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

type BotRowProps = {
  bot: Bot;
  density: SidebarDensity;
  quiet: boolean;
  query: string;
  onMenu: (menu: MenuState) => void;
  startRename: boolean;
  onRenameStarted: () => void;
  selection: ReturnType<SelectionFor>;
};

type GroupRowProps = {
  group: Group;
  density: SidebarDensity;
  quiet: boolean;
  query: string;
  onMenu: (menu: { groupId: string; x: number; y: number }) => void;
};

export function SidebarSectionList({
  density,
  quietRows,
  q,
  state,
  sectionIds,
  teamMap,
  botChats,
  peopleDms,
  sectionedRooms,
  unsectionedRooms,
  builtInBots,
  matchingBots,
  visibleGroups,
  loneGeneral,
  sectionCollapsed,
  inTopGrid,
  renameBotId,
  setRenameBotId,
  setMenu,
  setRoomMenu,
  selectionFor,
  orgMode,
  remoteClient,
  sectionEdit,
  setSectionEdit,
  renameOrgSection,
  openOrgMenu,
  teamMenuReturn,
  setTeamMenu,
  drag,
  hiddenRows,
  renderBot,
  renderGroup,
}: {
  density: SidebarDensity;
  quietRows: boolean;
  q: string;
  state: AppState;
  sectionIds: string[];
  teamMap: TeamMapEntry[];
  botChats: Group[];
  peopleDms: Group[];
  sectionedRooms: Group[];
  unsectionedRooms: Group[];
  builtInBots: Bot[];
  matchingBots: Bot[];
  visibleGroups: Group[];
  loneGeneral: boolean;
  sectionCollapsed: (id: string) => boolean;
  inTopGrid: (bot: Bot) => boolean;
  renameBotId: string | null;
  setRenameBotId: (id: string | null) => void;
  setMenu: (menu: MenuState) => void;
  setRoomMenu: (menu: { groupId: string; x: number; y: number }) => void;
  selectionFor: SelectionFor;
  orgMode: boolean;
  remoteClient: boolean;
  sectionEdit: { mode: "rename"; name: string } | null;
  setSectionEdit: (value: { mode: "rename"; name: string } | null) => void;
  renameOrgSection: (oldName: string, name: string) => Promise<string | null>;
  openOrgMenu: (event: React.MouseEvent<HTMLElement>, name: string | null, id: string | null) => void;
  teamMenuReturn: React.MutableRefObject<HTMLElement | null>;
  setTeamMenu: (value: { name: string; x: number; y: number }) => void;
  drag: SectionListDrag;
  hiddenRows: ReturnType<typeof hiddenSidebarRows>;
  renderBot: (props: BotRowProps) => ReactNode;
  renderGroup: (props: GroupRowProps) => ReactNode;
}) {
  const {
    draggingSectionId,
    dropTarget,
    itemDropId,
    setItemDropId,
    setDraggingSectionId,
    sectionDragRef,
    acceptItemDrag,
    updateSectionDropTarget,
    dropItem,
    dropSection,
    resetSectionDrag,
    itemDragProps,
    toggleSection,
    moveSidebarSection,
    layoutInteractive,
  } = drag;

  return (
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
                    {renderBot({
                      bot,
                      density,
                      quiet: quietRows,
                      query: q,
                      onMenu: setMenu,
                      startRename: renameBotId === bot.id,
                      onRenameStarted: () => setRenameBotId(null),
                      selection: selectionFor(bot.id),
                    })}
                  </div>
                ))}
                {sectionGroupItems.map((group) => (
                  <div key={group.id} {...(group.dm ? {} : itemDragProps("group", group.id))}>
                    {renderGroup({
                      group,
                      density,
                      quiet: quietRows,
                      query: q,
                      onMenu: setRoomMenu,
                    })}
                  </div>
                ))}
                {sectionBotItems.map((bot) => (
                  <div key={bot.id} {...itemDragProps("bot", bot.id)}>
                    {renderBot({
                      bot,
                      density,
                      quiet: quietRows,
                      query: q,
                      onMenu: setMenu,
                      startRename: renameBotId === bot.id,
                      onRenameStarted: () => setRenameBotId(null),
                      selection: selectionFor(bot.id),
                    })}
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
                    {renderBot({
                      bot,
                      density,
                      quiet: quietRows,
                      query: q,
                      onMenu: setMenu,
                      startRename: renameBotId === bot.id,
                      onRenameStarted: () => setRenameBotId(null),
                      selection: selectionFor(bot.id),
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {density !== "icons" && <HiddenEntriesRow rows={hiddenRows} />}
    </div>
  );
}
