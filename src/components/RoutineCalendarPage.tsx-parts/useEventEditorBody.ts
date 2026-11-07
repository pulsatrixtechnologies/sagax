import { useEffect, useRef, useState } from "react";
import { Clock3, Eye, Globe, Hourglass, Mail, Repeat2 } from "lucide-react";
import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { useBotEditor } from "@/components/bot-settings/BotEditorContext";
import { pathForFile } from "@/components/ComposerAttachments";
import { draftFromWatch, watchFromDraft } from "@/components/routines/WatchFields";
import { useRunAsOptions } from "@/components/routines/RunAsField";
import { everyMinutesOf, keptScheduleValue, scheduleDraftFor, scheduleEditorValue, type ScheduleDraft } from "@/components/routines/schedule-editor";
import { defaultScheduleModel, type ScheduleFrequency } from "../../../shared/schedule-model";
import type { EffortLevel } from "../../../shared/model-selection";
import { ROUTINE_AUTO_PAUSE_DEFAULT, routineAutoPauseAfter } from "../../../shared/routine-auto-pause";
import { boatCapableEngine } from "@/lib/remote-desktop";
import { routinesInConversationEnabled } from "@/lib/feature-flags";
import {
  addDays,
  atLocalTime,
  fromLocalDateAndTime,
  nextIntervalForSave,
  startOfDay,
  toLocalDateInput,
  toLocalTimeInput,
} from "@/lib/routine-calendar";
import { readTiming } from "@/components/routines/RoutineTimingFields";
import {
  imageAttachmentFromFile,
  intakeFiles,
} from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import type { CalendarCallAttachment } from "@/lib/calendar-calls";
import type { RoutineContextAttachment, RoutineRunOn, RoutineTarget } from "@/lib/routines";
import { useStore } from "@/state/store";
import { preferredRoomLead } from "@/lib/group-routing";
import { viewerActorId } from "@/lib/viewer";
import { useRoutineRoleCoverage } from "@/components/routines/RoutineActAsField";
import { useRoutineReadiness } from "@/components/routines/RoutineReadiness";
import type { LimitResetChoice } from "@/components/routines/LimitResetFields";
import { ALL_DAYS, WEEKDAYS } from "./constants";
import {
  activeRoomMembers,
  endOfLocalDate,
  intervalDayChoice,
  recurrenceFor,
  roomCanRunGoal,
} from "./helpers";
import { toContextAttachments } from "./editorWidgets";
import { runEventEditorSave } from "./saveEventEditor";
import { eventEditorAdvancedSummary, eventEditorWhenSentence } from "./eventEditorSummary";
import type { EventEditorBodyProps, EventKind, IntervalDayChoice, IntervalEndChoice, IntervalWindowChoice, RecurrenceChoice } from "./types";

export type EventEditorModel = ReturnType<typeof useEventEditorBody>;

