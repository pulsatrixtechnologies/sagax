import type { CalendarCallAttachment, CalendarCallInput } from "@/lib/calendar-calls";
import { goalDraftOf, goalPayload, type RoutineGoalDraft } from "@/components/routines/RoutineGoalFields";
import type { Routine, RoutineContextAttachment, RoutineInput } from "@/lib/routines";
import { createAnswerErrorMessage, recoverCreatedRoutineAfterLostAnswer } from "@/lib/routine-save-recovery";
import { intervalAnchorForSave, nextIntervalForSave } from "@/lib/routine-calendar";
import { savedPatternSchedule } from "@/components/routines/schedule-editor";
import { withRoutineTiming } from "@/components/routines/RoutineTimingFields";
import { actAsToSave } from "@/components/routines/RoutineActAsField";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { makeCalendarSchedule, makeRoutineSchedule } from "./helpers";
import type { RecurrenceChoice } from "./types";
import type { LimitResetChoice } from "@/components/routines/LimitResetFields";
import type { ScheduleDraft } from "@/components/routines/schedule-editor";
import { githubScheduleFromDraft, type GithubDraft } from "@/components/routines/GithubTriggerFields";
import { productScheduleFromDraft, type ProductDraft } from "@/components/routines/ProductTriggerFields";
import type { EffortLevel } from "../../../shared/model-selection";

