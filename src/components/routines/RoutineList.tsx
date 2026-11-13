import { Clock, Loader2, MoreHorizontal, Repeat2 } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { RoutineSuspendReason } from "../../../shared/routines";
import { scheduleLabel, scheduleLabelCompact } from "@/lib/schedule-label";
import { routineAutoPausedText, routineNextRunPhrase, routineRunAgo, routineRunLabel, routineRunPreview, routineRunTime, routineRunTone, routineScheduleState, routineUpcomingState, routineWhenLabel } from "@/lib/routine-display";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { runActivityStatus } from "./RoutineRunDetail";
import type { Bot } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { PILL_INFO } from "@/lib/status-tones";
import { Switch } from "../SettingsPrimitives";
import { RoutineOwnerBadge } from "./RoutineScopeBar";
import { GROUPED_CARD, GROUPED_ROW, PANEL_CARD, PANEL_ROW, SHOW_MORE_ROW } from "@/lib/grouped-card";
import { cn } from "@/lib/cn";
import { RoutineNameInput } from "./RoutineRowMenu";

const SUSPEND_REASON_KEYS = {
  person_out: "routines.suspendReason.person_out",
  no_right: "routines.suspendReason.no_right",
} as const;

/** Slice 6: "Paused: <why>" for a routine the server paused (its person is
 * out or lost the right to run the bot; since 2026-10-08 never for lack of a
 * delegation, which is issued automatically). */
export function routineSuspendedText(reason: RoutineSuspendReason): string {
  return t("routines.suspended", { reason: t(SUSPEND_REASON_KEYS[reason]) });
}

const UPCOMING_TONES = {
  info: PILL_INFO,
  warning: "bg-warning/15 text-warning",
  neutral: "bg-inset text-ink-secondary",
} as const;

/** Bot panel Upcoming (#2174, as Grok Bot): the folder becomes a `[Category]`
 * prefix on the title. A name that already starts with the same brackets is
 * left alone. */
export function routinePanelTitle(routine: Pick<Routine, "name" | "folder">): string {
  const folder = routine.folder?.trim();
  if (!folder) return routine.name;
  const prefix = `[${folder}]`;
  const name = routine.name.trimStart();
  if (name.startsWith(`${prefix} `) || name === prefix) return routine.name;
  return `${prefix} ${routine.name}`;
}

/** The bot panel's routine rows (#4151, as the reference): the clock before
 * the name tells how the last run went by its colour, from the run's own
 * tone (routineRunTone): red when it failed, orange when it ended with
 * problems or waits on something, grey when it went fine or never ran. */
export function routineClockTone(run: RoutineRun | undefined): "danger" | "warning" | "neutral" {
  if (!run) return "neutral";
  const tone = routineRunTone(run);
  return tone === "text-danger" ? "danger" : tone === "text-warning" ? "warning" : "neutral";
}

const CLOCK_TONES = { danger: "text-danger", warning: "text-warning", neutral: "text-ink-tertiary" } as const;

/** The words the clock carries in its tooltip and accessible name: the
 * line the row used to show under the schedule (result, how long ago, the
 * short detail). The run log keeps them too. */
export function routineClockLabel(run: RoutineRun): string {
  return t("routines.latestRun", { status: [routineRunLabel(run), routineRunAgo(routineRunTime(run)), lastRunPreview(run)].filter(Boolean).join(" · ") });
}

/** A last run's first line, never for a hidden or quiet run. */
function lastRunPreview(run: RoutineRun): string {
  return !run.redacted && !run.quiet ? routineRunPreview(run) : "";
}


