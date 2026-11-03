// A routine's trigger, changed where it is read (2026-11-03, JC): the routine
// page's Trigger value opens this popover (the app's AnchoredPopover, never a
// native control). Everything about the trigger is here: the frequency (once,
// every hour, every day, weekdays, certain days, monthly, yearly, every N
// minutes, a cron expression, a webhook), the days, one or several times, the
// time zone, the webhook's address, key and header (copy, reveal, rotate) and
// "Only when something changes". Nothing is saved before Apply.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Clock3, Globe } from "lucide-react";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { PillSelect } from "@/components/SettingsPrimitives";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Routine, RoutineScheduleInput } from "@/lib/routines";
import { fromLocalDateAndTime, intervalAnchorForSave, toLocalDateInput, toLocalTimeInput } from "@/lib/routine-calendar";
import { intervalLabel } from "@/lib/schedule-label";
import { readableError } from "@/lib/plain-error";
import type { Bot } from "@/state/store";
import type { ScheduleFrequency } from "../../../shared/schedule-model";
import { HumanScheduleFields, TimeZonePicker } from "./HumanScheduleFields";
import { keptScheduleValue, personTimeZone, PICKER_FREQUENCIES, savedPatternSchedule, scheduleDraftFor, scheduleEditorValue, type ScheduleDraft } from "./schedule-editor";
import { readTiming, withRoutineTiming } from "./RoutineTimingFields";
import { RoutineWebhookPanel } from "./RoutineWebhookPanel";
import { WatchFields, draftFromWatch, watchFromDraft } from "./WatchFields";
import { PANEL_INPUT, PANEL_LABEL, PanelRow, PanelRows } from "./PanelRows";

/** once | a pattern's frequency | every N minutes | cron | webhook; mail
 * and limit-reset triggers are kept as they are (changed in Edit). */
export type TriggerChoice = "once" | Exclude<ScheduleFrequency, "every"> | "interval" | "cron" | "webhook" | "email" | "limit_reset";

const INTERVALS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720];

export function triggerChoiceOf(schedule: Routine["schedule"]): TriggerChoice {
  if (schedule.type === "once") return "once";
  if (schedule.type === "interval") return "interval";
  if (schedule.type === "webhook") return "webhook";
  if (schedule.type === "event") return "email";
  if (schedule.type === "limit_reset") return "limit_reset";
  const { draft, fits } = scheduleDraftFor(schedule, Date.now());
  if (!fits || draft.model.frequency === "every") return "cron";
  return draft.model.frequency;
}

/** The patch Apply sends: the new schedule, and the watch when it changed. */
export function triggerPatch(input: {
  routine: Routine;
  choice: TriggerChoice;
  draft: ScheduleDraft;
  onceAt: number;
  everyMinutes: number;
  cron: { expression: string; timeZone: string };
  watch: Routine["precheck"] | null | undefined;
  now: number;
}): { patch: { schedule?: RoutineScheduleInput; precheck?: Routine["precheck"] | null } } | { error: string } {
  const { routine, choice, draft, now } = input;
  const timing = readTiming(routine.schedule);
  const timed = (schedule: RoutineScheduleInput) => withRoutineTiming(schedule, true, timing.mode, timing.early, timing.late);
  let schedule: RoutineScheduleInput | undefined;
  if (choice === "once") schedule = { type: "once", at: input.onceAt };
  else if (choice === "webhook") schedule = { type: "webhook" };
  else if (choice === "email" || choice === "limit_reset") schedule = undefined;
  else if (choice === "interval") {
    const current = routine.schedule.type === "interval" ? routine.schedule : undefined;
    schedule = timed({
      type: "interval",
      everyMinutes: input.everyMinutes,
      anchorAt: intervalAnchorForSave(now, input.everyMinutes, current),
      weekdays: current?.weekdays ?? null,
      window: current?.window ?? null,
      endsAt: current?.endsAt ?? null,
    } as RoutineScheduleInput);
  } else if (choice === "cron") {
    const value = keptScheduleValue({ type: "cron", expression: input.cron.expression.trim(), timeZone: input.cron.timeZone }, now);
    if (value.error || !value.schedule) return { error: value.error || t("routineCalendar.validSchedule") };
    schedule = timed({ type: "cron", expression: input.cron.expression.trim(), timeZone: input.cron.timeZone });
  } else {
    const value = scheduleEditorValue({ ...draft, model: { ...draft.model, frequency: choice } }, now);
    if (value.error || !value.schedule) return { error: value.error || t("routineCalendar.validSchedule") };
    schedule = timed(savedPatternSchedule(value.schedule, { ...draft, model: { ...draft.model, frequency: choice } }) as RoutineScheduleInput);
  }
  const repeats = choice !== "once" && choice !== "webhook" && choice !== "email" && choice !== "limit_reset";
  const hadWatch = routine.precheck?.kind === "watch";
  const watch = repeats && routine.target !== "room-goal" ? input.watch ?? null : null;
  const precheck = watch ? { precheck: watch } : hadWatch ? { precheck: null } : {};
  return { patch: { ...(schedule ? { schedule } : {}), ...precheck } };
}

