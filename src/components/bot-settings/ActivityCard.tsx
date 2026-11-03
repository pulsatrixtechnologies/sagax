// One Coding or Activity entry as a rounded card (status icon, truncated
// title, status line, chevron) and the status icon the detail modal reuses.
// Given `now`, a running entry reads its elapsed time and current step; given
// `onStop`, a running entry the viewer may stop gets a Stop button; given
// `where`, a third line says where it works (a coding job's repository and
// branch).
import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash, Clock, Hand, Loader2, Square, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, activitySubtitle, activityTitle, type BotActivityItem, type BotActivityStatus } from "@/lib/bot-activity";

export function ActivityStatusIcon({ status, size = 16 }: { status: BotActivityStatus; size?: number }) {
  const common = { size, strokeWidth: 1.9, "aria-hidden": true as const, className: "shrink-0" };
  switch (status) {
    case "running":
      return <Loader2 {...common} data-activity-icon="running" className="shrink-0 animate-spin text-accent-text" />;
    case "waiting":
      return <Hand {...common} data-activity-icon="waiting" className="shrink-0 text-warning" />;
    case "queued":
      return <Clock {...common} data-activity-icon="queued" className="shrink-0 text-ink-secondary" />;
    case "failed":
      return <AlertCircle {...common} data-activity-icon="failed" className="shrink-0 text-danger" />;
    case "stopped":
      return <CircleSlash {...common} data-activity-icon="stopped" className="shrink-0 text-ink-secondary" />;
    // 2026-11-03: a blocked run is never a green check.
    case "blocked":
      return <TriangleAlert {...common} data-activity-icon="blocked" className="shrink-0 text-warning" />;
    default:
      return <CheckCircle2 {...common} data-activity-icon="finished" className="shrink-0 text-success" />;
  }
}

export function ActivityCard({ item, onOpen, now, onStop, stopping = false, where, current = false }: {
  item: BotActivityItem;
  where?: string;
  /** The entry History's right pane shows. */
  current?: boolean;
  onOpen: (item: BotActivityItem) => void;
  now?: number;
  onStop?: (item: BotActivityItem) => void;
  stopping?: boolean;
}) {
  const stoppable = Boolean(onStop && item.canStop && item.threadId && activityStatusActive(item.status));
  return (
    <div className={cn("flex w-full items-center gap-1 rounded-xl border transition-colors", current ? "border-border bg-selected" : "border-hairline-weak bg-card hover:bg-hover")}>
      <button
        type="button"
        data-activity-card={item.id}
        aria-current={current ? "true" : undefined}
        data-activity-status={item.status}
        onClick={() => onOpen(item)}
        aria-label={t("botPanel.coding.openAria", { title: activityTitle(item) })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ActivityStatusIcon status={item.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{activityTitle(item)}</span>
          <span data-activity-subtitle className="block truncate text-[12px] leading-[17px] text-ink-secondary">
            {item.parallel ? `${t("botPanel.activity.parallel")} · ` : ""}{activitySubtitle(item, now)}
            {item.childCount ? ` · ${t("botPanel.coding.subagents", { count: item.childCount })}` : ""}
          </span>
          {where && <span data-activity-where className="block truncate text-[12px] leading-[17px] text-ink-tertiary">{where}</span>}
        </span>
        {!stoppable && <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
      </button>
      {stoppable && (
        <button
          type="button"
          data-activity-stop={item.id}
          onClick={() => onStop?.(item)}
          disabled={stopping}
          aria-label={t("botPanel.activity.stopAria", { title: activityTitle(item) })}
          title={t("botPanel.activity.stop")}
          className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-lg text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
        >
          {stopping ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Square size={11} fill="currentColor" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
