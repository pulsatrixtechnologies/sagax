// A company's and a contact's business tabs (M-20261127-101, D-20261127-010):
// Tickets (the board's grid, M-20261127-145, M-20261127-129), Projects (their
// progress), Opportunities (their stages), Agreements (the use of a block of
// hours), Finance (open invoices, the age of the accounts, the balance) and
// Data (hours per month, tickets by type, the time to resolve, the billable
// share). Every figure is the console's words; a bar's length is its number
// against the largest of its chart, never a sum made here.
import { FileText } from "lucide-react";
import { RECORD_ACTION, RecordAvatar, RecordPod } from "@/components/record-window/RecordBlocks";
import { RecordList, type RecordColumn } from "@/components/record-window/RecordGrid";
import { StateChip, TicketGrid } from "@/components/record-window/TicketGrid";
import { BILLING_FILL, RecordName, billingLabel } from "@/components/record-window/ticket/parts";
import type { RecordDetail } from "@/components/useRecordDetail";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { AgreementRow, InvoiceRow, OpportunityRow, ProjectRow, StatBar } from "@/lib/record-detail";
import type { RecordCard, RecordTone } from "../../../../shared/record-cards";
import { Tiles, type When } from "./AccountProfile";
import { Panel, SectionStatus } from "./AccountLists";
import { cardTicketRows } from "./account-model";

// ── Tickets ──

export function AccountTicketsTab({ detail, card, type, when }: { detail?: RecordDetail; card: RecordCard; type: string; when: When }) {
  const fromCard = cardTicketRows(card);
  if (detail?.known) {
    const state = detail.section("tickets");
    return (
      <Panel name="tickets">
        {!state.page ? <SectionStatus state={state} /> : <TicketGrid type={type} label={t("recordWindow.account.tabs.tickets")} rows={state.page.lines} now={when.now} tz={when.tz} />}
      </Panel>
    );
  }
  // a console with no sections for this kind: the card's own open tickets, the rest on the web
  const rows = fromCard?.rows ?? [];
  const more = (fromCard?.total ?? 0) - rows.length;
  return (
    <Panel name="tickets">
      <TicketGrid type={type} label={t("recordWindow.account.tabs.tickets")} rows={rows} now={when.now} tz={when.tz} />
      {more > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-more-on-web="">
          {t("recordWindow.account.moreTickets", { count: more })}
          {card.openUrl && <button type="button" className={RECORD_ACTION} onClick={() => { void openExternalLink(card.openUrl!).catch(() => {}); }}>{t("recordCard.openWeb")}</button>}
        </p>
      )}
    </Panel>
  );
}

// ── charts (one series each: the title names it, the words say every value) ──

/** Bars standing on one line (hours per month): the accent, 4px rounded tops, each its words in a tooltip. */
export function Columns({ bars, label }: { bars: readonly StatBar[]; label: string }) {
  const most = Math.max(...bars.map((bar) => bar.value), 0);
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2" data-record-chart="columns">
      <div className="flex h-36 min-w-0 items-end gap-2 border-b border-popover-hairline" aria-hidden="true">
        {bars.map((bar, index) => (
          <span key={`${bar.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${bar.label} : ${bar.text}`}>
            <span className="block w-full max-w-9 rounded-t-[4px] bg-popover-accent" style={{ height: `${most ? Math.max(2, (bar.value / most) * 100) : 2}%` }} />
          </span>
        ))}
      </div>
      <div className="flex min-w-0 gap-2 text-[12px] leading-4 text-popover-ink-secondary" aria-hidden="true">
        {bars.map((bar, index) => <span key={`${bar.label}-${index}`} className="min-w-0 flex-1 truncate text-center">{bar.label}</span>)}
      </div>
      <ul className="sr-only" aria-label={label}>{bars.map((bar, index) => <li key={index}>{bar.label} : {bar.text}</li>)}</ul>
    </figure>
  );
}