export function TriggerPopover({ routine, bot, anchorRef, onApply, onClose }: {
  routine: Routine;
  bot?: Bot;
  anchorRef: RefObject<HTMLElement | null>;
  /** Saves the patch (PATCH /api/routines/:id); rejects with the reason. */
  onApply: (patch: { schedule?: RoutineScheduleInput; precheck?: Routine["precheck"] | null }) => Promise<void>;
  onClose: () => void;
}) {
  const popover = useRef<HTMLElement | null>(null);
  const opened = useMemo(() => Date.now(), []);
  const [choice, setChoice] = useState<TriggerChoice>(() => triggerChoiceOf(routine.schedule));
  const [draft, setDraft] = useState<ScheduleDraft>(() => {
    const base = scheduleDraftFor(routine.schedule, routine.nextRunAt ?? opened).draft;
    return base.model.frequency === "every" ? { ...base, model: { ...base.model, frequency: "daily" } } : base;
  });
  const startAt = routine.schedule.type === "once" ? routine.schedule.at : routine.nextRunAt ?? opened + 3_600_000;
  const [date, setDate] = useState(toLocalDateInput(startAt));
  const [time, setTime] = useState(toLocalTimeInput(startAt));
  const [everyMinutes, setEveryMinutes] = useState(routine.schedule.type === "interval" ? routine.schedule.everyMinutes : 30);
  const [cron, setCron] = useState(() => routine.schedule.type === "cron" ? { expression: routine.schedule.expression, timeZone: routine.schedule.timeZone } : { expression: "0 9 * * 1-5", timeZone: personTimeZone() });
  const [watchDraft, setWatchDraft] = useState(() => draftFromWatch(routine.precheck?.kind === "watch" ? routine.precheck : undefined));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Outside press and Escape close it; a pill menu's list or a confirmation
  // opened from inside count as inside.
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || popover.current?.contains(target) || anchorRef.current?.contains(target)) return;
      if (target.closest(".popover-surface, [role=listbox], [role=alertdialog]")) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [anchorRef, onClose]);

  const patternChoice = (PICKER_FREQUENCIES as string[]).includes(choice);
  const patternValue = patternChoice ? scheduleEditorValue({ ...draft, model: { ...draft.model, frequency: choice as ScheduleFrequency } }, opened) : null;
  const cronValue = choice === "cron" ? keptScheduleValue({ type: "cron", expression: cron.expression.trim(), timeZone: cron.timeZone }, opened) : null;
  const repeats = choice !== "once" && choice !== "webhook" && choice !== "email" && choice !== "limit_reset";
  const watchAllowed = repeats && routine.target !== "room-goal";
  const watchBuilt = watchFromDraft(watchDraft);
  const watchError = watchAllowed && "error" in watchBuilt ? watchBuilt.error : "";

  const apply = async () => {
    const built = triggerPatch({
      routine, choice, draft, onceAt: fromLocalDateAndTime(date, time), everyMinutes, cron,
      watch: watchAllowed && "watch" in watchBuilt ? watchBuilt.watch ?? null : null, now: Date.now(),
    });
    if ("error" in built) { setError(built.error); return; }
    setSaving(true);
    setError("");
    try {
      await onApply(built.patch);
      onClose();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: "once", label: t("scheduleEditor.frequency.once") },
    ...PICKER_FREQUENCIES.map((frequency) => ({ value: frequency, label: t(`scheduleEditor.frequency.${frequency}`) })),
    { value: "interval", label: t("scheduleEditor.frequency.every") },
    { value: "cron", label: t("routineTrigger.cron") },
    ...(routine.target !== "room-goal" ? [{ value: "webhook", label: t("routineEditor.whenWebhook") }] : []),
    ...(choice === "email" ? [{ value: "email", label: t("schedule.sentence.email") }] : []),
    ...(choice === "limit_reset" ? [{ value: "limit_reset", label: t("routines.limitReset.option") }] : []),
  ];

  return <AnchoredPopover
    anchorRef={anchorRef}
    popoverRef={popover}
    align="end"
    maxHeight={620}
    role="dialog"
    aria-label={t("routineTrigger.title")}
    data-routine-trigger-popover=""
    className="popover-surface flex w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated"
  >
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(PANEL_LABEL, "inline-flex items-center gap-1.5")}>{choice === "webhook" ? <Globe size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}{t("routineTrigger.title")}</span>
        <span data-trigger-frequency={choice}><PillSelect<string> ariaLabel={t("routines.editor.repeat")} value={choice} options={options} onChange={(next) => { setChoice(next as TriggerChoice); setError(""); }} /></span>
      </div>
      {choice === "once" && <PanelRows><PanelRow label={t("routineCalendar.starts")}>
        <input type="date" aria-label={t("routineTrigger.date")} value={date} onChange={(event) => setDate(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]")} />
        <input type="time" aria-label={t("scheduleEditor.timeN", { n: 1 })} value={time} onChange={(event) => setTime(event.target.value)} className={cn(PANEL_INPUT, "[color-scheme:light_dark]")} />
      </PanelRow></PanelRows>}
      {patternChoice && patternValue && <HumanScheduleFields mode="all" draft={{ ...draft, model: { ...draft.model, frequency: choice as ScheduleFrequency } }} value={patternValue} onChange={(next) => setDraft(next)} paused={!routine.enabled} />}
      {choice === "interval" && <PanelRows><PanelRow label={t("routineCalendar.runsEvery")}>
        <PillSelect ariaLabel={t("routineCalendar.howOften")} value={String(everyMinutes)} onChange={(value) => setEveryMinutes(Number(value))}
          options={[...INTERVALS, ...(INTERVALS.includes(everyMinutes) ? [] : [everyMinutes])].map((minutes) => ({ value: String(minutes), label: intervalLabel(minutes) }))} />
      </PanelRow></PanelRows>}
      {choice === "cron" && cronValue && <div className="space-y-2">
        <PanelRows>
          <PanelRow label={t("routineTrigger.cron")}>
            <input data-trigger-cron aria-label={t("routineTrigger.cron")} value={cron.expression} spellCheck={false} onChange={(event) => setCron((current) => ({ ...current, expression: event.target.value }))} placeholder="0 9 * * 1-5" className={cn(PANEL_INPUT, "w-[150px] font-mono")} />
          </PanelRow>
          <TimeZonePicker value={cron.timeZone} onChange={(timeZone) => setCron((current) => ({ ...current, timeZone }))} />
        </PanelRows>
        <p className={cn("text-[12px] leading-snug", cronValue.error ? "text-danger" : "text-ink-secondary")} data-trigger-cron-sentence>{cronValue.error || cronValue.sentence}</p>
      </div>}
      {choice === "webhook" && <div className="space-y-2">
        <div className={PANEL_LABEL}>{t("routineEditor.webhook")}</div>
        <RoutineWebhookPanel routine={routine.schedule.type === "webhook" ? routine : undefined} bot={bot} />
      </div>}
      {(choice === "email" || choice === "limit_reset") && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("routineTrigger.keptHere")}</p>}
      {watchAllowed && <PanelRows><WatchFields draft={watchDraft} onChange={setWatchDraft} botId={routine.botId} routineId={routine.id} runOn={routine.runOn} /></PanelRows>}
      {(error || watchError) && <p role="alert" className="text-[12px] text-danger">{error || (watchError ? t(watchError) : "")}</p>}
    </div>
    <div className="flex items-center justify-end gap-2 border-t border-hairline/40 px-3.5 py-2.5">
      <button type="button" onClick={onClose} className="rounded-full border border-hairline/50 px-3.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-hover">{t("common.cancel")}</button>
      <button type="button" data-trigger-apply onClick={() => void apply()} disabled={saving || Boolean(watchError) || Boolean(patternValue?.error)} className="rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-40">{t("routineTrigger.apply")}</button>
    </div>
  </AnchoredPopover>;
}
