// One coding session in the bot panel's right column (JC, 2026-11-07): a row
// with the state mark at the left (dotted spinner while it runs, a green
// check once merged, the pull request icon while one is open), the session
// title on one line (truncated), a grey subtitle ("Merged · #3", "Ready for
// review · #40") whose "#N" is an underlined link to the pull request, and a
// grey chevron at the right. A click opens the session in the chat column;
// Status, Duration, Tokens and the rest live there. The one shared row:
// every place a coding session shows in the panel draws this.
import { Check, ChevronRight, Loader2, Square, X, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";

import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import { codingRowState, prNumberText, type CodingRowKind, type CodingRowPull } from "@/lib/coding-row-state";
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

const ICON_SIZE = 20;
const PR_ICON = { size: ICON_SIZE, strokeWidth: 1.9, "aria-hidden": true as const };

/** The green check of a finished session (merged here; a finished step of
 * an orchestrator's work on its bot's face, #3462). */
export function DoneMark({ small = false, data = { "data-coding-icon": "merged" }, className }: { small?: boolean; data?: Record<`data-${string}`, string>; className?: string }) {
  return (
    <span {...data} className={cn("flex", small ? "size-3" : "size-5", "shrink-0 items-center justify-center rounded-full bg-success", className)}>
      <Check size={small ? 8 : 13} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

function StateMark({ kind }: { kind: CodingRowKind }) {
  switch (kind) {
    case "running":
      return <DottedSpinner size={ICON_SIZE} />;
    case "merged":
      return <DoneMark />;
    case "ready":
      return <GitPullRequest {...PR_ICON} data-coding-icon="ready" className="shrink-0 text-[var(--color-switch-on)]" />;
    case "draft":
      return <GitPullRequestDraft {...PR_ICON} data-coding-icon="draft" className="shrink-0 text-ink-secondary" />;
    case "changes":
      return <GitPullRequest {...PR_ICON} data-coding-icon="changes" className="shrink-0 text-warning" />;
    case "checks":
      return <GitPullRequest {...PR_ICON} data-coding-icon="checks" className="shrink-0 text-danger" />;
    case "closed":
      return <GitPullRequestClosed {...PR_ICON} data-coding-icon="closed" className="shrink-0 text-danger" />;
    default:
      return <ActivityStatusIcon status={kind as BotActivityStatus} size={ICON_SIZE} />;
  }
}

export interface CodingSessionRowProps {
  title: string;
  /** Where it works (repository, branch): the tooltip only, never on the row. */
  hint?: string;
  status: BotActivityStatus;
  /** The job's pull request, when it has one: its state picks the icon and the
   * subtitle, its number is the "#N" link. */
  pull?: CodingRowPull;
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

export function CodingSessionRow({ title, hint, status, pull, attrs, onOpen, onIgnore, ignoreId, onStop, stopId, stopping = false }: CodingSessionRowProps) {
  const state = codingRowState(status, pull);
  const number = state.pr ? prNumberText(state.pr) : "";
  return (
    <li
      {...attrs}
      data-agent-row
      data-agent-status={status}
      data-coding-state={state.kind}
      className={cn("group relative flex min-h-14 items-center gap-3 hover:bg-hover", PANEL_ROW)}
    >
      {/* The open button covers the row; the content above it lets clicks
          through, except the "#N" link. */}
      <button
        type="button"
        data-coding-open
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={t("botPanel.coding.openAria", { title })}
        className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-default"
      />
      <span className="pointer-events-none relative flex size-5 shrink-0 items-center justify-center">
        <StateMark kind={state.kind} />
      </span>
      <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <span data-agent-title className="truncate text-[15px] leading-[20px] text-ink" title={hint ? `${title} (${hint})` : title}>{title}</span>
        <span data-coding-subtitle className="flex min-w-0 items-center gap-1 text-[14px] leading-[20px] text-ink-secondary">
          <span data-coding-label className="shrink-0">{state.label}</span>
          {state.pr && number && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                data-coding-pr={state.pr.url}
                title={state.pr.url}
                aria-label={t("chat.codingJob.openPrAria", { name: number })}
                onClick={() => void openExternalLink(state.pr!.url)}
                className="pointer-events-auto relative z-10 rounded-sm underline decoration-ink-tertiary decoration-1 underline-offset-[3px] transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {number}
              </button>
            </>
          )}
        </span>
      </span>
      {onOpen && (
        <ChevronRight
          size={16}
          aria-hidden="true"
          data-coding-chevron
          className={cn("pointer-events-none relative shrink-0 text-ink-tertiary", (onIgnore || onStop) && "group-hover:invisible group-focus-within:invisible")}
        />
      )}
      {onStop && (
        <button
          type="button"
          data-activity-stop={stopId}
          onClick={onStop}
          disabled={stopping}
          aria-label={t("botPanel.activity.stopAria", { title })}
          title={t("botPanel.activity.stop")}
          className="absolute right-3 z-10 flex size-6 items-center justify-center rounded-full text-ink-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 touch:opacity-100"
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
          className="absolute right-3 z-10 flex size-6 items-center justify-center rounded-full text-ink-tertiary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
