// The Routines table's pieces (2026-11-17), shared by the plain table and the
// grouped one: the six-column row (name, bot, schedule, the trend of the last 7
// runs, next run, "..."), its head, and a group's heading row. At a narrow page
// the row is two lines under the name: the trend, then the bot and schedule.
import { ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { memo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineDateTime, routineNextText, routineRunAgo, routineRunDuration, routineRunLabel, routineRunPreview, routineRunTime, routineState } from "@/lib/routine-display";
import type { RoutineTableRow } from "@/lib/routine-table";
import { TREND_RUN_KINDS, type RoutineTrend, type TrendKind } from "@/lib/routine-trend";
import { RoutineNameInput } from "./RoutineRowMenu";
import { RoutineOwnerBadge } from "./RoutineScopeBar";

export type RowMenu = (routine: Routine, at: { x: number; y: number }, trigger: HTMLElement) => void;

// Literal class names only: Tailwind reads them from the source text.
// Phone: name, trend and "..." on one line, the rest in one muted line under it. From 44rem: the columns, the trend
// as bars only until 64rem, then with its "ago" text. Which of Bot and Folder show depends on the grouping: the
// group's block says its own (Group by Bot hides Bot, Group by Folder hides Folder), No grouping shows both.
export type ColumnsMode = "both" | "bot" | "folder";
const PHONE = "grid-cols-[minmax(0,1fr)_auto_28px] gap-x-3 gap-y-1";
export const COLUMNS: Record<ColumnsMode, string> = {
  both: `${PHONE} @[44rem]/routines:grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,1.8fr)_7.5rem_minmax(0,0.9fr)_28px] @[64rem]/routines:grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,1.8fr)_13.5rem_minmax(12.5rem,0.9fr)_28px]`,
  bot: `${PHONE} @[44rem]/routines:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_7.5rem_minmax(0,0.9fr)_28px] @[64rem]/routines:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_13.5rem_minmax(12.5rem,0.9fr)_28px]`,
  folder: `${PHONE} @[44rem]/routines:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_7.5rem_minmax(0,0.9fr)_28px] @[64rem]/routines:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.9fr)_13.5rem_minmax(12.5rem,0.9fr)_28px]`,
};
const HEAD_CELL = "text-[12px] leading-4 text-ink-secondary";


// One bar per run, like an uptime strip: the SAME size for every result (owner, 2026-11-17: "same height, colour
// alone"), its colour the result's. The three colours are the skin's own, a stronger step of them where a skin keeps
// two too close for a colour-blind eye (--trend-* in styles.css, measured in src/lib/trend-colors.test.ts). A blocked or
// missed run, and one that waits on the person, are the OUTLINE of the same bar, so neither reads as a paler failure
// or problem. The meaning is also in the tooltip and the accessible label, never in the colour alone.
const BAR_TONE: Record<TrendKind, string> = {
  success: "bg-trend-success", problems: "bg-trend-problems", failed: "bg-trend-failed", blocked: "bg-transparent ring-1 ring-inset ring-trend-failed",
  running: "bg-accent animate-pulse motion-reduce:animate-none", waiting: "bg-transparent ring-1 ring-inset ring-trend-problems", empty: "bg-ink/10",
};
const BAR = "block h-4 w-1 shrink-0 rounded-[1px]";

/** The trend in words: "Last 7 runs: succeeded: 5, with problems: 1; most recent 3 min ago". */
export function trendSentence(trend: RoutineTrend, now: number): string {
  if (!trend.newest) return t("routinesOverview.trend.none");
  const counts = TREND_RUN_KINDS.filter((kind) => trend.counts[kind]).map((kind) => t(trend.counts[kind] === 1 ? `routinesOverview.trend.${kind}One` : `routinesOverview.trend.${kind}`, { count: trend.counts[kind]! }));
  return t("routinesOverview.trend.label", { counts: counts.join(", "), ago: routineRunAgo(routineRunTime(trend.newest), now) });
}

/** What a bar says in words: when, the result, how long. */
function markLabel(run: RoutineRun, now: number): string {
  return [routineDateTime(routineRunTime(run)), routineRunLabel(run), routineRunDuration(run, now)].filter(Boolean).join(" · ");
}

/** The tooltip adds the first words of what the run reported. */
function markTitle(run: RoutineRun, now: number): string {
  const preview = routineRunPreview(run).replace(/\s+/g, " ").trim();
  return [markLabel(run, now), preview.length > 140 ? `${preview.slice(0, 139)}…` : preview].filter(Boolean).join("\n");
}

/** The last 7 runs, oldest at the left, then how long ago the newest was. One tab stop for the whole strip: the
 * arrow keys (Home and End too) move between its bars and Enter or Space opens the focused run. */
function TrendCell({ trend, now, onOpenRun }: { trend: RoutineTrend; now: number; onOpenRun: (run: RoutineRun) => void }) {
  const runs = trend.marks.flatMap((mark) => mark.run ? [mark.run] : []);
  const [active, setActive] = useState(runs.length - 1);
  const stop = Math.min(Math.max(active, 0), runs.length - 1);
  const strip = useRef<HTMLSpanElement>(null);
  const focusAt = (index: number) => {
    const next = Math.min(Math.max(index, 0), runs.length - 1);
    setActive(next);
    strip.current?.querySelectorAll<HTMLElement>("[data-trend-run]")[next]?.focus();
  };
  let runIndex = -1;
  return <div role="group" data-routine-trend aria-label={trendSentence(trend, now)} className="flex min-w-0 items-center gap-2">
    <span ref={strip} className="flex h-4 shrink-0 items-center gap-[3px]">
      {trend.marks.map((mark, index) => {
        if (!mark.run) return <span key={`empty-${index}`} data-trend-mark="empty" aria-hidden="true" className={cn(BAR, BAR_TONE.empty)} />;
        const own = ++runIndex;
        const run = mark.run;
        // A span with a link role, not a button: a skin that paints buttons (the retro one) would give the bar a button face.
        return <span key={run.id} role="link" data-trend-run="" tabIndex={own === stop ? 0 : -1} data-trend-mark={mark.kind} title={markTitle(run, now)} aria-label={markLabel(run, now)} onClick={() => onOpenRun(run)} onFocus={() => setActive(own)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenRun(run); }
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); focusAt(own - 1); }
            else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); focusAt(own + 1); }
            else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
            else if (event.key === "End") { event.preventDefault(); focusAt(runs.length - 1); }
          }}
          className={cn(BAR, BAR_TONE[mark.kind], "relative z-10 cursor-pointer hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")} />;
      })}
    </span>
    <span data-trend-ago className="hidden min-w-0 whitespace-nowrap text-[12px] leading-4 text-ink-tertiary @[64rem]/routines:inline">{trend.newest ? routineRunAgo(routineRunTime(trend.newest), now) : t("routinesOverview.neverRan")}</span>
  </div>;
}

