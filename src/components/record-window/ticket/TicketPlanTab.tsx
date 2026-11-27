// A ticket's Schedule tab (M-20261127-109, M-20261127-101, D-20261127-007,
// M-20261127-126, M-20261127-119): the meetings, the resources and the
// activities together, each with its type in colour; the open ones only,
// newest first, the others under "Show completed"; "Mark done" on each row.
// On top, "Schedule me" (a bot finds the best time and proposes it as cards
// in the chat) and "Dispatch the ticket" (a bot finds the best person), no
// "Assign me"; the + opens Meeting, Resource, Activity. No Team and Location
// row: the fields column has them.
import { useEffect, useState } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { RECORD_ACTION, RECORD_LINK_ACTION, RecordAddButton, RecordEntryForm, RecordPod, RecordRowActions, type RecordFormField, type RecordFormValues } from "@/components/record-window/RecordBlocks";
import { RecordGrid, type RecordColumn } from "@/components/record-window/RecordGrid";
import { ScheduleCell, ScheduleTypeChip, scheduleKindLabel, type ScheduleKind } from "@/components/record-window/ScheduleCell";
import type { RecordDetail } from "@/components/useRecordDetail";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { RecordChoice } from "@/lib/record-detail";
import { RECORD_PLAN_KINDS, RECORD_SUBJECT_MAX, type RecordPlanKind } from "../../../../shared/record-actions";
import type { RecordRef } from "../../../../shared/record-cards";
import { RecordName } from "./parts";

export interface PlanRow {
  key: string;
  id?: string;
  kind: ScheduleKind;
  /** a person (a meeting, a resource) or a subject (an activity) */
  title: string;
  titleRef?: RecordRef;
  /** an activity's person, under its subject */
  detail?: string;
  detailRef?: RecordRef;
  when: string;
  where: string;
  at?: string;
  done: boolean;
}

/** A planned entry's time: "14 déc. 2026, 14 h 30 à 15 h 30", the day said once when it ends the same day. */
export function rangeOf(at: string | undefined, endAt: string | undefined, start: string, end: string): string {
  const from = at ? new Date(at) : null;
  if (!from || !Number.isFinite(from.getTime())) return start ? (end ? t("recordWindow.schedule.range", { start, end }) : start) : t("recordCard.related.unscheduled");
  const lang = activeLocale();
  const day = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
  const clock = new Intl.DateTimeFormat(lang, { timeStyle: "short" });
  const to = endAt ? new Date(endAt) : null;
  const first = `${day.format(from)}, ${clock.format(from)}`;
  if (!to || !Number.isFinite(to.getTime())) return first;
  const last = day.format(to) === day.format(from) ? clock.format(to) : `${day.format(to)}, ${clock.format(to)}`;
  return t("recordWindow.schedule.range", { start: first, end: last });
}

