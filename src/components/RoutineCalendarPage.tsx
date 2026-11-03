import { boatCapableEngine } from "@/lib/remote-desktop";
import { boatComputerEnabled, routinesInConversationEnabled } from "@/lib/feature-flags";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import {
  CalendarClock,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,

  CircleAlert,
  Clock3,
  Cloud,
  ExternalLink,
  FileText,
  Laptop,
  List,
  Loader2,
  Paperclip,
  Pause,
  Plus,
  Repeat2,
  Search,
  Target,
  Trash2,
  UserRoundPlus,
  UsersRound,
  Video,
  Webhook,
  X,
} from "lucide-react";

import { BotAvatar } from "@/components/Avatar";
import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { DetailPanel } from "@/components/DetailPanel";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { pathForFile } from "@/components/ComposerAttachments";
import { CalendarSidebar } from "@/components/routines/CalendarSidebar";
import { RightRailStrip, useRightRailOpen } from "@/components/RightRail";
import { RoutineList } from "@/components/routines/RoutineList";
import { RoutineMenuPortal, routineRowActions, RoutineRowMenuItems, RoutineTitle } from "@/components/routines/RoutineRowMenu";
import { PAGE_COLUMN, PAGE_FIELD_LABEL, PAGE_FILTER_RESET, PAGE_HEADER_BUTTON, PAGE_INDICATOR, PAGE_MENU_COUNT, PAGE_POPOVER, PAGE_SCROLL, PageFilters, PageHeader, PageHeading, PageMenu, PageMenuItem, PageMenuSeparator, PageSegment, PageTopStrip, useDismissMenus } from "@/components/content-page";
import { RoutineLogs } from "@/components/routines/RoutineLogs";
import { RoutineOwnerBadge, RoutineScopeBar } from "@/components/routines/RoutineScopeBar";
import { useRoutineScope } from "@/lib/use-routine-scope";
import { useAdvancedMode } from "@/lib/interface-mode";
import { RunAsField, useRunAsOptions } from "@/components/routines/RunAsField";
import { WatchFields, draftFromWatch, watchFromDraft } from "@/components/routines/WatchFields";
import { RoutineAwayBanner } from "@/components/routines/RoutineAwayBanner";
import { RoutineDetail } from "@/components/routines/RoutineDetail";
import { RoutineRunExchange } from "@/components/routines/RoutineRunExchange";
import { getExchangeColumnHost } from "@/lib/exchange-column-host";
import { canRunRoutineNow, routineRunInFlight } from "@/components/routines/RunNowButton";
import { AdvancedScheduleFields, HumanScheduleFields } from "@/components/routines/HumanScheduleFields";
import { EditorSection, HelpTip } from "@/components/routines/EditorSection";
import { RoutineWebhookPanel } from "@/components/routines/RoutineWebhookPanel";
import { personLabel } from "@/lib/human-label";
import { everyMinutesOf, keptScheduleValue, personTimeZone, PICKER_FREQUENCIES, savedPatternSchedule, scheduleDraftFor, scheduleEditorValue, type ScheduleDraft } from "@/components/routines/schedule-editor";
import { defaultScheduleModel, timeZoneCity, type ScheduleFrequency } from "../../shared/schedule-model";
import { routineAutoPauseChoices, routineAutoPauseOption, routineRunLabel, scheduleRepeatsEventDate, upcomingRoutines } from "@/lib/routine-display";
import { ROUTINE_AUTO_PAUSE_DEFAULT, routineAutoPauseAfter } from "../../shared/routine-auto-pause";
import { t, activeLocale } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { TriggersPanel } from "@/components/TriggersPanel";
import type { CalendarCall, CalendarCallAttachment, CalendarCallInput } from "@/lib/calendar-calls";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { readRoutineEditorMoreOpen, rememberRoutineEditorMoreOpen } from "@/lib/routine-editor-more-pref";
import {
  imageAttachmentFromFile,
  intakeFiles,
  type Attachment,
} from "@/lib/composer-attachments";
import { mausInk, type MausState } from "@/lib/mascot";
import {
  addDays,
  atLocalTime,
  CALENDAR_SLOT_MINUTES,
  calendarRangeLabel,
  formatGmtOffset,
  fromLocalDateAndTime,
  intervalAnchorForSave,
  nextIntervalForSave,
  packCalendarCollisions,
  scheduledRoutineItems,
  groupCalendarSlots,
  scheduleAt,
  slotAt,
  startOfDay,
  startOfWeek,
  toLocalDateInput,
  toLocalTimeInput,
  type RoutineCalendarItem,
} from "@/lib/routine-calendar";
import { cachedDateFormat, dayNames, durationLabel, intervalLabel, niceDate, niceTime, scheduleLabel, scheduleLabelCompact } from "@/lib/schedule-label";
import { PillSelect, Switch, SwitchRow } from "./SettingsPrimitives";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import {
  isRoutineProblemRun,
  type Routine,
  type RoutineContextAttachment,
  type RoutineInput,
  type RoutineRunOn,
  type RoutineRun,
  type RoutineRunStatus,
  type RoutineRunStatusFilter,
  type RoutineSchedule,
  type RoutineScheduleInput,
  type RoutineTarget,
} from "@/lib/routines";
import { api, useStore, type AppState, type Bot, type Group } from "@/state/store";
import { shallowEqual, useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { viewerCanCreateBots } from "@/lib/viewer";
import { createAnswerErrorMessage, recoverCreatedRoutineAfterLostAnswer } from "@/lib/routine-save-recovery";
import { RoutineScheduleNote } from "./RoutineScheduleNote";
import { readTiming, RoutineTimingFields, withRoutineTiming } from "./routines/RoutineTimingFields";
import { BOT_CALENDAR_DRAG_TYPE } from "@/lib/bot-drag";
import { limitResetWhen, resetMarkers, useEngineLimits, type ResetMarker } from "@/lib/limit-resets";
import { LimitWarnings } from "@/components/automations/LimitWarnings";
import { LimitResetFields, type LimitResetChoice } from "@/components/routines/LimitResetFields";
import { LimitResetMarker, type ResetDrop } from "@/components/routines/LimitResetMarkers";
import { readableError } from "@/lib/plain-error";

const HOUR_HEIGHT = 64;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
/** Every N minutes or hours (2026-10-29: hours read as hours). */
const INTERVAL_PRESETS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720];
const EVENT_DURATION_OPTIONS = Array.from({ length: 240 / CALENDAR_SLOT_MINUTES }, (_, index) => (index + 1) * CALENDAR_SLOT_MINUTES);
const BOT_DRAG_TYPE = BOT_CALENDAR_DRAG_TYPE;
const EVENT_DRAG_TYPE = "application/x-openmaus-calendar-event";

type EventKind = "routine" | "call";
type CalendarRecurrenceChoice = "none" | "daily" | "weekdays" | "weekly" | "custom";
/** A routine repeats on a pattern (HumanScheduleFields), every N minutes
 * (the interval's fields), or on a saved schedule no pattern fits
 * ("advanced", kept as it is). A call keeps the calendar's choices. */
type RecurrenceChoice = CalendarRecurrenceChoice | "interval" | "pattern" | "advanced" | "webhook" | "email" | "limit_reset";
type IntervalDayChoice = "every-day" | "weekdays" | "custom";
type IntervalWindowChoice = "all-day" | "custom";
type IntervalEndChoice = "never" | "on-date";

type CallOccurrence = {
  id: string;
  at: number;
  durationMinutes: number;
  call: CalendarCall;
};

type CalendarEventItem =
  | ({ kind: "routine" } & RoutineCalendarItem)
  | ({ kind: "call" } & CallOccurrence);

type EventSeed = {
  kind: EventKind;
  at: number;
  durationMinutes: number;
  botIds: string[];
  name?: string;
  description?: string;
  /** Where quick create hangs: a point, or a day column (x its right edge, left its left edge). */
  anchor?: { x: number; y: number; left?: number };
  routine?: Routine;
  /** 2026-10-29: a new routine prefilled from this one (Duplicate). */
  copyOf?: Routine;
  call?: CalendarCall;
  /** 2026-10-28: a new routine made from a folder's + goes in that folder. */
  folder?: string;
  /** Prefill a limit-reset schedule (calendar marker drop). */
  limitReset?: { engine: string };
};

function activeRoomMembers(group: Group | undefined, bots: Bot[]): Bot[] {
  if (!group) return [];
  return group.memberIds.flatMap((id) => {
    const bot = bots.find((candidate) => candidate.id === id);
    return bot && !bot.hidden ? [bot] : [];
  });
}

function roomCanRunGoal(group: Group): boolean {
  return !group.dm;
}

function preferredRoomLead(group: Group | undefined, bots: Bot[], preferredId?: string): Bot | undefined {
  const members = activeRoomMembers(group, bots);
  const explicitLeadId = group?.defaultResponder.kind === "member" ? group.defaultResponder.botId : undefined;
  return members.find((bot) => bot.id === preferredId)
    ?? members.find((bot) => bot.id === explicitLeadId)
    ?? members.find((bot) => bot.chiefOfStaff)
    ?? members[0];
}

function nextHour(): number {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

/** "15 minutes", "2 hours": an interval preset in words. */
function intervalSpan(minutes: number): string {
  return minutes < 60 ? t("scheduleEditor.minutesN", { count: minutes }) : minutes === 60 ? t("scheduleEditor.hour1") : t("scheduleEditor.hoursN", { count: minutes / 60 });
}

function sameDays(left: readonly number[] | undefined, right: readonly number[]): boolean {
  return Boolean(left && left.length === right.length && left.every((day, index) => day === right[index]));
}

function intervalDayChoice(schedule: RoutineSchedule | CalendarCall["schedule"]): IntervalDayChoice {
  if (schedule.type !== "interval" || !schedule.weekdays || schedule.weekdays.length === 7) return "every-day";
  return sameDays(schedule.weekdays, WEEKDAYS) ? "weekdays" : "custom";
}

function endOfLocalDate(dateInput: string): number {
  const date = new Date(`${dateInput}T00:00`);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
function recurrenceFor(schedule: RoutineSchedule | CalendarCall["schedule"], at: number, routine: boolean): RecurrenceChoice {
  if (schedule.type === "once") return "none";
  // 2026-10-29: a routine started by a webhook or an email says so.
  if (schedule.type === "webhook") return routine ? "webhook" : "none";
  if (schedule.type === "event") return routine ? "email" : "none";
  if (schedule.type === "interval") return "interval";
  if (schedule.type === "cron") {
    const { draft, fits } = scheduleDraftFor(schedule, at);
    return !fits ? "advanced" : draft.model.frequency === "every" ? "interval" : "pattern";
  }
  if (schedule.type === "limit_reset") return "limit_reset";
  if (routine) return "pattern";
  if (schedule.weekdays.length === 7) return "daily";
  if (schedule.weekdays.join(",") === "1,2,3,4,5") return "weekdays";
  if (schedule.weekdays.length === 1 && schedule.weekdays[0] === new Date(at).getDay()) return "weekly";
  return "custom";
}

function makeCalendarSchedule(choice: CalendarRecurrenceChoice, at: number, weekdays: number[]): CalendarCall["schedule"] {
  if (choice === "none") return { type: "once", at };
  const selected = choice === "daily"
    ? ALL_DAYS
    : choice === "weekdays"
      ? WEEKDAYS
      : choice === "weekly"
        ? [new Date(at).getDay()]
        : weekdays;
  return { type: "daily", time: toLocalTimeInput(at), weekdays: [...selected].sort() };
}

function makeRoutineSchedule(
  choice: Exclude<RecurrenceChoice, "pattern" | "advanced" | "webhook" | "email" | "limit_reset">,
  at: number,
  weekdays: number[],
  everyMinutes: number,
  interval: {
    anchorAt: number;
    weekdays: number[] | null;
    window: { start: string; end: string } | null;
    endsAt: number | null;
  },
): RoutineScheduleInput {
  if (choice === "interval") return { type: "interval", everyMinutes, ...interval };
  return makeCalendarSchedule(choice, at, weekdays);
}

function projectCalls(calls: CalendarCall[], from: number, to: number): CallOccurrence[] {
  const items: CallOccurrence[] = [];
  for (const call of calls) {
    if (call.schedule.type === "once") {
      if (call.schedule.at >= from && call.schedule.at < to) {
        items.push({ id: `call-${call.id}-${call.schedule.at}`, at: call.schedule.at, durationMinutes: call.durationMinutes, call });
      }
      continue;
    }
    for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
      if (!call.schedule.weekdays.includes(new Date(day).getDay())) continue;
      const at = atLocalTime(day, call.schedule.time);
      if (at >= from && at < to && at >= call.createdAt) {
        items.push({ id: `call-${call.id}-${at}`, at, durationMinutes: call.durationMinutes, call });
      }
    }
  }
  return items.sort((left, right) => left.at - right.at);
}

function statusState(status: RoutineRunStatus): MausState {
  if (status === "running") return "working";
  if (status === "waiting") return "curious";
  if (status === "completed") return "proud";
  if (status === "failed" || status === "missed") return "sad";
  if (status === "cancelled") return "sleeping";
  return "drowsy";
}

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Array<RoutineContextAttachment | CalendarCallAttachment>;
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex max-w-[260px] items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-2.5 py-2 text-[12px] text-ink">
          <FileText size={14} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          {onRemove && <button type="button" onClick={() => onRemove(attachment.id)} className="rounded p-0.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("botPanel.skills.removeAria", { name: attachment.name })}><X size={12} /></button>}
        </div>
      ))}
    </div>
  );
}

