// ConnectWise records in the chat: a card for one record, a table for a
// list. Every change posts to Sagax for an approval card. Nothing here
// talks to ConnectWise.
import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarClock,
  Clock,
  ExternalLink,
  FileText,
  Search,
  Ticket,
} from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  cwFamilyLabelKey,
  cwStatusTone,
  formatCwAmount,
  formatCwDay,
  formatCwHours,
  formatCwWhen,
  postCwWidgetActionViaApi,
  type CwPoster,
  type CwTone,
} from "@/lib/cw-widgets";
import type { CwAction, CwBillable } from "../../../shared/cw-widgets/actions.ts";
import { filterSortTickets } from "../../../shared/cw-widgets/ticket.ts";
import { shownCwWidget } from "../../../shared/cw-widgets/tool-call.ts";
import { safeCwLink } from "../../../shared/cw-widgets/links.ts";
import { safeWebsite } from "../../../shared/cw-widgets/company.ts";
import type {
  CwAgreement,
  CwCompany,
  CwScheduleEntry,
  CwTicket,
  CwTicketNote,
  CwTimeEntry,
  CwWidget,
} from "../../../shared/cw-widgets/types.ts";
import type { Message } from "@/state/store";

const RAIL: Record<CwWidget["family"], string> = {
  ticket: "bg-accent",
  time: "bg-warning",
  schedule: "bg-success",
  agreement: "bg-accent",
  company: "bg-danger",
};

const TONE: Record<CwTone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-danger/15 text-danger",
  idle: "bg-inset text-ink-secondary",
};

function FamilyIcon({ family }: { family: CwWidget["family"] }) {
  const props = { size: 15, "aria-hidden": true as const };
  switch (family) {
    case "ticket": return <Ticket {...props} />;
    case "time": return <Clock {...props} />;
    case "schedule": return <CalendarClock {...props} />;
    case "agreement": return <FileText {...props} />;
    case "company": return <Building2 {...props} />;
  }
}

function billableLabel(value: string): string {
  if (value === "Billable") return t("cw.billable");
  if (value === "DoNotBill") return t("cw.doNotBill");
  if (value === "NoCharge") return t("cw.noCharge");
  return value;
}

function Pill({ tone, children }: { tone: CwTone; children: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[tone])}>{children}</span>;
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-tertiary">{label}</div>
      <div className="text-[13px] leading-snug text-ink">{value}</div>
    </div>
  );
}

function OpenLink({ href }: { href?: string }) {
  const url = safeCwLink(href) ?? safeWebsite(href);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-hairline/50 bg-panel px-3 text-[12px] font-medium text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <ExternalLink size={13} aria-hidden="true" />
      {t("cw.open")}
    </a>
  );
}

function Shell({
  family,
  title,
  kicker,
  href,
  children,
  footer,
  embedded,
}: {
  family: CwWidget["family"];
  title: string;
  kicker: string;
  href?: string;
  children: ReactNode;
  footer?: ReactNode;
  embedded?: boolean;
}) {
  if (embedded) {
    return (
      <div className="rounded-xl bg-panel">
        {href && <div className="flex justify-end px-2 pt-2"><OpenLink href={href} /></div>}
        <div className="px-2 py-2">{children}</div>
        {footer && <div className="border-t border-hairline/40 px-2 py-2">{footer}</div>}
      </div>
    );
  }
  return (
    <article
      data-cw-widget={family}
      className="my-1 min-w-0 overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-sm"
    >
      <div className="flex min-w-0">
        <div className={cn("w-1 shrink-0", RAIL[family])} />
        <div className="min-w-0 flex-1">
          <header className="flex items-start gap-3 border-b border-hairline/40 bg-raised/40 px-3.5 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-inset text-ink">
              <FamilyIcon family={family} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">{kicker}</div>
              <h3 className="truncate text-[15px] font-semibold leading-snug text-ink">{title}</h3>
            </div>
            <OpenLink href={href} />
          </header>
          <div className="px-3.5 py-3">{children}</div>
          {footer && <div className="border-t border-hairline/40 bg-inset/40 px-3.5 py-3">{footer}</div>}
        </div>
      </div>
    </article>
  );
}