function NextRun({ routine }: { routine: Routine }) {
  const state = routineState(routine);
  if (!routine.enabled || routine.suspended) {
    return <span data-routine-state={state.tone} title={state.label} className={cn("inline-block max-w-full truncate rounded-md px-1.5 align-top text-[12px] leading-[18px]", state.tone === "warning" ? "bg-warning/15 text-warning" : "bg-inset text-ink-secondary")}>{state.label}</span>;
  }
  // A routine that starts on a trigger has no next time: its Schedule column already says what starts it.
  if (routine.nextRunAt == null) return <span data-routine-next="" aria-hidden="true" className="text-[12px] leading-4 text-ink-tertiary">-</span>;
  return <span data-routine-next className="text-[12px] leading-4 text-ink-secondary">{routineNextText(routine)}</span>;
}

interface RowProps {
  /** Which of the Bot and Folder columns this table shows. */
  columns?: ColumnsMode;
  row: RoutineTableRow; now: number; viewerPrincipalId?: string | null; onOpen: (routine: Routine) => void; onOpenRun: (run: RoutineRun) => void; onRowMenu?: RowMenu;
  /** A mouse press on the row: the folder logic may turn it into a drag onto a folder. */
  onDragStart?: (routine: Routine, event: ReactPointerEvent<HTMLElement>) => void;
  /** Alt+Up / Alt+Down on the focused name: to the previous or next folder. */
  onStep?: (routine: Routine, direction: -1 | 1) => void;
  /** Dragging is on in this block: the row is a drop place for its own folder, lit while a row is over it. */
  dropSection?: { active: boolean };
  renaming: boolean; onRenameStart?: (routine: Routine) => void; onRenameSave?: (routine: Routine, name: string) => void; onRenameCancel?: () => void;
}

