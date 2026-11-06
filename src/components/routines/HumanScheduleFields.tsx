// The routine editor's schedule fields (2026-10-29): times with the native
// time picker (12 h or 24 h as the language has it), the days, the day of
// the month, the zone by its city, a live sentence and the next three runs.
// Cron is never shown: a schedule no model fits stays under Advanced, said
// in words, with a way back to a simple schedule.
import { useMemo } from "react";
import { Plus, X } from "lucide-react";
import { PillSelect } from "../SettingsPrimitives";
import { PANEL_TEXT_ACTION, PanelRow, PanelRows } from "./PanelRows";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { timeZoneCity, type ScheduleModel } from "../../../shared/schedule-model";
import { CronRunDates } from "./CronScheduleFields";
import { timeZoneChoices } from "@/components/settings/TimeZoneSettings";
import type { ScheduleDraft, ScheduleEditorValue } from "./schedule-editor";

const FIELD = "min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong";
const LABEL = "text-[12px] font-medium text-ink-secondary";
/** Monday first, as a week reads (Sunday = 0 in the model). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayName(day: number, style: "long" | "narrow"): string {
  // 2023-01-01 was a Sunday.
  return new Intl.DateTimeFormat(activeLocale(), { weekday: style }).format(new Date(2023, 0, 1 + day));
}

function monthName(month: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, month - 1, 1)));
}

/** "Toronto · Eastern Time": the city, then the zone's plain name. */
export function timeZoneLabel(timeZone: string): string {
  const city = timeZoneCity(timeZone);
  try {
    const name = new Intl.DateTimeFormat(activeLocale(), { timeZone, timeZoneName: "longGeneric" }).formatToParts(0).find((part) => part.type === "timeZoneName")?.value;
    return name && name !== city ? `${city} · ${name}` : city;
  } catch {
    return city;
  }
}

export function TimeZonePicker({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(() => {
    const all = timeZoneChoices();
    const list = all.includes(value) ? all : [value, ...all];
    return list.map((zone) => ({ value: zone, label: timeZoneLabel(zone) })).sort((a, b) => a.label.localeCompare(b.label, activeLocale()));
  }, [value]);
  // 2026-11-03: a row with the app's pill menu, never a native select.
  return <PanelRow data-schedule-zone-row="" label={t("scheduleEditor.timeZone")}>
    <span data-schedule-zone="" data-value={value} className="contents"><PillSelect ariaLabel={t("scheduleEditor.timeZone")} value={value} options={zones} onChange={onChange} /></span>
  </PanelRow>;
}

/** "12:30 PM" in the person's language. */
export function scheduleTimeLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(activeLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour ?? 0, minute ?? 0));
}

/** The sentence and the next runs, or the reason it cannot be saved. */
/** `preview` false (the side panel's routine page, 2026-11-06): no next runs. */
export function ScheduleSummary({ value, paused = false, preview = true }: { value: ScheduleEditorValue; paused?: boolean; preview?: boolean }) {
  if (value.error) return <p id="routine-schedule-error" role="alert" className="text-[11.5px] text-danger">{value.error}</p>;
  return <div className="space-y-2 rounded-lg bg-inset/70 px-3 py-2.5">
    <p data-schedule-sentence aria-live="polite" className="text-[13px] font-medium leading-snug text-ink">{value.sentence}</p>
    {preview && value.schedule && <CronRunDates runs={value.runs} timeZone={value.schedule.timeZone} paused={paused} />}
  </div>;
}

/** `essentials`: the shape and the first time (the simple When picker).
 * `advanced`: only the extra times ("Also at", never the first time again:
 * one field per time, 2026-11-02), the time zone and the next runs (the
 * editor's Advanced). `all`: the full block. */
export type HumanScheduleMode = "all" | "essentials" | "advanced";

