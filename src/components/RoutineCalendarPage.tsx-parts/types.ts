import type { CalendarCall } from "@/lib/calendar-calls";
import type { Routine, RoutineRunOn } from "@/lib/routines";
import type { RoutineCalendarItem } from "@/lib/routine-calendar";
import type { ReactNode } from "react";
import type { Bot } from "@/state/store";

export type EventKind = "routine" | "call";
export type CalendarRecurrenceChoice = "none" | "daily" | "weekdays" | "weekly" | "custom";
/** A routine repeats on a pattern (HumanScheduleFields), every N minutes
 * (the interval's fields), or on a saved schedule no pattern fits
 * ("advanced", kept as it is). A call keeps the calendar's choices. */
export type RecurrenceChoice = CalendarRecurrenceChoice | "interval" | "pattern" | "advanced" | "webhook" | "github" | "product" | "email" | "limit_reset";
export type IntervalDayChoice = "every-day" | "weekdays" | "custom";
export type IntervalWindowChoice = "all-day" | "custom";
export type IntervalEndChoice = "never" | "on-date";

export type CallOccurrence = {
  id: string;
  at: number;
  durationMinutes: number;
  call: CalendarCall;
};

export type CalendarEventItem =
  | ({ kind: "routine" } & RoutineCalendarItem)
  | ({ kind: "call" } & CallOccurrence);

export type EventSeed = {
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
  /** 2026-11-03: an existing routine opens in view mode unless asked to edit (an explicit Edit). */
  mode?: "view" | "edit";
  /** A routine not on the server yet (a new bot's draft): edit only, no Pause, no trash. */
  unmanaged?: boolean;
  /** 2026-11-03: a new routine made from a group's panel is that group's team goal. */
  groupId?: string;
};

export type EventEditorProps = {
  seed: EventSeed;
  bots: Bot[];
  lockedBotId?: string;
  defaultRunOn?: RoutineRunOn;
  routinesOnly?: boolean;
  /** 2026-11-01: panel = push view in the side panel; modal = centered dialog. */
  presentation?: "modal" | "panel";
  onClose: () => void;
  /** The header's ×: closes the whole side panel (else the same as Back). */
  onDismiss?: () => void;
  /** After the trash deleted the routine (else onClose). */
  onDeleted?: () => void;
  /** Advanced's Duplicate (2026-11-03: off the routine page's bar). */
  onDuplicate?: (routine: Routine) => void;
  onSavedCall: (call: CalendarCall) => void;
  /** 2026-11-06 (JC, one pane): the side panel's routine page. Editable in
   * place from the start (no view mode, no Edit); its state rows and runs
   * sit in the same pane; Cancel and Save show only while a change is not
   * saved, else the routine's own bar (`actions`). A new routine opens in
   * the same pane, without rows, runs or bar. */
  page?: RoutinePageSlots;
};

export type RoutinePageSlots = {
  /** Next run, Skipped while busy and the notes (under When to run). */
  status?: ReactNode;
  /** Runs (n) and its list (above Advanced since 2026-11-06). */
  runs?: ReactNode;
  /** Runs as, changed in place (in Advanced since 2026-11-06). */
  runAs?: ReactNode;
  /** The routine's state when it needs a look (failing, auto-paused), by the title. */
  badge?: ReactNode;
  /** The bar while nothing is unsaved: Run now, check, Pause, Delete. */
  actions?: ReactNode;
  /** Opened by an old Edit entry: the instruction is focused. */
  focusInstruction?: boolean;
  /** A new routine was saved: its page opens in the same pane. */
  onCreated?: (routine: Routine) => void;
};

export type EventEditorBodyProps = EventEditorProps & {
  mode: "view" | "edit";
  onStartEdit: () => void;
  onCancelEdit?: () => void;
  onSavedRoutine?: (routine: Routine) => void;
  /** The page's wrapper keeps the routine in step with the server only while nothing is unsaved. */
  onDirtyChange?: (dirty: boolean) => void;
};