export const RoutineTableRowView = memo(function RoutineTableRowView({ columns = "both", row, now, viewerPrincipalId, onOpen, onOpenRun, onRowMenu, onDragStart, onStep, dropSection, renaming, onRenameStart, onRenameSave, onRenameCancel }: RowProps) {
  const { routine } = row;
  const readOnly = routine.canEdit === false;
  const otherOwner = routine.owner?.id && routine.owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? routine.owner : null;
  const openMenu = (trigger: HTMLElement, at?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    onRowMenu?.(routine, at ?? { x: rect.left, y: rect.bottom + 4 }, trigger);
  };
  const reset = "@[44rem]/routines:[grid-area:auto]";
  // Phone: one muted line (never a third), cut at the edge; the whole line is its tooltip.
  const folded = [columns === "folder" ? null : row.botName, columns === "bot" ? null : routine.folder, row.paused ? routineState(routine).label : row.when, !row.paused && routine.enabled && routine.nextRunAt != null ? routineNextText(routine) : null].filter(Boolean).join(" · ");
  return <div role="row" data-routine-row data-routine-id={routine.id} data-routine-enabled={routine.enabled ? "" : undefined} data-routine-folder-section={dropSection ? (routine.folder ?? "") : undefined}
    onPointerDown={onDragStart && !readOnly ? (event) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if ((event.target as HTMLElement).closest?.("[data-routine-row-menu],[data-trend-mark]")) return;
      onDragStart(routine, event);
    } : undefined}
    onContextMenu={onRowMenu && !readOnly ? (event) => { event.preventDefault(); openMenu(event.currentTarget, { x: event.clientX, y: event.clientY }); } : undefined}
    className={cn("relative grid items-center border-b border-hairline/40 py-2.5 hover:bg-hover", onDragStart && !readOnly && "cursor-grab select-none", dropSection?.active && "bg-hover/60 ring-1 ring-accent/50", COLUMNS[columns])}>
    <div role="cell" className={cn("flex min-w-0 flex-col [grid-area:1/1]", reset)}>
      {renaming && onRenameSave ? <RoutineNameInput initial={routine.name} onSave={(name) => onRenameSave(routine, name)} onCancel={() => onRenameCancel?.()} /> : (
        <span className="flex min-w-0 items-center gap-2">
          <button type="button" data-routine-title onClick={() => onOpen(routine)}
            onKeyDown={!readOnly ? (event: ReactKeyboardEvent<HTMLButtonElement>) => {
              if (onRenameStart && event.key === "F2") { event.preventDefault(); onRenameStart(routine); }
              else if (onRowMenu && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); openMenu(event.currentTarget); }
              else if (onStep && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); onStep(routine, event.key === "ArrowUp" ? -1 : 1); }
            } : undefined}
            className="min-w-0 break-words text-left text-[13px] font-medium leading-[18px] text-ink after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent/60">{routine.name}</button>
          {otherOwner && <RoutineOwnerBadge owner={otherOwner} size={14} className="relative max-w-[40%] shrink-0 rounded-md bg-inset px-1.5 text-[12px] leading-[18px] text-ink-secondary" />}
        </span>)}
    </div>
    <div role="cell" data-routine-folded title={folded} className={cn("min-w-0 truncate text-[12px] leading-4 text-ink-secondary [grid-area:2/1/auto/4]", "@[44rem]/routines:hidden")}>{folded}</div>
    {columns !== "folder" && <div role="cell" data-routine-bot className={cn("hidden min-w-0 text-[12px] leading-4 text-ink-secondary", "@[44rem]/routines:block")}>{row.botName}</div>}
    {columns !== "bot" && <div role="cell" data-routine-folder className={cn("hidden min-w-0", "@[44rem]/routines:block")}>{routine.folder && <span className="inline-block max-w-full break-words rounded-md bg-inset px-1.5 text-[12px] leading-[18px] text-ink-secondary">{routine.folder}</span>}</div>}
    <div role="cell" data-routine-when className={cn("hidden min-w-0 text-[12px] leading-4 text-ink-secondary", "@[44rem]/routines:block")}>{row.when}</div>
    <div role="cell" className={cn("min-w-0 [grid-area:1/2]", reset)}><TrendCell trend={row.trend} now={now} onOpenRun={onOpenRun} /></div>
    <div role="cell" className={cn("hidden min-w-0", "@[44rem]/routines:block")}><NextRun routine={routine} /></div>
    <div role="cell" className={cn("flex justify-end [grid-area:1/3]", reset)}>
      {onRowMenu && !readOnly && <button type="button" data-routine-row-menu aria-label={t("routineFolders.rowMenu", { name: routine.name })} title={t("routineFolders.rowMenu", { name: routine.name })}
        onClick={(event) => openMenu(event.currentTarget)}
        className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><MoreHorizontal size={16} aria-hidden="true" /></button>}
    </div>
  </div>;
}, sameRowProps);

/** The trend's runs and results: what a bar draws, nothing else. */
const trendKey = (row: RoutineTableRow) => row.trend.marks.map((mark) => `${mark.run?.id ?? "-"}:${mark.kind}:${mark.run?.finishedAt ?? ""}`).join("|");

/** A row redraws only when what it shows changed: its routine, its bot's name, its schedule words, paused, its
 * trend's runs and results, or any other prop. The row object is rebuilt on every run event, so a plain shallow
 * compare never skipped one. */
