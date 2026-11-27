// A ticket's Time & expenses tab, one tab (M-20261127-108): a block of the
// totals with the B, NC and DNB share, then one list by day where each entry
// shows its note, the person, the work type, its amount and its B, NC or DNB
// tag, changed in place (M-20261127-101, M-20261127-138); "+ Time" and
// "+ Expense" open their form (M-20261127-110), and an entry is edited or
// removed at its right.
//
// The totals are the console's words when it sends them; a console that
// sends the entries' numbers only gets them added here (two decimals), never
// from the entries' words.
import { useEffect, useId, useState } from "react";
import { Clock, Plus, Receipt } from "lucide-react";
import { PillTabs } from "@/components/PillTabs";
import { RECORD_ACTION, RecordEntryForm, RecordPod, RecordRowActions, type RecordFormField, type RecordFormValues } from "@/components/record-window/RecordBlocks";
import type { RecordDetail } from "@/components/useRecordDetail";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { ExpenseRow, RecordChoice, TimeRow, TimeTotals } from "@/lib/record-detail";
import { RECORD_BILLING, RECORD_LINE_NOTE_MAX, type RecordBilling } from "../../../../shared/record-actions";
import { BILLING_FILL, BillingTag, billingLabel, clockOf, dayOf, decimal, RecordName } from "./parts";

const SHOWN = ["all", "time", "expenses"] as const;
type Shown = (typeof SHOWN)[number];

type Entry = { key: string; kind: "time"; row: TimeRow } | { key: string; kind: "expense"; row: ExpenseRow };

/** The currency of an amount's words ("12,50 $", "$12.50"): what is neither a digit nor a separator. */
function currencyOf(amount: string | undefined): string {
  return (amount ?? "").replace(/[\d\s.,  -]/g, "").trim();
}

/** The totals shown: the console's, else the entries' numbers added up. */
export function timeTotals(time: readonly TimeRow[], expenses: readonly ExpenseRow[], given?: TimeTotals): Required<Pick<TimeTotals, "parts">> & TimeTotals {
  const sums: Record<RecordBilling, number> = { B: 0, NC: 0, DNB: 0 };
  let hours = 0;
  let counted = 0;
  for (const row of time) {
    if (row.value === undefined) continue;
    counted += 1;
    hours += row.value;
    if (row.billing) sums[row.billing] += row.value;
  }
  const spent = expenses.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const unit = currencyOf(expenses.find((row) => row.amount)?.amount);
  const money = (value: number) => (unit === "$" || !unit ? `${decimal(value)}${unit ? ` ${unit}` : ""}` : `${decimal(value)} ${unit}`);
  const known = counted > 0;
  const parts: TimeTotals["parts"] = { ...(known ? Object.fromEntries(RECORD_BILLING.map((billing) => [billing, { text: `${decimal(sums[billing])} h`, share: hours > 0 ? (sums[billing] / hours) * 100 : 0 }])) : {}), ...given?.parts };
  return {
    hours: given?.hours ?? (known ? `${decimal(hours)} h` : undefined),
    billable: given?.billable ?? (known ? `${decimal(sums.B)} h` : undefined),
    expenses: given?.expenses ?? (expenses.some((row) => row.value !== undefined) ? money(spent) : undefined),
    parts,
  };
}

function TimeForm({ kind, entry, detail, onDone }: { kind: "time" | "expense"; entry?: Entry; detail: RecordDetail; onDone: () => void }) {
  const [types, setTypes] = useState<RecordChoice[] | undefined>();
  const { choices } = detail;
  useEffect(() => {
    let current = true;
    choices(kind === "time" ? "work_type" : "expense_type").then((list) => { if (current) setTypes(list); }, () => { if (current) setTypes([]); });
    return () => { current = false; };
  }, [choices, kind]);
  const billing: RecordFormField = { key: "billing", label: t("recordWindow.billing.label"), kind: "choice", required: true, value: entry?.row.billing ?? "B", choices: RECORD_BILLING.map((value) => ({ value, label: `${value} · ${billingLabel(value)}` })) };
  const typeField: RecordFormField[] = types?.length ? [{ key: kind === "time" ? "work_type" : "type", label: t(kind === "time" ? "recordWindow.time.workType" : "recordWindow.time.expenseType"), kind: "choice", choices: types }] : [];
  const fields: RecordFormField[] = kind === "time"
    ? [
      { key: "hours", label: t("recordWindow.time.hours"), kind: "number", required: !entry, min: 0.01, max: 24, step: 0.05, value: entry?.kind === "time" && entry.row.value !== undefined ? String(entry.row.value) : "" },
      { key: "start", label: t("recordWindow.time.start"), kind: "datetime" },
      ...typeField, billing,
      { key: "note", label: t("recordWindow.time.note"), kind: "textarea", max: RECORD_LINE_NOTE_MAX, value: entry?.row.note ?? "" },
    ]
    : [
      { key: "amount", label: t("recordWindow.time.amount"), kind: "number", required: !entry, min: 0.01, max: 10_000_000, step: 0.01, value: entry?.kind === "expense" && entry.row.value !== undefined ? String(entry.row.value) : "" },
      { key: "date", label: t("recordWindow.time.date"), kind: "date" },
      ...typeField, billing,
      { key: "note", label: t("recordWindow.time.note"), kind: "textarea", max: RECORD_LINE_NOTE_MAX, value: entry?.row.note ?? "" },
    ];
  const submit = async (values: RecordFormValues) => {
    const set: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) if (typeof value === "string" && value) set[key] = key === "hours" || key === "amount" ? value.replace(",", ".") : value;
    const id = entry?.row.id;
    if (kind === "time") await detail.write(id ? { action: "time.update", id, set } : { action: "time.add", set });
    else await detail.write(id ? { action: "expense.update", id, set } : { action: "expense.add", set });
    onDone();
  };
  return <RecordEntryForm data-record-time-form={kind} fields={fields} submitLabel={t(entry ? "recordWindow.save" : kind === "time" ? "recordWindow.time.addTime" : "recordWindow.time.addExpense")} onCancel={onDone} onSubmit={submit} />;
}