export function HumanScheduleFields({ draft, value, onChange, paused = false, mode = "all", preview = true }: {
  draft: ScheduleDraft;
  value: ScheduleEditorValue;
  onChange: (draft: ScheduleDraft) => void;
  /** A paused routine: the dates are a preview, not scheduled runs. */
  paused?: boolean;
  mode?: HumanScheduleMode;
  /** The next runs under the zone (off on the side panel's routine page, 2026-11-06). */
  preview?: boolean;
}) {
  const { model } = draft;
  const update = (patch: Partial<ScheduleModel>) => onChange({ ...draft, model: { ...model, ...patch } });
  const setTime = (index: number, time: string) => update({ times: model.times.map((value, at) => (at === index ? time : value)) });
  const addTime = () => {
    // A new time keeps the minutes of the others, four hours after the last.
    const last = model.times.at(-1) ?? "09:00";
    const [hour, minute] = last.split(":").map(Number);
    const next = `${String(((hour ?? 9) + 4) % 24).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
    update({ times: [...model.times, next] });
  };
  const toggleDay = (day: number) => {
    const has = model.weekdays.includes(day);
    if (has && model.weekdays.length === 1) return;
    update({ weekdays: has ? model.weekdays.filter((value) => value !== day) : [...model.weekdays, day].sort((a, b) => a - b) });
  };
  const timed = model.frequency !== "hourly" && model.frequency !== "every";
  const showShape = mode === "all" || mode === "essentials";
  const showZoneAndPreview = mode === "all" || mode === "advanced";
  const firstTime = model.times[0] ?? "09:00";
  return <div data-human-schedule={mode} className={mode === "advanced" ? "flex min-w-0 flex-col divide-y divide-hairline/30" : "space-y-3"}>
    {showShape && model.frequency === "days" && <div role="group" aria-label={t("scheduleEditor.days")} className="flex flex-wrap gap-1.5">
      {WEEK_ORDER.map((day) => {
        const on = model.weekdays.includes(day);
        return <button key={day} type="button" aria-pressed={on} aria-label={weekdayName(day, "long")} title={weekdayName(day, "long")} onClick={() => toggleDay(day)} className={cn("size-8 rounded-full text-[11px] font-semibold", on ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>{weekdayName(day, "narrow").toLocaleUpperCase(activeLocale())}</button>;
      })}
    </div>}

    {showShape && model.frequency === "hourly" && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.atMinute")}</span>
      <span data-schedule-minute="" className="contents"><PillSelect ariaLabel={t("scheduleEditor.atMinute")} value={String(model.minute)} options={Array.from({ length: 60 }, (_, minute) => ({ value: String(minute), label: `:${String(minute).padStart(2, "0")}` }))} onChange={(minute) => update({ minute: Number(minute) })} /></span>
    </div>}

    {showShape && (model.frequency === "monthly" || model.frequency === "yearly") && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.onDay")}</span>
      <span data-schedule-month-day="" className="contents"><PillSelect ariaLabel={t("scheduleEditor.dayOfMonth")} value={String(model.monthDay)} options={[...Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })), ...(model.frequency === "monthly" ? [{ value: "last", label: t("scheduleEditor.lastDay") }] : [])]} onChange={(day) => update({ monthDay: day === "last" ? "last" : Number(day) })} /></span>
      {model.frequency === "yearly" && <span data-schedule-month="" className="contents"><PillSelect ariaLabel={t("scheduleEditor.month")} value={String(model.month)} options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1) }))} onChange={(month) => update({ month: Number(month) })} /></span>}
    </div>}
    {showShape && model.frequency === "monthly" && typeof model.monthDay === "number" && model.monthDay > 28 && <p className="text-[11px] text-ink-secondary">{t("scheduleEditor.skipHelp")}</p>}

    {showShape && timed && mode === "essentials" && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.at")}</span>
      <input data-schedule-time type="time" step={60} value={firstTime} aria-label={t("scheduleEditor.timeN", { n: 1 })} aria-invalid={Boolean(value.error)} onChange={(event) => setTime(0, event.target.value)} className={cn(FIELD, "tabular-nums")} />
      {model.times.length > 1 && <span data-schedule-more-times className="text-[11.5px] text-ink-secondary">{t("scheduleEditor.moreTimesAdvanced", { count: model.times.length - 1 })}</span>}
    </div>}

    {timed && mode === "advanced" && <PanelRow data-schedule-extra-times="" label={t("scheduleEditor.alsoAt")} below={model.times.length > 1 ? <div className="flex flex-wrap items-center gap-1.5">
      {model.times.map((time, index) => index === 0 ? null : <span key={index} data-schedule-time-pill="" className="inline-flex h-7 items-center gap-0.5 rounded-full bg-inset pl-2.5 pr-1">
        <input data-schedule-time type="time" step={60} value={time} aria-label={t("scheduleEditor.timeN", { n: index + 1 })} aria-invalid={Boolean(value.error)} onChange={(event) => setTime(index, event.target.value)} className="w-[72px] bg-transparent text-[12.5px] tabular-nums text-ink outline-none [color-scheme:light_dark] [&::-webkit-calendar-picker-indicator]:hidden" />
        <button type="button" aria-label={t("scheduleEditor.removeTime")} title={t("scheduleEditor.removeTime")} onClick={() => update({ times: model.times.filter((_, at) => at !== index) })} className="flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink"><X size={11} /></button>
      </span>)}
    </div> : undefined}>
      {model.times.length < 12 && <button type="button" data-schedule-add-time onClick={addTime} className={PANEL_TEXT_ACTION}><Plus size={13} aria-hidden="true" />{t("scheduleEditor.addTime")}</button>}
    </PanelRow>}

    {timed && mode === "all" && <div data-schedule-times="" className="flex flex-wrap items-center gap-1.5">
      <span className={cn(LABEL, "mr-1")}>{t("scheduleEditor.at")}</span>
      {model.times.map((time, index) => <span key={index} data-schedule-time-pill="" className="inline-flex h-7 items-center gap-0.5 rounded-full bg-inset pl-2.5 pr-1">
        <input data-schedule-time type="time" step={60} value={time} aria-label={t("scheduleEditor.timeN", { n: index + 1 })} aria-invalid={Boolean(value.error)} onChange={(event) => setTime(index, event.target.value)} className="w-[72px] bg-transparent text-[12.5px] tabular-nums text-ink outline-none [color-scheme:light_dark] [&::-webkit-calendar-picker-indicator]:hidden" />
        {model.times.length > 1 ? <button type="button" aria-label={t("scheduleEditor.removeTime")} title={t("scheduleEditor.removeTime")} onClick={() => update({ times: model.times.filter((_, at) => at !== index) })} className="flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink"><X size={11} /></button> : <span className="w-1.5" />}
      </span>)}
      {model.times.length < 12 && <button type="button" data-schedule-add-time onClick={addTime} className={PANEL_TEXT_ACTION}><Plus size={13} aria-hidden="true" />{t("scheduleEditor.addTime")}</button>}
    </div>}

    {showZoneAndPreview && mode === "advanced" && <>
      <TimeZonePicker value={draft.timeZone} onChange={(timeZone) => onChange({ ...draft, timeZone })} />
      {/* Advanced: the sentence and any error already read in When to run. */}
      {preview && value.schedule && !value.error && <div className="py-2"><CronRunDates runs={value.runs} timeZone={value.schedule.timeZone} paused={paused} /></div>}
    </>}
    {showZoneAndPreview && mode === "all" && <>
      <PanelRows><TimeZonePicker value={draft.timeZone} onChange={(timeZone) => onChange({ ...draft, timeZone })} /></PanelRows>
      <ScheduleSummary value={value} paused={paused} preview={preview} />
    </>}
  </div>;
}

/** A schedule no simple model fits, kept as it is: its sentence, its next
 * runs, and a way to pick a simple schedule instead. */
export function AdvancedScheduleFields({ value, onSimplify, paused = false, preview = true }: { value: ScheduleEditorValue; onSimplify: () => void; paused?: boolean; preview?: boolean }) {
  return <div data-schedule-advanced className="space-y-2">
    <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("scheduleEditor.advancedHelp")}</p>
    <ScheduleSummary value={value} paused={paused} preview={preview} />
    <button type="button" data-schedule-simplify onClick={onSimplify} className="rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised">{t("scheduleEditor.simplify")}</button>
  </div>;
}
