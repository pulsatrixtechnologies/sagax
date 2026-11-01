// The routine editor's schedule fields (2026-10-29): times with the native
// time picker (12 h or 24 h as the language has it), the days, the day of
// the month, the zone by its city, a live sentence and the next three runs.
// Cron is never shown: a schedule no model fits stays under Advanced, said
// in words, with a way back to a simple schedule.
import { useMemo } from "react";
import { Plus, X } from "lucide-react";
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

function TimeZonePicker({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(() => {
    const all = timeZoneChoices();
    const list = all.includes(value) ? all : [value, ...all];
    return list.map((zone) => ({ zone, label: timeZoneLabel(zone) })).sort((a, b) => a.label.localeCompare(b.label, activeLocale()));
  }, [value]);
  return <label className="flex flex-wrap items-center gap-2">
    <span className={LABEL}>{t("scheduleEditor.timeZone")}</span>
    <select data-schedule-zone value={value} onChange={(event) => onChange(event.target.value)} className={cn(FIELD, "max-w-full")}>
      {zones.map(({ zone, label }) => <option key={zone} value={zone}>{label}</option>)}
    </select>
  </label>;
}

/** The sentence and the next runs, or the reason it cannot be saved. */
export function ScheduleSummary({ value, paused = false }: { value: ScheduleEditorValue; paused?: boolean }) {
  if (value.error) return <p id="routine-schedule-error" role="alert" className="text-[11.5px] text-danger">{value.error}</p>;
  return <div className="space-y-2 rounded-lg bg-inset/70 px-3 py-2.5">
    <p data-schedule-sentence aria-live="polite" className="text-[13px] font-medium leading-snug text-ink">{value.sentence}</p>
    {value.schedule && <CronRunDates runs={value.runs} timeZone={value.schedule.timeZone} paused={paused} />}
  </div>;
}

/** `essentials`: one time + days (Grok-simple When). `advanced`: extra times,
 * time zone, next-runs preview (More options). `all`: previous full block. */
export type HumanScheduleMode = "all" | "essentials" | "advanced";

export function HumanScheduleFields({ draft, value, onChange, paused = false, mode = "all" }: {
  draft: ScheduleDraft;
  value: ScheduleEditorValue;
  onChange: (draft: ScheduleDraft) => void;
  /** A paused routine: the dates are a preview, not scheduled runs. */
  paused?: boolean;
  mode?: HumanScheduleMode;
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
  const showTimesFull = mode === "all" || mode === "advanced";
  const showZoneAndPreview = mode === "all" || mode === "advanced";
  const firstTime = model.times[0] ?? "09:00";
  return <div data-human-schedule={mode} className="space-y-3">
    {showShape && model.frequency === "days" && <div role="group" aria-label={t("scheduleEditor.days")} className="flex flex-wrap gap-1.5">
      {WEEK_ORDER.map((day) => {
        const on = model.weekdays.includes(day);
        return <button key={day} type="button" aria-pressed={on} aria-label={weekdayName(day, "long")} title={weekdayName(day, "long")} onClick={() => toggleDay(day)} className={cn("size-8 rounded-full text-[11px] font-semibold", on ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>{weekdayName(day, "narrow").toLocaleUpperCase(activeLocale())}</button>;
      })}
    </div>}

    {showShape && model.frequency === "hourly" && <label className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.atMinute")}</span>
      <select data-schedule-minute value={model.minute} onChange={(event) => update({ minute: Number(event.target.value) })} className={cn(FIELD, "tabular-nums")}>
        {Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>:{String(minute).padStart(2, "0")}</option>)}
      </select>
    </label>}

    {showShape && (model.frequency === "monthly" || model.frequency === "yearly") && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.onDay")}</span>
      <select data-schedule-month-day aria-label={t("scheduleEditor.dayOfMonth")} value={String(model.monthDay)} onChange={(event) => update({ monthDay: event.target.value === "last" ? "last" : Number(event.target.value) })} className={cn(FIELD, "tabular-nums")}>
        {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        {model.frequency === "monthly" && <option value="last">{t("scheduleEditor.lastDay")}</option>}
      </select>
      {model.frequency === "yearly" && <select data-schedule-month aria-label={t("scheduleEditor.month")} value={model.month} onChange={(event) => update({ month: Number(event.target.value) })} className={FIELD}>
        {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthName(index + 1)}</option>)}
      </select>}
    </div>}
    {showShape && model.frequency === "monthly" && typeof model.monthDay === "number" && model.monthDay > 28 && <p className="text-[11px] text-ink-secondary">{t("scheduleEditor.skipHelp")}</p>}

    {showShape && timed && mode === "essentials" && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.at")}</span>
      <input data-schedule-time type="time" step={60} value={firstTime} aria-label={t("scheduleEditor.timeN", { n: 1 })} aria-invalid={Boolean(value.error)} onChange={(event) => setTime(0, event.target.value)} className={cn(FIELD, "tabular-nums")} />
      {model.times.length > 1 && <span data-schedule-more-times className="text-[11.5px] text-ink-secondary">{t("scheduleEditor.moreTimesHint", { count: model.times.length - 1 })}</span>}
    </div>}

    {timed && showTimesFull && <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL}>{t("scheduleEditor.at")}</span>
      {model.times.map((time, index) => <span key={index} className="inline-flex items-center gap-1">
        <input data-schedule-time type="time" step={60} value={time} aria-label={t("scheduleEditor.timeN", { n: index + 1 })} aria-invalid={Boolean(value.error)} onChange={(event) => setTime(index, event.target.value)} className={cn(FIELD, "tabular-nums")} />
        {model.times.length > 1 && <button type="button" aria-label={t("scheduleEditor.removeTime")} title={t("scheduleEditor.removeTime")} onClick={() => update({ times: model.times.filter((_, at) => at !== index) })} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"><X size={13} /></button>}
      </span>)}
      {model.times.length < 12 && <button type="button" data-schedule-add-time onClick={addTime} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-accent hover:bg-raised"><Plus size={13} />{t("scheduleEditor.addTime")}</button>}
    </div>}

    {showZoneAndPreview && <>
      <TimeZonePicker value={draft.timeZone} onChange={(timeZone) => onChange({ ...draft, timeZone })} />
      <ScheduleSummary value={value} paused={paused} />
    </>}
  </div>;
}

/** A schedule no simple model fits, kept as it is: its sentence, its next
 * runs, and a way to pick a simple schedule instead. */
export function AdvancedScheduleFields({ value, onSimplify, paused = false }: { value: ScheduleEditorValue; onSimplify: () => void; paused?: boolean }) {
  return <div data-schedule-advanced className="space-y-2">
    <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("scheduleEditor.advancedHelp")}</p>
    <ScheduleSummary value={value} paused={paused} />
    <button type="button" data-schedule-simplify onClick={onSimplify} className="rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised">{t("scheduleEditor.simplify")}</button>
  </div>;
}
