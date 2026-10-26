import { Loader2, Repeat2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { RoutineSuspendReason } from "../../../shared/routines";
import { scheduleRawCron } from "@/lib/schedule-label";
import { routineNextRunPhrase, routineScheduleState, routineUpcomingState, routineWhenLabel } from "@/lib/routine-display";
import type { Bot } from "@/state/store";
import { BotAvatar } from "@/components/Avatar";
import { PILL_INFO } from "@/lib/status-tones";
import { Switch } from "../SettingsPrimitives";
import { RoutineOwnerBadge } from "./RoutineScopeBar";
import { personLabel } from "@/lib/human-label";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { cn } from "@/lib/cn";

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

export function RoutineList({ routines, viewerPrincipalId, runs, bots, loading, error, onOpen, onToggle, grouped = false, toggle = true, variant = "list", emptyText }: {
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
   * bot and the next run in words on the second line, a state pill, no
   * switch. The rows are otherwise the list's own. */
  variant?: "list" | "upcoming";
  emptyText?: string;
}) {
  const upcoming = variant === "upcoming";
  const sorted = upcoming
    ? [...routines].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name))
    : [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
  return <div aria-label={upcoming ? t("routines.upcoming.list") : t("routines.list")}>
    {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
    {loading && <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
    {!loading && !error && sorted.length === 0 && <div className="rounded-xl border border-dashed border-hairline/50 p-5 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" />{emptyText ?? t("routines.empty")}</div>}
    {sorted.length > 0 && (
      <div className={grouped ? GROUPED_CARD : "flex flex-col gap-0.5"}>
        {sorted.map((routine) => {
          const bot = upcoming ? bots?.find((candidate) => candidate.id === routine.botId) : undefined;
          const botName = bot?.name ?? routine.bot?.name;
          const when = upcoming && routine.nextRunAt != null ? routineNextRunPhrase(routine.nextRunAt) : routineWhenLabel(routine);
          const rawCron = scheduleRawCron(routine.schedule);
          const state = upcoming ? routineUpcomingState(routine, runs) : null;
          // Someone else's routine (a wider scope): its owner, read-only
          // unless the server says this person may edit it.
          const otherOwner = routine.owner?.id && routine.owner.id.toLowerCase() !== viewerPrincipalId?.toLowerCase() ? routine.owner : null;
          // Owner and Runs as are the same person on most cards. Keep Runs as
          // only when the job acts as someone other than the owner.
          const runAsOther = routine.runAs && routine.runAs.principalId.toLowerCase() !== routine.owner?.id?.toLowerCase() ? routine.runAs : null;
          const readOnly = routine.canEdit === false;
          // With a switch the line under the name is the state: Paused, or
          // when it runs (the schedule stays in the tooltip when paused).
          const stateLine = toggle && !upcoming && !routine.enabled && routineScheduleState(routine) === t("routines.pausedSchedule") ? t("routines.pausedSchedule") : null;
          return (
            <div key={routine.id} data-routine-row className={grouped ? cn("flex items-center gap-2.5 hover:bg-hover", GROUPED_ROW) : "flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover"}>
              <button type="button" onClick={() => onOpen(routine)} className="min-w-0 flex-1 text-left">
                {state ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-ink">{routine.name}</span>
                    <span data-routine-state className={`shrink-0 rounded-md ${UPCOMING_TONES[state.tone]} px-1.5 text-[11px] leading-[16px]`}>{state.label}</span>
                  </span>
                ) : <span className="block truncate text-[13px] leading-[18px] text-ink">{routine.name}</span>}
                {upcoming ? (
                  <span data-routine-when={when} title={[botName ? `${botName} · ${when}` : when, rawCron].filter(Boolean).join("\n")} className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink-secondary">
                    {bot && <BotAvatar bot={bot} size={16} animated={false} />}
                    {botName && <span data-routine-bot className="min-w-0 truncate">{botName}</span>}
                    {botName && <span aria-hidden="true" className="shrink-0">·</span>}
                    <span className="max-w-full shrink-0 truncate">{when}</span>
                  </span>
                ) : <span data-routine-when={stateLine ?? when} title={rawCron ? `${when}\n${rawCron}` : when} className="line-clamp-2 text-[13px] leading-[18px] text-ink-secondary">{stateLine ?? when}</span>}
                {(runAsOther || routine.suspended || otherOwner) && (
                  <span className="mt-0.5 flex flex-wrap gap-1.5">
                    {otherOwner && <RoutineOwnerBadge owner={otherOwner} size={14} className="max-w-full rounded-md bg-inset px-1.5 text-[11.5px] leading-[18px] text-ink-secondary" />}
                    {runAsOther && <span data-routine-run-as className="truncate rounded-md bg-inset px-1.5 text-[11.5px] leading-[18px] text-ink-secondary">{t("routines.runAs", { name: personLabel(runAsOther.name, runAsOther.principalId) })}</span>}
                    {routine.suspended && <span data-routine-suspended={routine.suspended.reason} className={`truncate rounded-md ${PILL_INFO} px-1.5 text-[11.5px] leading-[18px]`}>{routineSuspendedText(routine.suspended.reason)}</span>}
                  </span>
                )}
              </button>
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
      </div>
    )}
  </div>;
}