function BotPicker({
  bots,
  selected,
  multiple,
  locked,
  onChange,
}: {
  bots: Bot[];
  selected: string[];
  multiple: boolean;
  locked?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = bots.filter((bot) => `${bot.name} ${bot.title}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="rounded-xl border border-hairline/50 bg-inset/60 p-2">
      {!locked && bots.length > 5 && (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-transparent bg-panel px-2.5 py-2 text-ink-secondary focus-within:border-focus">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("routineCalendar.findBot")} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-tertiary" />
        </label>
      )}
      <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {filtered.map((bot) => {
          const active = selected.includes(bot.id);
          return (
            <button
              key={bot.id}
              type="button"
              disabled={locked}
              onClick={() => onChange(multiple ? (active ? selected.filter((id) => id !== bot.id) : [...selected, bot.id]) : [bot.id])}
              className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition", active ? "bg-accent/12 ring-1 ring-accent/50" : "hover:bg-raised", locked && "cursor-default")}
            >
              <BotAvatar bot={bot} state={active ? "happy" : "idle"} size={32} animated={false} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span>
              {active && <CheckCircle2 size={14} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toContextAttachments(attachments: Attachment[]): Array<RoutineContextAttachment | CalendarCallAttachment> {
  return attachments.flatMap((attachment) => attachment.kind === "paste" || attachment.kind === "citation" ? [] : [{
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
  }]);
}

function EventEditor({
  seed,
  bots,
  lockedBotId,
  defaultRunOn,
  routinesOnly = false,
  presentation = "modal",
  onClose,
  onSavedCall,
}: {
  seed: EventSeed;
  bots: Bot[];
  lockedBotId?: string;
  defaultRunOn?: RoutineRunOn;
  routinesOnly?: boolean;
  /** 2026-11-01: panel = push view in the side panel; modal = centered dialog. */
  presentation?: "modal" | "panel";
  onClose: () => void;
  onSavedCall: (call: CalendarCall) => void;
}) {
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
  const [routineTarget, setRoutineTarget] = useState<RoutineTarget>(template?.target ?? "bot");
  const [groupId, setGroupId] = useState(template?.groupId ?? "");
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
    const lead = preferredRoomLead(room, state.bots, botIds[0]);
    selectBots(lead ? [lead.id] : []);
  };

  const selectRoom = (nextGroupId: string) => {
    const room = rooms.find((candidate) => candidate.id === nextGroupId);
    setGroupId(nextGroupId);
    const lead = preferredRoomLead(room, state.bots, botIds[0]);
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
          : recurrence === "email" && existingRoutine?.schedule.type === "event"
            ? existingRoutine.schedule
          : recurrence === "pattern" || recurrence === "advanced"
          ? keptCron ?? (!scheduleTouched && schedule.type === "daily" ? schedule : pattern?.schedule && savedPatternSchedule(pattern.schedule, scheduleDraft))
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
          // Room goals can't carry a report yet, and a one-time run has no next run.
          continuity: routineTarget === "bot" && repeatsOnClock && continuity,
          onlyWhenPresent,
          postResults: routineTarget === "bot" ? postResults : undefined,
          deleteWhenFinished: (recurrence === "none" || (recurrence === "interval" && intervalEndsAt != null)) && deleteWhenFinished,
          mailAlias: routineTarget === "bot" ? (mailAlias.trim() || null) : null,
          // Sent when on, or to remove a watch the routine had.
          ...(watchAllowed && watchBuilt.watch ? { precheck: watchBuilt.watch } : existingWatch ? { precheck: null } : {}),
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
      } else {
        if (recurrence === "interval" || recurrence === "limit_reset" || recurrence === "pattern" || recurrence === "advanced" || recurrence === "webhook" || recurrence === "email") throw new Error(t("routineCalendar.supportedCallSchedule"));
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
  const whenSentence = recurrence === "pattern" || recurrence === "advanced"
    ? pattern?.sentence || t("routineCalendar.validSchedule")
    : recurrence === "webhook"
      ? t("schedule.compact.webhook")
      : recurrence === "email"
        ? t("schedule.compact.email")
        : recurrence === "limit_reset"
          ? limitResetWhen({ engine: limitReset.engine || bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId || "", repeat: limitReset.repeat })
          : recurrence === "interval"
            ? intervalLabel(intervalMinutes || 5)
            : scheduleLabelCompact({ type: "once", at });
  const [whenOpen, setWhenOpen] = useState(() => !existingRoutine);
  // Advanced's summary names only what differs from the defaults.
  const extraTimes = recurrence === "pattern" && scheduleDraft.model.frequency !== "hourly" ? scheduleDraft.model.times.length - 1 : 0;
  const advancedItems = kind === "routine" ? [
    runAs && runAs !== runAsOptions?.current?.principalId && runAsName ? t("routineEditor.summary.runAs", { name: runAsName }) : null,
    !isRoomGoal && runOn === "cloud" ? t("routineCalendar.boatAgent") : null,
    !isRoomGoal && postResults !== routinesInConversationEnabled(state.config)
      ? (postResults ? t("routineEditor.summary.resultsPosted") : t("routineEditor.summary.resultsHidden"))
      : null,
    !isRoomGoal && attachments.length > 0 ? t("routineEditor.summary.attachments", { count: attachments.length }) : null,
    extraTimes > 0 ? t("routineEditor.summary.extraTimes", { count: extraTimes }) : null,
    recurrence === "pattern" && scheduleDraft.timeZone !== personTimeZone() ? t("routineEditor.summary.zone", { city: timeZoneCity(scheduleDraft.timeZone) }) : null,
    repeatsOnClock && timingMode === "flexible" ? t("routineEditor.summary.flexible") : null,
    recurrence === "interval" && intervalDays !== "every-day" ? t("routineEditor.summary.intervalDays") : null,
    recurrence === "interval" && intervalWindow === "custom" ? t("routineEditor.summary.intervalHours") : null,
    recurrence === "interval" && intervalEnd === "on-date" ? t("routineEditor.summary.intervalEnds", { date: intervalEndDate }) : null,
    watchAllowed && watchDraft.on ? t("routineWatch.title") : null,
    timeoutMinutes != null ? t("routineCalendar.stopsAfter", { duration: durationLabel(timeoutMinutes) }) : null,
    repeatsOnClock && overlap === "queue" ? t("routines.overlapQueue") : null,
    repeatsOnClock && autoPauseAfter !== ROUTINE_AUTO_PAUSE_DEFAULT ? routineAutoPauseOption(autoPauseAfter) : null,
    !isRoomGoal && repeatsOnClock && continuity ? t("routines.continuityLabel") : null,
    onlyWhenPresent ? t("routines.away.onlyLabel") : null,
    deleteWhenFinished && (recurrence === "none" || (recurrence === "interval" && intervalEnd === "on-date")) ? t("routines.deleteWhenFinished.label") : null,
    !isRoomGoal && mailAlias.trim() ? t("routineEditor.summary.mailTag", { tag: mailAlias.trim() }) : null,
  ].filter(Boolean) : [];
  const advancedSummary = advancedItems.length ? advancedItems.join(" · ") : t("routineEditor.advancedDefault");
  const [moreOpen, setMoreOpen] = useState(() => readRoutineEditorMoreOpen());
  const toggleMore = (open: boolean) => {
    setMoreOpen(open);
    rememberRoutineEditorMoreOpen(open);
  };
  const editorSnapshot = JSON.stringify([kind, name, description, recurrence, limitReset, scheduleDraft, date, startTime, weekdays, durationMinutes, timeoutMinutes, overlap, autoPauseAfter, continuity, onlyWhenPresent, deleteWhenFinished, watchDraft, postResults, mailAlias, timingMode, earlyMinutes, lateMinutes, intervalMinutes, intervalDays, intervalWeekdays, intervalWindow, intervalWindowStart, intervalWindowEnd, intervalEnd, intervalEndDate, botIds, routineTarget, groupId, runOn, attachments.map((attachment) => attachment.id), runAs]);
  const openedSnapshot = useRef(editorSnapshot);
  const dirty = editorSnapshot !== openedSnapshot.current;
  const requestClose = async () => {
    if (dirty && !saving && !(await confirm(discardConfirmRequest(t("routineEditor.discard"))))) return;
    onClose();
  };
  const panel = presentation === "panel";
  // A panel is not modal (2026-11-01): no focus trap; Escape inside it still
  // asks about unsaved changes before it closes, and stops there.
  const noModal = useRef<HTMLDivElement>(null);
  useModalDialog(panel ? noModal : dialogRef, requestClose);
  const titleText = kind === "routine"
    ? (readOnly ? t("routineEditor.titleView") : existingRoutine ? t("routineEditor.titleEdit") : t("routineEditor.titleNew"))
    : existingRoutine || existingCall ? t("routineCalendar.editEvent") : t("routineCalendar.newEvent");

  const shell = (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={panel ? "false" : "true"}
        aria-label={existingRoutine || existingCall ? t("routineCalendar.editEventAria") : t("routineCalendar.createEventAria")}
        tabIndex={-1}
        data-routine-editor-presentation={presentation}
        onKeyDown={panel ? (event) => {
          if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        } : undefined}
        className={panel
          ? "absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden bg-panel"
          : "max-h-[94vh] w-full max-w-[760px] overflow-y-auto rounded-[14px] border border-border bg-elevated"}
      >
        <div className={cn("sticky top-0 z-20 flex items-center justify-between", panel ? "bg-panel px-4 py-2" : "border-b border-hairline/40 bg-elevated px-6 py-4")}>
          <div className="flex min-w-0 items-center gap-2">
            {panel && (
              <button type="button" data-editor-back onClick={requestClose} aria-label={t("routineRun.back")} title={t("routineRun.back")} className={cn(CIRCLE_BUTTON, "shrink-0")}>
                <ChevronLeft size={18} strokeWidth={1.75} />
              </button>
            )}
            <div data-editor-title className="truncate text-[16px] font-medium leading-6 text-ink">{titleText}</div>
            {dirty && !readOnly && <span data-editor-dirty className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text"><span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />{t("routineEditor.unsaved")}</span>}
          </div>
          {!panel && <button onClick={requestClose} className="rounded-full p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("common.close")}><X size={18} /></button>}
        </div>
        <div className={panel ? "min-h-0 flex-1 overflow-y-auto" : undefined}>

        <div className={cn(panel ? "px-4 py-4" : "space-y-5 px-6 py-5 sm:px-8")}>
          {canSwitchKind && (
            <div className="ml-10 inline-flex rounded-lg bg-inset p-1">
              <button type="button" onClick={() => { setKind("routine"); setBotIds((ids) => ids.slice(0, 1)); if (recurrence !== "none" && recurrence !== "interval" && recurrence !== "limit_reset" && recurrence !== "webhook" && recurrence !== "email") { setScheduleDraft(scheduleDraftFor(makeCalendarSchedule(recurrence as CalendarRecurrenceChoice, at, weekdays), at).draft); setRecurrence("pattern"); } }} className={cn("rounded-md px-4 py-1.5 text-[13px] font-medium", kind === "routine" ? "bg-raised text-ink shadow" : "text-ink-secondary")}>{t("botPanel.coding.kind.routine")}</button>
              <button type="button" onClick={() => { setKind("call"); if (recurrence === "interval" || recurrence === "limit_reset" || recurrence === "pattern" || recurrence === "advanced" || recurrence === "webhook" || recurrence === "email") setRecurrence("none"); }} className={cn("rounded-md px-4 py-1.5 text-[13px] font-medium", kind === "call" ? "bg-raised text-ink shadow" : "text-ink-secondary")}>{t("routineCalendar.kindCall")}</button>
            </div>
          )}

          {kind === "routine" && !lockedBotId && (
            <div className="ml-10">
              <div className="mb-2 text-[12px] font-medium text-ink-secondary">{t("routineCalendar.routineType")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => selectRoutineTarget("bot")}
                  className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition", routineTarget === "bot" ? "border-accent/60 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised")}
                >
                  <UserRoundPlus size={17} className={cn("mt-0.5 shrink-0", routineTarget === "bot" ? "text-accent" : "text-ink-secondary")} />
                  <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.botTask")}</span><span className="mt-1 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.botTaskHelp")}</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => selectRoutineTarget("room-goal")}
                  className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition", routineTarget === "room-goal" ? "border-accent/60 bg-accent/10" : "border-hairline/50 bg-inset hover:bg-raised")}
                >
                  <Target size={17} className={cn("mt-0.5 shrink-0", routineTarget === "room-goal" ? "text-accent" : "text-ink-secondary")} />
                  <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.teamGoal")}</span><span className="mt-1 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.teamGoalHelp")}</span></span>
                </button>
              </div>
            </div>
          )}

          {kind === "routine" ? <>
            <div className={cn("space-y-1.5", panel && "pb-2")}>
              <input autoFocus data-routine-editor-name value={name} onChange={(event) => setName(event.target.value)} aria-label={t("routineEditor.name")} placeholder={t("routineCalendar.addTitle")} className={cn("w-full min-w-0 border-b border-transparent bg-transparent px-0.5 pb-1 font-medium text-ink outline-none placeholder:text-ink-tertiary hover:border-hairline/40 focus:border-border-strong", panel ? "text-[20px] leading-7" : "text-[22px] leading-8")} />
              {otherOwner && <p data-routine-editor-owner className="px-0.5 text-[12px] text-ink-secondary">{t("routineEditor.owner", { name: personLabel(otherOwner.name, otherOwner.id) })}</p>}
              {readOnly && <p data-routine-editor-readonly className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("routineEditor.readOnly")}</p>}
            </div>
            {/* 2026-11-02 (JC, Cursor's automation panel): the simple view is the
                name, the prompt, one "When to run" row and its trigger details;
                every other setting sits under Advanced, folded by default. */}
            <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
            <section data-routine-editor-section="what" className="min-w-0 space-y-2">
              {existingRoutine?.redacted && <p className="text-[12px] text-ink-secondary">{t("routineEditor.redacted")}</p>}
              <MarkdownEditor compact expandable toolbarOnFocus readOnly={readOnly} value={description} onChange={setDescription} minHeight={panel ? 96 : 120} maxHeight={panel ? 280 : 320} dataField="routine-instructions" className="-mx-3 min-w-0" ariaLabel={isRoomGoal ? t("routineCalendar.teamAccomplish") : t("routineCalendar.botInstructions")} placeholder={isRoomGoal ? t("routineCalendar.teamAccomplish") : t("routineCalendar.botInstructions")} />
            </section>

            <EditorSection title={t("routineEditor.whenToRun")} data-routine-editor-section="when">
              <button
                type="button"
                data-routine-when-row
                aria-expanded={whenOpen}
                aria-label={`${whenSentence}. ${t("routineEditor.changeWhen")}`}
                onClick={() => setWhenOpen((open) => !open)}
                className="-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] leading-5 text-ink hover:bg-raised"
              >
                <span data-routine-when-sentence className="min-w-0">{whenSentence}</span>
                <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform", whenOpen && "rotate-180")} />
              </button>
              {whenOpen && <div data-routine-when-picker className="space-y-3">
                <div data-schedule-frequency={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}>
                  <PillSelect
                    ariaLabel={t("routines.editor.repeat")}
                    value={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}
                    onChange={(value) => {
                      if ((PICKER_FREQUENCIES as string[]).includes(value)) selectFrequency(value as ScheduleFrequency);
                      else selectRecurrence(value as RecurrenceChoice);
                    }}
                    options={[
                      { value: "none", label: t("scheduleEditor.frequency.once") },
                      ...PICKER_FREQUENCIES.map((frequency) => ({ value: frequency, label: t(`scheduleEditor.frequency.${frequency}`) })),
                      { value: "interval", label: t("scheduleEditor.frequency.every") },
                      { value: "limit_reset", label: t("routines.limitReset.option") },
                      ...(recurrence === "advanced" ? [{ value: "advanced", label: t("scheduleEditor.frequency.advanced") }] : []),
                      ...(!isRoomGoal ? [{ value: "webhook", label: t("routineEditor.whenWebhook") }] : []),
                      ...(recurrence === "email" ? [{ value: "email", label: t("schedule.sentence.email") }] : []),
                    ]}
                  />
                </div>
                {recurrence === "none" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.starts")}</span>
                    <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />
                    <input type="time" step={CALENDAR_SLOT_MINUTES * 60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />
                  </div>
                )}
                {recurrence === "limit_reset" && (
                  <LimitResetFields
                    value={limitReset}
                    botEngine={bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId}
                    onChange={setLimitReset}
                  />
                )}
                {recurrence === "pattern" && pattern && <HumanScheduleFields mode="essentials" draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />}
                {recurrence === "advanced" && pattern && <AdvancedScheduleFields value={pattern} onSimplify={simplifySchedule} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />}
                {recurrence === "interval" && (
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                    <span className="font-medium">{t("routineCalendar.runsEvery")}</span>
                    <select
                      value={INTERVAL_PRESETS.includes(intervalMinutes) ? String(intervalMinutes) : "custom"}
                      onChange={(event) => setIntervalMinutes(event.target.value === "custom" ? 0 : Number(event.target.value))}
                      aria-label={t("routineCalendar.howOften")}
                      className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong"
                    >
                      {INTERVAL_PRESETS.map((minutes) => <option key={minutes} value={minutes}>{intervalSpan(minutes)}</option>)}
                      <option value="custom">{t("room.turnLimit.custom")}</option>
                    </select>
                    {!INTERVAL_PRESETS.includes(intervalMinutes) && (
                      <input
                        type="number"
                        min={5}
                        max={1_440}
                        step={1}
                        value={intervalMinutes || ""}
                        onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                        aria-label={t("routineCalendar.customIntervalMinutes")}
                        aria-invalid={intervalInvalid}
                        aria-describedby={intervalInvalid ? "routine-interval-error" : "routine-interval-help"}
                        autoFocus
                        className={cn("w-20 rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong", intervalInvalid ? "border-danger/70" : "border-border")}
                      />
                    )}
                    {!INTERVAL_PRESETS.includes(intervalMinutes) && <span>{t("settings.mcpCalls.minutes")}</span>}
                  </div>
                )}
              </div>}
              {pattern?.error && (recurrence === "pattern" || recurrence === "advanced") && <p id="routine-schedule-error" role="alert" className="text-[11.5px] text-danger">{pattern.error}</p>}
              {intervalInvalid && <div id="routine-interval-error" className="text-[11px] text-danger">{t("routineCalendar.intervalWholeNumber")}</div>}
              {recurrence === "webhook" && <RoutineWebhookPanel routine={existingRoutine?.schedule.type === "webhook" ? existingRoutine : undefined} bot={bots.find((bot) => bot.id === botIds[0])} />}
              {recurrence === "email" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("routineEditor.emailTrigger")}</p>}
            </EditorSection>

            {!lockedBotId && <EditorSection title={isRoomGoal ? t("routineCalendar.chooseGroup") : t("routineCalendar.assignBot")} data-routine-editor-section="bot">
              {isRoomGoal ? (
                <div className="space-y-3">
                  {rooms.length > 0 ? (
                    <select id="routine-goal-room" aria-label={t("routineCalendar.chooseGroup")} value={groupId} onChange={(event) => selectRoom(event.target.value)} className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                      <option value="">{t("routineCalendar.selectGroup")}</option>
                      {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-xl border border-dashed border-hairline/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">{t("routineCalendar.createGroupFirst")}</div>
                  )}
                  {selectedRoom && (
                    <div>
                      <div className="mb-2 text-[12px] text-ink-tertiary">{t("routineCalendar.chooseLead")}</div>
                      {roomMembers.length > 0 ? (
                        <>
                          <BotPicker bots={roomMembers} selected={botIds} multiple={false} onChange={selectBots} />
                          <div className="mt-2 text-[12px] text-ink-secondary">{t("routineCalendar.leadCoordinates", { name: selectedRoom.name })}</div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-[12px] text-warning">{t("routineCalendar.noActiveMembers")}</div>
                      )}
                    </div>
                  )}
                </div>
              ) : bots.length > 0 ? (
                <BotPicker bots={bots} selected={botIds} multiple={false} locked={Boolean(lockedBotId)} onChange={selectBots} />
              ) : viewerCanCreateBots(state.config) && (
                <button type="button" onClick={() => { dispatch({ type: "openBotWizard" }); onClose(); }} className="w-full rounded-xl border border-dashed border-accent/45 bg-accent/[0.06] px-4 py-4 text-left hover:bg-accent/10">
                  <div className="text-[13px] font-medium text-accent">{t("onboarding.firstRun.bot.title")}</div>
                  <div className="mt-1 text-[12px] text-ink-secondary">{t("routineCalendar.needsOneBot")}</div>
                </button>
              )}
            </EditorSection>}

            <details data-routine-editor-more className="group border-t border-hairline/35 pt-3" open={moreOpen} onToggle={(event) => toggleMore((event.currentTarget as HTMLDetailsElement).open)}>
              <summary data-routine-editor-more-summary className="-mx-2 flex cursor-pointer select-none list-none items-start gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-ink-tertiary transition-transform group-open:rotate-90" />
                <span className="min-w-0"><span className="font-medium text-ink">{t("routineEditor.advanced")}</span><span data-routine-advanced-summary className="ml-1.5 text-ink-tertiary">· {advancedSummary}</span></span>
              </summary>
              <div className="mt-3 space-y-5">
              {runAsOptions && (runAsOptions.canChoose || runAsOptions.current) && <div className="-mx-3">
                <RunAsField compact options={runAsOptions} value={runAs} onChange={setRunAs} />
              </div>}
              {isRoomGoal ? (
                <p data-routine-run-on className="flex items-center gap-1.5 text-[12.5px] text-ink">
                  <Target size={14} aria-hidden="true" className="text-ink-tertiary" />{t("routineCalendar.runsHere")}
                  <HelpTip id="routine-runs-here-help" text={t("routineCalendar.runsHereHelp")} />
                </p>
              ) : (boatComputerEnabled(state.config) || runOn === "cloud") && (
                <div data-routine-run-on role="radiogroup" aria-label={t("routineEditor.runsOn")} className="inline-flex rounded-full bg-inset p-0.5">
                  <button type="button" role="radio" aria-checked={runOn === "maus"} title={t("routineCalendar.botSetupHelp")} onClick={() => setRunOn("maus")} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px]", runOn === "maus" ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}><Laptop size={13} aria-hidden="true" />{t("routineCalendar.botSetup")}</button>
                  <button type="button" role="radio" aria-checked={runOn === "cloud"} title={t("routineCalendar.boatAgentHelp")} disabled={!cloudReady || attachments.length > 0} onClick={() => setRunOn("cloud")} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-45", runOn === "cloud" ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}><Cloud size={13} aria-hidden="true" />{t("routineCalendar.boatAgent")}</button>
                </div>
              )}
              {!isRoomGoal && (
                <div data-routine-post-results>
                  <SwitchRow label={t("routines.postResults.label")} help={t("routines.postResults.help")} description={t("routines.postResults.hint")} checked={postResults} onChange={setPostResults} />
                </div>
              )}
              {isRoomGoal ? (
                <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary">{t("routineCalendar.sharedContext")}<HelpTip id="routine-goal-attach-help" text={t("routineCalendar.noGoalAttachments")} /></p>
              ) : <div data-routine-attachments className="min-w-0 space-y-2">
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void pickFiles(event.target.files); event.target.value = ""; }} />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-full border border-hairline/50 px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised"><Paperclip size={13} aria-hidden="true" />{t("routineCalendar.addAttachment")}</button>
                  <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] leading-4 text-ink-tertiary">
                    <span className="truncate">{t("routineCalendar.attachRoutineHint")}</span>
                    <HelpTip id="routine-attach-help" text={t("routineCalendar.attachRoutineHelp")} />
                  </span>
                </div>
                <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />
                {attachmentNotice && <div className="text-[12px] text-warning">{attachmentNotice}</div>}
              </div>}
              {recurrence === "pattern" && pattern && (
                <div data-routine-editor-more-schedule className="space-y-3">
                  <HumanScheduleFields mode="advanced" draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} paused={Boolean(existingRoutine && !existingRoutine.enabled)} />
                </div>
              )}
              {repeatsOnClock && (
                <RoutineTimingFields
                  mode={timingMode}
                  earlyMinutes={earlyMinutes}
                  lateMinutes={lateMinutes}
                  onMode={setTimingMode}
                  onEarly={setEarlyMinutes}
                  onLate={setLateMinutes}
                />
              )}
              {!triggered && <RoutineScheduleNote />}
              {recurrence === "interval" && (
                <div className="space-y-3" data-routine-interval-advanced>
                  <div className="grid items-center gap-2 text-[13px] text-ink sm:flex sm:flex-wrap">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="text-ink-secondary">{t("routineCalendar.intervalOn")}</span>
                      <select
                        value={intervalDays}
                        onChange={(event) => selectIntervalDays(event.target.value as IntervalDayChoice)}
                        aria-label={t("routineCalendar.intervalDaysAria")}
                        aria-invalid={intervalDaysInvalid}
                        aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="every-day">{t("routines.repeat.daily")}</option>
                        <option value="weekdays">{t("routines.repeat.weekdays")}</option>
                        <option value="custom">{t("room.turnLimit.custom")}</option>
                      </select>
                    </span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="text-ink-secondary">{t("routineCalendar.during")}</span>
                      <select
                        value={intervalWindow}
                        onChange={(event) => setIntervalWindow(event.target.value as IntervalWindowChoice)}
                        aria-label={t("routineCalendar.intervalHoursAria")}
                        aria-invalid={intervalWindowInvalid}
                        aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="all-day">{t("routineCalendar.allDay")}</option>
                        <option value="custom">{t("routineCalendar.customHours")}</option>
                      </select>
                    </span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="text-ink-secondary">{t("remoteSessionsAdmin.col.ends")}</span>
                      <select
                        value={intervalEnd}
                        onChange={(event) => setIntervalEnd(event.target.value as IntervalEndChoice)}
                        aria-label={t("routineCalendar.intervalEndsAria")}
                        aria-invalid={intervalEndInvalid}
                        aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="never">{t("pages.expiry.never")}</option>
                        <option value="on-date">{t("routineCalendar.onDateOption")}</option>
                      </select>
                    </span>
                  </div>
                  {intervalDays === "custom" && (
                    <div role="group" aria-label={t("routineCalendar.customIntervalDays")} aria-invalid={intervalDaysInvalid} aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined} className="flex flex-wrap gap-1.5">
                      {dayNames().map((label, day) => (
                        <button key={label} type="button" onClick={() => setIntervalWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())} aria-label={t(intervalWeekdays.includes(day) ? "routineCalendar.daySelected" : "routineCalendar.dayNotSelected", { day: label })} aria-pressed={intervalWeekdays.includes(day)} className={cn("size-8 rounded-full text-[11px] font-semibold", intervalWeekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>
                          {dayNames()[day]?.slice(0, 2)}
                        </button>
                      ))}
                    </div>
                  )}
                  {intervalWindow === "custom" && (
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                      <span className="text-ink-secondary">{t("routineCalendar.runBetween")}</span>
                      <input aria-label={t("routineCalendar.windowStart")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowStart} onChange={(event) => setIntervalWindowStart(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                      <span className="text-ink-secondary">{t("routineCalendar.and")}</span>
                      <input aria-label={t("routineCalendar.windowEnd")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowEnd} onChange={(event) => setIntervalWindowEnd(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                    </div>
                  )}
                  {intervalEnd === "on-date" && (
                    <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                      <span className="text-ink-secondary">{t("routineCalendar.stopSchedulingAfter")}</span>
                      <input aria-label={t("routineCalendar.intervalEndDate")} aria-invalid={intervalEndInvalid} aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined} type="date" min={toLocalDateInput(intervalEndMinimumAt)} value={intervalEndDate} onChange={(event) => setIntervalEndDate(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalEndInvalid ? "border-danger/70" : "border-border")} />
                    </label>
                  )}
                  {intervalDaysInvalid && <div id="routine-interval-days-error" className="text-[11px] text-danger">{t("routineCalendar.chooseOneDay")}</div>}
                  {intervalWindowInvalid && <div id="routine-interval-window-error" className="text-[11px] text-danger">{t("routineCalendar.sameDayWindow", { minutes: intervalMinutes || 5 })}</div>}
                  {intervalEndInvalid && <div id="routine-interval-end-error" className="text-[11px] text-danger">{t("routineCalendar.endAfterFirstRun")}</div>}
                </div>
              )}
              {watchAllowed && (
                <WatchFields draft={watchDraft} onChange={setWatchDraft} botId={lockedBotId ?? botIds[0] ?? ""} routineId={existingRoutine?.id} runOn={runOn} />
              )}
              <div className="space-y-3">
                <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
                  <span className="inline-flex items-center gap-1">{t("routineCalendar.stopIfStillRunning")}<HelpTip id="routine-time-limit-help" text={t("routineCalendar.safetyLimitHelp")} /></span>
                  <select aria-label={t("routineCalendar.safetyLimit")} value={timeoutMinutes ?? ""} onChange={(event) => setTimeoutMinutes(event.target.value ? Number(event.target.value) : null)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                    <option value="">{t("settings.card.noLimit")}</option>
                    {EVENT_DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
                  </select>
                </label>
                {repeatsOnClock && <label id="routine-interval-help" className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
                  <span className="inline-flex items-center gap-1">{t("routines.overlapLabel")}<HelpTip id="routine-overlap-help" text={t(overlap === "queue" ? "routines.overlapQueueHelp" : "routines.overlapSkipHelp")} /></span>
                  <select aria-label={t("routines.overlapLabel")} value={overlap} onChange={event => setOverlap(event.target.value === "queue" ? "queue" : "skip")} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                    <option value="skip">{t("routines.overlapSkip")}</option>
                    <option value="queue">{t("routines.overlapQueue")}</option>
                  </select>
                </label>}
                {repeatsOnClock && <label data-routine-auto-pause className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
                  <span className="inline-flex items-center gap-1">{t("routines.autoPause.label")}<HelpTip id="routine-auto-pause-help" text={t("routines.autoPause.help")} /></span>
                  <select aria-label={t("routines.autoPause.label")} value={autoPauseAfter} onChange={(event) => setAutoPauseAfter(Number(event.target.value))} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                    {routineAutoPauseChoices(autoPauseAfter).map((count) => <option key={count} value={count}>{routineAutoPauseOption(count)}</option>)}
                  </select>
                </label>}
              </div>
              <div className="space-y-3">
                {!isRoomGoal && repeatsOnClock && <div data-routine-continuity><SwitchRow label={t("routines.continuityLabel")} help={t("routines.continuityHelp")} checked={continuity} onChange={setContinuity} /></div>}
                <div data-routine-only-present><SwitchRow label={t("routines.away.onlyLabel")} help={t("routines.away.onlyHelp")} checked={onlyWhenPresent} onChange={setOnlyWhenPresent} /></div>
                {(recurrence === "none" || (recurrence === "interval" && intervalEnd === "on-date")) && <div data-routine-delete-when-finished><SwitchRow label={t("routines.deleteWhenFinished.label")} help={t("routines.deleteWhenFinished.help")} checked={deleteWhenFinished} onChange={setDeleteWhenFinished} /></div>}
              </div>
              {!isRoomGoal && (
                <label data-routine-mail-alias className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
                  <span className="inline-flex items-center gap-1">{t("routines.mailAlias.label")}<HelpTip id="routine-mail-alias-help" text={t("routines.mailAlias.help")} /></span>
                  <input
                    value={mailAlias}
                    maxLength={32}
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-label={t("routines.mailAlias.label")}
                    placeholder={t("routines.mailAlias.placeholder")}
                    onChange={(event) => setMailAlias(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32))}
                    className="w-full max-w-[200px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-border-strong"
                  />
                </label>
              )}
              </div>
            </details>
            </fieldset>
          </> : <>
          <div className="flex items-start gap-4">
            <span className="mt-3 size-4 shrink-0 rounded bg-accent" />
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={isRoutineKind ? t("routineCalendar.addTitle") : t("routineCalendar.addCallTitle")} className="min-w-0 flex-1 border-b border-hairline/60 bg-transparent px-1 pb-2 text-[22px] font-medium text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
          </div>

          <div className="flex items-start gap-4">
            <Clock3 size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1 space-y-3">
              {(kind === "call" || recurrence === "none") && (
                <div className="flex flex-wrap items-center gap-2">
                  {isRoutineKind && recurrence === "none" && <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.starts")}</span>}
                  {isRoutineKind && recurrence === "weekly" && <span className="text-[12px] font-medium text-ink-secondary">{t("routineCalendar.onDate")}</span>}
                  {(kind === "call" || recurrence === "none" || recurrence === "weekly") && <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />}
                  <input type="time" step={CALENDAR_SLOT_MINUTES * 60} value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]" />
                  {kind === "call" && <>
                    <span className="text-[12px] text-ink-secondary">{t("routineCalendar.to")}</span>
                    <span className="rounded-lg border border-hairline/40 bg-inset/60 px-3 py-2 text-[13px] text-ink">{niceTime(endAt)}</span>
                    <PillSelect
                      ariaLabel={t("routineCalendar.callDuration")}
                      value={String(durationMinutes)}
                      onChange={(value) => setDurationMinutes(Number(value))}
                      options={EVENT_DURATION_OPTIONS.map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) }))}
                    />
                  </>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Repeat2 size={14} className="text-ink-secondary" />
                {isRoutineKind ? (
                  <div data-schedule-frequency={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}>
                    <PillSelect
                      ariaLabel={t("routines.editor.repeat")}
                      value={recurrence === "pattern" ? scheduleDraft.model.frequency : recurrence}
                      onChange={(value) => {
                        if ((PICKER_FREQUENCIES as string[]).includes(value)) selectFrequency(value as ScheduleFrequency);
                        else selectRecurrence(value as RecurrenceChoice);
                      }}
                      options={[
                        { value: "none", label: t("scheduleEditor.frequency.once") },
                        ...PICKER_FREQUENCIES.map((frequency) => ({ value: frequency, label: t(`scheduleEditor.frequency.${frequency}`) })),
                        { value: "interval", label: t("scheduleEditor.frequency.every") },
                        { value: "limit_reset", label: t("routines.limitReset.option") },
                        ...(recurrence === "advanced" ? [{ value: "advanced", label: t("scheduleEditor.frequency.advanced") }] : []),
                      ]}
                    />
                  </div>
                ) : (
                <PillSelect
                  ariaLabel={t("routines.editor.repeat")}
                  value={recurrence}
                  onChange={(value) => selectRecurrence(value as RecurrenceChoice)}
                  options={[
                    { value: "none", label: t("routineCalendar.noRepeat") },
                    { value: "daily", label: t("routineCalendar.daily") },
                    { value: "weekdays", label: t("routineCalendar.everyWeekday") },
                    { value: "weekly", label: t("routineCalendar.weeklyOn", { day: dayNames()[new Date(at).getDay()] ?? "" }) },
                    { value: "custom", label: t("routineCalendar.selectedWeekdays") },
                  ]}
                />
                )}
              </div>
              {isRoutineKind && recurrence === "limit_reset" && (
                <LimitResetFields
                  value={limitReset}
                  botEngine={bots.find((bot) => bot.id === (lockedBotId ?? botIds[0]))?.modelSelection?.instanceId}
                  onChange={setLimitReset}
                />
              )}
              {isRoutineKind && recurrence === "pattern" && pattern && <HumanScheduleFields draft={scheduleDraft} value={pattern} onChange={changeScheduleDraft} />}
              {isRoutineKind && recurrence === "advanced" && pattern && <AdvancedScheduleFields value={pattern} onSimplify={simplifySchedule} />}
              {isRoutineKind && recurrence !== "none" && recurrence !== "limit_reset" && (
                <RoutineTimingFields
                  mode={timingMode}
                  earlyMinutes={earlyMinutes}
                  lateMinutes={lateMinutes}
                  onMode={setTimingMode}
                  onEarly={setEarlyMinutes}
                  onLate={setLateMinutes}
                />
              )}
              {isRoutineKind && <RoutineScheduleNote />}
              {kind === "call" && recurrence === "custom" && (
                <div className="flex flex-wrap gap-1.5">
                  {dayNames().map((label, day) => <button key={label} type="button" onClick={() => setWeekdays((current) => current.includes(day) ? (current.length === 1 ? current : current.filter((value) => value !== day)) : [...current, day].sort())} className={cn("size-8 rounded-full text-[11px] font-semibold", weekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>{label[0]}</button>)}
                </div>
              )}
              {recurrence === "interval" && isRoutineKind && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                    <span className="font-medium">{t("routineCalendar.runsEvery")}</span>
                    <select
                      value={INTERVAL_PRESETS.includes(intervalMinutes) ? String(intervalMinutes) : "custom"}
                      onChange={(event) => setIntervalMinutes(event.target.value === "custom" ? 0 : Number(event.target.value))}
                      aria-label={t("routineCalendar.howOften")}
                      className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong"
                    >
                      {INTERVAL_PRESETS.map((minutes) => <option key={minutes} value={minutes}>{intervalSpan(minutes)}</option>)}
                      <option value="custom">{t("room.turnLimit.custom")}</option>
                    </select>
                    {!INTERVAL_PRESETS.includes(intervalMinutes) && (
                      <input
                        type="number"
                        min={5}
                        max={1_440}
                        step={1}
                        value={intervalMinutes || ""}
                        onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                        aria-label={t("routineCalendar.customIntervalMinutes")}
                        aria-invalid={intervalInvalid}
                        aria-describedby={intervalInvalid ? "routine-interval-error" : "routine-interval-help"}
                        autoFocus
                        className={cn("w-20 rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] tabular-nums text-ink outline-none focus:border-border-strong", intervalInvalid ? "border-danger/70" : "border-border")}
                      />
                    )}
                    {!INTERVAL_PRESETS.includes(intervalMinutes) && <span>{t("settings.mcpCalls.minutes")}</span>}
                  </div>

                  <div className="grid items-center gap-2 text-[13px] text-ink sm:flex sm:flex-wrap">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="font-medium">{t("routineCalendar.intervalOn")}</span>
                      <select
                        value={intervalDays}
                        onChange={(event) => selectIntervalDays(event.target.value as IntervalDayChoice)}
                        aria-label={t("routineCalendar.intervalDaysAria")}
                        aria-invalid={intervalDaysInvalid}
                        aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="every-day">{t("routines.repeat.daily")}</option>
                        <option value="weekdays">{t("routines.repeat.weekdays")}</option>
                        <option value="custom">{t("room.turnLimit.custom")}</option>
                      </select>
                    </span>
                    <span aria-hidden="true" className="hidden text-ink-secondary sm:inline">·</span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="font-medium">{t("routineCalendar.during")}</span>
                      <select
                        value={intervalWindow}
                        onChange={(event) => setIntervalWindow(event.target.value as IntervalWindowChoice)}
                        aria-label={t("routineCalendar.intervalHoursAria")}
                        aria-invalid={intervalWindowInvalid}
                        aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="all-day">{t("routineCalendar.allDay")}</option>
                        <option value="custom">{t("routineCalendar.customHours")}</option>
                      </select>
                    </span>
                    <span aria-hidden="true" className="hidden text-ink-secondary sm:inline">·</span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="font-medium">{t("remoteSessionsAdmin.col.ends")}</span>
                      <select
                        value={intervalEnd}
                        onChange={(event) => setIntervalEnd(event.target.value as IntervalEndChoice)}
                        aria-label={t("routineCalendar.intervalEndsAria")}
                        aria-invalid={intervalEndInvalid}
                        aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined}
                        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
                      >
                        <option value="never">{t("pages.expiry.never")}</option>
                        <option value="on-date">{t("routineCalendar.onDateOption")}</option>
                      </select>
                    </span>
                  </div>

                  {intervalDays === "custom" && (
                    <div>
                      <div className="mb-2 text-[11px] font-medium text-ink-secondary">{t("routineCalendar.chooseDays")}</div>
                      <div
                        role="group"
                        aria-label={t("routineCalendar.customIntervalDays")}
                        aria-invalid={intervalDaysInvalid}
                        aria-describedby={intervalDaysInvalid ? "routine-interval-days-error" : undefined}
                        className="flex flex-wrap gap-1.5"
                      >
                        {dayNames().map((label, day) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setIntervalWeekdays((current) => current.includes(day)
                              ? current.filter((value) => value !== day)
                              : [...current, day].sort())}
                            aria-label={t(intervalWeekdays.includes(day) ? "routineCalendar.daySelected" : "routineCalendar.dayNotSelected", { day: label })}
                            aria-pressed={intervalWeekdays.includes(day)}
                            className={cn("size-8 rounded-full text-[11px] font-semibold", intervalWeekdays.includes(day) ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}
                          >
                            {dayNames()[day]?.slice(0, 2)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {intervalWindow === "custom" && (
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                      <span className="font-medium text-ink-secondary">{t("routineCalendar.runBetween")}</span>
                      <input aria-label={t("routineCalendar.windowStart")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowStart} onChange={(event) => setIntervalWindowStart(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                      <span className="text-ink-secondary">{t("routineCalendar.and")}</span>
                      <input aria-label={t("routineCalendar.windowEnd")} aria-invalid={intervalWindowInvalid} aria-describedby={intervalWindowInvalid ? "routine-interval-window-error" : undefined} type="time" step={CALENDAR_SLOT_MINUTES * 60} value={intervalWindowEnd} onChange={(event) => setIntervalWindowEnd(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalWindowInvalid ? "border-danger/70" : "border-border")} />
                    </div>
                  )}

                  {intervalEnd === "on-date" && (
                    <label className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
                      <span className="font-medium text-ink-secondary">{t("routineCalendar.stopSchedulingAfter")}</span>
                      <input aria-label={t("routineCalendar.intervalEndDate")} aria-invalid={intervalEndInvalid} aria-describedby={intervalEndInvalid ? "routine-interval-end-error" : undefined} type="date" min={toLocalDateInput(intervalEndMinimumAt)} value={intervalEndDate} onChange={(event) => setIntervalEndDate(event.target.value)} className={cn("rounded-lg border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong [color-scheme:dark]", intervalEndInvalid ? "border-danger/70" : "border-border")} />
                    </label>
                  )}

                  {intervalInvalid && (
                    <div id="routine-interval-error" className="text-[11px] text-danger">{t("routineCalendar.intervalWholeNumber")}</div>
                  )}
                  {intervalDaysInvalid && (
                    <div id="routine-interval-days-error" className="text-[11px] text-danger">{t("routineCalendar.chooseOneDay")}</div>
                  )}
                  {intervalWindowInvalid && (
                    <div id="routine-interval-window-error" className="text-[11px] text-danger">{t("routineCalendar.sameDayWindow", { minutes: intervalMinutes || 5 })}</div>
                  )}
                  {intervalEndInvalid && (
                    <div id="routine-interval-end-error" className="text-[11px] text-danger">{t("routineCalendar.endAfterFirstRun")}</div>
                  )}
                  <div id="routine-interval-help" className="text-[11px] leading-relaxed text-ink-secondary">{t(overlap === "queue" ? "routines.overlapQueueHelp" : "routines.overlapSkipHelp")}</div>
                </div>
              )}
              {watchAllowed && (
                <WatchFields draft={watchDraft} onChange={setWatchDraft} botId={lockedBotId ?? botIds[0] ?? ""} routineId={existingRoutine?.id} runOn={runOn} />
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            {isRoomGoal ? <UsersRound size={18} className="mt-2.5 shrink-0 text-ink-secondary" /> : <UserRoundPlus size={18} className="mt-2.5 shrink-0 text-ink-secondary" />}
            <div className="min-w-0 flex-1">
              {isRoomGoal ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="routine-goal-room" className="mb-2 block text-[13px] font-medium text-ink">{t("routineCalendar.chooseGroup")}</label>
                    {rooms.length > 0 ? (
                      <select id="routine-goal-room" value={groupId} onChange={(event) => selectRoom(event.target.value)} className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong">
                        <option value="">{t("routineCalendar.selectGroup")}</option>
                        {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                      </select>
                    ) : (
                      <div className="rounded-xl border border-dashed border-hairline/60 bg-inset px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">{t("routineCalendar.createGroupFirst")}</div>
                    )}
                  </div>
                  {selectedRoom && (
                    <div>
                      <div className="mb-2 text-[13px] font-medium text-ink">{t("routineCalendar.chooseLead")}</div>
                      {roomMembers.length > 0 ? (
                        <>
                          <BotPicker bots={roomMembers} selected={botIds} multiple={false} onChange={selectBots} />
                          <div className="mt-2 text-[12px] text-ink-secondary">{t("routineCalendar.leadCoordinates", { name: selectedRoom.name })}</div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-[12px] text-warning">{t("routineCalendar.noActiveMembers")}</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-2 text-[13px] font-medium text-ink">{isRoutineKind ? t("routineCalendar.assignBot") : t("routineCalendar.addGuests")}</div>
                  {bots.length > 0 ? (
                <>
                  <BotPicker bots={bots} selected={botIds} multiple={kind === "call"} locked={Boolean(lockedBotId)} onChange={selectBots} />
                  <div className="mt-2 text-[12px] text-ink-secondary">{isRoutineKind ? t("routineCalendar.botOwnsRun") : selectedBots.length === 0 ? t("routineCalendar.noBotsInvited") : selectedBots.length === 1 ? t("routineCalendar.oneBotInvited") : t("routineCalendar.botsInvited", { count: selectedBots.length })}</div>
                </>
              ) : viewerCanCreateBots(state.config) && (
                <button type="button" onClick={() => { dispatch({ type: "openBotWizard" }); onClose(); }} className="w-full rounded-xl border border-dashed border-accent/45 bg-accent/[0.06] px-4 py-4 text-left hover:bg-accent/10">
                  <div className="text-[13px] font-medium text-accent">{t("onboarding.firstRun.bot.title")}</div>
                  <div className="mt-1 text-[12px] text-ink-secondary">{t("routineCalendar.needsOneBot")}</div>
                </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-start gap-4">
            <FileText size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
            <MarkdownEditor value={description} onChange={setDescription} minHeight={120} dataField="routine-instructions" className="min-w-0 flex-1" ariaLabel={isRoomGoal ? t("routineCalendar.teamAccomplish") : isRoutineKind ? t("routineCalendar.botInstructions") : t("routineCalendar.addAgenda")} placeholder={isRoomGoal ? t("routineCalendar.teamAccomplish") : isRoutineKind ? t("routineCalendar.botInstructions") : t("routineCalendar.addAgenda")} />
          </div>
          <div className="flex items-start gap-4">
            <Paperclip size={18} className="mt-2.5 shrink-0 text-ink-secondary" />
            {isRoomGoal ? (
              <div className="min-w-0 flex-1 rounded-xl border border-hairline/50 bg-inset px-3.5 py-3">
                <div className="text-[13px] font-medium text-ink">{t("routineCalendar.sharedContext")}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.noGoalAttachments")}</div>
              </div>
            ) : <div className="min-w-0 flex-1 space-y-2">
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void pickFiles(event.target.files); event.target.value = ""; }} />
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg border border-hairline/50 px-3 py-2 text-[13px] font-medium text-ink hover:bg-raised">{t("routineCalendar.addAttachment")}</button>
              <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />
              <div className="text-[11px] leading-relaxed text-ink-secondary">
                {isRoutineKind
                  ? t("routineCalendar.attachRoutineHelp")
                  : selectedBots.length > 1
                    ? t("routineCalendar.refsSharedHelp")
                    : t("routineCalendar.refsStayHelp")}
              </div>
              {attachmentNotice && <div className="text-[12px] text-warning">{attachmentNotice}</div>}
            </div>}
          </div>

          </>}
          {error && <div className="ml-10 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</div>}
        </div>
        </div>

        <div className={cn("sticky bottom-0 z-20 flex items-center justify-end gap-2", panel ? "bg-panel px-4 pb-4 pt-2" : "border-t border-hairline/40 bg-elevated px-6 py-4")}>
          <button onClick={requestClose} className={cn("rounded-full border border-hairline/50 px-4 py-2 text-[13px] font-medium text-ink hover:bg-raised", panel && "flex-1")}>{readOnly ? t("common.close") : t("common.cancel")}</button>
          {!readOnly && <button onClick={save} disabled={saving || attachmentPending || !valid} className={cn("flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40", panel && "flex-1")}>{(saving || attachmentPending) && <Loader2 size={14} className="animate-spin" />}{attachmentPending ? t("routineCalendar.attaching") : existingRoutine || existingCall ? t("common.save") : kind === "call" ? t("routineCalendar.scheduleCall") : isRoomGoal ? t("routineCalendar.scheduleGoal") : t("routineCalendar.scheduleRoutine")}</button>}
        </div>
      </div>
  );

  if (panel) return shell;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      {shell}
    </div>
  );
}

/** Exported for tests. */
export function QuickComposer({
  seed,
  bots,
  routinesOnly = false,
  onClose,
  onMore,
  onSavedRoutine,
  onSavedCall,
}: {
  seed: EventSeed;
  bots: Bot[];
  routinesOnly?: boolean;
  onClose: () => void;
  onMore: (seed: EventSeed) => void;
  onSavedRoutine: (routine: Routine) => void;
  onSavedCall: (call: CalendarCall) => void;
}) {
  const confirm = useConfirm();
  const { state, dispatch } = useStore();
  const [kind, setKind] = useState<EventKind>(routinesOnly || seed.limitReset ? "routine" : seed.kind);
  const [name, setName] = useState(seed.name ?? "");
  const [description, setDescription] = useState(seed.description ?? "");
  const [botIds, setBotIds] = useState(seed.botIds.length ? seed.botIds : bots[0] ? [bots[0].id] : []);
  const selectBots = (ids: string[]) => setBotIds(ids);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dialogPosition, setDialogPosition] = useState<{ left: number; top: number } | null>(null);
  const durationMinutes = kind === "routine" ? 30 : seed.durationMinutes;
  // 2026-11-01 (no modals): a popover hung off the slot or the New button,
  // with no scrim; the calendar stays usable. A press outside closes it while
  // it is empty; with a draft it stays (another slot moves the draft there)
  // and Escape or Close asks before dropping it.
  const dirty = Boolean(name.trim() || description.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const requestClose = useCallback(async () => {
    if (dirtyRef.current && !(await confirm(discardConfirmRequest(t("routineEditor.discard"))))) return;
    onCloseRef.current();
  }, [confirm]);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || dialogRef.current?.contains(target) || target.closest?.("[data-anchored-popover], [data-tour-card]")) return;
      if (!dirtyRef.current) onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [requestClose]);

  useLayoutEffect(() => {
    if (!seed.anchor) {
      setDialogPosition(null);
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const place = () => {
      const gap = 12;
      const rect = dialog.getBoundingClientRect();
      let left = seed.anchor!.x + gap;
      let top = seed.anchor!.y + gap;
      // A day column anchors by both edges: the other side when this one has no room.
      if (left + rect.width > window.innerWidth - gap) left = (seed.anchor!.left ?? seed.anchor!.x) - rect.width - gap;
      if (top + rect.height > window.innerHeight - gap) top = seed.anchor!.y - rect.height - gap;
      setDialogPosition({
        left: Math.max(gap, Math.min(left, window.innerWidth - rect.width - gap)),
        top: Math.max(gap, Math.min(top, window.innerHeight - rect.height - gap)),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [kind, seed.anchor]);

  const save = async () => {
    setWorking(true);
    setError("");
    // #1753: same lost-answer guard as the full editor (#1522).
    const knownRoutineIds = new Set(state.routines.map((routine) => routine.id));
    const creating = (kind === "routine" || routinesOnly)
      ? { name, botId: botIds[0] ?? "", target: "bot" as const }
      : null;
    try {
      if (creating) {
        const response = await api("/api/routines", {
          method: "POST",
          body: JSON.stringify({
            name,
            prompt: description,
            botId: botIds[0],
            runOn: "maus",
            enabled: true,
            schedule: seed.limitReset
              ? { type: "limit_reset", engine: seed.limitReset.engine, repeat: "once" }
              : { type: "once", at: seed.at },
            durationMinutes,
            attachments: [],
          } satisfies RoutineInput),
        });
        onSavedRoutine(response.routine);
      } else {
        const response = await api("/api/calendar-calls", {
          method: "POST",
          body: JSON.stringify({
            name,
            description,
            botIds,
            schedule: { type: "once", at: seed.at },
            durationMinutes,
          } satisfies CalendarCallInput),
        });
        onSavedCall(response.call);
      }
      onClose();
    } catch (cause) {
      if (creating) {
        const created = await recoverCreatedRoutineAfterLostAnswer(
          cause,
          knownRoutineIds,
          creating,
          () => api("/api/routines") as Promise<{ routines?: Routine[] }>,
        );
        if (created) {
          onSavedRoutine(created);
          onClose();
          return;
        }
      }
      setError(createAnswerErrorMessage(cause, t("routineCalendar.saveAnswerLost")));
    } finally {
      setWorking(false);
    }
  };

  const valid = Boolean(name.trim() && botIds.length && (kind === "call" || description.trim()));
  return (
    <div ref={dialogRef} role="dialog" aria-modal="false" aria-label={t("routineCalendar.quickCreate")} data-quick-create="" data-quick-create-anchored={seed.anchor ? "" : undefined} style={dialogPosition ?? undefined} className={cn("animate-pop-in fixed z-50 max-h-[calc(100vh-24px)] w-[min(400px,calc(100vw-24px))] overflow-y-auto rounded-[14px] border border-popover-hairline popover-surface bg-popover shadow-xl", !dialogPosition && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2")}>
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <div className="text-[12px] font-medium text-popover-ink-secondary">{t("routineCalendar.newCalendarEvent")}</div>
        <button type="button" onClick={requestClose} className="rounded-full p-1.5 text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink" aria-label={t("common.close")}><X size={16} /></button>
      </div>
      <div className="space-y-3 p-4">
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("routineCalendar.addTitle")} onKeyDown={(event) => { if (event.key === "Enter" && valid) void save(); }} className="w-full border-b border-hairline/60 bg-transparent pb-2 text-[18px] font-medium text-ink outline-none placeholder:text-ink-secondary focus:border-border-strong" />
        {!routinesOnly && !seed.limitReset && (
          <div className="flex items-center gap-1 border-b border-hairline/35 pb-2">
            <button type="button" onClick={() => { setKind("routine"); setBotIds((ids) => ids.slice(0, 1)); }} className={cn("rounded-lg px-3 py-1.5 text-[12px] font-medium", kind === "routine" ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised hover:text-ink")}>{t("botPanel.coding.kind.routine")}</button>
            <button type="button" onClick={() => setKind("call")} className={cn("rounded-lg px-3 py-1.5 text-[12px] font-medium", kind === "call" ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised hover:text-ink")}>{t("routineCalendar.kindCall")}</button>
          </div>
        )}
        <div className="flex items-start gap-3 text-[13px] text-ink">
          <Clock3 size={16} className="mt-0.5 shrink-0 text-ink-secondary" />
          {seed.limitReset
            ? <div data-testid="quick-limit-reset">{limitResetWhen({ engine: seed.limitReset.engine, repeat: "once" })}</div>
            : <div><div>{niceDate(seed.at)}</div><div className="mt-0.5 text-ink-secondary">{niceTime(seed.at)}{kind === "call" ? ` - ${niceTime(seed.at + durationMinutes * 60_000)}` : ""}</div></div>}
        </div>
        <div className="flex items-start gap-3">
          <UserRoundPlus size={16} className="mt-2.5 shrink-0 text-ink-secondary" />
          {bots.length === 0 ? viewerCanCreateBots(state.config) && (
            <button type="button" onClick={() => { dispatch({ type: "openBotWizard" }); onClose(); }} className="min-w-0 flex-1 rounded-xl border border-dashed border-accent/45 bg-accent/[0.06] px-3 py-3 text-left hover:bg-accent/10">
              <div className="text-[12px] font-medium text-accent">{t("onboarding.firstRun.bot.title")}</div>
              <div className="mt-0.5 text-[11px] text-ink-secondary">{t("routineCalendar.thenComeBack")}</div>
            </button>
          ) : kind === "routine" ? (
            <div className="min-w-0 flex-1">
              <PillSelect
                ariaLabel={t("routineCalendar.assignBot")}
                value={botIds[0] ?? ""}
                onChange={(id) => selectBots(id ? [id] : [])}
                options={[{ value: "", label: t("routineCalendar.assignBot") }, ...bots.map((bot) => ({ value: bot.id, label: bot.name }))]}
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1"><BotPicker bots={bots} selected={botIds} multiple onChange={selectBots} /></div>
          )}
        </div>
        <div className="flex items-start gap-3">
          <FileText size={16} className="mt-2.5 shrink-0 text-ink-secondary" />
          <MarkdownEditor compact expandable value={description} onChange={setDescription} minHeight={72} maxHeight={220} showCount={false} dataField="routine-instructions-quick" className="min-w-0 flex-1" ariaLabel={kind === "routine" ? t("routineCalendar.botDo") : t("routineCalendar.descOptional")} placeholder={kind === "routine" ? t("routineCalendar.botDo") : t("routineCalendar.descOptional")} />
        </div>
        {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-hairline/40 px-4 py-3">
        <button onClick={() => onMore({ ...seed, kind, botIds, name, description, durationMinutes })} title={t("routineCalendar.moreOptionsTitle")} className="rounded-lg px-3 py-2 text-[12px] font-medium text-accent hover:bg-accent/10">{t("routines.editor.more")}</button>
        <button onClick={save} disabled={!valid || working} className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-40">{working && <Loader2 size={13} className="animate-spin" />}{t("common.save")}</button>
      </div>
    </div>
  );
}

const SINGLE_COLUMN = { column: 0, columns: 1 };
const viewerPrincipalOf = (state: AppState) => state.config?.viewer?.principalId?.toLowerCase();

/** One card of the grid. Memoized (2026-11-02): it renders when its own item,
 * its bots or the minute it turns past changes, never on another card's
 * live frame. */
const CalendarEventCard = memo(function CalendarEventCard({
  item,
  bots,
  groups,
  compact,
  column,
  columns,
  reserveRight = 0,
  past,
  onOpen,
  onResize,
}: {
  item: CalendarEventItem;
  bots: Bot[];
  groups: Group[];
  compact: boolean;
  /** Its column among the overlapping cards (numbers, so an equal layout
   * computed again does not render the card). */
  column: number;
  columns: number;
  /** Room kept free for the "+N" marker of a crowded half hour. */
  reserveRight?: number;
  /** The occurrence is in the past (a plan there no longer moves). */
  past: boolean;
  onOpen: (item: CalendarEventItem) => void;
  onResize: (item: CalendarEventItem, minutes: number) => void;
}) {
  const isCall = item.kind === "call";
  const routine = item.kind === "routine" ? item.routine : null;
  const run = item.kind === "routine" ? item.run : null;
  const isRoomGoal = !isCall && (run?.target ?? routine?.target) === "room-goal";
  const room = isRoomGoal
    ? groups.find((candidate) => candidate.id === (run?.groupId ?? routine?.groupId))
    : undefined;
  const ownerIds = isCall ? item.call.botIds : [run?.botId ?? routine?.botId ?? ""];
  const ownerBots = ownerIds.flatMap((id) => bots.find((bot) => bot.id === id) ?? []);
  const primary = ownerBots[0];
  const name = isCall ? item.call.name : run?.routineName ?? routine?.name ?? t("botPanel.coding.kind.routine");
  // #1506: a past run of a routine that was deleted since.
  const deletedRoutine = !isCall && !routine && Boolean(run);
  const color = isCall ? "#6d7cff" : primary ? (mausInk(primary.color) ?? "#666") : "#666";
  // Someone else's routine (a wider scope): its owner, and no drag unless
  // the server says this person may edit it.
  const confirm = useConfirm();
  const viewerId = useStoreSelector(viewerPrincipalOf);
  const otherOwner = routine?.owner && routine.owner.id && routine.owner.id.toLowerCase() !== viewerId ? routine.owner : null;
  const [previewDuration, setPreviewDuration] = useState(item.durationMinutes);
  useEffect(() => setPreviewDuration(item.durationMinutes), [item.durationMinutes]);
  const status = run?.status;
  const statusLabel = run ? routineRunLabel(run) : undefined;
  const canMove = isCall || Boolean(routine && !run && !past && routine.schedule.type !== "cron" && routine.canEdit !== false);
  const schedule = isCall ? item.call.schedule : routine?.schedule;
  const recurring = Boolean(schedule && schedule.type !== "once");
  const intervalCadence = schedule?.type === "interval" ? intervalLabel(schedule.everyMinutes) : null;
  const metaLine = `${niceTime(item.at)} · ${deletedRoutine ? `${t("routineCalendar.deletedRoutine")}${statusLabel ? ` · ${statusLabel}` : ""}` : intervalCadence ?? (isCall ? (ownerBots.length === 1 ? t("canvas.botCountOne") : t("canvas.botCount", { count: ownerBots.length })) : isRoomGoal ? `${t("routineCalendar.teamGoalIn", { name: room?.name ?? t("routines.drawer.group") })}${statusLabel ? ` · ${statusLabel}` : ""}` : statusLabel ?? primary?.name ?? routine?.bot?.name)}`;
  const titleOnly = compact || previewDuration < 30;
  const cardTitle = [
    routine?.schedule.type === "cron" ? t("routineCalendar.openRoutineForCron") : deletedRoutine ? `${name} · ${t("routineCalendar.deletedRoutine")}` : undefined,
    titleOnly ? metaLine : undefined,
  ].filter(Boolean).join("\n") || undefined;

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startDuration = previewDuration;
    let next = startDuration;
    const move = (pointer: PointerEvent) => {
      next = Math.max(CALENDAR_SLOT_MINUTES, Math.min(240, Math.round((startDuration + ((pointer.clientY - startY) / HOUR_HEIGHT) * 60) / CALENDAR_SLOT_MINUTES) * CALENDAR_SLOT_MINUTES));
      setPreviewDuration(next);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (next === item.durationMinutes) return;
      void (async () => {
        if (recurring && !(await confirm({
          title: t("routineCalendar.resizeSeries"),
          confirmLabel: t("common.confirm"),
          tone: "neutral",
        }))) {
          setPreviewDuration(item.durationMinutes);
          return;
        }
        onResize(item, next);
      })();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
  };

  return (
    <button
      data-event-card
      type="button"
      draggable={canMove}
      title={cardTitle}
      data-deleted-routine={deletedRoutine || undefined}
      onDragStart={(event) => {
        if (!canMove) return event.preventDefault();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(EVENT_DRAG_TYPE, JSON.stringify({ kind: item.kind, id: isCall ? item.call.id : routine!.id, at: item.at }));
      }}
      onClick={(event) => { event.stopPropagation(); onOpen(item); }}
      className={cn("group absolute z-10 overflow-hidden rounded-md border text-left shadow-sm transition hover:z-20 hover:brightness-110 focus:z-20 focus:outline-none focus:ring-2 focus:ring-accent", previewDuration < 30 ? "px-1.5 py-0" : "px-2 py-1.5", (status === "cancelled" || deletedRoutine) && "opacity-55", deletedRoutine && "border-dashed", (status === "failed" || status === "missed") && "border-danger/60")}
      style={{
        left: `calc(${(column / columns) * 100}% + 2px)`,
        width: `calc(${100 / columns}% - ${4 + reserveRight}px)`,
        top: `${((new Date(item.at).getHours() * 60 + new Date(item.at).getMinutes()) / 60) * HOUR_HEIGHT}px`,
        height: `${Math.max(16, (previewDuration / 60) * HOUR_HEIGHT)}px`,
        background: `linear-gradient(110deg, color-mix(in srgb, ${color} 58%, #242424), color-mix(in srgb, ${color} 28%, #181818))`,
        borderColor: `color-mix(in srgb, ${color} 70%, transparent)`,
      }}
    >
      <div className="flex min-w-0 items-start gap-1.5 text-white">
        {previewDuration >= 30 && (isCall ? <Video size={compact ? 13 : 15} className="mt-0.5 shrink-0" /> : primary ? <BotAvatar bot={primary} state={status ? statusState(status) : "idle"} size={compact ? 16 : 26} animated={status === "running" || status === "waiting"} /> : null)}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[11px] font-semibold", previewDuration < 30 ? "leading-none" : "leading-tight")}>{name}</div>
          {!titleOnly && <div className="mt-0.5 truncate text-[11px] text-white/75">{metaLine}</div>}
          {!titleOnly && previewDuration >= 45 && otherOwner && <RoutineOwnerBadge owner={otherOwner} size={12} className="mt-0.5 max-w-full text-[11px] text-white/80" />}
        </div>
        {!titleOnly && ownerBots.length > 1 && <span className="rounded bg-black/20 px-1 py-0.5 text-[11px]">+{ownerBots.length - 1}</span>}
      </div>
      {isCall && <div onPointerDown={beginResize} className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-full opacity-0 transition-opacity group-hover:opacity-100" aria-label={t("routineCalendar.resizeEvent")}><div className="mx-auto mt-0.5 h-0.5 w-5 rounded-full bg-white/55" /></div>}
    </button>
  );
});

/** The current minute, for the now line and what turns past: one timer per
 * grid, aligned on the minute (the memoized grid no longer renders on every
 * store frame, which used to move the line by accident). */
function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => { setNow(Date.now()); schedule(); }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

const HOUR_LABEL_OPTIONS: Intl.DateTimeFormatOptions = { hour: "numeric" };
const NO_MARKERS: ResetMarker[] = [];

type DayLayout = {
  start: number;
  shown: CalendarEventItem[];
  overflow: Array<{ id: string; at: number; items: CalendarEventItem[] }>;
  layouts: Map<string, { column: number; columns: number }>;
  crowded: Set<string>;
};

/** Each visible day's cards, "+N" groups and columns, in one pass over the
 * items (sorted once, bucketed by day): computed when the items or the range
 * change, not on every render of the grid. */
function layoutDays(items: readonly CalendarEventItem[], starts: readonly number[]): DayLayout[] {
  const byDay = new Map<number, CalendarEventItem[]>(starts.map((start) => [start, []]));
  for (const item of items) byDay.get(startOfDay(item.at))?.push(item);
  return starts.map((start) => {
    const { shown, overflow } = groupCalendarSlots(byDay.get(start) ?? []);
    return { start, shown, overflow, layouts: packCalendarCollisions(shown), crowded: new Set(overflow.map((group) => group.id.slice("more-".length))) };
  });
}

const CalendarGrid = memo(function CalendarGrid({
  anchor,
  days,
  items,
  bots,
  groups,
  onOpen,
  onCreate,
  onMove,
  onResize,
  markers,
  onDropOnReset,
  pending,
}: {
  anchor: number;
  days: number;
  items: CalendarEventItem[];
  bots: Bot[];
  groups: Group[];
  onOpen: (item: CalendarEventItem) => void;
  onCreate: (seed: EventSeed) => void;
  onMove: (item: { kind: EventKind; id: string; at: number }, nextAt: number) => void;
  onResize: (item: CalendarEventItem, duration: number) => void;
  markers?: ResetMarker[];
  onDropOnReset?: (drop: ResetDrop, marker: ResetMarker) => void;
  /** The slot quick create is open on: it stays marked while the popover is up. */
  pending?: { at: number; durationMinutes: number; kind: EventKind } | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ day: number; start: number; end: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ day: number; at: number } | null>(null);
  // A bot dragged from anywhere (the left sidebar): the whole grid shows it
  // takes the drop before the pointer reaches it.
  const [botDrag, setBotDrag] = useState<{ name: string } | null>(null);
  // The "+N" marker of a crowded half hour: which one is open.
  const [moreOpen, setMoreOpen] = useState<string | null>(null);
  // Its list is drawn on <body> (AnchoredPopover), against the open marker,
  // so the scrolling grid never cuts it; it carries [data-slot-more] too.
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(null); };
    document.addEventListener("keydown", onKey);
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement | null)?.closest?.("[data-slot-more]")) setMoreOpen(null); };
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", onKey); };
  }, [moreOpen]);
  const minuteNow = useMinuteNow();
  const today = startOfDay(minuteNow);
  const starts = useMemo(() => Array.from({ length: days }, (_, index) => addDays(anchor, index)), [anchor, days]);
  const dayLayouts = useMemo(() => layoutDays(items, starts), [items, starts]);
  const weekdayNames = dayNames();
  const hourLabels = useMemo(() => {
    const format = cachedDateFormat(HOUR_LABEL_OPTIONS, activeLocale());
    return Array.from({ length: 24 }, (_, hour) => hour === 0 ? "" : format.format(new Date(2000, 0, 1, hour)));
  }, []);
  const minDayWidth = days === 7 ? 88 : days === 3 ? 180 : 340;
  const gridTemplateColumns = `64px repeat(${days}, minmax(${minDayWidth}px, 1fr))`;
  const minWidth = 64 + days * minDayWidth;

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const now = new Date();
    const hour = starts.includes(today) ? Math.max(0, now.getHours() - 2) : 7;
    viewport.scrollTo({ top: hour * HOUR_HEIGHT });
  }, [days]);

  // The bots read when a drag starts, so the listeners stay put while the
  // bots' live frames arrive.
  const botsRef = useRef(bots);
  botsRef.current = bots;
  useEffect(() => {
    const start = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer?.types.includes(BOT_DRAG_TYPE)) return;
      const botId = transfer.getData(BOT_DRAG_TYPE);
      setBotDrag({ name: botsRef.current.find((bot) => bot.id === botId)?.name ?? "" });
    };
    const stop = () => { setBotDrag(null); setDragPreview(null); };
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop);
    };
  }, []);

  const beginSelection = (event: ReactPointerEvent<HTMLDivElement>, day: number) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-event-card]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = slotAt(day, event.clientY, rect.top, HOUR_HEIGHT);
    let end = start + 30 * 60_000;
    // 2026-11-03 (JC): a plain click on the grid never opens the create
    // dialog; only a drag over the slots does (or a right-click, below).
    const startY = event.clientY;
    let dragged = false;
    const move = (pointer: PointerEvent) => {
      if (!dragged && Math.abs(pointer.clientY - startY) < 6) return;
      dragged = true;
      const current = slotAt(day, pointer.clientY, rect.top, HOUR_HEIGHT);
      end = Math.max(start + CALENDAR_SLOT_MINUTES * 60_000, current + CALENDAR_SLOT_MINUTES * 60_000);
      setSelection({ day, start, end });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      setSelection(null);
      if (!dragged) return;
      // Beside the day's column at the slot's top, so the marked slot stays in view.
      const slotTop = rect.top + ((new Date(start).getHours() * 60 + new Date(start).getMinutes()) / 60) * HOUR_HEIGHT;
      onCreate({ kind: "routine", at: start, durationMinutes: Math.max(CALENDAR_SLOT_MINUTES, Math.round((end - start) / 60_000)), botIds: [], anchor: { x: rect.right, y: slotTop, left: rect.left } });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
  };

  const createFromMenu = (event: ReactMouseEvent<HTMLDivElement>, day: number) => {
    if ((event.target as HTMLElement).closest("[data-event-card]")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const at = slotAt(day, event.clientY, rect.top, HOUR_HEIGHT);
    const slotTop = rect.top + ((new Date(at).getHours() * 60 + new Date(at).getMinutes()) / 60) * HOUR_HEIGHT;
    onCreate({ kind: "routine", at, durationMinutes: 30, botIds: [], anchor: { x: rect.right, y: slotTop, left: rect.left } });
  };

  const drop = (event: ReactDragEvent<HTMLDivElement>, day: number) => {
    event.preventDefault();
    setDragPreview(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const at = slotAt(day, event.clientY, rect.top, HOUR_HEIGHT);
    const botId = event.dataTransfer.getData(BOT_DRAG_TYPE);
    if (botId) return onCreate({ kind: "routine", at, durationMinutes: 30, botIds: [botId], anchor: { x: event.clientX, y: event.clientY } });
    const raw = event.dataTransfer.getData(EVENT_DRAG_TYPE);
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as { kind: EventKind; id: string; at: number };
      onMove(item, at);
    } catch {
      // Ignore drags from another application.
    }
  };

  const previewDrop = (event: ReactDragEvent<HTMLDivElement>, day: number) => {
    if (!event.dataTransfer.types.includes(BOT_DRAG_TYPE) && !event.dataTransfer.types.includes(EVENT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(EVENT_DRAG_TYPE) ? "move" : "copy";
    const rect = event.currentTarget.getBoundingClientRect();
    const at = slotAt(day, event.clientY, rect.top, HOUR_HEIGHT);
    setDragPreview((current) => current?.day === day && current.at === at ? current : { day, at });
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
    {botDrag && (
      <div data-calendar-drop-target className="pointer-events-none absolute inset-1 z-40 rounded-lg border-2 border-dashed border-accent/70">
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink shadow-md">
          {botDrag.name ? t("routines.upcoming.dropBot", { name: botDrag.name }) : t("routines.upcoming.drop")}
        </div>
      </div>
    )}
    <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-auto border-l border-t border-hairline/40 bg-app", botDrag && "bg-accent/[0.03]")}>
      <div className="sticky top-0 z-30 grid bg-app/95 backdrop-blur" style={{ gridTemplateColumns, minWidth }}>
        <div className="border-b border-r border-hairline/40 px-2 py-3 text-center text-[12px] font-medium text-ink-secondary">{formatGmtOffset(-new Date(anchor).getTimezoneOffset())}</div>
        {starts.map((start) => {
          const date = new Date(start);
          const isToday = start === today;
          return <div key={start} role="columnheader" className={cn("border-b border-r border-hairline/40 px-2 py-2 text-center last:border-r-0", isToday && "bg-accent/[0.035]")}><div className={cn("text-[11px] font-medium", isToday ? "text-accent" : "text-ink-secondary")}>{weekdayNames[date.getDay()]}</div><div className={cn("mx-auto mt-1 flex size-8 items-center justify-center rounded-full text-[15px] font-medium", isToday ? "bg-accent text-accent-ink" : "text-ink")}>{date.getDate()}</div></div>;
        })}
      </div>
      <div role="grid" aria-label={t("routineCalendar.calendarAria")} onDragEnd={() => setDragPreview(null)} className="relative grid" style={{ height: HOUR_HEIGHT * 24, gridTemplateColumns, minWidth }}>
        <div className="relative border-r border-hairline/40">
          {hourLabels.map((label, hour) => <div key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-tertiary" style={{ top: hour * HOUR_HEIGHT }}>{label}</div>)}
        </div>
        {dayLayouts.map(({ start, shown: dayItems, overflow, layouts: collisionLayouts, crowded }) => {
          const now = new Date(minuteNow);
          const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
          const selected = selection?.day === start ? selection : null;
          const preview = dragPreview?.day === start ? dragPreview : null;
          return (
            <div key={start} role="gridcell" aria-label={t("routineCalendar.dayCalendar", { date: niceDate(start) })} onPointerDown={(event) => beginSelection(event, start)} onContextMenu={(event) => createFromMenu(event, start)} onDragOver={(event) => previewDrop(event, start)} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragPreview(null); }} onDrop={(event) => drop(event, start)} className={cn("relative border-r border-hairline/40 last:border-r-0", start === today && "bg-accent/[0.025]")}>
              {Array.from({ length: 48 }, (_, half) => <div key={half} className={cn("pointer-events-none absolute inset-x-0 border-t", half % 2 === 0 ? "border-hairline/30" : "border-hairline/10")} style={{ top: (half / 2) * HOUR_HEIGHT }} />)}
              {start === today && <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowTop }}><span className="-ml-1 size-2 rounded-full bg-danger" /><span className="h-px flex-1 bg-danger/80" /></div>}
              {selected && <div className="pointer-events-none absolute inset-x-1 z-10 rounded-md border border-accent/70 bg-accent/20" style={{ top: ((new Date(selected.start).getHours() * 60 + new Date(selected.start).getMinutes()) / 60) * HOUR_HEIGHT, height: Math.max(16, ((selected.end - selected.start) / 3_600_000) * HOUR_HEIGHT) }} />}
              {!selected && pending && startOfDay(pending.at) === start && <div data-calendar-pending="" className="pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded-md border border-accent/70 bg-accent/15 px-2 py-1 text-[12px] font-medium text-accent-text" style={{ top: ((new Date(pending.at).getHours() * 60 + new Date(pending.at).getMinutes()) / 60) * HOUR_HEIGHT, height: Math.max(16, (pending.durationMinutes / 60) * HOUR_HEIGHT) }}>{pending.kind === "call" ? t("routineCalendar.newEvent") : t("routineEditor.titleNew")}</div>}
              {preview && <div className="pointer-events-none absolute inset-x-1 z-20 rounded-md border border-accent/80 bg-accent/25 shadow-sm" style={{ top: ((new Date(preview.at).getHours() * 60 + new Date(preview.at).getMinutes()) / 60) * HOUR_HEIGHT, height: HOUR_HEIGHT / 2 }}><div className="px-2 py-1 text-[11px] font-medium text-accent">{niceTime(preview.at)}</div></div>}
              {dayItems.map((item) => <CalendarEventCard key={item.id} item={item} bots={bots} groups={groups} compact={days === 7} column={(collisionLayouts.get(item.id) ?? SINGLE_COLUMN).column} columns={(collisionLayouts.get(item.id) ?? SINGLE_COLUMN).columns} reserveRight={crowded.has(item.id) ? 34 : 0} past={item.at < minuteNow} onOpen={onOpen} onResize={onResize} />)}
              {(markers ?? NO_MARKERS).filter((marker) => startOfDay(marker.at) === start).map((marker) => (
                <LimitResetMarker
                  key={marker.engine}
                  marker={marker}
                  hourHeight={HOUR_HEIGHT}
                  onDrop={onDropOnReset ? (drop) => onDropOnReset(drop, marker) : undefined}
                />
              ))}
              {overflow.map((group) => {
                const layout = collisionLayouts.get(group.id.slice("more-".length)) ?? { column: 0, columns: 1 };
                const top = ((new Date(group.at).getHours() * 60 + new Date(group.at).getMinutes()) / 60) * HOUR_HEIGHT;
                return (
                  <div key={group.id} data-slot-more className={cn("absolute", moreOpen === group.id ? "z-40" : "z-20")} style={{ left: `calc(${((layout.column + 1) / layout.columns) * 100}% - 34px)`, width: 30, top, height: Math.max(16, HOUR_HEIGHT / 2) }}>
                    <button ref={moreOpen === group.id ? moreButtonRef : undefined} type="button" aria-expanded={moreOpen === group.id} aria-label={t("routineCalendar.moreAt", { count: group.items.length, time: niceTime(group.at) })} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMoreOpen((current) => current === group.id ? null : group.id); }} className="h-full w-full rounded-md border border-hairline/60 bg-raised px-0.5 text-center text-[11px] font-semibold text-ink-secondary hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent">+{group.items.length}</button>
                    {moreOpen === group.id && (
                      <AnchoredPopover anchorRef={moreButtonRef} role="menu" data-slot-more="" maxHeight={256} onPointerDown={(event) => event.stopPropagation()} className="w-56 overflow-y-auto rounded-lg border border-border bg-elevated p-1 shadow-lg">
                        {group.items.map((entry) => (
                          <button key={entry.id} type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setMoreOpen(null); onOpen(entry); }} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12px] text-ink hover:bg-raised">
                            <span className="text-ink-secondary">{niceTime(entry.at)}</span> {entry.kind === "call" ? entry.call.name : entry.routine?.name ?? t("botPanel.coding.kind.routine")}
                          </button>
                        ))}
                      </AnchoredPopover>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
});

export function EventDetails({
  item,
  bots,
  onClose,
  onEdit,
  onDuplicate,
  onCallChanged,
  onOpenRoom,
}: {
  item: CalendarEventItem;
  bots: Bot[];
  onClose: () => void;
  onEdit: () => void;
  /** 2026-10-29: the editor opened on a copy of this routine. */
  onDuplicate?: (routine: Routine) => void;
  onCallChanged: (id: string | null) => void;
  onOpenRoom: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { state, dispatch } = useStore();
  const [working, setWorking] = useState(false);
  const runNowPending = useRef(false);
  const [starting, setStarting] = useState(false);
  // undefined preserves the selected historical run; null clears it for a new attempt.
  const [submittedRun, setSubmittedRun] = useState<RoutineRun | null | undefined>(undefined);
  // 2026-10-29: a routine's page lists its runs; one opens in place, and
  // Back returns. A run opened from the logs reaches its routine's page the
  // same way, in the other direction.
  const [openedRun, setOpenedRun] = useState<RoutineRun | null>(null);
  const [showRoutinePage, setShowRoutinePage] = useState(false);
  const [error, setError] = useState("");
  const isCall = item.kind === "call";
  const routine = item.kind === "routine" ? item.routine : null;
  const liveRun = (candidate: RoutineRun | null | undefined) => candidate ? state.routineRuns.find((entry) => entry.id === candidate.id) ?? candidate : candidate ?? null;
  const run = submittedRun === undefined
    ? openedRun ? liveRun(openedRun) : showRoutinePage ? null : item.kind === "routine" ? item.run : null
    : liveRun(submittedRun);
  const call = item.kind === "call" ? item.call : null;
  const isRoomGoal = !isCall && (run?.target ?? routine?.target) === "room-goal";
  const goalGroupId = isRoomGoal ? run?.groupId ?? routine?.groupId : undefined;
  const goalGroup = state.groups.find((group) => group.id === goalGroupId);
  const botIds = call?.botIds ?? [run?.botId ?? routine?.botId ?? ""];
  const invited = botIds.flatMap((id) => bots.find((bot) => bot.id === id) ?? []);
  const primary = invited[0];
  // A routine seen through a wider scope (2026-10-09): its bot may not be
  // one of this person's, and only what the server allows can be changed.
  const viewerPrincipal = state.config?.viewer?.principalId?.toLowerCase();
  const editable = !routine || routine.canEdit !== false;
  const title = call?.name ?? run?.routineName ?? routine?.name ?? t("botPanel.coding.kind.routine");
  const description = call?.description ?? "";
  const attachments = call?.attachments ?? [];
  const roomId = call?.botIds.length === 1 ? primary?.id : undefined;
  const showingRun = Boolean(run) && !isCall;
  const canGoBack = !isCall && ((openedRun && routine) || (showRoutinePage && item.kind === "routine" && item.run));
  const goBack = () => { setOpenedRun(null); setShowRoutinePage(false); setSubmittedRun(undefined); };

  const invoke = async (path: string, method = "POST", body?: unknown) => {
    setWorking(true);
    setError("");
    try {
      const response = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.routine) dispatch({ type: "routinePatched", routine: response.routine });
      if (response.run) dispatch({ type: "routineRunPatched", run: response.run });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setWorking(false);
    }
  };

  const routineInFlight = Boolean(routine && routineRunInFlight(state.routineRuns, routine.id));
  const runRoutineNow = () => {
    if (!routine || working || routineInFlight || runNowPending.current) return;
    runNowPending.current = true;
    setStarting(true);
    setOpenedRun(null);
    setShowRoutinePage(false);
    setSubmittedRun(null);
    setWorking(true);
    setError("");
    // The store flushes pending model and approval-level changes before it
    // starts the run. Keep this button pending through that barrier and the
    // POST so a double-click cannot create two routine runs.
    dispatch({
      type: "runRoutine",
      routineId: routine.id,
      // Prefer subsequent SSE records over this response, which may already be stale.
      onStarted: setSubmittedRun,
      onError: (cause) => setError(readableError(cause)),
      onSettled: () => {
        runNowPending.current = false;
        setStarting(false);
        setWorking(false);
      },
    });
  };

  const joinRoom = async () => {
    if (!call) return;
    setWorking(true);
    setError("");
    try {
      const { group: created } = await api(`/api/calendar-calls/${call.id}/room`, { method: "POST" });
      dispatch({ type: "groupPatched", group: created });
      onOpenRoom(created.id);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setWorking(false);
    }
  };

  const deleteEvent = async () => {
    if (!(await confirm({
      title: t("routineCalendar.deleteConfirm", { title }),
      confirmLabel: t("common.delete"),
      tone: "danger",
    }))) return;
    if (call) {
      // #1754: a refused DELETE must surface in the dialog like joinRoom;
      // never leave the dialog open on an unhandled rejection.
      setWorking(true);
      setError("");
      try {
        await api(`/api/calendar-calls/${call.id}`, { method: "DELETE" });
        onCallChanged(call.id);
        onClose();
      } catch (cause) {
        setError(readableError(cause));
      } finally {
        setWorking(false);
      }
      return;
    }
    if (routine) {
      dispatch({ type: "deleteRoutine", routineId: routine.id });
    }
    onClose();
  };
  const toggleRoutine = () => { if (routine) void invoke(`/api/routines/${routine.id}`, "PATCH", { enabled: !routine.enabled }); };
  const openLogs = () => {
    const routineId = routine?.id ?? run?.routineId;
    dispatch({ type: "showRoutines", section: "logs", ...(routineId ? { routineId } : {}), botId: routine?.botId ?? run?.botId });
    onClose();
  };

  // 2026-11-01 (no modals): a routine, its run and a calendar call all open
  // in the right detail panel (DetailPanel.tsx), the calendar usable beside it.
  if (showingRun && run) {
    const exchange = (
      <RoutineRunExchange
        run={run}
        routine={routine}
        bots={state.bots}
        working={working || starting}
        onClose={canGoBack ? goBack : onClose}
        onStop={() => void invoke(`/api/routine-runs/${run.id}/cancel`)}
        onRunAgain={runRoutineNow}
        onLogs={openLogs}
        onOpenConfiguration={onEdit}
        onOpenRoom={onOpenRoom}
      />
    );
    // Chat column host present: portal into it like Melonie <-> Katarina.
    // Automations alone: the detail panel holds it.
    if (getExchangeColumnHost()) return exchange;
    return <DetailPanel bare label={t("routineCalendar.eventDetails")} onClose={onClose} data-event-details="run">{exchange}</DetailPanel>;
  }

  const leading = canGoBack
    ? <button type="button" data-event-back onClick={goBack} aria-label={t("routineRun.back")} title={t("routineRun.back")} className="-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"><ChevronLeft size={16} /></button>
    : <span aria-hidden="true" className={cn("size-3 shrink-0 rounded", isCall ? "bg-[#6d7cff]" : "bg-accent")} />;
  const heading = routine && editable
    ? <div className="flex min-w-0"><RoutineTitle name={routine.name} editable onRename={(name) => { dispatch({ type: "routinePatched", routine: { ...routine, name } }); dispatch({ type: "updateRoutine", routineId: routine.id, patch: { name } }); }} className="truncate text-[16px] font-medium text-ink" /></div>
    : <h2 className="truncate text-[16px] font-medium text-ink">{title}</h2>;
  const callFooter = isCall ? <>
    {roomId && <button onClick={() => onOpenRoom(roomId)} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink hover:brightness-110"><ExternalLink size={13} />{t("routineCalendar.joinGroup")}</button>}
    {call && call.botIds.length > 1 && <button onClick={joinRoom} disabled={working} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50"><ExternalLink size={13} />{t("routineCalendar.joinGroup")}</button>}
    <div className="ml-auto flex items-center gap-1">
      <button onClick={onEdit} className="rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">{t("routines.edit")}</button>
      <button onClick={() => void deleteEvent()} disabled={working} className="rounded-lg p-2 text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40" title={t("common.delete")} aria-label={t("common.delete")}><Trash2 size={15} /></button>
    </div>
  </> : undefined;

  return (
    <DetailPanel
      label={t("routineCalendar.eventDetails")}
      leading={leading}
      title={heading}
      onClose={onClose}
      footer={callFooter}
      bodyClassName={isCall ? undefined : "flex flex-col overflow-hidden!"}
      data-event-details={isCall ? "call" : "routine"}
    >
      {isCall ? (
        <div data-event-details-side className="space-y-4 p-4">
          <div>
            <div className="text-[13px] font-medium text-ink">{niceDate(item.at)}</div>
            <div className="mt-1 text-[13px] text-ink-secondary">{niceTime(item.at)} - {niceTime(item.at + item.durationMinutes * 60_000)}</div>
            {call && !scheduleRepeatsEventDate(call.schedule, item.at) && <div className="mt-1 text-[12px] text-ink-secondary">{scheduleLabel(call.schedule)}</div>}
          </div>
          <div className="flex items-start gap-3">
            <UserRoundPlus size={17} className="mt-1 shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ink-secondary">{t("routines.drawer.guests")}</div>
              <div className="mt-2 flex flex-wrap gap-2">{invited.map((bot) => <div key={bot.id} className="flex items-center gap-2 rounded-full bg-inset py-1 pl-1 pr-3"><BotAvatar bot={bot} state="idle" size={24} animated={false} /><span className="text-[12px] text-ink">{bot.name}</span></div>)}</div>
            </div>
          </div>
          {description && <div data-event-details-instructions className="flex items-start gap-3"><FileText size={17} className="mt-1 shrink-0 text-ink-secondary" /><div data-event-details-prose className="min-w-0 max-w-[68ch] whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{description}</div></div>}
          {attachments.length > 0 && <div className="flex items-start gap-3"><Paperclip size={17} className="mt-1 shrink-0 text-ink-secondary" /><div className="min-w-0 flex-1 space-y-2"><AttachmentChips attachments={attachments} />{call && <div className="text-[11px] leading-relaxed text-ink-secondary">{call.botIds.length > 1 ? t("routineCalendar.detailRefsShared") : t("routineCalendar.detailRefsStay")}</div>}</div></div>}
          {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
        </div>
      ) : routine ? (
        <RoutineDetail
          routine={routine}
          runs={state.routineRuns}
          bots={state.bots}
          groups={state.groups}
          viewerPrincipalId={viewerPrincipal ?? null}
          editable={editable}
          canRun={canRunRoutineNow(state.config, routine, primary)}
          inFlight={routineInFlight}
          starting={starting}
          working={working}
          error={error}
          onOpenRun={(opened) => { setSubmittedRun(undefined); setOpenedRun(opened); if (["failed", "missed"].includes(opened.status) && !opened.seenAt && !opened.redacted) dispatch({ type: "markRoutineRunSeen", runId: opened.id }); }}
          onRunNow={runRoutineNow}
          onToggle={toggleRoutine}
          onEdit={onEdit}
          onDuplicate={onDuplicate ? () => onDuplicate(routine) : undefined}
          onDelete={() => void deleteEvent()}
          onLogs={openLogs}
          onOpenGroup={goalGroup ? () => { onOpenRoom(goalGroup.id); onClose(); } : undefined}
          onConfigure={onEdit}
        />
      ) : null}
    </DetailPanel>
  );
}

export function PausedList({
  routines,
  bots,
  groups,
  onClose,
  onEdit,
  onOpenRoom,
}: {
  routines: Routine[];
  bots: Bot[];
  groups: Group[];
  onClose: () => void;
  onEdit: (routine: Routine) => void;
  onOpenRoom: (id: string) => void;
}) {
  const { dispatch } = useStore();
  return (
    <DetailPanel label={t("routineCalendar.pausedTitle")} title={t("routineCalendar.pausedTitle")} closeLabel={t("routines.paused.close")} onClose={onClose} data-paused-list-panel="">
        <p className="px-4 pt-3 text-[12px] text-ink-secondary">{t("routineCalendar.pausedHistory")}</p>
        <div className="space-y-1 p-3">
          {routines.map((routine) => {
            const bot = bots.find((candidate) => candidate.id === routine.botId);
            const room = routine.target === "room-goal"
              ? groups.find((candidate) => candidate.id === routine.groupId)
              : undefined;
            return (
              <div key={routine.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-raised/60">
                {room ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent"><UsersRound size={17} /></span> : bot && <BotAvatar bot={bot} state="sleeping" size={36} animated={false} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{routine.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-secondary">{room ? `${t("routineCalendar.teamGoalIn", { name: room.name })} · ` : ""}{scheduleLabel(routine.schedule)}</div>
                </div>
                {room && <button onClick={() => { onOpenRoom(room.id); onClose(); }} className="rounded-lg px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-inset">{t("routines.drawer.group")}</button>}
                <button onClick={() => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: true } })} className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-[11px] font-medium text-accent">{t("routines.resume")}</button>
                <button onClick={() => onEdit(routine)} className="rounded-lg px-2 py-1.5 text-[11px] text-ink-secondary hover:bg-inset">{t("routines.edit")}</button>
              </div>
            );
          })}
        </div>
    </DetailPanel>
  );
}

/** The moment the editor opens a routine on: its one-time date, its next
 * run, or the next hour. */
export function routineEditorAt(routine: Routine | undefined): number {
  return routine?.schedule.type === "once"
    ? routine.schedule.at
    : routine?.schedule.type === "daily"
      ? atLocalTime(Date.now(), routine.schedule.time)
      : routine?.schedule.type === "interval"
        ? routine.schedule.anchorAt
      : routine?.schedule.type === "cron"
        ? routine.nextRunAt ?? nextHour()
      : nextHour();
}

export function RoutineEditor({
  routine,
  copyOf,
  bots,
  lockedBotId,
  defaultRunOn,
  folder,
  presentation = "modal",
  onClose,
}: {
  routine?: Routine;
  /** 2026-10-29: a new routine prefilled from this one (Duplicate). */
  copyOf?: Routine;
  bots: Bot[];
  lockedBotId?: string;
  defaultRunOn?: RoutineRunOn;
  /** A new routine goes in this folder of its bot (a folder's +). */
  folder?: string;
  /** 2026-11-01: `panel` edits in the side panel (Grok Bot style); `modal` is the legacy centered dialog (calendar calls still use it). */
  presentation?: "modal" | "panel";
  onClose: () => void;
}) {
  const source = routine ?? copyOf;
  const at = routineEditorAt(source);
  return <EventEditor seed={{ kind: "routine", at, durationMinutes: source?.durationMinutes ?? 30, botIds: lockedBotId ? [lockedBotId] : source ? [source.botId] : [], routine, ...(copyOf && !routine ? { copyOf } : {}), ...(folder && !routine ? { folder } : {}) }} bots={bots} lockedBotId={lockedBotId} defaultRunOn={defaultRunOn} presentation={presentation} onClose={onClose} onSavedCall={() => {}} />;
}

/** The slices of the store the Automations page reads (2026-11-02): it
 * renders when one of them changes, not on every store frame (a bot's
 * stream, an unread mark, the sidebar). */
function selectRoutinesPage(state: AppState) {
  return {
    routines: state.routines,
    routineRuns: state.routineRuns,
    bots: state.bots,
    groups: state.groups,
    config: state.config,
    routinesFocus: state.routinesFocus,
    routinesLoadState: state.routinesLoadState,
    webhooks: state.webhooks,
  };
}

const IN_FLIGHT_STATUSES: ReadonlySet<RoutineRunStatus> = new Set(["queued", "running", "waiting"]);
/** The in-flight runs, kept as the same array while that set (ids and
 * statuses) does not change: the upcoming panel reads only these. */
function useInFlightRuns(runs: RoutineRun[]): RoutineRun[] {
  const held = useRef<{ key: string; runs: RoutineRun[] }>({ key: "", runs: [] });
  return useMemo(() => {
    const inFlight = runs.filter((run) => IN_FLIGHT_STATUSES.has(run.status));
    const key = inFlight.map((run) => `${run.id}:${run.routineId}:${run.status}`).join("|");
    if (key !== held.current.key) held.current = { key, runs: inFlight };
    return held.current.runs;
  }, [runs]);
}

/** The latest render's function behind a stable one: a memoized child keeps
 * the same prop while the function reads this render's state. */
function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback((...args: A) => ref.current(...args), []);
}

export const RoutinesPage = memo(function RoutinesPage({ onBack: _onBack, onOpenRoom, embedded = false, fill = false }: { onBack: () => void; onOpenRoom: (id: string) => void; embedded?: boolean; fill?: boolean }) {
  const confirm = useConfirm();
  const state = useStoreSelector(selectRoutinesPage, shallowEqual);
  const dispatch = useStoreDispatch();
  const { capabilities } = useDesktopCapabilities();
  const advanced = useAdvancedMode();
  const routinesOnly = window.ogb?.remoteClient?.active === true;
  const newMenuRef = useRef<HTMLDetailsElement>(null);
  const navMenuRef = useRef<HTMLDetailsElement>(null);
  const filtersMenuRef = useRef<HTMLDetailsElement>(null);
  const { dragProps, noDragStyle, controlsShiftStyle } = useCaptionChrome();
  const [section, setSection] = useState<"calendar" | "logs" | "webhooks">(state.routinesFocus?.section === "logs" || state.routinesFocus?.section === "webhooks" ? state.routinesFocus.section : "calendar");
  const [scheduleView, setScheduleView] = useState<"calendar" | "list">(state.routinesFocus?.view ?? "calendar");
  // Mine, My teams or Everyone and the filters (src/lib/use-routine-scope.ts).
  const scoped = useRoutineScope({ config: state.config, routines: state.routines, runs: state.routineRuns, ignoreStatus: section === "calendar" && scheduleView === "calendar" });
  const [viewDays, setViewDays] = useState<1 | 3 | 7>(7);
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [botFilter, setBotFilterState] = useState(state.routinesFocus?.botId ?? scoped.prefs.botId ?? "all");
  const setBotFilter = (botId: string) => {
    setBotFilterState(botId);
    scoped.setPrefs({ ...scoped.prefs, botId: botId === "all" ? undefined : botId });
  };
  const [routineFilter, setRoutineFilter] = useState<string | undefined>(state.routinesFocus?.routineId);
  const [statusFilter, setStatusFilter] = useState<RoutineRunStatusFilter>(state.routinesFocus?.runStatus ?? "all");
  const [calls, setCalls] = useState<CalendarCall[]>([]);
  const [quick, setQuick] = useState<EventSeed | null>(null);
  const [editor, setEditor] = useState<EventSeed | null>(null);
  const [selected, setSelected] = useState<CalendarEventItem | null>(null);
  const [pausedOpen, setPausedOpen] = useState(false);
  const [botsOpen, setBotsOpen] = useRightRailOpen();
  const [webhookCreateRequest, setWebhookCreateRequest] = useState(0);
  const [error, setError] = useState("");
  const visibleBots = state.bots.filter((bot) => !bot.hidden);
  const rangeStart = viewDays === 7 ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, viewDays);
  const engineLimits = useEngineLimits();
  const markers = useMemo(() => resetMarkers(engineLimits, rangeStart, rangeEnd), [engineLimits, rangeStart, rangeEnd]);

  useEffect(() => {
    const focus = state.routinesFocus;
    setSection(focus?.section === "logs" || focus?.section === "webhooks" ? focus.section : "calendar");
    setScheduleView(focus?.view ?? "calendar");
    setBotFilterState(focus?.botId ?? scoped.prefs.botId ?? "all");
    setRoutineFilter(focus?.routineId);
    setStatusFilter(focus?.runStatus ?? "all");
  }, [state.routinesFocus]);
  const scopedRoutines = scoped.routines;
  const scopedRuns = scoped.runs;
  // The bots the "All bots" select lists: the person's own, or the bots of
  // the routines in a wider scope.
  const botChoices = scoped.scope === "mine" ? visibleBots.map((bot) => ({ id: bot.id, name: bot.name })) : scoped.facets.botChoices;

  const loadCalls = useCallback(async () => {
    try {
      const response = await api("/api/calendar-calls");
      setCalls(response.calls ?? []);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, []);
  useEffect(() => {
    if (!routinesOnly) void loadCalls();
  }, [loadCalls, routinesOnly]);
  useDismissMenus([newMenuRef, navMenuRef, filtersMenuRef]);

  // The plans come from the schedules alone (scheduledRoutineItems ignores
  // the runs): a live run frame never recomputes them.
  // An item that reads the same as the last one drawn (same routine or call
  // record, time and length) stays the same object, so its card skips the
  // render when another routine changes.
  const heldItems = useRef(new Map<string, CalendarEventItem>());
  const items = useMemo<CalendarEventItem[]>(() => {
    const routineItems = scheduledRoutineItems(scopedRoutines, [], rangeStart, rangeEnd).map((item) => ({ ...item, kind: "routine" as const }));
    const callItems = projectCalls(calls, rangeStart, rangeEnd).map((item) => ({ ...item, kind: "call" as const }));
    const next = [...routineItems, ...callItems]
      .filter((item) => botFilter === "all" || (item.kind === "call" ? item.call.botIds.includes(botFilter) : (item.routine?.botId ?? item.run?.botId) === botFilter))
      .sort((left, right) => left.at - right.at);
    const held = heldItems.current;
    const kept = new Map<string, CalendarEventItem>();
    const shared = next.map((item) => {
      const old = held.get(item.id);
      const same = old && old.kind === item.kind && old.at === item.at && old.durationMinutes === item.durationMinutes
        && (item.kind === "call" ? old.kind === "call" && old.call === item.call : old.kind === "routine" && old.routine === item.routine && old.run === item.run);
      const value = same ? old : item;
      kept.set(item.id, value);
      return value;
    });
    heldItems.current = kept;
    return shared;
  }, [scopedRoutines, calls, rangeStart, rangeEnd, botFilter]);

  // The ranges either side are projected while the page is idle, one day per
  // idle slice (no long task), so Previous and Next (and Day, 3 days, Week)
  // find their cron runs already computed (the per-day cache in
  // routine-calendar.ts).
  const calendarShown = section === "calendar" && scheduleView === "calendar";
  useEffect(() => {
    if (!calendarShown) return;
    const idle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 8 } as IdleDeadline), 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const days: number[] = [];
    for (let day = startOfWeek(addDays(rangeStart, -7)); day < rangeStart; day = addDays(day, 1)) days.push(day);
    for (let day = rangeEnd; day < addDays(startOfWeek(rangeEnd), 14); day = addDays(day, 1)) days.push(day);
    let handle = 0;
    const step = (deadline: IdleDeadline) => {
      while (days.length && deadline.timeRemaining() > 4) {
        const day = days.shift()!;
        scheduledRoutineItems(scopedRoutines, [], day, addDays(day, 1));
      }
      if (days.length) handle = idle(step);
    };
    handle = idle(step);
    return () => cancel(handle);
  }, [calendarShown, scopedRoutines, rangeStart, rangeEnd]);

  const liveSelected = selected?.kind === "call"
    ? (() => { const call = calls.find((candidate) => candidate.id === selected.call.id); return call ? { ...selected, call } : null; })()
    : selected?.kind === "routine"
      ? {
          ...selected,
          routine: selected.routine ? scopedRoutines.find((routine) => routine.id === selected.routine?.id) ?? null : null,
          run: selected.run ? scopedRuns.find((run) => run.id === selected.run?.id) ?? selected.run : null,
        }
      : null;
  // The pills count within the scope; the sidebar's own count stays the
  // person's (the store).
  const paused = scopedRoutines.filter((routine) => !routine.enabled && (routine.schedule.type !== "once" || routine.schedule.at > Date.now()));
  const running = scopedRuns.filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const unseenFailures = scopedRuns.filter((run) => isRoutineProblemRun(run) && !run.seenAt).length;
  const filteredRoutines = useMemo(() => scopedRoutines.filter((routine) => botFilter === "all" || routine.botId === botFilter), [scopedRoutines, botFilter]);
  const upcoming = useMemo(() => upcomingRoutines(filteredRoutines), [filteredRoutines]);
  const inFlightRuns = useInFlightRuns(scopedRuns);
  const filteredRuns = scopedRuns.filter((run) => botFilter === "all" || run.botId === botFilter);
  const routineOwnerOf = (run: RoutineRun) => scopedRoutines.find((routine) => routine.id === run.routineId);
  const clearLogs = () => {
    // Mine without filters: the store's own Clear logs, as before.
    if (scoped.live && botFilter === "all" && !scoped.prefs.status) {
      dispatch({ type: "clearRoutineRuns" });
      return;
    }
    api(`/api/routine-runs?${scoped.clearSearch(botFilter === "all" ? undefined : botFilter)}`, { method: "DELETE" })
      .then(({ removed }) => {
        dispatch({ type: "routineRunsRemoved", ids: Array.isArray(removed) ? removed : [] });
        void scoped.reload();
      })
      .catch((cause) => setError(readableError(cause)));
  };
  // 2026-10-29: a routine's row menu in the list (right click, its "…"):
  // Run now or Stop, Pause or Resume, Rename in place, Open, Duplicate, Delete.
  const [rowMenu, setRowMenu] = useState<{ routine: Routine; x: number; y: number; trigger: HTMLElement } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const closeRowMenu = (focus = true) => {
    const trigger = rowMenu?.trigger;
    setRowMenu(null);
    if (focus) requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };
  const duplicateRoutine = (routine: Routine) => setEditor({ kind: "routine", at: routineEditorAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], copyOf: routine });
  const renameRoutine = (routine: Routine, name: string) => {
    setRenamingId(null);
    dispatch({ type: "routinePatched", routine: { ...routine, name } });
    dispatch({ type: "updateRoutine", routineId: routine.id, patch: { name } });
  };
  const openRoutine = (routine: Routine) => setSelected({ kind: "routine", id: routine.id, at: routine.nextRunAt ?? (routine.schedule.type === "once" ? routine.schedule.at : routine.schedule.type === "interval" ? routine.schedule.anchorAt : routine.schedule.type === "webhook" || routine.schedule.type === "event" ? Date.now() : routine.schedule.type === "cron" ? nextHour() : routine.schedule.type === "limit_reset" ? (routine.schedule.at ?? Date.now()) : atLocalTime(Date.now(), routine.schedule.time)), durationMinutes: routine.durationMinutes, routine, run: null });
  // An upcoming row: the calendar moves to its next run, and its details open.
  const showUpcoming = (routine: Routine) => {
    if (routine.nextRunAt != null) setAnchor(startOfDay(routine.nextRunAt));
    openRoutine(routine);
  };
  const openLogs = (routine: Routine) => { setRoutineFilter(routine.id); setSection("logs"); };
  const openRun = (run: RoutineRun) => {
    setSelected({ kind: "routine", id: run.id, at: run.scheduledFor, durationMinutes: run.durationMinutes ?? 30, routine: scopedRoutines.find((routine) => routine.id === run.routineId) ?? null, run });
    if (["failed", "missed"].includes(run.status) && !run.seenAt && !run.redacted) dispatch({ type: "markRoutineRunSeen", runId: run.id });
  };
  // 2026-10-28: "Running" on a bot panel row lands on that run, open.
  useEffect(() => {
    const runId = state.routinesFocus?.runId;
    // 2026-10-29: View run and a run's notification land here too; a run
    // outside the current scope (or of a deleted routine) still opens.
    const run = runId ? scopedRuns.find((candidate) => candidate.id === runId) ?? state.routineRuns.find((candidate) => candidate.id === runId) : undefined;
    if (run) openRun(run);
  }, [state.routinesFocus, state.routineRuns.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // 2026-11-02: Configuration in a run's ⋯ menu opens the routine's editor
  // in the side panel (a routine is edited there).
  useEffect(() => {
    const editId = state.routinesFocus?.editRoutineId;
    const routine = editId ? scopedRoutines.find((candidate) => candidate.id === editId) ?? state.routines.find((candidate) => candidate.id === editId) : undefined;
    if (!routine) return;
    setSelected(null);
    setPausedOpen(false);
    setEditor({ kind: "routine", at: routineEditorAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], routine });
  }, [state.routinesFocus, state.routines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const macInset = capabilities.windowChrome === "mac-inset";
  const windowDragStyle = macInset
    ? ({ WebkitAppRegion: "drag" } as CSSProperties)
    : undefined;
  const windowNoDragStyle = macInset
    ? ({ WebkitAppRegion: "no-drag" } as CSSProperties)
    : undefined;

  const setView = (days: 1 | 3 | 7) => {
    setViewDays(days);
    setAnchor((current) => startOfDay(current));
  };
  const goToday = useCallback(() => setAnchor(startOfDay(Date.now())), []);
  const handleWebhookCreateHandled = useCallback(() => setWebhookCreateRequest(0), []);
  const openCreate = useCallback((seed?: Partial<EventSeed>) => {
    setSelected(null);
    setPausedOpen(false);
    // 2026-11-01 (no modals): quick create hangs off what opened it, the slot
    // that was clicked or the New button, never the middle of the window.
    const button = newMenuRef.current?.querySelector("summary")?.getBoundingClientRect();
    const anchor = seed?.anchor ?? (button ? { x: button.right, y: button.bottom } : undefined);
    setQuick({ kind: "routine", at: nextHour(), durationMinutes: 30, botIds: [], ...seed, ...(anchor ? { anchor } : {}) });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      // A panel (the editor asking about unsaved changes) or the quick create
      // popover already handled this Escape.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { for (const menu of [newMenuRef.current, navMenuRef.current, filtersMenuRef.current]) menu?.removeAttribute("open"); setEditor(null); setSelected(null); setPausedOpen(false); return; }
      if (section !== "calendar" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "c") { event.preventDefault(); openCreate(); }
      if (event.key.toLowerCase() === "t") goToday();
      if (event.key === "1") setView(1);
      if (event.key === "3") setView(3);
      if (event.key.toLowerCase() === "w") setView(7);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, openCreate, goToday, anchor]);

  const upsertCall = (call: CalendarCall) => setCalls((current) => current.some((candidate) => candidate.id === call.id) ? current.map((candidate) => candidate.id === call.id ? call : candidate) : [call, ...current]);
  const moveEvent = async (dragged: { kind: EventKind; id: string; at: number }, nextAt: number) => {
    if (nextAt === dragged.at) return;
    try {
      if (dragged.kind === "routine") {
        const routine = scopedRoutines.find((candidate) => candidate.id === dragged.id);
        if (!routine || routine.canEdit === false) return;
        if (routine.schedule.type === "cron") throw new Error(t("routineCalendar.openRoutineForCron"));
        if (routine.schedule.type !== "once" && !(await confirm({
          title: t("routineCalendar.moveSeries"),
          confirmLabel: t("common.confirm"),
          tone: "neutral",
        }))) return;
        const response = await api(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(routine.schedule, dragged.at, nextAt) }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else {
        const call = calls.find((candidate) => candidate.id === dragged.id);
        if (!call) return;
        if (call.schedule.type === "daily" && !(await confirm({
          title: t("routineCalendar.moveSeries"),
          confirmLabel: t("common.confirm"),
          tone: "neutral",
        }))) return;
        const response = await api(`/api/calendar-calls/${call.id}`, { method: "PATCH", body: JSON.stringify({ schedule: scheduleAt(call.schedule, dragged.at, nextAt) }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  /** A bot dropped on a reset opens the quick composer for a limit-reset automation; an automation dropped there runs
   * at that reset instead of its time. */
  const dropOnReset = async (drop: ResetDrop, marker: ResetMarker) => {
    if ("botId" in drop) {
      setSelected(null);
      setQuick({ kind: "routine", at: marker.at, durationMinutes: 30, botIds: [drop.botId], limitReset: { engine: marker.engine } });
      return;
    }
    if (drop.event.kind !== "routine") {
      setError(t("limits.callNotOnReset"));
      return;
    }
    try {
      const response = await api(`/api/routines/${drop.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({ schedule: { type: "limit_reset", engine: marker.engine, repeat: "once" } }),
      });
      dispatch({ type: "routinePatched", routine: response.routine });
    } catch (cause) {
      setError(readableError(cause));
    }
  };
  const resizeEvent = async (item: CalendarEventItem, durationMinutes: number) => {
    try {
      if (item.kind === "routine" && item.routine) {
        const response = await api(`/api/routines/${item.routine.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      } else if (item.kind === "call") {
        const response = await api(`/api/calendar-calls/${item.call.id}`, { method: "PATCH", body: JSON.stringify({ durationMinutes }) });
        upsertCall(response.call);
      }
    } catch (cause) {
      setError(readableError(cause));
    }
  };

  // The header (2026-10-27): one row. On the left the title, the view (List
  // or Calendar) and, in Calendar, ‹ Today › and the range; on the right the
  // run indicators (active, problem runs), Filters, the ☰ menu and New.
  // Filters holds the scope (Mine, My teams, Everyone), Team, Owner, Status,
  // the bot and the calendar's range (Day, 3 days, Week); its badge counts
  // what narrows the page. ☰ holds the sections (Schedule, Run logs,
  // Webhooks), Paused routines and Mark all as read. Team map moved to the
  // avatar menu's Tools (2026-10-27). Under 60rem of header the labels of
  // the view switch and Filters fold to their icons (a tooltip keeps the
  // name); under 44rem the view and dates take a second line. The right
  // group clears the Windows caption buttons (useCaptionChrome, #1204).
  // Its pieces (PageHeader, PageSegment, PageFilters, PageMenu) live in
  // content-page.tsx, shared with the Achievements page (2026-10-28).
  const scopeShown = section !== "webhooks" && scoped.available;
  const calendarGrid = section === "calendar" && scheduleView === "calendar";
  const hideStatus = calendarGrid;
  const scopeFilters = scopeShown
    ? (scoped.scope !== "mine" ? 1 : 0)
      + (scoped.scope !== "mine" && scoped.prefs.teamId ? 1 : 0)
      + (scoped.prefs.ownerId ? 1 : 0)
      + (advanced && !hideStatus && scoped.prefs.status ? 1 : 0)
    : 0;
  const activeFilters = scopeFilters + (botFilter !== "all" ? 1 : 0);
  const clearFilters = () => {
    setBotFilterState("all");
    scoped.setPrefs({ scope: "mine" });
    setRoutineFilter(undefined);
  };
  const closeNavMenu = () => navMenuRef.current?.removeAttribute("open");
  const FIELD_LABEL = PAGE_FIELD_LABEL;

  const filtersMenu = section !== "webhooks" && (
    <PageFilters name="automations" menuRef={filtersMenuRef} activeCount={activeFilters}>
        {scopeShown && <div>
          <span className={FIELD_LABEL}>{t("routines.scope.label")}</span>
          <RoutineScopeBar stacked prefs={scoped.prefs} allowed={scoped.allowed} teams={scoped.facets.teams} owners={scoped.facets.owners} advanced={advanced} hideStatus={hideStatus} viewerPrincipalId={state.config?.viewer?.principalId ?? null} onChange={(next) => { scoped.setPrefs(next); setRoutineFilter(undefined); }} />
        </div>}
        <div className="block">
          <span className={FIELD_LABEL}>{t("routineCalendar.filterBot")}</span>
          <PillSelect
            ariaLabel={t("routineCalendar.filterByBot")}
            value={botFilter}
            onChange={(next) => { setBotFilter(next); setRoutineFilter(undefined); }}
            options={[{ value: "all", label: t("usage.allBots") }, ...botChoices.map((bot) => ({ value: bot.id, label: bot.name }))]}
          />
        </div>
        {calendarGrid && <div className="block">
          <span className={FIELD_LABEL}>{t("routineCalendar.scheduleRange")}</span>
          <PillSelect
            ariaLabel={t("routineCalendar.scheduleRange")}
            value={String(viewDays)}
            onChange={(next) => setView(Number(next) as 1 | 3 | 7)}
            options={[
              { value: "1", label: t("routines.view.day") },
              { value: "3", label: t("routineCalendar.threeDays") },
              { value: "7", label: t("routines.view.week") },
            ]}
          />
        </div>}
        {activeFilters > 0 && <button type="button" data-routine-filter-reset onClick={clearFilters} className={PAGE_FILTER_RESET}>{t("routines.scope.reset")}</button>}
    </PageFilters>
  );

  const automationActions = (
    <>
          <PageMenu name="automations" menuRef={navMenuRef} label={t("routineCalendar.automationMenu")} title={paused.length > 0 ? `${t("routineCalendar.automationMenu")} (${t("routineCalendar.pausedMenu")} ${paused.length})` : t("routineCalendar.automationMenu")} badge={paused.length}>
              <PageMenuItem icon={CalendarDays} current={section === "calendar"} onClick={() => { closeNavMenu(); setSection("calendar"); }}>{routinesOnly ? t("routineCalendar.scheduledRoutines") : t("routines.drawer.schedule")}</PageMenuItem>
              <PageMenuItem icon={FileText} current={section === "logs"} trailing={unseenFailures > 0 ? <span className="ml-auto rounded-full bg-danger/10 px-1.5 text-[11px] text-danger">{unseenFailures}</span> : undefined} onClick={() => { closeNavMenu(); setSection("logs"); setRoutineFilter(undefined); }}>{t("routines.logs")}</PageMenuItem>
              {!routinesOnly && <PageMenuItem icon={Webhook} current={section === "webhooks"} trailing={state.webhooks.length > 0 ? <span className={PAGE_MENU_COUNT}>{state.webhooks.length}</span> : undefined} onClick={() => { closeNavMenu(); setSection("webhooks"); }}>{t("routines.webhooks")}</PageMenuItem>}
              <PageMenuSeparator />
              {paused.length > 0 && <PageMenuItem icon={Pause} aria-label={t("routineCalendar.viewPaused")} trailing={<span className={PAGE_MENU_COUNT}>{paused.length}</span>} onClick={() => { closeNavMenu(); setQuick(null); setEditor(null); setSelected(null); setPausedOpen(true); }}>{t("routineCalendar.pausedMenu")}</PageMenuItem>}
              <PageMenuItem icon={CheckCheck} onClick={() => { closeNavMenu(); dispatch({ type: "markAllRoutineRunsSeen" }); }}>{t("routines.markAllSeen")}</PageMenuItem>
          </PageMenu>
          <details ref={newMenuRef} className="group relative">
            <summary role="button" data-automations-create aria-label={t("routineCalendar.createAutomation")} title={t("routineCalendar.createAutomation")} className={cn(PAGE_HEADER_BUTTON, "h-9 w-auto gap-1.5 border-transparent bg-accent px-3 text-[12px] font-medium text-white hover:bg-accent/90")}>
              <Plus size={15} aria-hidden="true" /><span className="@max-[30rem]/page-header:sr-only">{t("sidebar.new")}</span>
            </summary>
            <div role="group" aria-label={t("routineCalendar.newAutomation")} className={cn(PAGE_POPOVER, "w-[280px] min-w-[200px] gap-0.5 p-1.5")}>
              <button type="button" aria-label={t("routineCalendar.createTaskAria")} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("calendar"); openCreate({ kind: "routine" }); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <Clock3 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.scheduledTask")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.scheduledTaskHelp")}</span></span>
              </button>
              {!routinesOnly && <button type="button" aria-label={t("routineCalendar.createCallAria")} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("calendar"); openCreate({ kind: "call" }); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover">
                <Video size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routineCalendar.scheduledCall")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.scheduledCallHelp")}</span></span>
              </button>}
              {!routinesOnly && <button type="button" aria-label={t("routineCalendar.createWebhookAria")} disabled={visibleBots.length === 0} onClick={() => { newMenuRef.current?.removeAttribute("open"); setSection("webhooks"); setWebhookCreateRequest((request) => request + 1); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40">
                <Webhook size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span><span className="block text-[13px] font-medium text-ink">{t("routines.trigger.webhook")}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">{t("routineCalendar.webhookHelp")}</span></span>
              </button>}
            </div>
          </details>
    </>
  );
  const sectionName = section === "logs" ? t("routines.logs") : section === "webhooks" ? t("routines.webhooks") : null;
  // The calendar's handlers keep their identity, so the memoized grid, its
  // cards and the side panel skip a render that changes none of their data.
  const openGridItem = useStableHandler((item: CalendarEventItem) => { setSelected(item); if (item.kind === "routine" && item.run && ["failed", "missed"].includes(item.run.status) && !item.run.seenAt && !item.run.redacted) dispatch({ type: "markRoutineRunSeen", runId: item.run.id }); });
  const moveGridItem = useStableHandler((item: { kind: EventKind; id: string; at: number }, at: number) => void moveEvent(item, at));
  const resizeGridItem = useStableHandler((item: CalendarEventItem, duration: number) => void resizeEvent(item, duration));
  const dropGridReset = useStableHandler((drop: ResetDrop, marker: ResetMarker) => void dropOnReset(drop, marker));
  const selectSidebarDate = useCallback((at: number) => setAnchor(startOfDay(at)), []);
  const openSidebarRoutine = useStableHandler(showUpcoming);
  const collapseSidebar = useCallback(() => setBotsOpen(false), []);
  const pendingSlot = useMemo(() => quick && !quick.limitReset ? { at: quick.at, durationMinutes: quick.durationMinutes, kind: quick.kind } : null, [quick]);

  return (
    <main className={cn("flex h-full min-w-0 flex-col bg-app", fill ? "flex-1" : embedded ? "w-[min(820px,48vw)] min-w-[420px] shrink-0 border-l border-hairline/40" : "flex-1 animate-workspace-in")}>
      {fill && <PageTopStrip />}
      <PageHeader
        name="automations"
        icon={CalendarDays}
        title={t("sidebar.nav.automations")}
        section={sectionName}
        titleProps={{ "data-tour": "automations-page" }}
        {...(fill ? dragProps : {})}
        topbar={fill}
        inset={!embedded && !fill && macInset}
        style={embedded ? undefined : fill ? dragProps.style : windowDragStyle}
        primaryStyle={noDragStyle ?? windowNoDragStyle}
        actionsStyle={{ ...(noDragStyle ?? windowNoDragStyle), ...controlsShiftStyle }}
        primary={section === "calendar" && <>
            <PageSegment label={t("routines.view.label")} value={scheduleView} onChange={setScheduleView} options={[
              { value: "list", label: t("routines.view.list"), icon: List },
              { value: "calendar", label: t("connectApps.capabilities.calendar"), icon: CalendarDays },
            ]} />
            {scheduleView === "calendar" && <>
              <div className="flex shrink-0 items-center">
                <button type="button" onClick={() => setAnchor((current) => addDays(current, -viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.previous")} title={t("routines.previous")}><ChevronLeft size={16} /></button>
                <button type="button" onClick={goToday} className="rounded-md border border-hairline/50 px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-raised">{t("routines.today")}</button>
                <button type="button" onClick={() => setAnchor((current) => addDays(current, viewDays))} className="rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("routines.next")} title={t("routines.next")}><ChevronRight size={16} /></button>
              </div>
              <div data-automations-range className="min-w-0 truncate text-[14px] font-medium text-ink">{calendarRangeLabel(rangeStart, viewDays)}</div>
            </>}
          </>}
        actions={<>
            {section !== "webhooks" && running > 0 && <span role="status" data-automations-running title={t("routineCalendar.activeCount", { count: running })} aria-label={t("routineCalendar.activeCount", { count: running })} className={cn(PAGE_INDICATOR, "text-accent")}><Loader2 size={13} className="animate-spin" aria-hidden="true" />{running}</span>}
            {unseenFailures > 0 && <button type="button" data-automations-problems onClick={() => dispatch({ type: "showRoutines", section: "logs", runStatus: "problems" })} className="flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-danger hover:bg-danger/10" title={t("routineCalendar.openProblemLogs")} aria-label={t("routineCalendar.openProblemLogs")}><CircleAlert size={14} aria-hidden="true" />{unseenFailures}</button>}
            {filtersMenu}
            {automationActions}
          </>}
        below={<>
        {scopeShown && scoped.error && <p role="alert" className="mt-1 text-[12px] text-danger">{t("routines.scope.loadError")}</p>}
        {section !== "webhooks" && (error || (calendarGrid && state.routinesLoadState !== "ready")) && <div className="mt-2 flex flex-wrap items-center gap-2" style={windowNoDragStyle}>
          {error && <button onClick={() => setError("")} className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"><CircleAlert size={11} />{error}<X size={11} /></button>}
          {calendarGrid && state.routinesLoadState === "error" && <p role="alert" className="w-full text-[12px] text-danger">{t("routines.loadError")}</p>}
          {calendarGrid && state.routinesLoadState === "loading" && state.routines.length === 0 && <p role="status" className="w-full text-[12px] text-ink-secondary">{t("routines.loading")}</p>}
        </div>}
        {section === "webhooks" && error && <div className="mt-2"><button onClick={() => setError("")} className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger"><CircleAlert size={11} />{error}<X size={11} /></button></div>}
        </>}
      />
      <RoutineAwayBanner routines={state.routines} dispatch={dispatch} />
      {/* `display: contents` outside `fill` mode: the wrapper takes no part
          in layout, so embedded/standalone keep their exact original flex
          children. Only `fill` (the one mode rendered inside the content
          frame) opts into the card treatment. */}
      <div data-automations-row="" className="relative flex min-h-0 min-w-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", fill && "content-card-body")}>
      <RoutineWakeBar />

      {section === "webhooks" ? <TriggersPanel bots={visibleBots} createRequest={webhookCreateRequest} onCreateHandled={handleWebhookCreateHandled} /> : section === "logs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><RoutineLogs runs={filteredRuns} bots={state.bots} ownerOf={routineOwnerOf} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRuns.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} routineId={routineFilter} status={statusFilter} onStatusChange={setStatusFilter} onClearRoutine={() => setRoutineFilter(undefined)} onRoutineChange={setRoutineFilter} onClearLogs={clearLogs} onOpen={openRun} /></div>
      ) : scheduleView === "list" ? (
        <div className={PAGE_SCROLL}><div className={PAGE_COLUMN}>
          <PageHeading title={t("routines.title")} subtitle={t("routineCalendar.allSchedules")} />
          <LimitWarnings botFilter={botFilter} />
          <RoutineList routines={filteredRoutines} viewerPrincipalId={state.config?.viewer?.principalId ?? null} runs={scopedRuns} bots={state.bots} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && filteredRoutines.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpen={openRoutine} onLogs={openLogs}
            onRowMenu={(routine, at, trigger) => setRowMenu({ routine, x: at.x, y: at.y, trigger })}
            renamingId={renamingId} onRenameStart={(routine) => setRenamingId(routine.id)} onRenameSave={renameRoutine} onRenameCancel={() => setRenamingId(null)} />
          {rowMenu && <RoutineMenuPortal x={rowMenu.x} y={rowMenu.y} kind="row" label={rowMenu.routine.name} onClose={closeRowMenu}>
            <RoutineRowMenuItems routine={rowMenu.routine} actions={routineRowActions({
              routine: rowMenu.routine, bot: state.bots.find((bot) => bot.id === rowMenu.routine.botId), state: { config: state.config, routineRuns: state.routineRuns }, dispatch, close: closeRowMenu,
              onOpen: () => openRoutine(rowMenu.routine),
              onDuplicate: () => duplicateRoutine(rowMenu.routine),
              onRename: () => setRenamingId(rowMenu.routine.id),
            })} />
          </RoutineMenuPortal>}
          {!routinesOnly && calls.some((call) => botFilter === "all" || call.botIds.includes(botFilter)) && <section className="space-y-2" aria-label={t("routineCalendar.scheduledCalls")}><h2 className="text-[15px] font-semibold text-ink">{t("routineCalendar.scheduledCalls")}</h2>{calls.filter((call) => botFilter === "all" || call.botIds.includes(botFilter)).map((call) => <button key={call.id} type="button" onClick={() => setSelected({ kind: "call", id: call.id, at: call.schedule.type === "once" ? call.schedule.at : atLocalTime(Date.now(), call.schedule.time), durationMinutes: call.durationMinutes, call })} className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card p-4 text-left hover:bg-raised"><Video size={17} className="text-accent" /><span><span className="block text-[13px] font-medium text-ink">{call.name}</span><span className="mt-1 block text-[12px] text-ink-secondary">{scheduleLabel(call.schedule)}</span></span></button>)}</section>}
        </div></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <CalendarGrid anchor={rangeStart} days={viewDays} items={items} bots={state.bots} groups={state.groups} onOpen={openGridItem} onCreate={openCreate} onMove={moveGridItem} onResize={resizeGridItem} markers={markers} onDropOnReset={dropGridReset} pending={pendingSlot} />
          {botsOpen ? (
            <CalendarSidebar anchor={anchor} onSelectDate={selectSidebarDate} routines={upcoming} runs={inFlightRuns} bots={state.bots} viewerPrincipalId={state.config?.viewer?.principalId ?? null} loading={(scoped.live ? state.routinesLoadState === "loading" : scoped.loading) && upcoming.length === 0} error={scoped.live ? state.routinesLoadState === "error" : scoped.error} onOpenRoutine={openSidebarRoutine} filteredOut={filteredRoutines.length > 0} onCollapse={collapseSidebar} hideNarrow />
          ) : (
            <RightRailStrip onOpen={() => setBotsOpen(true)} showLabel={t("routines.upcoming.show")} title={t("routines.upcoming.title")} icon={<CalendarClock size={16} />} text={t("routines.upcoming.title")} hideNarrow />
          )}
        </div>
      )}
      </div>

      {quick && <QuickComposer seed={quick} bots={visibleBots} routinesOnly={routinesOnly} onClose={() => setQuick(null)} onMore={(seed) => { setQuick(null); setSelected(null); setPausedOpen(false); setEditor(seed); }} onSavedRoutine={(routine) => dispatch({ type: "routinePatched", routine })} onSavedCall={upsertCall} />}
      {/* 2026-11-01 (no modals): the editor, an event's details and the paused
          list share the one right detail panel (DetailPanel.tsx); the editor
          opened from the details goes back to them when it closes. */}
      {editor && (
        <DetailPanel bare label={editor.routine || editor.call ? t("routineCalendar.editEventAria") : t("routineCalendar.createEventAria")} onClose={() => setEditor(null)} data-calendar-editor-panel="">
          <EventEditor key={`${editor.kind}:${editor.routine?.id ?? editor.call?.id ?? editor.copyOf?.id ?? "new"}`} seed={editor} bots={visibleBots} routinesOnly={routinesOnly} presentation="panel" onClose={() => setEditor(null)} onSavedCall={upsertCall} />
        </DetailPanel>
      )}
      {!editor && liveSelected && <EventDetails key={`${liveSelected.kind}:${liveSelected.id}`} item={liveSelected} bots={state.bots} onClose={() => setSelected(null)} onEdit={() => { const seed: EventSeed = liveSelected.kind === "call" ? { kind: "call", at: liveSelected.at, durationMinutes: liveSelected.call.durationMinutes, botIds: liveSelected.call.botIds, call: liveSelected.call } : { kind: "routine", at: liveSelected.at, durationMinutes: liveSelected.routine?.durationMinutes ?? liveSelected.run?.durationMinutes ?? 30, botIds: [liveSelected.routine?.botId ?? liveSelected.run?.botId ?? ""].filter(Boolean), routine: liveSelected.routine ?? undefined }; setEditor(seed); }} onDuplicate={(routine) => { setEditor({ kind: "routine", at: routineEditorAt(routine), durationMinutes: routine.durationMinutes, botIds: [routine.botId], copyOf: routine }); }} onCallChanged={(id) => { if (id) setCalls((current) => current.filter((call) => call.id !== id)); else void loadCalls(); }} onOpenRoom={onOpenRoom} />}
      {!editor && !liveSelected && pausedOpen && <PausedList routines={paused} bots={state.bots} groups={state.groups} onClose={() => setPausedOpen(false)} onEdit={(routine) => { const at = routine.schedule.type === "once" ? routine.schedule.at : routine.schedule.type === "interval" ? routine.schedule.anchorAt : routine.schedule.type === "webhook" || routine.schedule.type === "event" ? Date.now() : routine.schedule.type === "cron" ? routine.nextRunAt ?? nextHour() : routine.schedule.type === "limit_reset" ? (routine.schedule.at ?? Date.now()) : atLocalTime(Date.now(), routine.schedule.time); setEditor({ kind: "routine", at, durationMinutes: routine.durationMinutes, botIds: [routine.botId], routine }); }} onOpenRoom={onOpenRoom} />}
      </div>
    </main>
  );
});

/** Desktop only: the one lever the app has against a sleeping computer.
 * The scheduler runs inside the local server, so while the Mac sleeps no
 * routine fires; the shell holds a power assertion for the hour before a
 * due routine and while one runs, plugged in only, and this row shows it. */
function RoutineWakeBar() {
  const bridge = typeof window !== "undefined" ? window.ogb?.routines : undefined;
  const [state, setState] = useState<DesktopRoutineWake | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = () => bridge.wakeState().then((next) => { if (!cancelled) setState(next); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [bridge]);
  if (!bridge || !state) return null;
  const status = !state.keepAwake
    ? t("routineCalendar.wakeOff")
    : state.onBattery
      ? t("routineCalendar.wakeBattery")
      : state.hold
        ? state.reason === "running" ? t("routineCalendar.wakeRunning") : state.at ? t("routineCalendar.wakeDue", { time: niceTime(state.at) }) : t("routineCalendar.wakeDueHour")
        : t("routineCalendar.wakeIdle");
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline/35 bg-panel/60 px-4 py-2">
      <div className="min-w-0 text-[12px] leading-relaxed text-ink-secondary">
        <span className="font-medium text-ink">{t("routineCalendar.wakeLabel")}</span> {status}
      </div>
      <Switch
        checked={state.keepAwake}
        disabled={busy}
        aria-label={t("routineCalendar.wakeAria")}
        onClick={() => {
          setBusy(true);
          bridge.keepAwake(!state.keepAwake).then(setState).catch(() => {}).finally(() => setBusy(false));
        }}
        className="shrink-0 disabled:cursor-wait disabled:opacity-50"
      />
    </div>
  );
}
