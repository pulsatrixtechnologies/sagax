import type { RefObject } from "react";
import { ArrowRight, BookOpen, Brain, Monitor, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { TeamMapSection } from "@/lib/team-map";
import { orderBots, type Point } from "@/lib/team-canvas";
import { BotCard } from "./BotCard";
import { VirtualRow } from "../VirtualRow";

/** A bot card's fixed height (BotCard: h-[126px]). */
const BOT_CARD_HEIGHT = 126;

const iconButton = "flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";
const menuButton = "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[12px] text-ink-secondary hover:bg-control hover:text-ink";

export function TeamSectionsLayer(props: {
  sections: TeamMapSection<Bot>[];
  tiles: Array<{ key: string; x: number; y: number; width: number; height: number }>;
  view: { scale: number };
  positions: Record<string, Point>;
  layoutLoaded: boolean;
  canManage: boolean;
  selectedId: string | null | undefined;
  settingsOpen: boolean;
  dragged: { bot: Bot; point: Point } | null;
  moving: string | null;
  connectedBotIds: string[];
  computerDropKey: string | null;
  dropKey: string | null;
  dropHint: string | null;
  insertion: { botId: string; after: boolean } | null;
  teamComputers: Record<string, { name: string; state?: string }>;
  menuAbove: string | null;
  setMenuAbove: (key: string | null) => void;
  viewport: RefObject<HTMLDivElement | null>;
  personalOrder: (key: string) => string[] | undefined;
  savePositions: (next: Record<string, Point>) => void;
  arrangeBot?: (bot: Bot, delta: number) => void;
  onComputer?: (bot: Bot) => void;
  onTeamComputer?: (sectionKey: string) => void;
  onEditTeam: (section: string, rename?: boolean) => void;
  onInstructions: (key: string, label: string) => void;
  onMemory?: (key: string, label: string) => void;
  onDeleteTeam: (section: string) => void;
}) {
  const {
    sections, tiles, view, positions, layoutLoaded, canManage, selectedId, settingsOpen,
    dragged, moving, connectedBotIds, computerDropKey, dropKey, dropHint, insertion, teamComputers,
    menuAbove, setMenuAbove, viewport, personalOrder, savePositions, arrangeBot, onComputer,
    onTeamComputer, onEditTeam, onInstructions, onMemory, onDeleteTeam,
  } = props;

  return (
    <>
      {sections.map((section, index) => {
        const tile = tiles[index];
        const hierarchy = section.chiefs.length > 0 && section.members.length > 0;
        const dropping = computerDropKey === section.key || (dragged && dropKey === section.key && (dragged.bot.section?.trim() ?? "") !== section.key);
        const computer = Object.hasOwn(teamComputers, section.key) ? teamComputers[section.key] : undefined;
        const label = section.key ? section.name : t("sidebar.section.general");
        // A card far from the visible part of the canvas keeps its box and
        // drops its content (#2791); the open, dragged or moving one keeps it.
        const renderBot = (bot: Bot) => <VirtualRow key={bot.id} rowKey={`team-card:${bot.id}`} className="relative w-[236px]" estimate={BOT_CARD_HEIGHT} initiallyShown
          eager={(selectedId === bot.id && settingsOpen) || dragged?.bot.id === bot.id || moving === bot.id || insertion?.botId === bot.id}
          heldAttributes={{ "data-bot-id": bot.id }}>
          {insertion?.botId === bot.id && <div className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent", insertion.after ? "-bottom-[9px]" : "-top-[9px]")} />}
          <BotCard bot={bot} selected={selectedId === bot.id && settingsOpen} moving={dragged?.bot.id === bot.id || moving === bot.id}
            connected={connectedBotIds.includes(bot.id)} onComputer={onComputer} onArrange={arrangeBot} />
        </VirtualRow>;
        return <section key={section.key} data-team-key={section.key} aria-label={t("canvas.teamRegion", { name: label })}
          data-team-depth={section.depth ?? 0}
          className={cn("absolute rounded-2xl border bg-panel/90 shadow-sm has-[details[open]]:z-20 data-[computer-dropping=true]:border-accent data-[computer-dropping=true]:ring-2 data-[computer-dropping=true]:ring-accent/25", dropping ? "border-accent ring-2 ring-accent/25" : "border-hairline/50", section.parent && "border-l-[3px] border-l-accent/40")}
          style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }}>
          <header className="flex h-16 items-center gap-2 px-5">
            <button data-arrange-team={section.key} disabled={!layoutLoaded} aria-label={t("canvas.arrange", { name: label })}
              title={t("canvas.arrangeHint")} className="min-w-0 flex-1 cursor-grab rounded-md py-2 text-left active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
              onKeyDown={(event) => {
                const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
                if (!delta) return;
                event.preventDefault(); event.stopPropagation();
                const step = event.shiftKey ? 40 : 10;
                savePositions({ ...positions, [section.key]: { x: tile.x + delta[0] * step, y: tile.y + delta[1] * step } });
              }}>
              <h2 className="truncate text-[13px] font-semibold tracking-tight">{label}</h2>
              {section.parent && <p data-sub-team-of={section.parent} className="truncate text-[11px] text-ink-secondary">{t("team.subTeamOf", { name: section.parent })}</p>}
            </button>
            {computer && <button aria-label={t("canvas.teamComputer", { team: label, name: computer.name })} title={`${computer.name}${computer.state ? ` · ${computer.state}` : ""}`}
              disabled={!onTeamComputer} onClick={() => onTeamComputer?.(section.key)}
              className="flex min-w-0 max-w-[120px] shrink items-center gap-1.5 rounded-md px-1.5 py-2 text-[10px] text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none">
              <Monitor size={12} className="shrink-0" /><span className="truncate">{computer.name}</span>
            </button>}
            <span className="text-[11px] tabular-nums text-ink-secondary">{section.chiefs.length + section.members.length}</span>
            {canManage && <details className="relative" onToggle={(event) => {
              if (event.currentTarget.open) {
                const bounds = viewport.current?.getBoundingClientRect();
                setMenuAbove(bounds && event.currentTarget.getBoundingClientRect().bottom > bounds.bottom - 210 * view.scale ? section.key : null);
                viewport.current?.querySelectorAll("details[open]").forEach((element) => { if (element !== event.currentTarget) element.removeAttribute("open"); });
              }
            }}>
              <summary aria-label={t("canvas.manageTeam", { name: label })} className={cn(iconButton, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}><MoreHorizontal size={17} /></summary>
              <div className={cn("absolute right-0 z-30 w-[220px] animate-pop-in rounded-xl border border-hairline popover-surface bg-panel p-1.5 shadow-xl", menuAbove === section.key ? "bottom-10" : "top-10")} onClick={(event) => {
                const menu = event.currentTarget.closest("details");
                menu?.querySelector("summary")?.focus();
                menu?.removeAttribute("open");
              }}>
                <button className={menuButton} onClick={() => onEditTeam(section.key)} aria-label={t("team.moveTo", { name: label })}><Users size={14} />{t("team.moveTo", { name: label })}</button>
                <button className={menuButton} onClick={() => onInstructions(section.key, label)} aria-label={t("team.instructionsEdit", { name: label })}><BookOpen size={14} />{t("team.instructions")}</button>
                {onMemory && <button className={menuButton} onClick={() => onMemory(section.key, label)} aria-label={t("teamCanvas.memoryAria", { name: label })}><Brain size={14} />{t("botPanel.teamMemorySharing")}</button>}
                {section.key && <button className={menuButton} onClick={() => onEditTeam(section.key, true)} aria-label={t("team.renameAria", { name: label })}><Pencil size={14} />{t("team.rename")}</button>}
                {section.key && <button className={cn(menuButton, "hover:text-danger")} onClick={() => onDeleteTeam(section.key)} aria-label={t("team.deleteAria", { name: label })}><Trash2 size={14} />{t("team.delete")}</button>}
              </div>
            </details>}
          </header>
          {dropping && <div className="pointer-events-none absolute -top-7 left-2 z-30 max-w-[calc(100%-16px)] truncate rounded-md bg-accent px-2 py-1 text-[10px] text-accent-ink shadow-sm">{dropHint}</div>}
          <div className="flex items-center px-5 pb-5">
            {section.chiefs.length > 0 && <div className="flex flex-col gap-4">{orderBots(section.chiefs, personalOrder(section.key)).map(renderBot)}</div>}
            {hierarchy && <div className="flex w-10 shrink-0 justify-center text-ink-secondary/35" aria-hidden="true"><ArrowRight size={22} strokeWidth={1} /></div>}
            {section.members.length > 0 && <div className="flex flex-col gap-4">{orderBots(section.members, personalOrder(section.key)).map(renderBot)}</div>}
            {section.chiefs.length + section.members.length === 0 && <p className="flex h-[126px] w-[236px] items-center justify-center rounded-xl border border-dashed border-hairline/70 px-6 text-center text-[12px] leading-relaxed text-ink-secondary">{t("canvas.dropHere")}</p>}
          </div>
        </section>;
      })}
    </>
  );
}
