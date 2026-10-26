// The Approvals screen's History tab: every card answered in the last 30
// days, what was decided, when and by whom, searchable. It is the audit
// trail the decision log keeps (server/decision-log.ts), read through
// GET /api/approvals?history=1; the full export stays in Settings > Activity.
import { Check, MessageSquareText, Phone, Search, Undo2, X } from "lucide-react";
import { useMemo } from "react";

import { searchInboxHistory, type InboxHistoryEntry } from "../../../shared/approvals-inbox";
import { approvalAction } from "@/lib/approval-describe";
import { withoutIds } from "@/lib/approvals-inbox";
import { whoLabel } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";

function decisionView(row: Pick<InboxHistoryEntry, "decision" | "question">): { label: string; tone: "success" | "danger" | "neutral"; Icon: typeof Check } {
  if (row.question && row.decision === "user-approved") return { label: t("approvals.history.answered"), tone: "success", Icon: MessageSquareText };
  if (row.decision === "user-approved") return { label: t("approvals.history.allowed"), tone: "success", Icon: Check };
  if (row.decision === "user-denied") return { label: t("approvals.history.denied"), tone: "danger", Icon: X };
  if (row.decision === "user-undone") return { label: t("approvals.history.undone"), tone: "neutral", Icon: Undo2 };
  return { label: t("approvals.history.closed"), tone: "neutral", Icon: X };
}

const TONE = {
  success: "bg-success/12 text-success",
  danger: "bg-danger/12 text-danger",
  neutral: "bg-control text-ink-secondary",
} as const;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ApprovalsHistory({ rows, query, onQuery, loading }: {
  rows: readonly InboxHistoryEntry[];
  query: string;
  onQuery: (q: string) => void;
  loading: boolean;
}) {
  const shown = useMemo(() => searchInboxHistory(rows, query), [rows, query]);
  const today = new Date();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-approvals-history="">
      <div className="px-5 pb-3 pt-1">
        <label className="flex max-w-md items-center gap-2 rounded-xl border border-hairline/50 bg-inset px-3 py-1.5 focus-within:border-accent/60">
          <Search size={14} aria-hidden="true" className="text-ink-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("approvals.history.search")}
            aria-label={t("approvals.history.search")}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-tertiary"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {shown.length === 0 ? (
          <div className="pt-16 text-center text-[13.5px] text-ink-secondary">
            {loading ? t("approvals.loading") : query.trim() ? t("approvals.history.noMatch") : t("approvals.history.empty")}
          </div>
        ) : (
          <ol className="divide-y divide-hairline/30 overflow-hidden rounded-2xl border border-hairline/40 bg-card">
            {shown.map((row, index) => {
              const view = decisionView(row);
              const at = new Date(row.at);
              const title = row.tool ? withoutIds(approvalAction(row.tool, undefined)) : row.summary ? withoutIds(row.summary) : view.label;
              return (
                <li key={`${row.at}:${index}`} className="flex items-start gap-3 px-4 py-2.5" data-history-decision={row.decision}>
                  <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[view.tone])}>
                    <view.Icon size={11} aria-hidden="true" />
                    {view.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink">{title.charAt(0).toLocaleUpperCase() + title.slice(1)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-secondary">
                      {row.botName && <span className="font-medium text-ink-secondary">{withoutIds(row.botName)}</span>}
                      {row.botName && <span aria-hidden="true">·</span>}
                      <span>{t("approvals.history.by", { name: whoLabel(row.who) })}</span>
                      {row.via === "call" && <Phone size={11} aria-label={t("approvals.history.viaCall")} />}
                    </div>
                    {row.summary && row.tool && (
                      <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-tertiary">{withoutIds(row.summary)}</div>
                    )}
                  </div>
                  <time dateTime={at.toISOString()} title={at.toLocaleString(activeLocale())} className="shrink-0 pt-0.5 text-[12px] tabular-nums text-ink-secondary">
                    {sameDay(at, today)
                      ? at.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })
                      : at.toLocaleDateString(activeLocale(), { day: "numeric", month: "short" }) + " " + at.toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
