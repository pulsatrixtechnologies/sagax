/** Shared constants for RoutineCalendarPage extracts (#1383). */
import { CALENDAR_SLOT_MINUTES } from "@/lib/routine-calendar";
import { BOT_CALENDAR_DRAG_TYPE } from "@/lib/bot-drag";

export const HOUR_HEIGHT = 64;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
/** Every N minutes or hours (2026-10-29: hours read as hours). */
export const INTERVAL_PRESETS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720];
export const EVENT_DURATION_OPTIONS = Array.from({ length: 240 / CALENDAR_SLOT_MINUTES }, (_, index) => (index + 1) * CALENDAR_SLOT_MINUTES);
export const BOT_DRAG_TYPE = BOT_CALENDAR_DRAG_TYPE;
export const EVENT_DRAG_TYPE = "application/x-openmaus-calendar-event";
export const FOOTER_PILL = "flex items-center justify-center gap-1.5 rounded-full border border-hairline/50 px-4 py-2 text-[13px] font-medium text-ink hover:bg-hover disabled:opacity-40";