export function RoutineList({ routines, viewerPrincipalId, runs, bots, loading, error, onOpen, onToggle, grouped = false, toggle = true, variant = "list", emptyText, onRowMenu, onRowDragStart, onRowStep, onOpenRunning, label, renamingId, onRenameStart, onRenameSave, onRenameCancel, showBot = false, collapseAfter, leadingClock = false }: {
  routines: Routine[];
  /** Slice 6: the signed-in person on an organization server. */
  viewerPrincipalId?: string | null;
  runs: RoutineRun[];
  bots?: Bot[];
  loading?: boolean;
  error?: boolean;
  onOpen: (routine: Routine) => void;
  onLogs?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void;
  /** The bot panel: one rounded card, rows split by hairlines. */
  grouped?: boolean;
  /** Draw the on/off switch on each row (the bot panel leaves Pause and
   * Resume to the routine's own page). */
  toggle?: boolean;
  /** `upcoming` (the calendar's side panel, 2026-10-18): soonest first, the
   * bot and the next run in words on the second line, a Running or Failing
   * pill (Active is omitted), no switch. The rows are otherwise the list's own. */
  variant?: "list" | "upcoming";
  emptyText?: string;
  /** 2026-10-28: the row's menu (right click, the "…" button, Shift+F10 or
   * the context menu key): Move to folder. */
  onRowMenu?: (routine: Routine, at: { x: number; y: number }, trigger: HTMLElement) => void;
  /** A mouse or trackpad press on a row: the folder list may turn it into a
   * drag (2026-10-28; pointer events, not HTML5 drag, which the desktop shell
   * and the panel's drag strip made unreliable). Never from the switch or the
   * row's own menu button. */
  onRowDragStart?: (routine: Routine, event: ReactPointerEvent<HTMLElement>) => void;
  /** Shows the quiet "Running" word on a row whose routine runs right now.
   * The row itself always opens the routine, running or not (JC 2026-11-06):
   * the live run is in the routine's Runs list. Without it the word is not shown. */
  onOpenRunning?: (routine: Routine, run: RoutineRun) => void;
  /** Alt+Up / Alt+Down on a row: to the previous or next folder. */
  onRowStep?: (routine: Routine, direction: -1 | 1) => void;
  /** The list's accessible name (a folder's name). */
  label?: string;
  /** 2026-10-29: the routine whose name is being typed in place (its row
   * menu's Rename, or F2 on the row). Enter saves, Escape cancels. */
  renamingId?: string | null;
  onRenameStart?: (routine: Routine) => void;
  onRenameSave?: (routine: Routine, name: string) => void;
  onRenameCancel?: () => void;
  /** The list variant with the bot before the schedule line (the Automations
   * list grouped by folder across bots, 2026-11-03). Needs `bots`. */
  showBot?: boolean;
  /** The bot panel's Upcoming card (#2125): the first N rows, then a
   * centered Show more at the bottom of the card. */
  collapseAfter?: number;
  /** A clock before each row's name (the bot panel's Upcoming card). */
  leadingClock?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const upcoming = variant === "upcoming";
  const sorted = upcoming
    ? [...routines].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name))
    : [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
  const openMenu = (routine: Routine, trigger: HTMLElement, at?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    onRowMenu?.(routine, at ?? { x: rect.left, y: rect.bottom + 4 }, trigger);
  };
  return <div aria-label={label ?? (upcoming ? t("routines.upcoming.list") : t("routines.list"))}>
    {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
    {loading && <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
    {!loading && !error && sorted.length === 0 && <div className="rounded-xl border border-dashed border-hairline/50 p-6 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" />{emptyText ?? t("routines.empty")}</div>}
    {sorted.length > 0 && (
      <div className={leadingClock ? PANEL_CARD : grouped ? GROUPED_CARD : "flex flex-col gap-0.5"}>
        {(collapseAfter && !showAll ? sorted.slice(0, collapseAfter) : sorted).map((routine) => {
          const bot = upcoming || showBot ? bots?.find((candidate) => candidate.id === routine.botId) : undefined;
          const botName = bot?.name ?? routine.bot?.name;
          const when = upcoming && routine.nextRunAt != null ? routineNextRunPhrase(routine.nextRunAt) : routineWhenLabel(routine);
          // The full sentence, with its zone, in the tooltip; never the expression.
          const fullWhen = routine.schedule.type === "cron" ? scheduleLabel(routine.schedule) : null;
          const state = upcoming ? routineUpcomingState(routine, runs) : null;
          // Someone else's routine (a wider scope): its owner, read-only
          // unless the server says this person may edit it.
          const otherOwner = routine.owner?.id && routine.owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? routine.owner : null;
          const readOnly = routine.canEdit === false;
          // 2026-10-26: paused by itself after failures in a row, until turned back on.
          const autoPaused = !routine.enabled ? routine.autoPaused : undefined;
          // A live run: the panel's clock becomes the spinner (#4202), the
          // other lists say "Running" on the last-run line's place (2026-10-28).
          const runningRun = !upcoming && (onOpenRunning || leadingClock) ? runs.find((run) => run.routineId === routine.id && run.status === "running") : undefined;
          // 2026-10-26 (shared/routine-watch.ts): runs only when something changes.
          const watchWords = routine.precheck?.kind === "watch" ? t("routineWatch.badge") : null;
          const finished = routineScheduleState(routine) === t("routines.finishedSchedule");
          const paused = !upcoming && !routine.enabled && !finished;
          const scheduleLine = upcoming ? when : routine.schedule.type !== "once" || routine.enabled || routine.nextRunAt != null ? scheduleLabelCompact(routine.schedule) : when;
          // #4202 (as the reference's list): ONE line under the name, in every
          // list: Paused when the routine is off (after N failures, or why the
          // server paused it), else its schedule or trigger in words ("Runs on
          // change" for a change trigger). Never both: the rest is the tooltip's.
          const pauseWords = upcoming ? null : autoPaused ? routineAutoPausedText(autoPaused.failures) : routine.suspended ? routineSuspendedText(routine.suspended.reason) : paused ? t("routines.pausedSchedule") : null;
          const whenLine = pauseWords ?? (!upcoming && watchWords && !finished ? watchWords : scheduleLine);
          // 2026-10-29: the row says how the last run went and when the next
          // one is, as cloud routines list them.
          // 2026-11-02 (JC): a live run takes the last-run line's place
          // ("Running · 2 min ago"); the old result never shows beside it.
          const lastRun = upcoming || runningRun ? undefined : runs.filter((run) => run.routineId === routine.id && run.status !== "queued" && run !== runningRun).sort((a, b) => routineRunTime(b) - routineRunTime(a))[0];
          const lastPreview = lastRun ? lastRunPreview(lastRun) : "";
          const nextRun = !upcoming && routine.enabled && routine.nextRunAt != null ? routineNextRunPhrase(routine.nextRunAt) : undefined;
          // The bot panel's Upcoming (#2125): the line is only the schedule,
          // as the reference design; the next run moves to the tooltip.
          const nextLine = leadingClock || pauseWords ? undefined : nextRun;
          // What the line leaves out, never lost: the schedule, the change
          // trigger, the next run (the panel) and the full sentence with its zone.
          const whenTitle = [...new Set([scheduleLine, watchWords, leadingClock && nextRun ? t("routines.list.next", { when: nextRun }) : null, upcoming ? null : scheduleLabel(routine.schedule)])].filter((line) => line && line !== whenLine).join("\n");
          const title = leadingClock ? routinePanelTitle(routine) : routine.name;
          // #4151: the panel's rows have two lines, as the reference's; the last
          // run is the clock's colour, its words the clock's tooltip and name.
          const clockLabel = leadingClock && lastRun ? routineClockLabel(lastRun) : undefined;
          // #4202: while it runs, the clock is the app's spinner at the same
          // size and place; "Running" and since when are its words.
          const runningLabel = runningRun ? `${t("routines.status.running")} · ${routineRunAgo(runningRun.startedAt || routineRunTime(runningRun))}` : undefined;
          const clock = leadingClock && (runningRun ? (
            <span data-routine-clock="running" role="img" aria-label={runningLabel} title={runningLabel} className="flex size-5 shrink-0 items-center justify-center">
              <Loader2 size={16} strokeWidth={1.5} aria-hidden="true" className="animate-spin text-ink-tertiary motion-reduce:animate-none" />
            </span>
          ) : (
            <span data-routine-clock={routineClockTone(lastRun)} role={clockLabel ? "img" : undefined} aria-label={clockLabel} aria-hidden={clockLabel ? undefined : true} title={clockLabel}
              className="flex size-5 shrink-0 items-center justify-center">
              <Clock size={16} strokeWidth={1.5} aria-hidden="true" className={CLOCK_TONES[routineClockTone(lastRun)]} />
            </span>
          ));
          return (
            <div key={routine.id} data-routine-row data-routine-id={routine.id}
              onPointerDown={onRowDragStart && !readOnly ? (event) => {
                if (event.pointerType === "touch" || event.button !== 0) return;
                if ((event.target as HTMLElement).closest?.("[role=switch],[data-routine-row-menu]")) return;
                onRowDragStart(routine, event);
              } : undefined}
              onContextMenu={onRowMenu && !readOnly ? (event) => { event.preventDefault(); openMenu(routine, event.currentTarget, { x: event.clientX, y: event.clientY }); } : undefined}
              className={cn("group/routine", onRowDragStart && !readOnly && "cursor-grab select-none", leadingClock ? cn("flex items-center gap-2 hover:bg-hover", PANEL_ROW) : grouped ? cn("flex items-center gap-2 hover:bg-hover", GROUPED_ROW, "py-1.5") : "flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover")}>
              {renamingId === routine.id && onRenameSave ? <>{clock}<RoutineNameInput initial={routine.name} onSave={(name) => onRenameSave(routine, name)} onCancel={() => onRenameCancel?.()} /></> : <button type="button" onClick={() => onOpen(routine)}
                onKeyDown={(onRowMenu || onRowStep || onRenameStart) && !readOnly ? (event: ReactKeyboardEvent<HTMLButtonElement>) => {
                  if (onRenameStart && event.key === "F2") { event.preventDefault(); onRenameStart(routine); }
                  else if (onRowMenu && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); openMenu(routine, event.currentTarget); }
                  else if (onRowStep && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); onRowStep(routine, event.key === "ArrowUp" ? -1 : 1); }
                } : undefined}
                aria-keyshortcuts={onRowMenu && !readOnly ? (onRowStep ? "Shift+F10 Alt+ArrowUp Alt+ArrowDown" : "Shift+F10") : undefined}
                className={leadingClock ? "flex min-w-0 flex-1 items-center gap-2 text-left" : "min-w-0 flex-1 text-left"}>
                {clock}
                <TextColumn wrap={leadingClock}>
                {state && state.tone !== "neutral" ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span data-routine-title className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{title}</span>
                    <span data-routine-state className={`shrink-0 rounded-md ${UPCOMING_TONES[state.tone]} px-1.5 text-[11px] leading-[16px]`}>{state.label}</span>
                  </span>
                ) : <span data-routine-title className={cn("block truncate leading-[18px] text-ink", leadingClock ? "text-[14px]" : "text-[13px]")}>{title}</span>}
                {upcoming ? (
                  <span data-routine-when={when} title={[botName ? `${botName} · ${when}` : when, watchWords, fullWhen !== when ? fullWhen : null].filter(Boolean).join("\n")} className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink-secondary">
                    {bot && <BotAvatar bot={bot} size={16} animated={false} />}
                    {botName && <span data-routine-bot className="min-w-0 truncate">{botName}</span>}
                    {botName && <span aria-hidden="true" className="shrink-0">·</span>}
                    <span className="max-w-full shrink-0 truncate">{when}</span>
                  </span>
                ) : <span data-routine-when={whenLine} data-routine-paused={paused && !autoPaused ? "" : undefined} data-routine-watch={whenLine === watchWords ? "" : undefined} title={whenTitle || undefined} className="block truncate text-[12px] leading-4 text-ink-secondary">{showBot && botName && <span data-routine-bot className="inline-flex max-w-[40%] items-center gap-1 align-bottom">{bot && <BotAvatar bot={bot} size={14} animated={false} />}<span className="truncate">{botName}</span></span>}{showBot && botName && <span aria-hidden="true">{" · "}</span>}
                  {autoPaused
                    ? <span data-routine-auto-paused={autoPaused.failures} className="rounded-md bg-warning/15 px-1.5 text-warning">{whenLine}</span>
                    : routine.suspended
                      ? <span data-routine-suspended={routine.suspended.reason} className={`rounded-md ${PILL_INFO} px-1.5`}>{whenLine}</span>
                      : whenLine}
                  {nextLine && <span data-routine-next> · {t("routines.list.next", { when: nextLine })}</span>}</span>}
                {runningRun && !leadingClock && (
                  <span data-routine-running aria-label={`${t("routines.status.running")}: ${routine.name}`} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
                    <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none" />
                    <span className="shrink-0 text-success">{t("routines.status.running")}</span>
                    <span aria-hidden="true" className="shrink-0">·</span>
                    <span className="shrink-0">{routineRunAgo(runningRun.startedAt || routineRunTime(runningRun))}</span>
                  </span>
                )}
                {lastRun && !leadingClock && (
                  <span data-routine-last-run={lastRun.status} title={lastPreview || undefined} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
                    <ActivityStatusIcon status={runActivityStatus(lastRun)} size={12} />
                    <span className={cn("shrink-0", routineRunTone(lastRun))}>{routineRunLabel(lastRun)}</span>
                    <span aria-hidden="true" className="shrink-0">·</span>
                    <span className="shrink-0">{routineRunAgo(routineRunTime(lastRun))}</span>
                    {lastPreview && <><span aria-hidden="true" className="shrink-0">·</span><span className="min-w-0 truncate">{lastPreview}</span></>}
                  </span>
                )}
                {otherOwner && (
                  <span className="mt-0.5 flex flex-wrap gap-1.5">
                    <RoutineOwnerBadge owner={otherOwner} size={14} className="max-w-full rounded-md bg-inset px-1.5 text-[12px] leading-[18px] text-ink-secondary" />
                  </span>
                )}
                </TextColumn>
              </button>}
              {onRowMenu && !readOnly && <button type="button" data-routine-row-menu aria-label={t("routineFolders.rowMenu", { name: routine.name })} title={t("routineFolders.rowMenu", { name: routine.name })}
                onClick={(event) => openMenu(routine, event.currentTarget)}
                className="hidden size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover/routine:flex touch:flex"><MoreHorizontal size={15} /></button>}
              {toggle && !upcoming && <Switch
                checked={routine.enabled}
                disabled={readOnly}
                title={readOnly ? t("routines.scope.readOnly") : undefined}
                aria-label={routine.enabled ? t("botPanel.routines.pause") : t("botPanel.routines.resume")}
                onClick={() => { if (!readOnly) onToggle?.(routine); }}
              />}
            </div>
          );
        })}
        {/* #2174: like Grok Bot, Show more expands once and then disappears. */}
        {collapseAfter != null && !showAll && sorted.length > collapseAfter && (
          <button type="button" data-routines-show-more="more" aria-expanded={false} onClick={() => setShowAll(true)}
            className={cn(SHOW_MORE_ROW, leadingClock ? "px-3" : grouped && GROUPED_ROW)}>
            {t("botPanel.library.showMore")}
          </button>
        )}
      </div>
    )}
  </div>;
}

/** The text of a row: a column of its own beside the panel's clock, else
 * the button's own content as before. */
function TextColumn({ wrap, children }: { wrap: boolean; children: ReactNode }) {
  return wrap ? <span className="min-w-0 flex-1">{children}</span> : <>{children}</>;
}
