// One coding session in the bot panel's right column (JC, 2026-11-06): a
// single row, nothing else visible. State mark at the left (dotted spinner
// while it runs, a fixed icon otherwise), the session title on one line,
// truncated, and a grey chevron at the right. A click opens the session in
// the chat column; Status, Duration, Tokens and the rest live there. The one
// shared row: every place a coding session shows in the panel draws this.
import { ChevronRight, Loader2, Square, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { PANEL_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import type { BotActivityStatus } from "../../../shared/bot-activity";
import { ActivityStatusIcon } from "./ActivityCard";

/** The dotted spinner of a running session. */
export function DottedSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      data-coding-spinner
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="shrink-0 animate-spin text-accent-text motion-reduce:animate-none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.1 3.1" />
    </svg>
  );
}

function StateMark({ status }: { status: BotActivityStatus }) {
  if (status === "running") return <DottedSpinner />;
  return <ActivityStatusIcon status={status} size={16} />;
}

export interface CodingSessionRowProps {
  title: string;
  /** Where it works (repository, branch): the tooltip only, never on the row. */
  hint?: string;
  status: BotActivityStatus;
  /** Attributes that identify the row (ids, status) for callers and tests. */
  attrs?: Record<string, string | undefined>;
  /** Click on the row; absent: the row is not openable (no chevron). */
  onOpen?: () => void;
  /** Ignore on a finished row: replaces the chevron on hover or focus. */
  onIgnore?: () => void;
  ignoreId?: string;
  /** Stop on a live row: replaces the chevron on hover or focus. */
  onStop?: () => void;
  stopId?: string;
  stopping?: boolean;
}

export function CodingSessionRow({ title, hint, status, attrs, onOpen, onIgnore, ignoreId, onStop, stopId, stopping = false }: CodingSessionRowProps) {
  return (
    <li
      {...attrs}
      data-agent-row
      data-agent-status={status}
      className={cn("group relative flex min-h-11 items-center gap-2.5 hover:bg-hover", PANEL_ROW)}
    >
      <button
        type="button"
        data-coding-open
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={t("botPanel.coding.openAria", { title })}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StateMark status={status} />
        </span>
        <span data-agent-title className="min-w-0 flex-1 truncate text-[14px] leading-[18px] text-ink" title={hint ? `${title} (${hint})` : title}>{title}</span>
        {onOpen && (
          <ChevronRight
            size={15}
            aria-hidden="true"
            data-coding-chevron
            className={cn("shrink-0 text-ink-tertiary", (onIgnore || onStop) && "group-hover:invisible group-focus-within:invisible")}
          />
        )}
      </button>
      {onStop && (
        <button
          type="button"
          data-activity-stop={stopId}
          onClick={onStop}
          disabled={stopping}
          aria-label={t("botPanel.activity.stopAria", { title })}
          title={t("botPanel.activity.stop")}
          className="absolute right-2.5 flex size-6 items-center justify-center rounded-full text-ink-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 touch:opacity-100"
        >
          {stopping ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={10} fill="currentColor" aria-hidden="true" />}
        </button>
      )}
      {onIgnore && (
        <button
          type="button"
          data-agent-ignore={ignoreId}
          onClick={onIgnore}
          aria-label={t("botPanel.coding.ignoreAria", { title })}
          title={t("botPanel.coding.ignore")}
          className="absolute right-2.5 flex size-6 items-center justify-center rounded-full text-ink-tertiary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
