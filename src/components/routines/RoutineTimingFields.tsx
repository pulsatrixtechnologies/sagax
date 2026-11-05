import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PillSelect } from "../SettingsPrimitives";
import { PANEL_INPUT, PanelRow, PanelValue } from "./PanelRows";

const DEFAULT_EARLY_MINUTES = 15;
const DEFAULT_LATE_MINUTES = 15;

export function readTiming(schedule: {
  type: string;
  timing?: string;
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}): { mode: "exact" | "flexible"; early: number; late: number } {
  const raw = schedule as { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number };
  if (raw.type !== "once" && raw.timing === "flexible") {
    return {
      mode: "flexible",
      early: raw.windowEarlyMinutes ?? DEFAULT_EARLY_MINUTES,
      late: raw.windowLateMinutes ?? DEFAULT_LATE_MINUTES,
    };
  }
  return { mode: "exact", early: DEFAULT_EARLY_MINUTES, late: DEFAULT_LATE_MINUTES };
}

/** Exact repeating saves name the choice so a flexible routine can be turned back. */
export function withRoutineTiming<T extends { type: string }>(
  schedule: T,
  repeats: boolean,
  mode: "exact" | "flexible",
  earlyMinutes: number,
  lateMinutes: number,
): T & { timing?: "exact" | "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  const { timing: _timing, windowEarlyMinutes: _early, windowLateMinutes: _late, ...rest } = schedule as T & {
    timing?: unknown;
    windowEarlyMinutes?: unknown;
    windowLateMinutes?: unknown;
  };
  if (!repeats || schedule.type === "once" || mode !== "flexible") {
    if (!repeats || schedule.type === "once") return rest as T;
    return { ...rest, timing: "exact" } as T & { timing: "exact" };
  }
  const early = Number.isInteger(earlyMinutes) && earlyMinutes >= 0 ? earlyMinutes : DEFAULT_EARLY_MINUTES;
  const late = Number.isInteger(lateMinutes) && lateMinutes >= 0 ? lateMinutes : DEFAULT_LATE_MINUTES;
  return { ...rest, timing: "flexible", windowEarlyMinutes: early, windowLateMinutes: late } as T & {
    timing: "flexible";
    windowEarlyMinutes: number;
    windowLateMinutes: number;
  };
}

function wholeMinutes(value: string): number {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : 0;
}

export function RoutineTimingFields({
  mode,
  earlyMinutes,
  lateMinutes,
  onMode,
  onEarly,
  onLate,
  viewing = false,
}: {
  mode: "exact" | "flexible";
  earlyMinutes: number;
  lateMinutes: number;
  onMode: (mode: "exact" | "flexible") => void;
  onEarly: (minutes: number) => void;
  onLate: (minutes: number) => void;
  /** View mode: the choice as text. */
  viewing?: boolean;
}) {
  // 2026-11-03: one row of the routine panel, the app's pill menu at the
  // right; the windows under it when flexible.
  const options = [{ value: "exact" as const, label: t("routineTiming.exact") }, { value: "flexible" as const, label: t("routineTiming.flexible") }];
  const minutes = (label: string, aria: string, value: number, onValue: (minutes: number) => void) => (
    <label className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      {viewing
        ? <span className="tabular-nums text-ink">{value}</span>
        : <input aria-label={aria} type="number" min={0} step={1} value={value} onChange={(event) => onValue(wholeMinutes(event.target.value))} className={cn(PANEL_INPUT, "w-14 tabular-nums")} />}
      <span>{t("routineTiming.min")}</span>
    </label>
  );
  return (
    <PanelRow data-routine-timing={mode} label={t("routineTiming.label")} hint={t("routineEditor.hint.timing")}
      below={mode === "flexible" ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-secondary">
        {minutes(t("routineTiming.early"), t("routineTiming.earlyAria"), earlyMinutes, onEarly)}
        {minutes(t("routineTiming.late"), t("routineTiming.lateAria"), lateMinutes, onLate)}
        <span className="w-full text-[11.5px] text-ink-tertiary">{t("routineTiming.lateHelp")}</span>
      </div> : undefined}>
      {viewing
        ? <PanelValue>{options.find((option) => option.value === mode)?.label}</PanelValue>
        : <PillSelect ariaLabel={t("routineTiming.label")} value={mode} options={options} onChange={onMode} />}
    </PanelRow>
  );
}
