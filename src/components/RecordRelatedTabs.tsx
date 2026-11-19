import { useId, useState } from "react";
import { PillTabCount, PillTabs } from "@/components/PillTabs";
import { TicketNotes, type TicketNote, type ScheduleEntry } from "./TicketRecordSections";
import { t } from "@/lib/i18n";

export const RELATED_TABS = ["notes", "time", "configurations", "expenses", "activities", "attachments"] as const;
export type RelatedTab = (typeof RELATED_TABS)[number];

type Lines = {
  notes: TicketNote[];
  schedule: ScheduleEntry[];
  time: { date: string; member: string; hours: string; note: string }[];
  configurations: { name: string; type: string; status: string }[];
  expenses: { date: string; member: string; type: string; amount: string }[];
  activities: { subject: string; type: string; date: string; assigned: string }[];
  attachments: { name: string; size: string; date: string; download: () => void }[];
};

export type RelatedPage = {
  [K in keyof Lines]: { tab: K; lines: Lines[K]; totalHours?: string }
}[keyof Lines];

export interface RecordRelatedTabsProps {
  counts: Partial<Record<RelatedTab, number>>;
  schedule?: ScheduleEntry[];
  scheduleError?: string;
  tab: RelatedTab;
  onTab: (tab: RelatedTab) => void;
  page?: RelatedPage;
  loading: boolean;
  error?: string;
  countError?: string;
  notice?: string;
}

/** The tabs of the opened card (#5053). They take the room left under the
 * record's text and grow with the card; the card's one scroller scrolls them
 * (never a box of their own), and the tab row stays in view at its top while
 * it does. A row too narrow for the six tabs wraps: no tab is ever cut. */
export function RecordRelatedTabs({ counts, tab, onTab, page, loading, error, countError, notice }: RecordRelatedTabsProps) {
  const id = useId();
  return (
    <section className="flex shrink-0 grow flex-col" data-record-related>
      <PillTabs
        tabs={RELATED_TABS} tab={tab} onTab={onTab} ariaLabel={t("recordCard.related.title")} idPrefix={id}
        label={(key) => t(`recordCard.related.${key}`)}
        after={(key) => counts[key] === undefined ? null : <PillTabCount count={counts[key]} />}
        className="sticky top-0 z-[1] shrink-0 gap-y-1 border-b border-popover-hairline [background-color:var(--float-fill)] px-4 py-2"
      />
      {(countError || notice) && <span role="status" className="px-6 pt-3 text-[13px] leading-[18px] text-popover-ink-secondary">{countError || notice}</span>}
      <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}
        key={tab} tabIndex={0} aria-busy={loading} className="px-6 pb-5 pt-3 focus-visible:outline-none">
        {error ? <p role="status" className="py-2 text-popover-ink-secondary">{error}</p> : page?.tab === tab ? page.tab === "notes" ? <TicketNotes notes={page.lines} /> : <RelatedLines page={page} /> :
          <p role="status" className="py-2 text-popover-ink-secondary">{t("recordCard.loading")}</p>}
      </div>
    </section>
  );
}

function TimeNote({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  return <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
    className={`w-full text-start text-popover-ink-secondary ${expanded ? "block whitespace-pre-wrap break-words" : "line-clamp-2"}`}>{note}</button>;
}

function RelatedLines({ page }: { page: Exclude<RelatedPage, { tab: "notes" | "schedule" }> }) {
  const columns = {
    time: ["date", "member", "hours", "note"],
    configurations: ["name", "type", "status"],
    expenses: ["date", "member", "type", "amount"],
    activities: ["subject", "type", "date", "assigned"],
    attachments: ["name", "size", "date"],
  } as const;
  const rows = (() => {
    switch (page.tab) {
      case "time": return page.lines.map(({ date, member, hours, note }) => [date, member, hours, note && <TimeNote key={note} note={note} />]);
      case "configurations": return page.lines.map(({ name, type, status }) => [name, type, status]);
      case "expenses": return page.lines.map(({ date, member, type, amount }) => [date, member, type, amount]);
      case "activities": return page.lines.map(({ subject, type, date, assigned }) => [subject, type, date, assigned]);
      case "attachments": return page.lines.map(({ name, size, date, download }) => [
        <button key={name} type="button" className="break-all text-start underline" onClick={download}>{name}</button>, size, date,
      ]);
    }
  })();
  return <>
    {rows.length ? <table className="w-full border-collapse text-start text-[15px] leading-[22px]">
      <thead><tr>{columns[page.tab].map(column => <th key={column} scope="col" className="pb-2 pe-6 pt-1 text-start text-[13px] font-normal leading-[18px] text-popover-ink-secondary last:pe-0">{t(`recordCard.related.${column}`)}</th>)}</tr></thead>
      <tbody>{rows.map((cells, index) => <tr key={index} className="border-t border-popover-hairline">
        {cells.map((cell, i) => <td key={i} className="max-w-[32rem] break-words py-2.5 pe-6 align-top last:pe-0">{cell}</td>)}
      </tr>)}</tbody>
    </table> : <p className="py-2 text-popover-ink-secondary">{t("recordCard.related.empty")}</p>}
    {page.tab === "time" && page.totalHours && <p className="border-t border-popover-hairline py-2.5 font-medium">{t("recordCard.related.total", { hours: page.totalHours })}</p>}
  </>;
}
