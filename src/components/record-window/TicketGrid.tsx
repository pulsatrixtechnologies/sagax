// Tickets as the board shows them, one grid shared by every window that lists
// tickets (a company's, a contact's, the board's: M-20261127-145): the
// priority, the number, the subject (a click opens the ticket in the window),
// the status, the type, the next planned entry with who in its tooltip
// (M-20261127-129), the owner and when it was updated, under the one filter,
// its columns moved and resized (RecordGrid.tsx). A column no row fills is
// left out (a console that sends the card's short list only).
import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { TONE_CLASS, TONE_DOT } from "@/components/RecordCard";
import { RecordAvatar } from "@/components/record-window/RecordBlocks";
import { RecordGrid, type RecordColumn } from "@/components/record-window/RecordGrid";
import { RecordName } from "@/components/record-window/ticket/parts";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatAbsolute, formatFull, formatRelative } from "@/lib/record-card-format";
import type { TicketRow } from "@/lib/record-detail";
import type { RecordLevel, RecordTone } from "../../../shared/record-cards";

// the priority's mark: the level's tone (urgent the danger token, high the warning, normal the accent, low the quiet ink)
const LEVEL_MARK: Record<RecordLevel, string> = { urgent: "bg-danger", high: "bg-warning", normal: "bg-accent", low: "bg-popover-ink-secondary/50" };

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

/** The next planned entry: its day and time, who in the tooltip and the accessible name, "+N" when several. */
export function NextPlanned({ next, closed, now, tz }: { next?: TicketRow["next"]; closed?: boolean; now: number; tz?: string }) {
  const lang = activeLocale();
  if (closed) return <span className="text-popover-ink-secondary">{t("recordWindow.tickets.closed")}</span>;
  if (!next) return <span className="text-popover-ink-secondary">{t("recordCard.related.unscheduled")}</span>;
  const when = next.at ? formatAbsolute(next.at, now, lang, tz) : next.date;
  const who = next.who.join(", ");
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={who ? t("recordWindow.tickets.nextWho", { who }) : undefined} data-ticket-next="">
      <CalendarDays size={14} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      <span className="min-w-0 break-words tabular-nums">{when}</span>
      {next.who.length > 1 && <span className="shrink-0 text-[13px] text-popover-ink-secondary" aria-hidden="true">+{next.who.length - 1}</span>}
      {who && <span className="sr-only">{t("recordWindow.tickets.nextWho", { who })}</span>}
    </span>
  );
}

export function TicketGrid({ type, grid = "tickets", rows, label, now, tz, company = false, toolbar, empty }: {
  /** the window's type: the columns are kept for it */
  type: string;
  grid?: string;
  rows: readonly TicketRow[];
  label: string;
  now: number;
  tz?: string;
  /** the board lists several companies: their column */
  company?: boolean;
  toolbar?: ReactNode;
  empty?: ReactNode;
}) {
  const lang = activeLocale();
  const updated = (row: TicketRow) => (row.updated ? formatRelative(row.updated, now, lang, tz) : row.updatedText);
  const all: RecordColumn<TicketRow>[] = [
    { id: "priority", label: t("recordWindow.tickets.priority"), width: 76, text: (row) => row.priority,
      cell: (row) => row.priority || row.level ? (
        <span className="flex items-center" title={row.priority || undefined}>
          <span aria-hidden="true" className={cn("h-5 w-1 rounded-full", LEVEL_MARK[row.level ?? "normal"])} />
          <span className="sr-only">{row.priority}</span>
        </span>
      ) : null },
    { id: "number", label: t("recordWindow.tickets.number"), width: 96, text: (row) => row.number, cell: (row) => <span dir="ltr" className="font-mono text-[13px] text-popover-ink-secondary [unicode-bidi:isolate]">{row.number}</span> },
    { id: "summary", label: t("recordWindow.tickets.summary"), width: 280, text: (row) => row.summary,
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="min-w-0 font-medium"><RecordName name={row.summary} recordRef={row.ref} /></span>
          {company && row.company && <span className="text-[13px] leading-[18px] text-popover-ink-secondary"><RecordName name={row.company} recordRef={row.companyRef} /></span>}
        </span>
      ) },
    { id: "status", label: t("recordCard.related.status"), width: 136, text: (row) => row.status, cell: (row) => <StateChip label={row.status} tone={row.tone} /> },
    { id: "type", label: t("recordCard.related.type"), width: 120, text: (row) => row.type, cell: (row) => <span className="text-popover-ink-secondary">{row.type}</span> },
    { id: "next", label: t("recordWindow.tickets.next"), width: 190, kind: "date", text: (row) => (row.closed ? t("recordWindow.tickets.closed") : row.next ? `${row.next.date} ${row.next.who.join(" ")}` : ""),
      cell: (row) => <NextPlanned next={row.next} closed={row.closed} now={now} tz={tz} /> },
    { id: "owner", label: t("recordWindow.tickets.owner"), width: 160, text: (row) => row.owner,
      cell: (row) => row.owner ? <span className="flex min-w-0 items-center gap-2"><RecordAvatar name={row.owner} /><span className="min-w-0 truncate"><RecordName name={row.owner} recordRef={row.ownerRef} /></span></span> : null },
    { id: "updated", label: t("recordWindow.tickets.updated"), width: 148, kind: "date", text: updated,
      cell: (row) => row.updated ? <time dateTime={row.updated} title={formatFull(row.updated, lang, tz)} className="text-popover-ink-secondary">{updated(row)}</time> : <span className="text-popover-ink-secondary">{row.updatedText}</span> },
  ];
  // a column no row fills says nothing: left out (the next entry is always said, "Not scheduled" too, once a row has one)
  const columns = all.filter((column) => column.id === "summary" || rows.some((row) => column.id === "next" ? Boolean(row.next || row.closed) : column.id === "priority" ? Boolean(row.priority || row.level) : column.text(row)));
  return (
    <RecordGrid type={type} grid={grid} label={label} columns={columns} rows={rows} rowKey={(row) => row.id ?? row.ref?.id ?? `${row.number}-${row.summary}`}
      rowAttributes={(row) => ({ "data-ticket-row": row.number || row.summary, ...(row.closed ? { "data-ticket-closed": "" } : {}) })} toolbar={toolbar} empty={empty} />
  );
}
