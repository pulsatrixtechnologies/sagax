// The ticket window (M-20261127-101): the record window's frame (head, foot,
// RecordCard.tsx) around a ticket's own body. The fields column at the left
// stays beside every tab (M-20261127-105, version A, TicketSide.tsx); the
// tabs sit over the right side only (M-20261127-106) and stay out of what
// scrolls (M-20261127-134), in this order: Notes (open first), Schedule, Time
// & expenses, Configurations, Attachments (M-20261127-118). No Overview tab.
// A tab with nothing in it where nothing can be added is hidden
// (M-20261127-143).
import { useEffect, useId, useState } from "react";
import { RecordWindowTabs, type RecordTab } from "@/components/record-window/RecordBlocks";
import { RecordSplit } from "@/components/record-window/RecordSplit";
import type { RecordDetail } from "@/components/useRecordDetail";
import { t } from "@/lib/i18n";
import type { DetailSection } from "@/lib/record-detail";
import type { RecordCard as Card } from "../../../../shared/record-cards";
import { TicketAttachmentsTab, TicketConfigurationsTab } from "./TicketListTabs";
import { TicketNotesTab } from "./TicketNotesTab";
import { planRows, TicketPlanTab } from "./TicketPlanTab";
import { TicketSide, type TicketHours } from "./TicketSide";
import { timeTotals, TicketTimeTab } from "./TicketTimeTab";

export const TICKET_TABS = ["notes", "plan", "time", "configurations", "attachments"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

/** The sections a tab reads. */
const READS: Record<TicketTab, readonly DetailSection[]> = {
  notes: ["notes"],
  plan: ["schedule", "activities"],
  time: ["time", "expenses"],
  configurations: ["configurations"],
  attachments: ["attachments"],
};
/** Read when the window opens: the first tab, the schedule's count and the hours of the fields column. */
const AT_OPEN: readonly DetailSection[] = ["notes", "schedule", "activities", "time"];

export interface TicketWindowProps {
  card: Card;
  detail: RecordDetail;
  /** the window's type (its columns and split are kept for it) */
  type: string;
  now: number;
  /** a bot finds the best time for the person and proposes it as cards in the chat */
  onScheduleMe?: () => void;
  /** a bot finds the best person for the ticket */
  onDispatch?: () => void;
}

export function TicketWindow({ card, detail, type, now, onScheduleMe, onDispatch }: TicketWindowProps) {
  const id = useId();
  const [tab, setTab] = useState<TicketTab>("notes");
  const { want } = detail;
  useEffect(() => { want(AT_OPEN); }, [want]);
  useEffect(() => { want(READS[tab]); }, [want, tab]);
  const counts = detail.counts;
  const notes = detail.section("notes").page?.lines.length ?? counts.notes;
  const plan = planRows(detail);
  const planKnown = Boolean(detail.section("schedule").page || detail.section("activities").page);
  const time = detail.section("time").page;
  const expenses = detail.section("expenses").page;
  const timeCount = counts.time !== undefined || counts.expenses !== undefined ? (counts.time ?? time?.lines.length ?? 0) + (counts.expenses ?? expenses?.lines.length ?? 0) : undefined;
  const tabs: RecordTab<TicketTab>[] = [
    { id: "notes", label: t("recordWindow.tabs.notes"), count: notes, canAdd: detail.can("note.add") },
    { id: "plan", label: t("recordWindow.tabs.plan"), count: planKnown ? plan.open.length : undefined, canAdd: detail.can("schedule.add") },
    { id: "time", label: t("recordWindow.tabs.time"), count: timeCount, canAdd: detail.can("time.add") || detail.can("expense.add") },
    { id: "configurations", label: t("recordWindow.tabs.configurations"), count: counts.configurations, canAdd: detail.can("configuration.add") },
    { id: "attachments", label: t("recordWindow.tabs.attachments"), count: counts.attachments, canAdd: detail.can("attachment.add") },
  ];
  const totals = time ? timeTotals(time.lines, expenses?.lines ?? [], time.totals) : undefined;
  const hours: TicketHours | undefined = totals?.hours ? { hours: totals.hours, ...(totals.billable ? { billable: totals.billable } : {}), ...(totals.parts.B?.share !== undefined ? { share: totals.parts.B.share } : {}) } : time?.totalHours ? { hours: time.totalHours } : undefined;
  return (
    <RecordSplit
      type={type}
      fallback={360}
      left={<TicketSide card={card} hours={hours} now={now} />}
      rightHead={
        <>
          <RecordWindowTabs tabs={tabs} tab={tab} onTab={setTab} label={t("recordWindow.tabs.label")} idPrefix={id} />
          {detail.countError && <p role="status" className="px-4 pt-2 text-[13px] leading-[18px] text-popover-ink-secondary">{detail.countError}</p>}
        </>
      }
      right={
        <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} data-record-ticket-tab={tab}>
          {tab === "notes" && <TicketNotesTab detail={detail} />}
          {tab === "plan" && <TicketPlanTab detail={detail} type={type} onScheduleMe={onScheduleMe} onDispatch={onDispatch} />}
          {tab === "time" && <TicketTimeTab detail={detail} tz={card.tz} />}
          {tab === "configurations" && <TicketConfigurationsTab detail={detail} />}
          {tab === "attachments" && <TicketAttachmentsTab detail={detail} />}
        </div>
      }
    />
  );
}