type AskState = "idle" | "asking" | "asked" | "failed";

function useAsk(threadId: string | undefined, botId: string | undefined, poster?: CwPoster) {
  const [state, setState] = useState<AskState>("idle");
  const canAsk = Boolean(threadId || poster);
  async function ask(action: CwAction) {
    if (!threadId && !poster) {
      setState("failed");
      return;
    }
    setState("asking");
    try {
      if (poster) {
        if (!threadId) throw new Error("no thread");
        const { postCwWidgetAction } = await import("@/lib/cw-widgets");
        await postCwWidgetAction(threadId, action, botId, poster);
      } else if (threadId) {
        await postCwWidgetActionViaApi(threadId, action, botId);
      }
      setState("asked");
    } catch {
      setState("failed");
    }
  }
  return { state, canAsk, ask };
}

function AskNote({ state, canAsk }: { state: AskState; canAsk: boolean }) {
  if (!canAsk) return <p className="text-[12px] text-ink-tertiary">{t("cw.noThread")}</p>;
  if (state === "idle") return null;
  const label = state === "asking" ? t("cw.asking") : state === "asked" ? t("cw.asked") : t("cw.askFailed");
  return <p className={cn("text-[12px]", state === "failed" ? "text-danger" : "text-ink-secondary")} role="status">{label}</p>;
}