/** The ticket's planned entries, one list: open first, each part newest first. */
export function planRows(detail: RecordDetail): { open: PlanRow[]; done: PlanRow[]; loading: boolean; error: string } {
  const schedule = detail.section("schedule");
  const activities = detail.section("activities");
  const rows: PlanRow[] = [
    ...(schedule.page?.lines ?? []).map((row, index) => ({
      key: `s-${row.id ?? index}`, ...(row.id ? { id: row.id } : {}), kind: row.kind,
      title: row.kind === "meeting" && row.subject ? row.subject : row.resource || t("recordCard.related.unassigned"),
      ...(row.resourceRef && !(row.kind === "meeting" && row.subject) ? { titleRef: row.resourceRef } : {}),
      ...(row.kind === "meeting" && row.subject && row.resource ? { detail: row.resource, ...(row.resourceRef ? { detailRef: row.resourceRef } : {}) } : {}),
      when: rangeOf(row.at, row.endAt, row.start, row.end),
      where: row.where, ...(row.at ? { at: row.at } : {}), done: row.done === true,
    })),
    ...(activities.page?.lines ?? []).map((row, index) => ({
      key: `a-${row.id ?? index}`, ...(row.id ? { id: row.id } : {}), kind: "activity" as const,
      title: row.subject, ...(row.assigned ? { detail: row.assigned } : {}), ...(row.assignedRef ? { detailRef: row.assignedRef } : {}),
      when: row.date ? t("recordWindow.schedule.dueOn", { date: row.date }) : "", where: "", ...(row.at ? { at: row.at } : {}), done: row.done === true,
    })),
  ];
  const time = (row: PlanRow) => (row.at ? Date.parse(row.at) : NaN);
  const order = (a: PlanRow, b: PlanRow) => {
    const left = time(a), right = time(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
    // an entry with no time yet (not scheduled) comes after the planned ones
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    return 0;
  };
  return {
    open: rows.filter((row) => !row.done).sort(order),
    done: rows.filter((row) => row.done).sort(order),
    loading: Boolean(schedule.loading || activities.loading) && !schedule.page && !activities.page,
    error: schedule.error || activities.error,
  };
}

function fieldsFor(kind: RecordPlanKind, row?: PlanRow): RecordFormField[] {
  const member: RecordFormField = { key: "member", label: t(kind === "activity" ? "recordWindow.schedule.assigned" : "recordWindow.schedule.person"), kind: "choice", choices: [], value: "" };
  if (kind === "activity") {
    return [
      { key: "subject", label: t("recordWindow.schedule.subject"), kind: "text", required: true, max: RECORD_SUBJECT_MAX, value: row?.title ?? "" },
      { key: "start", label: t("recordWindow.schedule.due"), kind: "datetime" },
      member,
    ];
  }
  return [
    member,
    { key: "start", label: t("recordWindow.schedule.start"), kind: "datetime", required: !row },
    { key: "end", label: t("recordWindow.schedule.end"), kind: "datetime" },
    ...(kind === "meeting" ? [{ key: "subject", label: t("recordWindow.schedule.subject"), kind: "text" as const, max: RECORD_SUBJECT_MAX }] : []),
    { key: "where", label: t("recordWindow.schedule.where"), kind: "choice", choices: [], value: "" },
  ];
}

/** A form whose pickers load their choices from the console once it opens. */
function PlanForm({ kind, row, detail, onDone }: { kind: RecordPlanKind; row?: PlanRow; detail: RecordDetail; onDone: () => void }) {
  const [choices, setChoices] = useState<Partial<Record<"member" | "where", RecordChoice[]>>>({});
  const { choices: read } = detail;
  useEffect(() => {
    let current = true;
    for (const field of ["member", "where"] as const) {
      read(field).then((list) => { if (current) setChoices((now) => ({ ...now, [field]: list })); }, () => { if (current) setChoices((now) => ({ ...now, [field]: [] })); });
    }
    return () => { current = false; };
  }, [read]);
  const fields = fieldsFor(kind, row).map((field) => field.kind === "choice" && (field.key === "member" || field.key === "where") ? { ...field, choices: choices[field.key] ?? [] } : field)
    // a list the console has nothing in is left out rather than shown empty
    .filter((field) => field.kind !== "choice" || field.choices.length > 0 || choices[field.key as "member" | "where"] === undefined);
  const submit = async (values: RecordFormValues) => {
    const set: Record<string, string> = { kind };
    for (const [key, value] of Object.entries(values)) if (typeof value === "string" && value) set[key] = value;
    await detail.write(row?.id ? { action: "schedule.update", id: row.id, set } : { action: "schedule.add", set });
    onDone();
  };
  return (
    <RecordEntryForm data-record-plan-form={kind} fields={fields}
      submitLabel={t(row ? "recordWindow.save" : "recordWindow.schedule.addKind", { kind: scheduleKindLabel(kind) })} onCancel={onDone} onSubmit={submit} />
  );
}

export function TicketPlanTab({ detail, type, onScheduleMe, onDispatch }: {
  detail: RecordDetail;
  /** the window's type: the table's columns are kept for it */
  type: string;
  /** a bot finds the best time and proposes it as cards in the chat (absent: no conversation to ask in) */
  onScheduleMe?: () => void;
  /** a bot finds the best person for the ticket */
  onDispatch?: () => void;
}) {
  const { open, done, loading, error } = planRows(detail);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState<RecordPlanKind | null>(null);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [asked, setAsked] = useState<"me" | "dispatch" | null>(null);
  const canAdd = detail.can("schedule.add");
  const rows = showDone ? [...open, ...done] : open;
  const columns: RecordColumn<PlanRow>[] = [
    { id: "type", label: t("recordWindow.schedule.type"), width: 120, text: (row) => scheduleKindLabel(row.kind), cell: (row) => <ScheduleTypeChip kind={row.kind} /> },
    { id: "who", label: t("recordWindow.schedule.who"), width: 200, text: (row) => `${row.title} ${row.detail ?? ""}`,
      cell: (row) => <ScheduleCell done={row.done} title={<RecordName name={row.title} recordRef={row.titleRef} />} detail={row.detail ? <RecordName name={row.detail} recordRef={row.detailRef} /> : undefined} /> },
    { id: "when", label: t("recordWindow.schedule.when"), kind: "date", text: (row) => row.when, cell: (row) => <span className={cn("tabular-nums", row.done && "text-popover-ink-secondary")}>{row.when}</span> },
    { id: "where", label: t("recordWindow.schedule.where"), width: 112, text: (row) => row.where },
    {
      id: "actions", label: "", fixed: true, width: 216, text: () => "", className: "text-end",
      cell: (row) => (
        <span className="flex items-center justify-end gap-1">
          {row.id && detail.can("schedule.done") && (
            <button type="button" className={cn(RECORD_ACTION, "h-7 bg-transparent px-2 hover:bg-popover-hover")} data-record-mark-done={row.done ? "reopen" : "done"}
              onClick={() => { void detail.write({ action: "schedule.done", id: row.id!, set: { kind: row.kind, done: !row.done } }); }}>
              {row.done ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{t(row.done ? "recordWindow.schedule.reopen" : "recordWindow.schedule.markDone")}
            </button>
          )}
          <RecordRowActions name={`${scheduleKindLabel(row.kind)} ${row.title}`}
            onEdit={row.id && detail.can("schedule.update") ? () => { setAdding(null); setEditing(row); } : undefined}
            onRemove={row.id && detail.can("schedule.remove") ? () => detail.write({ action: "schedule.remove", id: row.id!, set: { kind: row.kind } }) : undefined} />
        </span>
      ),
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-tab-panel="plan">
      <RecordPod
        data-record-plan=""
        title={t("recordWindow.tabs.plan")}
        count={open.length}
        actions={<>
          {onScheduleMe && <button type="button" className={RECORD_ACTION} title={t("recordWindow.schedule.meHint")} onClick={() => { onScheduleMe(); setAsked("me"); }} data-record-schedule-me=""><Sparkles size={14} aria-hidden="true" />{t("recordWindow.schedule.me")}</button>}
          {onDispatch && <button type="button" className={RECORD_ACTION} title={t("recordWindow.schedule.dispatchHint")} onClick={() => { onDispatch(); setAsked("dispatch"); }} data-record-dispatch=""><Sparkles size={14} aria-hidden="true" />{t("recordWindow.schedule.dispatch")}</button>}
          {canAdd && <RecordAddButton<RecordPlanKind> label={t("recordWindow.schedule.add")} choices={RECORD_PLAN_KINDS.map((kind) => ({ id: kind, label: scheduleKindLabel(kind) }))} onAdd={(kind) => { setEditing(null); setAdding(kind ?? "resource"); }} />}
        </>}
      >
        {asked && <p role="status" className="text-[13px] leading-[18px] text-popover-ink-secondary" data-record-bot-asked="">{t(asked === "me" ? "recordWindow.schedule.meAsked" : "recordWindow.schedule.dispatchAsked")}</p>}
        {adding && <PlanForm kind={adding} detail={detail} onDone={() => setAdding(null)} />}
        {editing && editing.kind && <PlanForm key={editing.key} kind={editing.kind} row={editing} detail={detail} onDone={() => setEditing(null)} />}
        {error ? <p role="status" className="py-2 text-popover-ink-secondary">{error}</p>
          : loading ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
          : <RecordGrid type={type} grid="plan" label={t("recordWindow.tabs.plan")} columns={columns} rows={rows} rowKey={(row) => row.key}
              rowAttributes={(row) => ({ "data-plan-row": row.kind, "data-plan-done": row.done ? "" : undefined })}
              empty={t("recordWindow.schedule.none")} />}
        {done.length > 0 && (
          <button type="button" className={cn(RECORD_LINK_ACTION, "self-center")} aria-expanded={showDone} onClick={() => setShowDone(!showDone)} data-record-show-done="">
            {t(showDone ? "recordWindow.schedule.hideDone" : "recordWindow.schedule.showDone", { count: done.length })}
          </button>
        )}
      </RecordPod>
    </div>
  );
}
