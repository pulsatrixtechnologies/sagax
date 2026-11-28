// A list of tickets in a record window (M-20261127-145, M-20261127-129): one
// plain grid, never grouped by status. Each row: the priority as a bar of its
// colour, the number, the subject with the company under it, the status, the
// type, the next scheduling (a calendar, going on now, or not scheduled, and
// its date; resting on it says who is planned, when, and whether they saw
// it), the owner, the age. Shared by every record that lists tickets (a board,
// a company, a contact, D-20261127-009): the subject, the company and the
// owner open their record in the same window with a way back
// (M-20261127-101). Columns move and resize (RecordGrid); the one filter is
// the window's own.
import { Ban, CalendarDays, Check, ChevronRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { FieldValue, RecordRefChip, TONE_CLASS, TONE_DOT, useOpenRef } from "@/components/RecordCard";
import { HoverCard } from "@/components/LinkHoverCard";
import { MENU_BOX } from "@/components/menu-look";
import { RecordAvatar } from "@/components/record-window/RecordBlocks";
import { RecordGrid, type RecordColumn } from "@/components/record-window/RecordGrid";
import { rangeOf } from "@/components/record-window/ticket/TicketPlanTab";
import { RecordName } from "@/components/record-window/ticket/parts";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatFull, formatRelative } from "@/lib/record-card-format";
import type { NextPlan, TicketRow } from "@/lib/record-detail";
import type { RecordLevel, RecordRef, RecordTone } from "../../../shared/record-cards";

/** A priority's bar: urgent in the danger tone, high in the warning, normal in the accent, low quiet. */
export const LEVEL_FILL: Record<RecordLevel, string> = {
  urgent: "bg-danger",
  high: "bg-warning",
  normal: "bg-accent",
  low: "bg-popover-ink-secondary",
};

/** A state as a pill: its tone's tint under the popover ink, its dot (the card's chips). */
export function StateChip({ label, tone = "open" }: { label: string; tone?: RecordTone }) {
  if (!label) return null;
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-[18px] text-popover-ink", TONE_CLASS[tone])} title={label} data-state-chip={tone}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function PriorityBar({ row, className }: { row: Pick<TicketRow, "level" | "priority">; className?: string }) {
  return (
    <span role="img" aria-label={row.priority || t("recordWindow.tickets.noPriority")} title={row.priority || undefined}
      className={cn("inline-block h-5 w-1 shrink-0 rounded-full", row.level ? LEVEL_FILL[row.level] : "bg-popover-hairline", className)} data-ticket-priority={row.level ?? ""} />
  );
}

/** The words of a ticket's next scheduling, in the record's zone. */
export function nextPlanWords(next: NextPlan | undefined, now: number, tz?: string): string {
  if (!next) return "";
  if (next.state === "ongoing") return t("recordWindow.tickets.ongoing");
  if (next.state === "none") return t("recordCard.related.unscheduled");
  const at = next.at ?? next.people.find((one) => one.at)?.at;
  return at ? formatAbsolute(at, now, activeLocale(), tz) : t("recordWindow.tickets.planned");
}