function EntryRow({ entry, detail, tz, onEdit }: { entry: Entry; detail: RecordDetail; tz?: string; onEdit?: () => void }) {
  const time = entry.kind === "time";
  const row = entry.row;
  const note = time ? (row as TimeRow).note : (row as ExpenseRow).note;
  const sort = time ? (row as TimeRow).workType : (row as ExpenseRow).type;
  const at = clockOf(row.at, tz);
  const id = row.id;
  const update = time ? "time.update" as const : "expense.update" as const;
  const remove = time ? "time.remove" as const : "expense.remove" as const;
  return (
    <li className="flex min-w-0 items-start gap-3 py-3" data-record-entry={entry.kind}>
      <span aria-hidden="true" className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover", time ? "text-accent" : "text-warning")} title={t(time ? "recordWindow.time.timeEntry" : "recordWindow.time.expense")}>
        {time ? <Clock size={16} /> : <Receipt size={16} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="min-w-0 whitespace-pre-line break-words">{note || (time ? (row as TimeRow).hours : (row as ExpenseRow).amount)}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-popover-ink-secondary">
          <RecordName name={row.member} recordRef={row.memberRef} />
          {sort && <><span aria-hidden="true">·</span><span>{sort}</span></>}
          {at && <><span aria-hidden="true">·</span><span className="tabular-nums">{at}</span></>}
        </span>
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-semibold tabular-nums" data-record-entry-amount="">{time ? (row as TimeRow).hours : (row as ExpenseRow).amount}</span>
        <BillingTag billing={row.billing} onChange={id && detail.can(update) ? (billing) => detail.write({ action: update, id, set: { billing } }) : undefined} />
      </span>
      <RecordRowActions name={note || t(time ? "recordWindow.time.timeEntry" : "recordWindow.time.expense")}
        onEdit={id && detail.can(update) ? onEdit : undefined}
        onRemove={id && detail.can(remove) ? () => detail.write({ action: remove, id }) : undefined} />
    </li>
  );
}

export function TicketTimeTab({ detail, tz }: { detail: RecordDetail; tz?: string }) {
  const id = useId();
  const time = detail.section("time");
  const expenses = detail.section("expenses");
  const [shown, setShown] = useState<Shown>("all");
  const [form, setForm] = useState<{ kind: "time" | "expense"; entry?: Entry } | null>(null);
  const timeRows = time.page?.lines ?? [];
  const expenseRows = expenses.page?.lines ?? [];
  const totals = timeTotals(timeRows, expenseRows, time.page?.totals);
  const entries: Entry[] = [
    ...(shown !== "expenses" ? timeRows.map((row, index): Entry => ({ key: `t-${row.id ?? index}`, kind: "time", row })) : []),
    ...(shown !== "time" ? expenseRows.map((row, index): Entry => ({ key: `e-${row.id ?? index}`, kind: "expense", row })) : []),
  ];
  // one list by day, newest first; an entry with no instant goes by its date's words
  const instant = (entry: Entry) => (entry.row.at ? Date.parse(entry.row.at) : NaN);
  entries.sort((a, b) => {
    const left = instant(a), right = instant(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return right - left;
    return Number.isFinite(left) ? -1 : Number.isFinite(right) ? 1 : 0;
  });
  const days: Array<{ key: string; day: string; weekday: string; entries: Entry[]; hours: number; spent: number }> = [];
  for (const entry of entries) {
    const day = dayOf(entry.row.at, entry.row.date, tz);
    let group = days.find((one) => one.key === day.key);
    if (!group) { group = { ...day, entries: [], hours: 0, spent: 0 }; days.push(group); }
    group.entries.push(entry);
    if (entry.kind === "time") group.hours += entry.row.value ?? 0;
    else group.spent += entry.row.value ?? 0;
  }
  const unit = currencyOf(expenseRows.find((row) => row.amount)?.amount);
  const loading = (time.loading && !time.page) || (expenses.loading && !expenses.page);
  const error = time.error || expenses.error;
  const parts = RECORD_BILLING.filter((billing) => totals.parts[billing]);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4" data-record-tab-panel="time">
      <RecordPod data-record-time-totals=""
        title={<span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {totals.hours && <><span className="text-[18px] font-semibold tabular-nums" data-record-total-hours="">{totals.hours}</span>{totals.billable && <span className="text-[13px] font-normal text-popover-ink-secondary">{t("recordWindow.time.ofWhichBillable", { hours: totals.billable })}</span>}</>}
          {totals.expenses && <><span aria-hidden="true" className="mx-1 h-4 w-px self-center bg-popover-hairline" /><span className="text-[18px] font-semibold tabular-nums" data-record-total-expenses="">{totals.expenses}</span><span className="text-[13px] font-normal text-popover-ink-secondary">{t("recordWindow.time.ofExpenses")}</span></>}
          {!totals.hours && !totals.expenses && <span>{t("recordWindow.tabs.time")}</span>}
        </span>}
        actions={<>
          {detail.can("time.add") && <button type="button" className={RECORD_ACTION} onClick={() => setForm({ kind: "time" })} data-record-add-time=""><Plus size={14} aria-hidden="true" />{t("recordWindow.time.addTime")}</button>}
          {detail.can("expense.add") && <button type="button" className={RECORD_ACTION} onClick={() => setForm({ kind: "expense" })} data-record-add-expense=""><Plus size={14} aria-hidden="true" />{t("recordWindow.time.addExpense")}</button>}
        </>}
      >
        {parts.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex h-1.5 min-w-0 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((billing) => `${billingLabel(billing)} ${totals.parts[billing]?.text ?? ""}`).join(", ")} data-record-billing-bar="">
              {parts.map((billing) => <span key={billing} className={cn("h-full rounded-full", BILLING_FILL[billing])} style={{ flexGrow: Math.max(0.001, totals.parts[billing]?.share ?? 0) }} />)}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-[18px] text-popover-ink-secondary">
              {parts.map((billing) => <li key={billing} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-2 rounded-sm", BILLING_FILL[billing])} />{billingLabel(billing)}{totals.parts[billing]?.text ? ` · ${totals.parts[billing]!.text}` : ""}</li>)}
            </ul>
          </div>
        )}
      </RecordPod>
      {form && <TimeForm key={`${form.kind}-${form.entry?.key ?? "new"}`} kind={form.kind} entry={form.entry} detail={detail} onDone={() => setForm(null)} />}
      <PillTabs tabs={SHOWN} tab={shown} onTab={setShown} ariaLabel={t("recordWindow.time.filter")} idPrefix={id} label={(key) => t(`recordWindow.time.show.${key}` as "recordWindow.time.show.all")} className="gap-y-1" data-record-time-filter="" />
      <div role="tabpanel" id={`${id}-panel-${shown}`} aria-labelledby={`${id}-tab-${shown}`} aria-busy={loading} className="flex min-w-0 flex-col gap-3">
        {error ? <p role="status" className="py-2 text-popover-ink-secondary">{error}</p>
          : loading ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>
          : days.length ? days.map((day) => (
            <RecordPod key={day.key} data-record-day={day.key} bodyClassName="-my-3"
              title={<span className="flex items-baseline gap-2"><span>{day.day}</span><span className="text-[13px] font-normal text-popover-ink-secondary">{[day.weekday, day.hours ? `${decimal(day.hours)} h` : "", day.spent ? `${decimal(day.spent)}${unit ? ` ${unit}` : ""}` : ""].filter(Boolean).join(" · ")}</span></span>}>
              <ul className="flex min-w-0 flex-col divide-y divide-popover-hairline">
                {day.entries.map((entry) => <EntryRow key={entry.key} entry={entry} detail={detail} tz={tz} onEdit={() => setForm({ kind: entry.kind === "time" ? "time" : "expense", entry })} />)}
              </ul>
            </RecordPod>
          ))
          : <p className="py-2 text-popover-ink-secondary">{t("recordWindow.time.none")}</p>}
      </div>
    </div>
  );
}