function sameRowProps(a: RowProps, b: RowProps): boolean {
  if (a.row !== b.row && (a.row.routine !== b.row.routine || a.row.botName !== b.row.botName || a.row.when !== b.row.when || a.row.paused !== b.row.paused || trendKey(a.row) !== trendKey(b.row))) return false;
  for (const key of Object.keys({ ...a, ...b }) as Array<keyof RowProps>) {
    if (key === "row") continue;
    if (key === "dropSection") { if (a.dropSection?.active !== b.dropSection?.active || Boolean(a.dropSection) !== Boolean(b.dropSection)) return false; continue; }
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** The table's column titles, once at the top, whatever the grouping. */
export function RoutineTableHead({ columns = "both" }: { columns?: ColumnsMode }) {
  const wide = "hidden @[44rem]/routines:block";
  return <div role="row" className={cn("grid items-center border-b border-hairline/40 pb-2", COLUMNS[columns])}>
    <span role="columnheader" className={cn(HEAD_CELL, "[grid-area:1/1] @[44rem]/routines:[grid-area:auto]")}>{t("routinesOverview.col.routine")}</span>
    {columns !== "folder" && <span role="columnheader" className={cn(HEAD_CELL, wide)}>{t("routinesOverview.col.bot")}</span>}
    {columns !== "bot" && <span role="columnheader" className={cn(HEAD_CELL, wide)}>{t("routinesOverview.col.folder")}</span>}
    <span role="columnheader" className={cn(HEAD_CELL, wide)}>{t("routinesOverview.col.when")}</span>
    <span role="columnheader" className={cn(HEAD_CELL, wide)}>{t("routinesOverview.col.trend")}</span>
    <span role="columnheader" className={cn(HEAD_CELL, wide)}>{t("routinesOverview.col.next")}</span>
    <span role="columnheader" className="sr-only">{t("routinesOverview.col.actions")}</span>
  </div>;
}

/** A group's header band, a table row of its own: one header cell that spans every column, holding a filled band
 * (a bot's mascot or a folder's icon, the name, the count, how many are running, one problem figure when there is one)
 * that folds or opens its block; its "..." is the group's menu. */
export function GroupBand({ lead, name, count, running, failing, collapsed, onToggle, menuLabel, onMenu, columnCount = 6, children, ...rest }: {
  lead: ReactNode;
  name: ReactNode;
  count: number;
  /** Routines of the group with a run in progress: shown only above zero. */
  running?: number;
  /** Routines with a problem in the group: one compact figure, only when above zero. */
  failing?: number;
  collapsed: boolean;
  onToggle: () => void;
  menuLabel?: string;
  onMenu?: (at: { x: number; y: number }, trigger: HTMLElement) => void;
  /** The columns the table has at this grouping: the header cell spans them. */
  columnCount?: number;
  children?: ReactNode;
} & Record<`data-${string}`, string | number | undefined>) {
  return <div role="row" {...rest} onContextMenu={onMenu ? (event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }, event.currentTarget); } : undefined}>
    <div role="rowheader" aria-colspan={columnCount} className="flex min-w-0 items-center gap-1 rounded-lg bg-inset">
      <button type="button" aria-expanded={!collapsed} data-group-toggle onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform motion-reduce:transition-none", !collapsed && "rotate-90")} />
        <span aria-hidden="true" className="flex shrink-0 items-center text-ink-secondary">{lead}</span>
        <span className="min-w-0 break-words text-[13px] font-medium leading-[18px] text-ink">{name}</span>
        <span data-group-count={count} className="shrink-0 text-[12px] leading-4 tabular-nums text-ink-secondary">{count === 1 ? t("routineCalendar.countOne") : t("routineCalendar.count", { count })}</span>
        {running ? <span data-group-running={running} title={t("routineCalendar.activeCount", { count: running })} aria-label={t("routineCalendar.activeCount", { count: running })} className="flex shrink-0 items-center gap-1 text-[12px] leading-4 tabular-nums text-accent"><Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />{running}</span> : null}
        {failing ? <span data-group-failing={failing} title={t("routines.group.failing", { count: failing })} aria-label={t("routines.group.failing", { count: failing })} className="shrink-0 rounded-full bg-danger/10 px-1.5 text-[11px] leading-4 tabular-nums text-danger">{failing}</span> : null}
      </button>
      {children}
      {onMenu && menuLabel && <button type="button" data-group-menu aria-haspopup="menu" aria-label={menuLabel} title={menuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><MoreHorizontal size={16} aria-hidden="true" /></button>}
    </div>
  </div>;
}