function FieldButton({ children, disabled, onClick }: { children: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded-full bg-accent px-3 text-[12px] font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}

function NoteList({ notes }: { notes: CwTicketNote[] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {notes.slice(0, 4).map((note, index) => (
        <li key={note.id ?? index} className="rounded-xl bg-inset/70 px-3 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-tertiary">
            {note.by && <span className="font-medium text-ink-secondary">{note.by}</span>}
            {note.at && <span>{formatCwWhen(note.at)}</span>}
            {note.internal && <Pill tone="warn">{t("cw.internal")}</Pill>}
            {note.resolution && <Pill tone="ok">{t("cw.resolution")}</Pill>}
            {!note.internal && !note.resolution && <Pill tone="idle">{t("cw.discussion")}</Pill>}
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{note.text}</p>
        </li>
      ))}
    </ul>
  );
}

function TicketCard({ ticket, ask, embedded }: { ticket: CwTicket; ask: ReturnType<typeof useAsk>; embedded?: boolean }) {
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  return (
    <Shell
      family="ticket"
      kicker={`${t("cw.brand")} · ${t("cw.ticket")} #${ticket.id}`}
      title={ticket.summary || `#${ticket.id}`}
      href={ticket.link}
      embedded={embedded}
      footer={(
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`cw-status-${ticket.id}`}>{t("cw.status")}</label>
            <input
              id={`cw-status-${ticket.id}`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              placeholder={t("cw.statusPlaceholder")}
              maxLength={80}
              className="min-h-8 min-w-[10rem] flex-1 rounded-full border border-hairline/60 bg-panel px-3 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <FieldButton
              disabled={!ask.canAsk || ask.state === "asking" || !status.trim() || status.trim() === ticket.status}
              onClick={() => void ask.ask({ kind: "ticket.status", ticketId: ticket.id, status: status.trim(), ...(ticket.status ? { from: ticket.status } : {}) })}
            >
              {t("cw.changeStatus")}
            </FieldButton>
          </div>
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("cw.notePlaceholder")}
              rows={2}
              maxLength={4000}
              className="w-full resize-none rounded-xl border border-hairline/60 bg-panel px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={internal}
                onClick={() => setInternal((value) => !value)}
                className={cn("min-h-8 rounded-full border px-3 text-[12px]", internal ? "border-warning/40 bg-warning/15 text-warning" : "border-hairline/60 text-ink-secondary")}
              >
                {internal ? t("cw.internal") : t("cw.discussion")}
              </button>
              <FieldButton
                disabled={!ask.canAsk || ask.state === "asking" || !note.trim()}
                onClick={() => void ask.ask({ kind: "ticket.note", ticketId: ticket.id, text: note.trim(), internal })}
              >
                {t("cw.addNote")}
              </FieldButton>
              <AskNote state={ask.state} canAsk={ask.canAsk} />
            </div>
          </div>
        </div>
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {ticket.status && <Pill tone={cwStatusTone(ticket.status, ticket.closed)}>{ticket.status}</Pill>}
        {ticket.priority && <Pill tone={cwStatusTone(ticket.priority)}>{ticket.priority}</Pill>}
        {ticket.closed && <Pill tone="ok">{t("cw.markDone")}</Pill>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Meta label={t("cw.company")} value={ticket.company} />
        <Meta label={t("cw.contact")} value={ticket.contact} />
        <Meta label={t("cw.board")} value={ticket.board} />
        <Meta label={t("cw.owner")} value={ticket.owner} />
        <Meta label={t("cw.due")} value={formatCwWhen(ticket.due)} />
        <Meta label={t("cw.hours")} value={[formatCwHours(ticket.actualHours), ticket.budgetHours !== undefined ? `/ ${formatCwHours(ticket.budgetHours)}` : ""].filter(Boolean).join(" ")} />
      </div>
      {ticket.notes && <NoteList notes={ticket.notes} />}
    </Shell>
  );
}

const BILLABLE: Array<{ value: CwBillable; label: "cw.billable" | "cw.doNotBill" | "cw.noCharge" }> = [
  { value: "Billable", label: "cw.billable" },
  { value: "DoNotBill", label: "cw.doNotBill" },
  { value: "NoCharge", label: "cw.noCharge" },
];

function TimeCard({ entry, ask, embedded }: { entry: CwTimeEntry; ask: ReturnType<typeof useAsk>; embedded?: boolean }) {
  return (
    <Shell
      family="time"
      kicker={`${t("cw.brand")} · ${t("cw.time")} #${entry.id}`}
      title={entry.charge || entry.company || `#${entry.id}`}
      href={entry.link}
      embedded={embedded}
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          {BILLABLE.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!ask.canAsk || ask.state === "asking" || entry.billable === option.value}
              onClick={() => void ask.ask({
                kind: "time.billable",
                entryId: entry.id,
                billable: option.value,
                ...(entry.billable === "Billable" || entry.billable === "DoNotBill" || entry.billable === "NoCharge" ? { from: entry.billable } : {}),
              })}
              className={cn(
                "min-h-8 rounded-full border px-3 text-[12px] font-medium disabled:opacity-50",
                entry.billable === option.value ? "border-accent bg-accent text-accent-ink" : "border-hairline/60 text-ink hover:bg-raised",
              )}
            >
              {t(option.label)}
            </button>
          ))}
          <AskNote state={ask.state} canAsk={ask.canAsk} />
        </div>
      )}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="text-[28px] font-semibold leading-none tracking-tight text-ink">{formatCwHours(entry.hours) || "—"}</div>
        {entry.billable && <Pill tone={entry.billable === "Billable" ? "ok" : entry.billable === "DoNotBill" ? "warn" : "idle"}>{billableLabel(entry.billable)}</Pill>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Meta label={t("cw.company")} value={entry.company} />
        <Meta label={t("cw.member")} value={entry.member} />
        <Meta label={t("cw.workType")} value={entry.workType} />
        <Meta label={t("cw.when")} value={[formatCwWhen(entry.start), formatCwWhen(entry.end)].filter(Boolean).join(" – ")} />
        <Meta label={t("cw.agreement")} value={entry.agreement} />
        <Meta label={t("cw.status")} value={entry.status} />
      </div>
      {entry.notes && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">{entry.notes}</p>}
    </Shell>
  );
}