export type EventEditorSaveCtx = {
  attachmentPending: boolean;
  setSaving: (v: boolean) => void;
  setError: (v: string) => void;
  githubDraft: GithubDraft;
  productDraft: ProductDraft;
  state: { routines: Routine[] };
  kind: "routine" | "call";
  routinesOnly: boolean;
  intervalMinutes: number;
  existingIntervalSchedule: Extract<Routine["schedule"], { type: "interval" }> | undefined;
  recurrence: RecurrenceChoice;
  intervalEndsAt: number | null;
  limitReset: LimitResetChoice;
  bots: { id: string; modelSelection: { instanceId?: string } }[];
  lockedBotId?: string;
  botIds: string[];
  existingRoutine?: Routine;
  keptCron: Extract<Routine["schedule"], { type: "cron" }> | null;
  scheduleTouched: boolean;
  schedule: Routine["schedule"] | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] };
  // scheduleEditorValue / keptScheduleValue shapes; save path only reads schedule.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pattern: { schedule?: any; error?: string; runs?: unknown[]; sentence?: string } | null;
  scheduleDraft: ScheduleDraft;
  keptEvery: boolean;
  at: number;
  weekdays: number[];
  selectedIntervalWeekdays: number[] | undefined;
  selectedIntervalWindow: { start: string; end: string } | undefined;
  triggered: boolean;
  timingMode: "exact" | "flexible";
  earlyMinutes: number;
  lateMinutes: number;
  name: string;
  description: string;
  routineTarget: RoutineInput["target"];
  groupId: string;
  runOn: RoutineInput["runOn"];
  durationMinutes: number;
  timeoutMinutes: number | null;
  overlap: "skip" | "queue";
  autoPauseAfter: number;
  requiredSkills: string;
  requiredMcp: string;
  requiresComputer: boolean;
  repeatsOnClock: boolean;
  continuity: boolean;
  onlyWhenPresent: boolean;
  postResults: boolean;
  deleteWhenFinished: boolean;
  mailAlias: string;
  routineModel: string;
  routineSubagentModel: string;
  actAs: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleCoverageAnswer: any;
  routineEffort: EffortLevel | "";
  goalDraft: RoutineGoalDraft;
  watchAllowed: boolean;
  watchBuilt: { watch?: unknown; error?: string };
  existingWatch?: unknown;
  attachments: Array<RoutineContextAttachment | CalendarCallAttachment>;
  runAs?: string;
  runAsOptions?: { current?: { principalId: string } } | null;
  seed: { folder?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRequest: (url: string, init?: RequestInit) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  onSavedRoutine?: (routine: Routine) => void;
  existingCall?: { id: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSavedCall: (call: any) => void;
  onClose: () => void;
};

/** #4250: the product change schedule, or its reason as the save's error. */
function productScheduleOrThrow(draft: ProductDraft) {
  const built = productScheduleFromDraft(draft);
  if ("error" in built) throw new Error(built.error);
  return built.schedule;
}

/** Shared save path for the event editor (routine or call). */
export async function runEventEditorSave(ctx: EventEditorSaveCtx): Promise<void> {
  const {
    attachmentPending, setSaving, setError, state, kind, routinesOnly, intervalMinutes,
    existingIntervalSchedule, recurrence, intervalEndsAt, limitReset, githubDraft, productDraft, bots, lockedBotId, botIds,
    existingRoutine, keptCron, scheduleTouched, schedule, pattern, scheduleDraft, keptEvery, at,
    weekdays, selectedIntervalWeekdays, selectedIntervalWindow, triggered, timingMode, earlyMinutes,
    lateMinutes, name, description, routineTarget, groupId, runOn, durationMinutes, timeoutMinutes,
    overlap, autoPauseAfter, requiredSkills, requiredMcp, requiresComputer, repeatsOnClock, continuity,
    onlyWhenPresent, postResults, deleteWhenFinished, mailAlias, routineModel, routineSubagentModel,
    actAs, roleCoverageAnswer, routineEffort, goalDraft, watchAllowed, watchBuilt, existingWatch, attachments,
    runAs, runAsOptions, seed, editorRequest, dispatch, onSavedRoutine, existingCall, onSavedCall, onClose,
  } = ctx;
  if (attachmentPending) return;
  setSaving(true);
  setError("");
  // #1522: what a create whose answer is lost is checked against.
  const knownRoutineIds = new Set(state.routines.map((routine) => routine.id));
  let creating: Pick<RoutineInput, "name" | "botId" | "target"> | null = null;
  try {
    if (kind === "routine" || routinesOnly) {
      const savedAt = Date.now();
      const intervalAnchorAt = intervalAnchorForSave(savedAt, intervalMinutes, existingIntervalSchedule);
      if (recurrence === "interval" && intervalEndsAt != null && intervalEndsAt < nextIntervalForSave(savedAt, intervalMinutes, existingIntervalSchedule)) {
        throw new Error(t("routineCalendar.endAfterFirstRun"));
      }
      const limitEngine = limitReset.engine
        || bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId
        || "";
      const built = recurrence === "limit_reset"
        ? { type: "limit_reset" as const, engine: limitEngine, repeat: limitReset.repeat }
        : recurrence === "webhook"
        ? { type: "webhook" as const }
        : recurrence === "github"
        ? githubScheduleFromDraft(githubDraft)
        : recurrence === "product"
        ? productScheduleOrThrow(productDraft)
        : recurrence === "email" && existingRoutine?.schedule.type === "event"
          ? existingRoutine.schedule
        : recurrence === "pattern" || recurrence === "advanced"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? keptCron ?? (!scheduleTouched && schedule.type === "daily" ? schedule : pattern?.schedule && savedPatternSchedule(pattern.schedule as any, scheduleDraft))
        : recurrence === "interval" && keptEvery && keptCron ? keptCron : recurrence === "email" ? null : makeRoutineSchedule(recurrence, at, weekdays, intervalMinutes, {
        anchorAt: intervalAnchorAt,
        weekdays: selectedIntervalWeekdays ? [...selectedIntervalWeekdays].sort() : null,
        window: selectedIntervalWindow ?? null,
        endsAt: intervalEndsAt,
      });
      if (!built) throw new Error(pattern?.error || t("routineCalendar.validSchedule"));
      const nextSchedule = recurrence === "limit_reset" || triggered ? built : withRoutineTiming(built, recurrence !== "none", timingMode, earlyMinutes, lateMinutes);
      // `runAs` (organization server): the person chosen in the modal.
      const input: RoutineInput & { runAs?: string } = {
        name,
        prompt: description,
        target: routineTarget,
        botId: lockedBotId ?? botIds[0] ?? "",
        groupId: routineTarget === "room-goal" ? groupId : null,
        runOn: routineTarget === "room-goal" ? "maus" : runOn,
        enabled: existingRoutine ? undefined : true,
        schedule: nextSchedule,
        durationMinutes,
        timeoutMinutes,
        overlap,
        autoPauseAfter,
        requires: requiredSkills.trim() || requiredMcp.trim() || requiresComputer ? {
          skills: requiredSkills.split(",").map(name => name.trim()).filter(Boolean),
          mcpServers: requiredMcp.split(",").map(name => name.trim()).filter(Boolean),
          computer: requiresComputer,
        } : null,
        // Room goals can't carry a report yet, and a one-time run has no next run.
        continuity: routineTarget === "bot" && repeatsOnClock && continuity,
        onlyWhenPresent,
        postResults: routineTarget === "bot" ? postResults : undefined,
        deleteWhenFinished: (recurrence === "none" || (recurrence === "interval" && intervalEndsAt != null)) && deleteWhenFinished,
        mailAlias: routineTarget === "bot" ? (mailAlias.trim() || null) : null,
        model: routineTarget === "bot" ? (routineModel || null) : null,
        subagentModel: routineTarget === "bot" ? (routineSubagentModel || null) : null,
        // The person's choice; else, nothing chosen yet and the coverage
        // known, the minimal covering role (never over an explicit one).
        ...(() => { const role = routineTarget === "bot" ? actAsToSave(existingRoutine?.actAs, actAs, roleCoverageAnswer) : undefined; return role !== undefined ? { actAs: role } : {}; })(),
        effort: routineTarget === "bot" ? (routineEffort || null) : null,
        // #2696: sent when it changed, so an unchanged goal keeps its progress.
        ...(routineTarget === "bot"
          ? (JSON.stringify(goalDraft) !== JSON.stringify(goalDraftOf(existingRoutine?.goal)) ? { goal: goalPayload(goalDraft) } : {})
          : existingRoutine?.goal ? { goal: null } : {}),
        // Sent when on, or to remove a watch the routine had.
        ...(watchAllowed && watchBuilt.watch ? { precheck: watchBuilt.watch as RoutineInput["precheck"] } : existingWatch ? { precheck: null } : {}),
        attachments: routineTarget === "room-goal" ? [] : attachments as RoutineContextAttachment[],
        // Sent only when the person was changed in the dropdown.
        ...(runAs && runAs !== runAsOptions?.current?.principalId ? { runAs } : {}),
        ...(!existingRoutine && seed.folder ? { folder: seed.folder } : {}),
      };
      if (!existingRoutine) creating = { name: input.name, botId: input.botId, target: input.target };
      const response = await editorRequest(existingRoutine ? `/api/routines/${existingRoutine.id}` : "/api/routines", {
        method: existingRoutine ? "PATCH" : "POST",
        body: JSON.stringify(input),
      });
      dispatch({ type: "routinePatched", routine: response.routine });
      // An existing routine stays open; on the side panel's page a new one
      // opens its own page (onSavedRoutine is only set for those).
      if (onSavedRoutine) {
        onSavedRoutine(response.routine);
        return;
      }
    } else {
      if (recurrence === "interval" || recurrence === "limit_reset" || recurrence === "pattern" || recurrence === "advanced" || recurrence === "webhook" || recurrence === "github" || recurrence === "product" || recurrence === "email") throw new Error(t("routineCalendar.supportedCallSchedule"));
      const nextSchedule = makeCalendarSchedule(recurrence, at, weekdays);
      const input: CalendarCallInput = {
        name,
        description,
        botIds,
        schedule: nextSchedule,
        durationMinutes,
        attachments: attachments as CalendarCallAttachment[],
      };
      const response = await api(existingCall ? `/api/calendar-calls/${existingCall.id}` : "/api/calendar-calls", {
        method: existingCall ? "PATCH" : "POST",
        body: JSON.stringify(input),
      });
      onSavedCall(response.call);
    }
    onClose();
  } catch (cause) {
    // #1522 / #1753: the routine may exist although its answer never came
    // back. Read again before saying it failed, so a retry never duplicates it.
    if (creating) {
      const created = await recoverCreatedRoutineAfterLostAnswer(
        cause,
        knownRoutineIds,
        creating,
        () => editorRequest("/api/routines") as Promise<{ routines?: Routine[] }>,
      );
      if (created) {
        dispatch({ type: "routinePatched", routine: created });
        onClose();
        return;
      }
    }
    setError(createAnswerErrorMessage(cause, t("routineCalendar.saveAnswerLost")));
  } finally {
    setSaving(false);
  }
}
