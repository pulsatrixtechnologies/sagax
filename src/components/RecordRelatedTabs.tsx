import { useId, useState } from "react";
import { PillTabCount, PillTabs } from "@/components/PillTabs";
import { t } from "@/lib/i18n";

export const RELATED_TABS = ["time", "configurations", "expenses", "activities", "attachments"] as const;
export type RelatedTab = (typeof RELATED_TABS)[number];

type Lines = {
  time: { date: string; member: string; hours: string; note: string }[];
  configurations: { name: string; type: string; status: string }[];
  expenses: { date: string; member: string; type: string; amount: string }[];
  activities: { subject: string; type: string; date: string; assigned: string }[];
  attachments: { name: string; size: string; date: string; download: () => void }[];
};

export type RelatedPage = {
  [K in RelatedTab]: { tab: K; lines: Lines[K]; totalHours?: string }
}[RelatedTab];

export interface RecordRelatedTabsProps {
  counts: Partial<Record<RelatedTab, number>>;
  tab: RelatedTab;
  onTab: (tab: RelatedTab) => void;
  page?: RelatedPage;
  loading: boolean;
  error?: string;
  countError?: string;
  notice?: string;
}

export function RecordRelatedTabs({ counts, tab, onTab, page, loading, error, countError, notice }: RecordRelatedTabsProps) {
  const id = useId();
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PillTabs
        tabs={RELATED_TABS} tab={tab} onTab={onTab} ariaLabel={t("recordCard.related.title")} idPrefix={id}
        label={(key) => t(`recordCard.related.${key}`)}
        after={(key) => counts[key] === undefined ? null : <PillTabCount count={counts[key]} />}
        className="shrink-0 flex-nowrap overflow-x-auto border-b border-popover-hairline px-2 py-1"
      />
      {(countError || notice) && <span role="status" className="px-3 text-popover-ink-secondary">{countError || notice}</span>}
      <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}
        key={tab} tabIndex={0} aria-busy={loading} className="record-scroll min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {error ? <p role="status">{error}</p> : page?.tab === tab ? <RelatedLines page={page} /> :
          <p role="status">{t("recordCard.loading")}</p>}
      </div>
    </section>
  );
}

function TimeNote({ note }: { note: string }) {
  const [expanded, setExpanded] = useState(false);
  return <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
    className={`w-full text-start text-popover-ink-secondary ${expanded ? "block whitespace-pre-wrap break-words" : "line-clamp-1"}`}>{note}</button>;
}

function RelatedLines({ page }: { page: RelatedPage }) {
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
    {rows.length ? <table className="w-full border-collapse text-start text-[13px] leading-[18px]">
      <thead><tr>{columns[page.tab].map(column => <th key={column} scope="col" className="py-1 pe-2 text-start text-[12px] font-medium text-popover-ink-secondary">{t(`recordCard.related.${column}`)}</th>)}</tr></thead>
      <tbody>{rows.map((cells, index) => <tr key={index} className="border-t border-popover-hairline">
        {cells.map((cell, i) => <td key={i} className="max-w-64 break-words py-1 pe-2 align-top">{cell}</td>)}
      </tr>)}</tbody>
    </table> : <p className="py-2 text-popover-ink-secondary">{t("recordCard.related.empty")}</p>}
    {page.tab === "time" && page.totalHours && <p className="border-t border-popover-hairline py-1 font-medium">{t("recordCard.related.total", { hours: page.totalHours })}</p>}
  </>;
}