export function useEventEditorBody({
  seed,
  bots,
  lockedBotId,
  defaultRunOn,
  routinesOnly = false,
  presentation = "modal",
  onClose,
  onDismiss,
  onDeleted,
  onDuplicate,
  onSavedCall,
  mode,
  onStartEdit,
  onCancelEdit,
  onSavedRoutine,
  page,
  onDirtyChange,
}: EventEditorBodyProps) {
  const confirm = useConfirm();
  const { state, dispatch } = useStore();
  const existingRoutine = seed.routine;
  // A copy (Duplicate) starts from another routine's settings and saves as new.
  const template = seed.routine ?? seed.copyOf;
  const { request: editorRequest } = useBotEditor();
  const existingCall = seed.call;
  const [kind, setKind] = useState<EventKind>(routinesOnly ? "routine" : seed.kind);
  const [editorOpenedAt] = useState(() => Date.now());
  const [name, setName] = useState(seed.copyOf ? t("routineDetail.copyName", { name: seed.copyOf.name }) : template?.name ?? existingCall?.name ?? seed.name ?? "");
  const [description, setDescription] = useState(template?.prompt ?? existingCall?.description ?? seed.description ?? "");
  const initialAt = template?.schedule.type === "once"
    ? template.schedule.at
    : template?.schedule.type === "daily"
      ? atLocalTime(seed.at, template.schedule.time)
      : template?.schedule.type === "interval"
        ? template.schedule.anchorAt
      : existingCall?.schedule.type === "once"
        ? existingCall.schedule.at
        : existingCall?.schedule.type === "daily"
          ? atLocalTime(seed.at, existingCall.schedule.time)
          : seed.at;
  const schedule = template?.schedule ?? existingCall?.schedule ?? { type: "once" as const, at: initialAt };
  const [date, setDate] = useState(toLocalDateInput(initialAt));
  const [startTime, setStartTime] = useState(toLocalTimeInput(initialAt));
  const [durationMinutes, setDurationMinutes] = useState(template?.durationMinutes ?? existingCall?.durationMinutes ?? seed.durationMinutes);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(
    template?.timeoutMinutes ?? null,
  );
  const [intervalTimeoutDefaultApplied, setIntervalTimeoutDefaultApplied] = useState(Boolean(template));
  const [overlap, setOverlap] = useState<"skip" | "queue">(template?.overlap ?? "skip");
  // 2026-10-26: failed runs in a row that pause this routine (0 never).
  const [requiredSkills, setRequiredSkills] = useState(template?.requires?.skills?.join(", ") ?? "");
  const [requiredMcp, setRequiredMcp] = useState(template?.requires?.mcpServers?.join(", ") ?? "");
  const [requiresComputer, setRequiresComputer] = useState(template?.requires?.computer ?? false);
  const [autoPauseAfter, setAutoPauseAfter] = useState(() => template ? routineAutoPauseAfter(template) : ROUTINE_AUTO_PAUSE_DEFAULT);
  const [continuity, setContinuity] = useState(Boolean(template?.continuity));
  // Only when I'm here (server/routines/routine-away.ts): off unless chosen.
  const [onlyWhenPresent, setOnlyWhenPresent] = useState(template?.onlyWhenPresent === true);
  // #1648: delete once the finite schedule ends (once, or interval with endsAt).
  const [deleteWhenFinished, setDeleteWhenFinished] = useState(template?.deleteWhenFinished === true);
  // Only when something changes (2026-10-26, shared/routine-watch.ts): off
  // unless chosen. A condition pre-check set elsewhere is left as it is.
  const existingWatch = template?.precheck?.kind === "watch" ? template.precheck : undefined;
  const [watchDraft, setWatchDraft] = useState(() => draftFromWatch(existingWatch));
  const watchResult = watchFromDraft(watchDraft);
  const watchBuilt = "watch" in watchResult ? watchResult : { watch: null, error: watchResult.error };
  // Post results in the conversation (2026-10-22): the routine's own
  // choice, else the installation default. Off keeps a run in the background.
  const [postResults, setPostResults] = useState(template?.postResults ?? routinesInConversationEnabled(state.config));
  const [mailAlias, setMailAlias] = useState(template?.mailAlias ?? "");
  // 2026-11-04 (shared/routine-model.ts): its runs' model; "" is the bot's.
  const [routineModel, setRoutineModel] = useState(template?.model ?? "");
  // #2049: the model of its runs' Claude sub-agents; "" is automatic.
  const [routineSubagentModel, setRoutineSubagentModel] = useState(template?.subagentModel ?? "");
  // 2026-11-05 (shared/routine-act-as.ts): "Au nom de", the Perspicax role
  // its runs act as. Undefined: not chosen here (a saved routine keeps its
  // own; a duplicate starts from its source's).
  const [actAs, setActAs] = useState<string | undefined>(existingRoutine ? undefined : template?.actAs);
  const [routineEffort, setRoutineEffort] = useState<EffortLevel | "">(template?.effort ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>(seed.limitReset ? "limit_reset" : recurrenceFor(schedule, initialAt, (routinesOnly ? "routine" : seed.kind) === "routine"));
  const [limitReset, setLimitReset] = useState<LimitResetChoice>(
    schedule.type === "limit_reset" ? { engine: schedule.engine, repeat: schedule.repeat } : { engine: seed.limitReset?.engine ?? "", repeat: "once" },
  );
  const initialTiming = readTiming(schedule);
  const [timingMode, setTimingMode] = useState<"exact" | "flexible">(initialTiming.mode);
  const [earlyMinutes, setEarlyMinutes] = useState(initialTiming.early);
  const [lateMinutes, setLateMinutes] = useState(initialTiming.late);
  // The schedule in words (2026-10-29): frequency, times, days, zone. The
  // saved schedule is kept exactly until the person changes it.
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => scheduleDraftFor(schedule, initialAt).draft);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [weekdays, setWeekdays] = useState(schedule.type === "daily" ? schedule.weekdays : [new Date(initialAt).getDay()]);
  // A saved "every 15 minutes" cron opens in the interval's fields.
  const savedEveryMinutes = schedule.type === "cron" ? everyMinutesOf(scheduleDraftFor(schedule, initialAt).draft.model) : null;
  const [intervalMinutes, setIntervalMinutes] = useState(schedule.type === "interval" ? schedule.everyMinutes : savedEveryMinutes ?? 15);
  const [intervalDays, setIntervalDays] = useState<IntervalDayChoice>(() => intervalDayChoice(schedule));
  const [intervalWeekdays, setIntervalWeekdays] = useState(() => schedule.type === "interval" && schedule.weekdays?.length
    ? schedule.weekdays
    : [...ALL_DAYS]);
  const [intervalWindow, setIntervalWindow] = useState<IntervalWindowChoice>(schedule.type === "interval" && schedule.window ? "custom" : "all-day");
  const [intervalWindowStart, setIntervalWindowStart] = useState(schedule.type === "interval" ? schedule.window?.start ?? "09:00" : "09:00");
  const [intervalWindowEnd, setIntervalWindowEnd] = useState(schedule.type === "interval" ? schedule.window?.end ?? "17:00" : "17:00");
  const [intervalEnd, setIntervalEnd] = useState<IntervalEndChoice>(schedule.type === "interval" && schedule.endsAt != null ? "on-date" : "never");
  const [intervalEndDate, setIntervalEndDate] = useState(() => schedule.type === "interval" && schedule.endsAt != null
    ? toLocalDateInput(schedule.endsAt)
    : toLocalDateInput(addDays(startOfDay(Math.max(Date.now(), initialAt)), 7)));
  const [botIds, setBotIds] = useState(lockedBotId ? [lockedBotId] : template ? [template.botId] : existingCall?.botIds ?? seed.botIds);
  const selectBots = (ids: string[]) => setBotIds(ids);
  const [routineTarget, setRoutineTarget] = useState<RoutineTarget>(template?.target ?? (seed.groupId ? "room-goal" : "bot"));
  const [groupId, setGroupId] = useState(template?.groupId ?? seed.groupId ?? "");
  const [runOn, setRunOn] = useState<RoutineRunOn>(template?.runOn ?? defaultRunOn ?? "maus");
  const [attachments, setAttachments] = useState<Array<RoutineContextAttachment | CalendarCallAttachment>>(
    template?.target === "room-goal" ? [] : template?.attachments ?? existingCall?.attachments ?? [],
  );
  // Organization server: who the routine runs as (routines/RunAsField.tsx).
  const runAsOptions = useRunAsOptions({
    botId: kind === "routine" || routinesOnly ? lockedBotId ?? botIds[0] : undefined,
    ...(existingRoutine ? { routineId: existingRoutine.id } : {}),
    target: routineTarget,
    ...(routineTarget === "room-goal" && groupId ? { groupId } : {}),
  });
  const [runAs, setRunAs] = useState<string | undefined>(undefined);
  const runAsChosen = runAs ?? runAsOptions?.current?.principalId;
  const runAsName = runAsChosen ? (runAsOptions?.people.find((person) => person.principalId === runAsChosen)?.name ?? runAsOptions?.current?.name) : undefined;
  useEffect(() => {
    // A person who cannot run the newly chosen bot is no longer the choice.
    if (runAs && runAsOptions && !runAsOptions.people.some((person) => person.principalId === runAs && person.selectable)) setRunAs(undefined);
  }, [runAs, runAsOptions]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [attachmentPendingCount, setAttachmentPendingCount] = useState(0);
  const attachmentPending = attachmentPendingCount > 0;
  const fileInput = useRef<HTMLInputElement>(null);
  const cloudReady = Boolean(state.config?.box?.configured && botIds.length > 0 && botIds.every(id => boatCapableEngine(state.instances, bots.find(bot => bot.id === id)?.modelSelection.instanceId)?.snapshot.state === "available"));
  const rooms = state.groups.filter(roomCanRunGoal);
  const selectedRoom = rooms.find((group) => group.id === groupId);
  const roomMembers = activeRoomMembers(selectedRoom, state.bots);
  const isRoomGoal = kind === "routine" && routineTarget === "room-goal";
  const roleCoverage = useRoutineRoleCoverage({ botId: lockedBotId ?? botIds[0], routineId: existingRoutine?.id, prompt: description, enabled: (kind === "routine" || routinesOnly) && routineTarget === "bot" });
  const roleReadiness = useRoutineReadiness(existingRoutine?.id ?? "");
  // A watch checks on a repeating schedule, for one bot.
  // Started by a webhook or an email, not the clock. Limit-reset waits on usage, not the clock.
  const triggered = recurrence === "webhook" || recurrence === "email";
  const repeatsOnClock = recurrence !== "none" && recurrence !== "limit_reset" && !triggered;
  const watchAllowed = kind === "routine" && !isRoomGoal && repeatsOnClock;
  const at = fromLocalDateAndTime(date, startTime, template || existingCall ? initialAt : undefined);
  const endAt = at + durationMinutes * 60_000;
  const selectedBots = botIds.flatMap((id) => bots.find((bot) => bot.id === id) ?? []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const intervalInvalid = recurrence === "interval"
    && (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1_440);
  const intervalDaysInvalid = recurrence === "interval" && intervalDays === "custom" && intervalWeekdays.length === 0;
  const intervalWindowMinutes = fromLocalDateAndTime("2000-01-01", intervalWindowEnd)
    - fromLocalDateAndTime("2000-01-01", intervalWindowStart);
  const intervalWindowInvalid = recurrence === "interval"
    && intervalWindow === "custom"
    && (!intervalWindowStart
      || !intervalWindowEnd
      || !Number.isFinite(intervalWindowMinutes)
      || intervalWindowMinutes < intervalMinutes * 60_000);
  const existingIntervalSchedule = template?.schedule.type === "interval"
    ? template.schedule
    : undefined;
  const intervalEndMinimumAt = nextIntervalForSave(
    editorOpenedAt,
    Math.max(5, intervalMinutes || 5),
    existingIntervalSchedule,
  );
  const intervalEndsAt = intervalEnd === "on-date" ? endOfLocalDate(intervalEndDate) : null;
  const intervalEndInvalid = recurrence === "interval"
    && intervalEnd === "on-date"
    && (intervalEndsAt == null || !Number.isSafeInteger(intervalEndsAt) || intervalEndsAt < intervalEndMinimumAt);
  const selectedIntervalWeekdays = intervalDays === "every-day"
    ? undefined
    : intervalDays === "weekdays"
      ? WEEKDAYS
      : intervalWeekdays;
  const selectedIntervalWindow = intervalWindow === "custom"
    ? { start: intervalWindowStart, end: intervalWindowEnd }
    : undefined;
  const keptCron = !scheduleTouched && schedule.type === "cron" ? schedule : null;
  const pattern = recurrence === "advanced" && keptCron
    ? keptScheduleValue(keptCron, editorOpenedAt)
    : recurrence === "pattern"
      ? scheduleEditorValue(scheduleDraft, editorOpenedAt)
      : null;
  // An untouched "every N minutes" cron is saved as it was.
  const keptEvery = Boolean(keptCron && savedEveryMinutes != null && intervalMinutes === savedEveryMinutes
    && intervalDays === "every-day" && intervalWindow === "all-day" && intervalEnd === "never");

  const selectRecurrence = (choice: RecurrenceChoice) => {
    if (choice === "interval" && !intervalTimeoutDefaultApplied) {
      setTimeoutMinutes((current) => current ?? 30);
      setIntervalTimeoutDefaultApplied(true);
    }
    setScheduleTouched(true);
    setRecurrence(choice);
  };

  /** A frequency of the Repeat picker: a pattern keeps its times and zone. */
  const selectFrequency = (frequency: ScheduleFrequency) => {
    setScheduleDraft((draft) => ({ ...draft, model: { ...draft.model, frequency } }));
    selectRecurrence("pattern");
  };

  const changeScheduleDraft = (draft: ScheduleDraft) => {
    setScheduleDraft(draft);
    setScheduleTouched(true);
  };

  /** Advanced: replace a schedule no pattern fits with a simple one. */
  const simplifySchedule = () => {
    setScheduleDraft((draft) => ({ ...draft, model: defaultScheduleModel({ times: draft.model.times }) }));
    selectRecurrence("pattern");
  };

  const selectIntervalDays = (choice: IntervalDayChoice) => {
    if (choice === "custom" && intervalDays !== "custom") {
      setIntervalWeekdays(intervalDays === "weekdays" ? [...WEEKDAYS] : [...ALL_DAYS]);
    }
    setIntervalDays(choice);
  };

  const selectRoutineTarget = (target: RoutineTarget) => {
    setRoutineTarget(target);
    if (target === "bot") {
      setGroupId("");
      return;
    }
    setRunOn("maus");
    setAttachments([]);
    setAttachmentNotice("");
    const room = selectedRoom ?? rooms[0];
    setGroupId(room?.id ?? "");
    const lead = preferredRoomLead(room, state.bots, { preferredId: botIds[0], viewerId: viewerActorId(state.config) });
    selectBots(lead ? [lead.id] : []);
  };

  const selectRoom = (nextGroupId: string) => {
    const room = rooms.find((candidate) => candidate.id === nextGroupId);
    setGroupId(nextGroupId);
    const lead = preferredRoomLead(room, state.bots, { preferredId: botIds[0], viewerId: viewerActorId(state.config) });
    selectBots(lead ? [lead.id] : []);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length || isRoomGoal) return;
    setAttachmentPendingCount((count) => count + 1);
    try {
      const result = await intakeFiles(Array.from(files), {
        allowImages: true,
        getPath: pathForFile,
        uploadImage: imageAttachmentFromFile,
      });
      const added = toContextAttachments(result.attachments);
      if (added.length) {
        setAttachments((current) => [...current, ...added].slice(0, 20));
        if (runOn === "cloud") setRunOn("maus");
      }
      if (result.notice) setAttachmentNotice(result.notice);
    } finally {
      setAttachmentPendingCount((count) => Math.max(0, count - 1));
    }
  };

  const save = async () => {
    await runEventEditorSave({
      attachmentPending, setSaving, setError, state, kind, routinesOnly, intervalMinutes,
      existingIntervalSchedule, recurrence, intervalEndsAt, limitReset, bots, lockedBotId, botIds,
      existingRoutine, keptCron, scheduleTouched, schedule, pattern, scheduleDraft, keptEvery, at,
      weekdays, selectedIntervalWeekdays, selectedIntervalWindow, triggered, timingMode, earlyMinutes,
      lateMinutes, name, description, routineTarget, groupId, runOn, durationMinutes, timeoutMinutes,
      overlap, autoPauseAfter, requiredSkills, requiredMcp, requiresComputer, repeatsOnClock, continuity,
      onlyWhenPresent, postResults, deleteWhenFinished, mailAlias, routineModel, routineSubagentModel,
      actAs, roleCoverageAnswer: roleCoverage.answer, routineEffort, watchAllowed, watchBuilt, existingWatch,
      attachments, runAs, runAsOptions, seed, editorRequest, dispatch, onSavedRoutine, existingCall,
      onSavedCall, onClose,
    });
  };

  const valid = Boolean(
    name.trim()
    && (kind === "call" || description.trim())
    && (!lockedBotId || botIds[0] === lockedBotId)
    && (kind === "call"
      ? botIds.length > 0
      : routineTarget === "room-goal"
        ? groupId && botIds[0] && roomMembers.some((bot) => bot.id === botIds[0])
        : botIds.length > 0)
    && !intervalInvalid
    && !intervalDaysInvalid
    && !intervalWindowInvalid
    && !intervalEndInvalid
    && !pattern?.error
    && !("error" in watchBuilt && watchAllowed),
  );
  const canSwitchKind = !routinesOnly && !existingRoutine && !existingCall && !lockedBotId;

  const isCallKind = kind === "call";
  // 2026-10-29: the configuration lives here only; a routine the person
  // cannot change opens read-only (every field disabled, no Save).
  const readOnly = Boolean(existingRoutine && (existingRoutine.canEdit === false || existingRoutine.redacted));
  const otherOwner = existingRoutine?.owner?.id && existingRoutine.owner.id.toLowerCase() !== (state.config?.viewer?.principalId ?? "").toLowerCase() ? existingRoutine.owner : null;
  const isRoutineKind = !isCallKind;
  // 2026-11-02: "When to run" reads as one sentence; the picker opens on
  // click (open from the start for a new routine).
  const whenSentence = eventEditorWhenSentence({
    recurrence, pattern, limitReset, bots, lockedBotId, botIds, intervalMinutes, at, eventSchedule: existingRoutine?.schedule,
  });
  const [whenOpen, setWhenOpen] = useState(() => !existingRoutine);
  const advancedSummary = eventEditorAdvancedSummary({
    kind, runAs, runAsOptions, runAsName, isRoomGoal, runOn, postResults, config: state.config,
    attachmentsLength: attachments.length, recurrence, scheduleDraft, repeatsOnClock, timingMode,
    intervalDays, intervalWindow, intervalEnd, intervalEndDate, watchAllowed, watchOn: watchDraft.on,
    requiredSkills, requiredMcp, requiresComputer, timeoutMinutes, overlap, autoPauseAfter, continuity,
    onlyWhenPresent, deleteWhenFinished, mailAlias,
  });
  // #2272: Advanced is always folded when a routine opens. Nothing persisted
  // reopens it; a toggle only holds while this editor stays open.
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleMore = (open: boolean) => setMoreOpen(open);
  const editorSnapshot = JSON.stringify([requiredSkills, requiredMcp, requiresComputer, kind, name, description, recurrence, limitReset, scheduleDraft, date, startTime, weekdays, durationMinutes, timeoutMinutes, overlap, autoPauseAfter, continuity, onlyWhenPresent, deleteWhenFinished, watchDraft, postResults, mailAlias, routineModel, routineSubagentModel, actAs, routineEffort, timingMode, earlyMinutes, lateMinutes, intervalMinutes, intervalDays, intervalWeekdays, intervalWindow, intervalWindowStart, intervalWindowEnd, intervalEnd, intervalEndDate, botIds, routineTarget, groupId, runOn, attachments.map((attachment) => attachment.id), runAs]);
  const openedSnapshot = useRef(editorSnapshot);
  const dirty = editorSnapshot !== openedSnapshot.current;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const requestClose = async () => {
    if (dirty && !saving && !(await confirm(discardConfirmRequest(t("routineEditor.discard"))))) return;
    onClose();
  };
  const panel = presentation === "panel";
  const viewing = mode === "view" && kind === "routine" && Boolean(existingRoutine);
  // Format with AI opens the routine owner's bot chat (2026-11-03).
  const formatBot = existingRoutine && !existingRoutine.redacted ? state.bots.find((candidate) => candidate.id === existingRoutine.botId) ?? bots.find((candidate) => candidate.id === existingRoutine.botId) : undefined;
  const liveEnabled = (existingRoutine && state.routines.find((routine) => routine.id === existingRoutine.id)?.enabled) ?? existingRoutine?.enabled ?? true;
  const toggleEnabled = () => {
    if (!existingRoutine) return;
    const current = state.routines.find((routine) => routine.id === existingRoutine.id) ?? existingRoutine;
    dispatch({ type: "routinePatched", routine: { ...current, enabled: !liveEnabled } });
    dispatch({ type: "updateRoutine", routineId: existingRoutine.id, patch: { enabled: !liveEnabled } });
  };
  // The trash: the app's confirmation, then the routine is gone.
  const deleteRoutine = async () => {
    if (!existingRoutine) return;
    if (!(await confirm({ title: t("routineCalendar.deleteConfirm", { title: existingRoutine.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
    dispatch({ type: "deleteRoutine", routineId: existingRoutine.id });
    (onDeleted ?? onClose)();
  };
  const requestCancelEdit = async () => {
    if (dirty && !saving && !(await confirm(discardConfirmRequest(t("routineEditor.discard"))))) return;
    onCancelEdit?.();
  };
  const requestDismiss = async () => {
    if (!viewing && dirty && !saving && !(await confirm(discardConfirmRequest(t("routineEditor.discard"))))) return;
    (onDismiss ?? onClose)();
  };
  // The trigger's icon: a clock for a schedule, a globe for a webhook, an
  // eye for a watch, an envelope for mail, an hourglass for a limit reset.
  const whenIconName = recurrence === "webhook" ? "globe" : recurrence === "email" ? "mail" : recurrence === "limit_reset" ? "hourglass" : watchAllowed && watchDraft.on ? "eye" : recurrence === "interval" ? "repeat" : "clock";
  const WhenIcon = { globe: Globe, mail: Mail, hourglass: Hourglass, eye: Eye, repeat: Repeat2, clock: Clock3 }[whenIconName];
  // A panel is not modal (2026-11-01): no focus trap; Escape inside it still
  // asks about unsaved changes before it closes, and stops there.
  const noModal = useRef<HTMLDivElement>(null);
  useModalDialog(panel ? noModal : dialogRef, requestClose);
  const titleText = kind === "routine"
    ? (readOnly ? t("routineEditor.titleView") : existingRoutine ? t("routineEditor.titleEdit") : t("routineEditor.titleNew"))
    : existingRoutine || existingCall ? t("routineCalendar.editEvent") : t("routineCalendar.newEvent");
  return {
    attachmentNotice, attachmentPending, attachments, autoPauseAfter, botIds, canSwitchKind, changeScheduleDraft,
    cloudReady, continuity, date, deleteRoutine, deleteWhenFinished, description,
    dialogRef, dirty, dispatch, durationMinutes, earlyMinutes, endAt,
    error, existingCall, existingRoutine, fileInput, formatBot, groupId,
    intervalDays, intervalDaysInvalid, intervalEnd, intervalEndDate, intervalEndInvalid, intervalEndMinimumAt,
    intervalInvalid, intervalMinutes, intervalWeekdays, intervalWindow, intervalWindowEnd, intervalWindowInvalid,
    intervalWindowStart, isCallKind, isRoomGoal, isRoutineKind, kind, lateMinutes,
    limitReset, liveEnabled, mailAlias, moreOpen, name, onlyWhenPresent,
    otherOwner, overlap, panel, pattern, pickFiles, postResults,
    readOnly, recurrence, repeatsOnClock, requestCancelEdit, requestClose, requestDismiss,
    requiredSkills, requiredMcp, requiresComputer, roleCoverage, roleReadiness,
    roomMembers, rooms, routineTarget, routineModel, routineSubagentModel, routineEffort, actAs,
    runAs, runAsOptions, runOn, save, saving, scheduleDraft, selectBots, selectFrequency, selectIntervalDays,
    selectRecurrence, selectRoom, selectRoutineTarget, selectedBots, selectedRoom, setAttachments,
    setAutoPauseAfter, setContinuity, setDate, setDeleteWhenFinished, setDescription, setDurationMinutes,
    setEarlyMinutes, setIntervalEnd, setIntervalEndDate, setIntervalMinutes, setIntervalWeekdays, setIntervalWindow,
    setIntervalWindowEnd, setIntervalWindowStart, setKind, setLateMinutes, setLimitReset, setMailAlias,
    setName, setOnlyWhenPresent, setOverlap, setPostResults, setRequiredSkills, setRequiredMcp, setRequiresComputer,
    setRoutineModel, setRoutineSubagentModel, setRoutineEffort, setActAs,
    setRunAs, setRunOn, setStartTime, setTimeoutMinutes, setTimingMode, setWatchDraft, setWeekdays, setWhenOpen,
    simplifySchedule, startTime, state, timeoutMinutes, timingMode, titleText,
    toggleEnabled, toggleMore, triggered, valid, viewing, watchAllowed,
    watchDraft, weekdays, WhenIcon, whenOpen, whenSentence, advancedSummary,
    at, bots, lockedBotId, seed, onDuplicate, onStartEdit,
    onCancelEdit, presentation, routinesOnly, page, setBotIds, setRoutineTarget, setScheduleDraft, setRecurrence, onClose, whenIconName,
  };
}