function NextTip({ next }: { next: NextPlan }) {
  return (
    <div className={cn(MENU_BOX, "flex w-[min(22rem,calc(100vw-1rem))] flex-col gap-2 p-3 text-[13px] leading-[18px] text-popover-ink")} data-ticket-next-tip="">
      <p className="font-semibold">{t(next.state === "ongoing" ? "recordWindow.tickets.ongoing" : next.people.length ? "recordWindow.tickets.planned" : "recordWindow.tickets.nobody")}</p>
      {next.people.length ? (
        <ul className="flex flex-col gap-2">
          {next.people.map((person, index) => (
            <li key={`${person.name}-${index}`} className="flex min-w-0 items-start gap-2" data-ticket-next-person="">
              <RecordAvatar name={person.name} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words font-medium"><RecordName name={person.name} recordRef={person.ref} /></span>
                {(person.at ?? next.at) && <span className="text-popover-ink-secondary">{rangeOf(person.at ?? next.at, person.endAt ?? next.endAt, "", "")}</span>}
              </span>
              {person.seen !== undefined && (
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-popover-ink-secondary" data-ticket-seen={person.seen ? "yes" : "no"}>
                  {person.seen && <Check size={13} aria-hidden="true" className="text-success" />}
                  {t(person.seen ? "recordWindow.tickets.seen" : "recordWindow.tickets.notSeen")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-1.5 text-popover-ink-secondary"><Sparkles size={13} aria-hidden="true" className="mt-0.5 shrink-0" />{t("recordWindow.tickets.dispatchHint")}</p>
      )}
    </div>
  );
}

/** The next scheduling: its icon in its tone, its date, `+N` for the others planned; resting on it says who (M-20261127-129). */
export function NextPlanCell({ next, now, tz }: { next?: NextPlan; now: number; tz?: string }) {
  if (!next) return null;
  const Icon = next.state === "ongoing" ? ChevronRight : next.state === "none" ? Ban : CalendarDays;
  const words = nextPlanWords(next, now, tz);
  // the same words as the hover, for a screen reader: who is planned and whether they saw it
  const said = [words, ...next.people.map((person) => person.seen === undefined ? person.name : `${person.name}, ${t(person.seen ? "recordWindow.tickets.seen" : "recordWindow.tickets.notSeen")}`)].join(" · ");
  return (
    <HoverCard kind="ticket-next" card={() => <NextTip next={next} />}>
      {(anchor) => (
        <span {...anchor} tabIndex={0} aria-label={said} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-ticket-next={next.state}>
          <Icon size={15} aria-hidden="true" className={cn("shrink-0", next.state === "ongoing" ? "text-success" : next.state === "none" ? "text-popover-ink-secondary" : "text-popover-ink")} />
          <span className={cn("min-w-0 truncate", next.state === "none" && "text-popover-ink-secondary")}>{words}</span>
          {next.people.length > 1 && <span className="shrink-0 text-[13px] text-popover-ink-secondary">+{next.people.length - 1}</span>}
        </span>
      )}
    </HoverCard>
  );
}

/** The owner's initials, a click opening their record when they are one; nobody: a dashed ring. */
export function OwnerCell({ name, ownerRef }: { name: string; ownerRef?: RecordRef }) {
  const open = useOpenRef(ownerRef);
  if (!name) return <span role="img" aria-label={t("recordCard.related.unassigned")} title={t("recordCard.related.unassigned")} className="inline-block size-7 rounded-full border border-dashed border-popover-ink-secondary" data-ticket-owner="" />;
  const avatar = <RecordAvatar name={name} />;
  if (ownerRef && open) {
    return <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" title={name} aria-label={name} onClick={() => open(ownerRef, name)} data-ticket-owner={name}>{avatar}</button>;
  }
  return <span title={name} className="inline-flex" data-ticket-owner={name}>{avatar}<span className="sr-only">{name}</span></span>;
}

/** A record named in the quiet ink (the company under a subject, an invoice's agreement); a click opens it in the window (M-20261127-101). */
export function QuietRecordName({ name, recordRef }: { name: string; recordRef?: RecordRef }) {
  const open = useOpenRef(recordRef);
  const look = "min-w-0 max-w-full break-words text-start text-[13px] leading-[18px] text-popover-ink-secondary";
  if (!name) return null;
  return recordRef && open
    ? <button type="button" dir="auto" className={cn(look, "rounded hover:text-popover-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus")} onClick={() => open(recordRef, name)} data-record-quiet-link="">{name}</button>
    : <span dir="auto" className={look}>{name}</span>;
}

/** The subject (a click opens the ticket in the window) and the company under it. */
function SubjectCell({ row, company }: { row: TicketRow; company: boolean }) {
  const open = useOpenRef(row.ref);
  const subject = row.ref && open ? <RecordRefChip name={row.summary} refTo={row.ref} onOpen={open} /> : <span dir="auto" className="break-words">{row.summary}</span>;
  return (
    <span className="flex min-w-0 flex-col items-start" data-ticket-subject="">
      {subject}
      {company && <QuietRecordName name={row.company ?? ""} recordRef={row.companyRef} />}
    </span>
  );
}

/** The columns of a ticket list (the filter reads their words). */
export function ticketColumns({ now, tz, company = false }: { now: number; tz?: string; company?: boolean }): RecordColumn<TicketRow>[] {
  const lang = activeLocale();
  return [
    { id: "number", label: t("recordWindow.tickets.number"), width: 128, text: (row) => `${row.number} ${row.priority}`,
      cell: (row) => <span className="flex items-center gap-2.5"><PriorityBar row={row} /><span className="tabular-nums text-popover-ink-secondary">{row.number}</span></span> },
    { id: "subject", label: t("recordWindow.schedule.subject"), width: 320, text: (row) => company ? `${row.summary} ${row.company ?? ""}` : row.summary, cell: (row) => <SubjectCell row={row} company={company} /> },
    { id: "status", label: t("recordCard.related.status"), width: 150, text: (row) => row.status,
      cell: (row) => row.status ? <FieldValue field={{ label: row.status, value: row.status, type: "state", tone: row.statusTone ?? row.tone ?? "open" }} label={t("recordCard.related.status")} now={now} lang={lang} tz={tz} /> : null },
    { id: "type", label: t("recordCard.related.type"), width: 130, text: (row) => row.type, cell: (row) => <span className="text-[13px] text-popover-ink-secondary">{row.type}</span> },
    { id: "next", label: t("recordWindow.tickets.next"), width: 210, kind: "date", text: (row) => nextPlanWords(row.next, now, tz), cell: (row) => <NextPlanCell next={row.next} now={now} tz={tz} /> },
    { id: "owner", label: t("recordWindow.tickets.owner"), width: 112, text: (row) => row.owner || t("recordCard.related.unassigned"), cell: (row) => <OwnerCell name={row.owner} ownerRef={row.ownerRef} /> },
    { id: "age", label: t("recordWindow.tickets.age"), width: 120, kind: "date", text: (row) => (row.opened ? formatRelative(row.opened, now, lang, tz) : ""),
      cell: (row) => row.opened ? <time dateTime={row.opened} title={formatFull(row.opened, lang, tz)} className="whitespace-nowrap text-[13px] text-popover-ink-secondary">{formatRelative(row.opened, now, lang, tz)}</time> : null },
  ];
}

export function TicketGrid({ type, grid = "tickets", rows, now, tz, company = false, filter = true, toolbar, empty, label }: {
  /** the window's type and the table's id: its columns are kept for them */
  type: string;
  grid?: string;
  rows: readonly TicketRow[];
  now: number;
  tz?: string;
  /** the company under each subject (a board lists several; a company's own list leaves it out) */
  company?: boolean;
  /** the grid's own filter (a window that filters several views keeps its own) */
  filter?: boolean;
  toolbar?: ReactNode;
  empty?: ReactNode;
  label: string;
}) {
  return (
    <RecordGrid type={type} grid={grid} label={label} columns={ticketColumns({ now, tz, company })} rows={rows} rowKey={(row) => row.id ?? row.ref?.id ?? `${row.number}-${row.summary}`} filter={filter} toolbar={toolbar} empty={empty}
      rowAttributes={(row) => ({ "data-ticket-row": row.id ?? row.number || row.summary || "", ...(row.closed ? { "data-ticket-closed": "" } : {}) })} />
  );
}
