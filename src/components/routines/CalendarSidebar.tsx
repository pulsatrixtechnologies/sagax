import { CalendarClock } from "lucide-react";
import { memo } from "react";
import { RightRailPanel } from "@/components/RightRail";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { Bot } from "@/state/store";
import { MiniMonth } from "./MiniMonth";
import { RoutineList } from "./RoutineList";

export { BOT_CALENDAR_DRAG_TYPE } from "@/lib/bot-drag";

export interface CalendarSidebarProps {
  anchor: number;
  onSelectDate: (at: number) => void;
  /** The upcoming routines, already narrowed by the page's filters (scope,
   * status, bot) and in run order (`upcomingRoutines`). */
  routines: Routine[];
  /** The runs the rows read their state from (Running, Waiting, Queued):
   * the page passes the in-flight ones only, so a finished run's frame does
   * not render the panel (2026-11-02). */
  runs: RoutineRun[];
  bots: Bot[];
  viewerPrincipalId?: string | null;
  loading?: boolean;
  error?: boolean;
  /** Shows the routine: the page moves the calendar to its next run and
   * opens its details. */
  onOpenRoutine: (routine: Routine) => void;
  /** Collapses the sidebar; its button sits in its own row above the month
   * so it never covers the month title. */
  onCollapse?: () => void;
  /** Some routines match the filters but none will run (paused ones, for
   * instance): the empty line says so instead of "Nothing scheduled". */
  filteredOut?: boolean;
  /** Hidden under 1024px, as the page has always drawn it. */
  hideNarrow?: boolean;
}

/** The calendar's right panel (2026-10-18): the month, then what runs
 * next. Bots are scheduled by dragging them from the left sidebar, which
 * already lists them, so this panel no longer repeats them. */
export const CalendarSidebar = memo(function CalendarSidebar({ anchor, onSelectDate, routines, runs, bots, viewerPrincipalId, loading, error, onOpenRoutine, onCollapse, filteredOut = false, hideNarrow = false }: CalendarSidebarProps) {
  return (
    // The shared right rail (RightRail.tsx), the same as the Memory explorer's.
    <RightRailPanel label={t("routines.upcoming.sidebar")} onCollapse={onCollapse} hideLabel={t("routines.upcoming.hide")} hideNarrow={hideNarrow}>
      <MiniMonth anchor={anchor} onSelect={onSelectDate} />

      <div className="mx-4 border-t border-hairline/40" />

      <section aria-labelledby="calendar-upcoming-heading" className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <div id="calendar-upcoming-heading" className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
            <CalendarClock size={13} aria-hidden="true" />
            {t("routines.upcoming.title")}
          </div>
          <span className="rounded-full bg-raised px-1.5 py-0.5 text-[11px] tabular-nums text-ink-secondary">
            {routines.length}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <RoutineList
            variant="upcoming"
            routines={routines}
            runs={runs}
            bots={bots}
            viewerPrincipalId={viewerPrincipalId}
            loading={loading}
            error={error}
            onOpen={onOpenRoutine}
            emptyText={t(filteredOut ? "routines.upcoming.emptyFiltered" : "routines.upcoming.empty")}
          />
        </div>

        <p data-calendar-drag-hint className="mt-2 px-2 text-[11px] leading-relaxed text-ink-tertiary">
          {t("routines.upcoming.dragHint")}
        </p>
      </section>
    </RightRailPanel>
  );
});