function ScheduleCard({ entry, ask, embedded }: { entry: CwScheduleEntry; ask: ReturnType<typeof useAsk>; embedded?: boolean }) {
  return (
    <Shell
      family="schedule"
      kicker={`${t("cw.brand")} · ${t("cw.schedule")} #${entry.id}`}
      title={entry.name}
      href={entry.link}
      embedded={embedded}
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          <FieldButton
            disabled={!ask.canAsk || ask.state === "asking"}
            onClick={() => void ask.ask({ kind: "schedule.done", entryId: entry.id, done: !entry.done })}
          >
            {entry.done ? t("cw.reopen") : t("cw.markDone")}
          </FieldButton>
          <AskNote state={ask.state} canAsk={ask.canAsk} />
        </div>
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {entry.done ? <Pill tone="ok">{t("cw.markDone")}</Pill> : entry.status && <Pill tone={cwStatusTone(entry.status)}>{entry.status}</Pill>}
        {entry.hours !== undefined && <Pill tone="idle">{formatCwHours(entry.hours)}</Pill>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Meta label={t("cw.when")} value={[formatCwWhen(entry.start), formatCwWhen(entry.end)].filter(Boolean).join(" – ")} />
        <Meta label={t("cw.where")} value={entry.where} />
        <Meta label={t("cw.member")} value={entry.member} />
        <Meta label={t("cw.company")} value={entry.company} />
      </div>
    </Shell>
  );
}

function AgreementCard({ agreement, embedded }: { agreement: CwAgreement; embedded?: boolean }) {
  return (
    <Shell family="agreement" kicker={`${t("cw.brand")} · ${t("cw.agreement")} #${agreement.id}`} title={agreement.name} href={agreement.link} embedded={embedded}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-tertiary">{t("cw.amount")}</div>
          <div className="text-[28px] font-semibold leading-none tracking-tight text-ink">{formatCwAmount(agreement.billAmount) || "—"}</div>
        </div>
        {agreement.status && <Pill tone={cwStatusTone(agreement.status, agreement.cancelled)}>{agreement.status}</Pill>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Meta label={t("cw.company")} value={agreement.company} />
        <Meta label={t("cw.type")} value={agreement.type} />
        <Meta label={t("cw.cycle")} value={agreement.cycle} />
        <Meta label={t("cw.when")} value={[formatCwDay(agreement.start), formatCwDay(agreement.end)].filter(Boolean).join(" – ")} />
      </div>
    </Shell>
  );
}

function CompanyCard({ company, ask, embedded }: { company: CwCompany; ask: ReturnType<typeof useAsk>; embedded?: boolean }) {
  const [note, setNote] = useState("");
  const site = safeWebsite(company.website);
  return (
    <Shell
      family="company"
      kicker={`${t("cw.brand")} · ${company.identifier || t("cw.company")} #${company.id}`}
      title={company.name}
      embedded={embedded}
      href={company.link}
      footer={(
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("cw.notePlaceholder")}
            rows={2}
            maxLength={4000}
            className="w-full resize-none rounded-xl border border-hairline/60 bg-panel px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FieldButton
              disabled={!ask.canAsk || ask.state === "asking" || !note.trim()}
              onClick={() => void ask.ask({ kind: "company.note", companyId: company.id, text: note.trim() })}
            >
              {t("cw.addNote")}
            </FieldButton>
            <AskNote state={ask.state} canAsk={ask.canAsk} />
          </div>
        </div>
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {company.status && <Pill tone={cwStatusTone(company.status)}>{company.status}</Pill>}
        {company.type && <Pill tone="idle">{company.type}</Pill>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Meta label={t("cw.phone")} value={company.phone} />
        <Meta label={t("cw.city")} value={company.city} />
        <Meta label={t("cw.territory")} value={company.territory} />
        <Meta label={t("cw.website")} value={site ? new URL(site).hostname : undefined} />
      </div>
    </Shell>
  );
}

function matches(query: string, parts: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

function TableShell({
  family,
  total,
  shown,
  query,
  onQuery,
  extra,
  children,
}: {
  family: CwWidget["family"];
  total?: number;
  shown: number;
  query: string;
  onQuery: (value: string) => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-cw-widget={family} className="my-1 min-w-0 overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-sm">
      <div className="flex min-w-0">
        <div className={cn("w-1 shrink-0", RAIL[family])} />
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-2 border-b border-hairline/40 bg-raised/40 px-3.5 py-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-inset text-ink"><FamilyIcon family={family} /></span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">{t("cw.brand")}</div>
              <div className="text-[14px] font-semibold text-ink">{t(cwFamilyLabelKey(family))}</div>
            </div>
            <span className="text-[12px] text-ink-tertiary">{t("cw.showing", { shown, total: total ?? shown })}</span>
            <div className="ms-auto flex min-w-[12rem] flex-1 items-center gap-2 sm:max-w-xs">
              {extra}
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t("cw.search")}</span>
                <Search size={13} aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                <input
                  value={query}
                  onChange={(event) => onQuery(event.target.value)}
                  placeholder={t("cw.search")}
                  className="h-8 w-full rounded-full border border-hairline/60 bg-panel ps-8 pe-3 text-[12px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                />
              </label>
            </div>
          </header>
          <div className="overflow-x-auto">{children}</div>
        </div>
      </div>
    </section>
  );
}

const TH = "px-3 py-2 text-start text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary";
const TD = "px-3 py-2.5 align-middle text-[13px] text-ink";

function TicketTable({ records, total, ask }: { records: CwTicket[]; total?: number; ask: ReturnType<typeof useAsk> }) {
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = useMemo(
    () => filterSortTickets(records, { query, openOnly }, { key: "updated", dir: "desc" }),
    [records, query, openOnly],
  );
  return (
    <TableShell
      family="ticket"
      total={total}
      shown={rows.length}
      query={query}
      onQuery={setQuery}
      extra={(
        <button type="button" aria-pressed={openOnly} onClick={() => setOpenOnly((value) => !value)} className={cn("h-8 shrink-0 rounded-full border px-3 text-[12px]", openOnly ? "border-accent bg-accent text-accent-ink" : "border-hairline/60 text-ink-secondary")}>
          {t("cw.openOnly")}
        </button>
      )}
    >
      <table className="w-full border-collapse">
        <thead className="bg-inset/50"><tr>
          <th className={TH}>#</th>
          <th className={TH}>{t("cw.ticket")}</th>
          <th className={TH}>{t("cw.company")}</th>
          <th className={TH}>{t("cw.status")}</th>
          <th className={TH}>{t("cw.hours")}</th>
        </tr></thead>
        <tbody>
          {rows.map((ticket) => (
            <Fragment key={ticket.id}>
              <tr className="cursor-pointer border-t border-hairline/30 hover:bg-raised/50" onClick={() => setOpenId((id) => id === ticket.id ? null : ticket.id)} aria-expanded={openId === ticket.id}>
                <td className={cn(TD, "tabular-nums text-ink-secondary")}>{ticket.id}</td>
                <td className={cn(TD, "max-w-[14rem] truncate font-medium")}>{ticket.summary}</td>
                <td className={cn(TD, "max-w-[9rem] truncate text-ink-secondary")}>{ticket.company}</td>
                <td className={cn(TD, "whitespace-nowrap")}>{ticket.status && <Pill tone={cwStatusTone(ticket.status, ticket.closed)}>{ticket.status}</Pill>}</td>
                <td className={cn(TD, "tabular-nums")}>{formatCwHours(ticket.actualHours)}</td>
              </tr>
              {openId === ticket.id && (
                <tr className="border-t border-hairline/30">
                  <td colSpan={5} className="bg-inset/40 p-2">
                    <TicketCard ticket={ticket} ask={ask} embedded />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-tertiary">{t("cw.empty")}</p>}
    </TableShell>
  );
}

function SimpleTable({
  family,
  total,
  rows,
  headers,
  detail,
}: {
  family: CwWidget["family"];
  total?: number;
  rows: Array<{ id: number; haystack: Array<string | undefined>; cells: ReactNode }>;
  headers: string[];
  detail?: (id: number) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const shown = rows.filter((row) => matches(query, row.haystack));
  return (
    <TableShell family={family} total={total} shown={shown.length} query={query} onQuery={setQuery}>
      <table className="w-full min-w-[32rem] border-collapse">
        <thead className="bg-inset/50"><tr>{headers.map((header) => <th key={header} className={TH}>{header}</th>)}</tr></thead>
        <tbody>
          {shown.map((row) => (
            <Fragment key={row.id}>
              <tr
                className={cn("border-t border-hairline/30", detail && "cursor-pointer hover:bg-raised/50")}
                onClick={detail ? () => setOpenId((id) => id === row.id ? null : row.id) : undefined}
                aria-expanded={detail ? openId === row.id : undefined}
              >
                {row.cells}
              </tr>
              {detail && openId === row.id && (
                <tr className="border-t border-hairline/30">
                  <td colSpan={headers.length} className="bg-inset/40 p-2">{detail(row.id)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-tertiary">{t("cw.empty")}</p>}
    </TableShell>
  );
}

function WidgetBody({ widget, ask }: { widget: CwWidget; ask: ReturnType<typeof useAsk> }) {
  if (widget.view === "card" && widget.records.length === 1) {
    switch (widget.family) {
      case "ticket": return <TicketCard ticket={widget.records[0]!} ask={ask} />;
      case "time": return <TimeCard entry={widget.records[0]!} ask={ask} />;
      case "schedule": return <ScheduleCard entry={widget.records[0]!} ask={ask} />;
      case "agreement": return <AgreementCard agreement={widget.records[0]!} />;
      case "company": return <CompanyCard company={widget.records[0]!} ask={ask} />;
    }
  }
  switch (widget.family) {
    case "ticket":
      return <TicketTable records={widget.records} total={widget.total} ask={ask} />;
    case "time":
      return (
        <SimpleTable
          family="time"
          total={widget.total}
          headers={["#", t("cw.charge"), t("cw.member"), t("cw.hours"), t("cw.billable")]}
          rows={widget.records.map((entry) => ({
            id: entry.id,
            haystack: [String(entry.id), entry.charge, entry.member, entry.company, entry.notes],
            cells: [
              <td key="id" className={cn(TD, "tabular-nums text-ink-secondary")}>{entry.id}</td>,
              <td key="charge" className={cn(TD, "max-w-[14rem] truncate font-medium")}>{entry.charge || entry.company}</td>,
              <td key="member" className={cn(TD, "text-ink-secondary")}>{entry.member}</td>,
              <td key="hours" className={cn(TD, "tabular-nums")}>{formatCwHours(entry.hours)}</td>,
              <td key="bill" className={TD}>{entry.billable && <Pill tone={entry.billable === "Billable" ? "ok" : "warn"}>{billableLabel(entry.billable)}</Pill>}</td>,
            ],
          }))}
          detail={(id) => {
            const entry = widget.records.find((row) => row.id === id);
            return entry ? <TimeCard entry={entry} ask={ask} embedded /> : null;
          }}
        />
      );
    case "schedule":
      return (
        <SimpleTable
          family="schedule"
          total={widget.total}
          headers={[t("cw.schedule"), t("cw.when"), t("cw.member"), t("cw.where"), t("cw.status")]}
          rows={widget.records.map((entry) => ({
            id: entry.id,
            haystack: [entry.name, entry.member, entry.company, entry.where, entry.status],
            cells: [
              <td key="name" className={cn(TD, "max-w-[14rem] truncate font-medium")}>{entry.name}</td>,
              <td key="when" className={cn(TD, "text-ink-secondary")}>{formatCwWhen(entry.start)}</td>,
              <td key="member" className={TD}>{entry.member}</td>,
              <td key="where" className={cn(TD, "text-ink-secondary")}>{entry.where}</td>,
              <td key="status" className={TD}>{entry.done ? <Pill tone="ok">{t("cw.markDone")}</Pill> : entry.status && <Pill tone={cwStatusTone(entry.status)}>{entry.status}</Pill>}</td>,
            ],
          }))}
          detail={(id) => {
            const entry = widget.records.find((row) => row.id === id);
            return entry ? <ScheduleCard entry={entry} ask={ask} embedded /> : null;
          }}
        />
      );
    case "agreement":
      return (
        <SimpleTable
          family="agreement"
          total={widget.total}
          headers={[t("cw.agreement"), t("cw.company"), t("cw.amount"), t("cw.cycle"), t("cw.status")]}
          rows={widget.records.map((agreement) => ({
            id: agreement.id,
            haystack: [agreement.name, agreement.company, agreement.status, agreement.cycle],
            cells: [
              <td key="name" className={cn(TD, "max-w-[14rem] truncate font-medium")}>{agreement.name}</td>,
              <td key="co" className={cn(TD, "text-ink-secondary")}>{agreement.company}</td>,
              <td key="amt" className={cn(TD, "tabular-nums")}>{formatCwAmount(agreement.billAmount)}</td>,
              <td key="cycle" className={TD}>{agreement.cycle}</td>,
              <td key="status" className={TD}>{agreement.status && <Pill tone={cwStatusTone(agreement.status, agreement.cancelled)}>{agreement.status}</Pill>}</td>,
            ],
          }))}
          detail={(id) => {
            const agreement = widget.records.find((row) => row.id === id);
            return agreement ? <AgreementCard agreement={agreement} embedded /> : null;
          }}
        />
      );
    case "company":
      return (
        <SimpleTable
          family="company"
          total={widget.total}
          headers={[t("cw.company"), t("cw.identifier"), t("cw.phone"), t("cw.city"), t("cw.status")]}
          rows={widget.records.map((company) => ({
            id: company.id,
            haystack: [company.name, company.identifier, company.city, company.phone],
            cells: [
              <td key="name" className={cn(TD, "max-w-[14rem] truncate font-medium")}>{company.name}</td>,
              <td key="id" className={cn(TD, "text-ink-secondary")}>{company.identifier}</td>,
              <td key="phone" className={TD}>{company.phone}</td>,
              <td key="city" className={cn(TD, "text-ink-secondary")}>{company.city}</td>,
              <td key="status" className={TD}>{company.status && <Pill tone={cwStatusTone(company.status)}>{company.status}</Pill>}</td>,
            ],
          }))}
          detail={(id) => {
            const company = widget.records.find((row) => row.id === id);
            return company ? <CompanyCard company={company} ask={ask} embedded /> : null;
          }}
        />
      );
  }
}

function CwWidgetViewComponent({
  widget,
  threadId,
  botId,
  poster,
}: {
  widget: CwWidget;
  threadId?: string;
  botId?: string;
  poster?: CwPoster;
}) {
  const ask = useAsk(threadId, botId, poster);
  return <WidgetBody widget={widget} ask={ask} />;
}

export const CwWidgetView = memo(CwWidgetViewComponent);
export { shownCwWidget };

/** Widgets on a tool run, drawn even when the tool chips stay folded. */
export function CwActivityWidgets({
  messages,
  threadId,
  botId,
}: {
  messages: Message[];
  threadId?: string;
  botId?: string;
}) {
  const widgets = messages.flatMap((message) => (shownCwWidget(message.tool) ? [{ key: message.id, widget: message.tool!.widget! }] : []));
  if (!widgets.length) return null;
  return (
    <div className="flex w-full max-w-[min(94%,780px)] flex-col gap-2">
      {widgets.map((row) => <CwWidgetView key={row.key} widget={row.widget} threadId={threadId} botId={botId} />)}
    </div>
  );
}