/** Bars laid along a line (tickets by type): the label, the bar, the number. */
function Rows({ bars, label }: { bars: readonly StatBar[]; label: string }) {
  const most = Math.max(...bars.map((bar) => bar.value), 0);
  return (
    <ul className="m-0 grid min-w-0 grid-cols-[minmax(6rem,auto)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2" aria-label={label} data-record-chart="rows">
      {bars.map((bar, index) => (
        <li key={`${bar.label}-${index}`} className="contents">
          <span dir="auto" className="min-w-0 truncate">{bar.label}</span>
          <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-popover-hover"><span className="block h-full rounded-full bg-popover-accent" style={{ width: `${most ? Math.max(2, (bar.value / most) * 100) : 0}%` }} /></span>
          <span className="text-end tabular-nums text-popover-ink-secondary">{bar.text}</span>
        </li>
      ))}
    </ul>
  );
}

const PART_FILL: Record<RecordTone, string> = { done: "bg-success", waiting: "bg-warning", alert: "bg-danger", open: "bg-popover-ink-secondary/50" };

/** One bar made of parts (the age of the accounts, the billable share), 2px apart, its legend under it. */
function Parts({ parts, label }: { parts: ReadonlyArray<{ key: string; label: string; share: number; fill: string }>; label: string }) {
  const shown = parts.filter((part) => part.share > 0);
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-record-chart="parts">
      <div className="flex h-3 min-w-0 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label} : ${parts.map((part) => part.label).join(", ")}`}>
        {shown.map((part) => <span key={part.key} className={cn("h-full first:rounded-s-full last:rounded-e-full", part.fill)} style={{ flexGrow: part.share, flexBasis: 0 }} />)}
      </div>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[13px] leading-[18px]" aria-hidden="true">
        {parts.map((part) => <li key={part.key} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-sm", part.fill)} />{part.label}</li>)}
      </ul>
    </div>
  );
}

/** A block of hours as a ring: the share used in the accent, its words in the middle. */
function Ring({ share, used, of, label }: { share: number; used?: string; of?: string; label: string }) {
  const round = 2 * Math.PI * 34;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={label} className="shrink-0" data-record-ring="">
      <circle cx="48" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="10" className="text-popover-hover" />
      <circle cx="48" cy="48" r="34" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(round * share) / 100} ${round}`} transform="rotate(-90 48 48)" className="text-popover-accent" />
      {used && <text x="48" y={of ? 46 : 53} textAnchor="middle" className="fill-popover-ink text-[15px] font-semibold">{used}</text>}
      {of && <text x="48" y="62" textAnchor="middle" className="fill-popover-ink-secondary text-[10px]">{t("recordWindow.account.ofHours", { of })}</text>}
    </svg>
  );
}

// ── Projects, Opportunities, Agreements ──

function Progress({ share, label }: { share: number; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-popover-hover">
        <span className={cn("block h-full rounded-full", share >= 100 ? "bg-success" : "bg-popover-accent")} style={{ width: `${share}%` }} />
      </span>
      <span className="shrink-0 text-[13px] tabular-nums text-popover-ink-secondary">{Math.round(share)} %</span>
    </span>
  );
}

function Person({ name, recordRef }: { name: string; recordRef?: ProjectRow["managerRef"] }) {
  if (!name) return null;
  return <span className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]"><RecordAvatar name={name} /><span className="min-w-0 truncate text-popover-ink-secondary"><RecordName name={name} recordRef={recordRef} /></span></span>;
}

export function AccountProjectsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("projects");
  const columns: RecordColumn<ProjectRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "status", label: t("recordCard.related.status"), text: (row) => row.status },
    { id: "manager", label: t("recordWindow.account.manager"), text: (row) => row.manager },
  ];
  return (
    <Panel name="projects">
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="cards" label={t("recordWindow.account.tabs.projects")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? row.name}
          row={(row) => (
            <>
              <span className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1 font-medium"><RecordName name={row.name} recordRef={row.ref} /></span><StateChip label={row.status} tone={row.tone} /></span>
              {row.share !== undefined && <Progress share={row.share} label={row.name} />}
              <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1"><Person name={row.manager} recordRef={row.managerRef} /></span>{row.hours && <span className="shrink-0 text-[13px] tabular-nums text-popover-ink-secondary">{row.hours}</span>}</span>
              {row.period && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{row.period}</span>}
            </>
          )} />
      )}
    </Panel>
  );
}

export function AccountOpportunitiesTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("opportunities");
  const columns: RecordColumn<OpportunityRow>[] = [
    { id: "name", label: t("recordCard.related.name"), text: (row) => row.name },
    { id: "stage", label: t("recordWindow.account.stage"), text: (row) => row.stage },
    { id: "owner", label: t("recordWindow.tickets.owner"), text: (row) => row.owner },
  ];
  return (
    <Panel name="opportunities">
      {!state.page ? <SectionStatus state={state} /> : (
        <RecordList layout="cards" label={t("recordWindow.account.tabs.opportunities")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? row.name}
          row={(row) => (
            <>
              <span className="flex min-w-0 items-start gap-2"><span className="min-w-0 flex-1 font-medium"><RecordName name={row.name} recordRef={row.ref} /></span>{row.amount && <span className="shrink-0 text-[18px] font-semibold leading-6 tabular-nums">{row.amount}</span>}</span>
              {row.steps !== undefined && row.step !== undefined && (
                <span className="flex gap-1" role="img" aria-label={t("recordWindow.account.stepOf", { step: row.step + 1, steps: row.steps })} data-record-steps="">
                  {Array.from({ length: row.steps }, (_, index) => <span key={index} className={cn("h-1.5 flex-1 rounded-full", index <= row.step! ? "bg-popover-accent" : "bg-popover-hover")} />)}
                </span>
              )}
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] leading-[18px] text-popover-ink-secondary">
                {row.stage && <span>{[t("recordWindow.account.stageIs", { stage: row.stage }), row.probability !== undefined && t("recordWindow.account.chance", { share: Math.round(row.probability) })].filter(Boolean).join(" · ")}</span>}
                {row.close && <span>{t("recordWindow.account.closeOn", { date: row.close })}</span>}
              </span>
              <Person name={row.owner} recordRef={row.ownerRef} />
            </>
          )} />
      )}
    </Panel>
  );
}

function Agreement({ row }: { row: AgreementRow }) {
  return (
    <RecordPod data-record-agreement="">
      <div className="flex min-w-0 flex-wrap items-center gap-5">
        {row.share !== undefined && <Ring share={row.share} used={row.used} of={row.of} label={row.used && row.of ? t("recordWindow.account.hoursOf", { used: row.used, of: row.of }) : `${Math.round(row.share)} %`} />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[16px] font-semibold leading-6"><RecordName name={row.name} recordRef={row.ref} /></span><StateChip label={row.status} tone={row.tone} /></span>
          <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.type, row.period, row.renew].filter(Boolean).join(" · ")}</span>
          {(row.left || row.pace) && (
            <span className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
              {row.left && <span className="inline-flex h-7 items-center rounded-full bg-popover-hover px-2.5 text-[13px]">{row.left}</span>}
              {row.pace && <span className="inline-flex h-7 items-center rounded-full bg-popover-hover px-2.5 text-[13px]">{row.pace}</span>}
            </span>
          )}
        </div>
      </div>
      {row.months.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-[13px] font-medium leading-[18px]">{t("recordWindow.account.hoursUsedByMonth")}</h4>
          <Columns bars={row.months} label={t("recordWindow.account.hoursUsedByMonth")} />
        </div>
      )}
    </RecordPod>
  );
}

export function AccountAgreementsTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("agreements");
  return (
    <Panel name="agreements">
      {!state.page ? <SectionStatus state={state} />
        : !state.page.lines.length ? <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.related.empty")}</p>
        : state.page.lines.map((row, index) => <Agreement key={row.id ?? `${row.name}-${index}`} row={row} />)}
    </Panel>
  );
}

// ── Finance ──

export function AccountFinanceTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("finance");
  const facts = state.page?.finance;
  const columns: RecordColumn<InvoiceRow>[] = [
    { id: "number", label: t("recordWindow.account.invoice"), text: (row) => row.number },
    { id: "state", label: t("recordCard.related.status"), text: (row) => row.state },
    { id: "amount", label: t("recordWindow.time.amount"), text: (row) => row.amount },
  ];
  return (
    <Panel name="finance">
      {!state.page ? <SectionStatus state={state} /> : (
        <>
          {facts && <Tiles tiles={facts.tiles} shown={new Set()} onTab={() => {}} />}
          {facts && facts.aging.length > 0 && (
            <RecordPod title={t("recordWindow.account.aging")} data-record-aging="">
              <Parts label={t("recordWindow.account.aging")} parts={facts.aging.map((part, index) => ({ key: `${part.label}-${index}`, label: `${part.label} · ${part.text}`, share: part.share, fill: PART_FILL[part.tone] }))} />
            </RecordPod>
          )}
          <RecordPod title={t("recordWindow.account.openInvoices")} count={state.page.lines.length} data-record-invoices="">
            <RecordList label={t("recordWindow.account.openInvoices")} columns={columns} rows={state.page.lines} rowKey={(row) => row.id ?? row.number} empty={t("recordWindow.account.noInvoice")}
              row={(row) => (
                <>
                  <span aria-hidden="true" className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-popover-hover", row.late ? "text-danger" : "text-popover-ink-secondary")}><FileText size={15} /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium"><RecordName name={row.number} recordRef={row.ref} /></span>
                    <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{[row.issued && t("recordWindow.account.issued", { date: row.issued }), row.due].filter(Boolean).join(" · ")}</span>
                  </span>
                  {row.late ? <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-danger/15 px-2 text-[12px] leading-4 text-popover-ink">{t("recordWindow.account.late", { days: row.late })}</span>
                    : row.state && <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-popover-hover px-2 text-[12px] leading-4">{row.state}</span>}
                  <span className="shrink-0 text-end font-semibold tabular-nums">{row.amount}</span>
                </>
              )} />
          </RecordPod>
        </>
      )}
    </Panel>
  );
}

// ── Data ──

export function AccountDataTab({ detail }: { detail: RecordDetail }) {
  const state = detail.section("stats");
  const stats = state.page?.stats && "hours" in state.page.stats ? state.page.stats : undefined;
  if (!state.page) return <Panel name="data"><SectionStatus state={state} /></Panel>;
  if (!stats || (!stats.hours.length && !stats.types.length && !stats.resolution && !stats.billable.length)) {
    return <Panel name="data"><p role="status" className="py-2 text-popover-ink-secondary">{t("recordWindow.account.noData")}</p></Panel>;
  }
  return (
    <Panel name="data">
      <div className="grid min-w-0 grid-cols-1 gap-3 @min-[52rem]:grid-cols-2">
        {stats.hours.length > 0 && <RecordPod title={t("recordWindow.account.hoursByMonth")} data-record-stat="hours"><Columns bars={stats.hours} label={t("recordWindow.account.hoursByMonth")} /></RecordPod>}
        {stats.types.length > 0 && <RecordPod title={t("recordWindow.account.ticketsByType")} data-record-stat="types"><Rows bars={stats.types} label={t("recordWindow.account.ticketsByType")} /></RecordPod>}
        {stats.resolution && (
          <RecordPod title={t("recordWindow.account.resolution")} data-record-stat="resolution">
            <span className="text-[26px] font-semibold leading-8 tabular-nums">{stats.resolution.text}</span>
            {stats.resolution.detail && <span className="text-[13px] leading-[18px] text-popover-ink-secondary">{stats.resolution.detail}</span>}
          </RecordPod>
        )}
        {stats.billable.length > 0 && (
          <RecordPod title={t("recordWindow.account.billable")} data-record-stat="billable">
            <Parts label={t("recordWindow.account.billable")} parts={stats.billable.map((part) => ({ key: part.billing, label: `${billingLabel(part.billing)} ${part.text ?? `${Math.round(part.share)} %`}`, share: part.share, fill: BILLING_FILL[part.billing] }))} />
          </RecordPod>
        )}
      </div>
    </Panel>
  );
}
