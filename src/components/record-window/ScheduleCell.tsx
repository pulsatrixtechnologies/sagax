// The schedule cell (D-20261127-009): what a planned entry is, in its colour
// (a meeting, a resource, an activity, M-20261127-109), then who or what and
// when, a done entry quieter. Shared by every record that plans something (a
// ticket, a company's activities, a project). The colour is the tone's tint
// under the popover ink, as every chip of the card (4.5:1 in every skin).
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RecordPlanKind } from "../../../shared/record-actions";

/** A meeting, a resource or an activity (shared/record-actions.ts). */
export type ScheduleKind = RecordPlanKind;

const TINT: Record<ScheduleKind, string> = {
  meeting: "bg-[color-mix(in_srgb,var(--color-ultracode)_16%,transparent)]",
  resource: "bg-accent/15",
  activity: "bg-warning/15",
};
const DOT: Record<ScheduleKind, string> = {
  meeting: "bg-[var(--color-ultracode)]",
  resource: "bg-accent",
  activity: "bg-warning",
};

export function scheduleKindLabel(kind: ScheduleKind): string {
  return t(kind === "meeting" ? "recordWindow.schedule.meeting" : kind === "resource" ? "recordWindow.schedule.resource" : "recordWindow.schedule.activity");
}

/** The entry's type, in its colour. */
export function ScheduleTypeChip({ kind }: { kind: ScheduleKind }) {
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-[18px] text-popover-ink", TINT[kind])} data-schedule-kind={kind}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[kind])} />
      <span className="truncate">{scheduleKindLabel(kind)}</span>
    </span>
  );
}

/** Who or what (a person's link, an activity's subject), with a quiet line under it. */
export function ScheduleCell({ title, detail, done = false }: { title: ReactNode; detail?: ReactNode; done?: boolean }) {
  return (
    <span className={cn("flex min-w-0 flex-col", done && "text-popover-ink-secondary")} data-schedule-done={done ? "" : undefined}>
      <span className="min-w-0 break-words">{title}</span>
      {detail && <span className="min-w-0 break-words text-[13px] leading-[18px] text-popover-ink-secondary">{detail}</span>}
    </span>
  );
}
