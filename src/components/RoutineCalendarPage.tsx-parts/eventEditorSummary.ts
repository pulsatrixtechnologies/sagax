import { durationLabel, intervalLabel, scheduleLabelCompact } from "@/lib/schedule-label";
import { githubScheduleFromDraft, type GithubDraft } from "@/components/routines/GithubTriggerFields";
import { productScheduleFromDraft, type ProductDraft } from "@/components/routines/ProductTriggerFields";
import { limitResetWhen } from "@/lib/limit-resets";
import { personTimeZone } from "@/components/routines/schedule-editor";
import { timeZoneCity } from "../../../shared/schedule-model";
import { routineAutoPauseOption } from "@/lib/routine-display";
import { ROUTINE_AUTO_PAUSE_DEFAULT } from "../../../shared/routine-auto-pause";
import { routinesInConversationEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { RecurrenceChoice, IntervalDayChoice, IntervalWindowChoice, IntervalEndChoice } from "./types";
import type { ScheduleDraft } from "@/components/routines/schedule-editor";
import type { RoutineSchedule } from "@/lib/routines";
import type { LimitResetChoice } from "@/components/routines/LimitResetFields";

type WhenArgs = {
  recurrence: RecurrenceChoice;
  pattern: { sentence?: string; error?: string } | null;
  limitReset: LimitResetChoice;
  githubDraft?: GithubDraft;
  productDraft?: ProductDraft;
  bots: { id: string; modelSelection: { instanceId?: string } }[];
  lockedBotId?: string;
  botIds: string[];
  intervalMinutes: number;
  at: number;
  /** The saved schedule: a GitHub event routine reads its own events (I3). */
  eventSchedule?: RoutineSchedule;
};

/** #4250: "When <resource> changes", or the plain choice while none is typed. */
function productWhen(draft: ProductDraft | undefined): string {
  const built = productScheduleFromDraft(draft ?? { resources: "" });
  return "error" in built ? t("routineTrigger.product") : scheduleLabelCompact(built.schedule);
}

export function eventEditorWhenSentence(args: WhenArgs): string {
  const { recurrence, pattern, limitReset, githubDraft, productDraft, bots, lockedBotId, botIds, intervalMinutes, at, eventSchedule } = args;
  return recurrence === "pattern" || recurrence === "advanced"
    ? pattern?.sentence || t("routineCalendar.validSchedule")
    : recurrence === "webhook"
      ? t("schedule.compact.webhook")
      : recurrence === "github"
      ? scheduleLabelCompact(githubScheduleFromDraft(githubDraft ?? { events: [], repo: "" }))
      : recurrence === "product"
      ? productWhen(productDraft)
      : recurrence === "email"
        ? eventSchedule?.type === "event" && eventSchedule.source === "github" ? scheduleLabelCompact(eventSchedule) : t("schedule.compact.email")
        : recurrence === "limit_reset"
          ? limitResetWhen({ engine: limitReset.engine || bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId || "", repeat: limitReset.repeat })
          : recurrence === "interval"
            ? intervalLabel(intervalMinutes || 5)
            : scheduleLabelCompact({ type: "once", at });
}

type AdvancedArgs = {
  kind: "routine" | "call";
  runAs?: string;
  runAsOptions?: { current?: { principalId: string } } | null;
  runAsName?: string;
  isRoomGoal: boolean;
  runOn: string;
  postResults: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  attachmentsLength: number;
  recurrence: RecurrenceChoice;
  scheduleDraft: ScheduleDraft;
  repeatsOnClock: boolean;
  timingMode: "exact" | "flexible";
  intervalDays: IntervalDayChoice;
  intervalWindow: IntervalWindowChoice;
  intervalEnd: IntervalEndChoice;
  intervalEndDate: string;
  watchAllowed: boolean;
  watchOn: boolean;
  requiredSkills: string;
  requiredMcp: string;
  requiresComputer: boolean;
  timeoutMinutes: number | null;
  overlap: "skip" | "queue";
  autoPauseAfter: number;
  continuity: boolean;
  onlyWhenPresent: boolean;
  deleteWhenFinished: boolean;
  mailAlias: string;
};

export function eventEditorAdvancedSummary(args: AdvancedArgs): string {
  const {
    kind, runAs, runAsOptions, runAsName, isRoomGoal, runOn, postResults, config, attachmentsLength,
    recurrence, scheduleDraft, repeatsOnClock, timingMode, intervalDays, intervalWindow, intervalEnd,
    intervalEndDate, watchAllowed, watchOn, requiredSkills, requiredMcp, requiresComputer, timeoutMinutes,
    overlap, autoPauseAfter, continuity, onlyWhenPresent, deleteWhenFinished, mailAlias,
  } = args;
  const extraTimes = recurrence === "pattern" && scheduleDraft.model.frequency !== "hourly" ? scheduleDraft.model.times.length - 1 : 0;
  const advancedItems = kind === "routine" ? [
    runAs && runAs !== runAsOptions?.current?.principalId && runAsName ? t("routineEditor.summary.runAs", { name: runAsName }) : null,
    !isRoomGoal && runOn === "cloud" ? t("routineCalendar.boatAgent") : null,
    !isRoomGoal && postResults !== routinesInConversationEnabled(config)
      ? (postResults ? t("routineEditor.summary.resultsPosted") : t("routineEditor.summary.resultsHidden"))
      : null,
    !isRoomGoal && attachmentsLength > 0 ? t("routineEditor.summary.attachments", { count: attachmentsLength }) : null,
    extraTimes > 0 ? t("routineEditor.summary.extraTimes", { count: extraTimes }) : null,
    recurrence === "pattern" && scheduleDraft.timeZone !== personTimeZone() ? t("routineEditor.summary.zone", { city: timeZoneCity(scheduleDraft.timeZone) }) : null,
    repeatsOnClock && timingMode === "flexible" ? t("routineEditor.summary.flexible") : null,
    recurrence === "interval" && intervalDays !== "every-day" ? t("routineEditor.summary.intervalDays") : null,
    recurrence === "interval" && intervalWindow === "custom" ? t("routineEditor.summary.intervalHours") : null,
    recurrence === "interval" && intervalEnd === "on-date" ? t("routineEditor.summary.intervalEnds", { date: intervalEndDate }) : null,
    watchAllowed && watchOn ? t("routineWatch.title") : null,
    requiredSkills.trim() ? t("routineReadiness.requiresSkills") : null,
    requiredMcp.trim() ? t("routineReadiness.requiresMcp") : null,
    requiresComputer ? t("routineReadiness.requiresComputer") : null,
    timeoutMinutes != null ? t("routineCalendar.stopsAfter", { duration: durationLabel(timeoutMinutes) }) : null,
    repeatsOnClock && overlap === "queue" ? t("routines.overlapQueue") : null,
    repeatsOnClock && autoPauseAfter !== ROUTINE_AUTO_PAUSE_DEFAULT ? routineAutoPauseOption(autoPauseAfter) : null,
    !isRoomGoal && repeatsOnClock && continuity ? t("routines.continuityLabel") : null,
    onlyWhenPresent ? t("routines.away.onlyLabel") : null,
    deleteWhenFinished && (recurrence === "none" || (recurrence === "interval" && intervalEnd === "on-date")) ? t("routines.deleteWhenFinished.label") : null,
    !isRoomGoal && mailAlias.trim() ? t("routineEditor.summary.mailTag", { tag: mailAlias.trim() }) : null,
  ].filter(Boolean) : [];
  return advancedItems.length ? advancedItems.join(" · ") : t("routineEditor.advancedDefault");
}
