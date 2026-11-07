// The state of one Coding row (JC, 2026-11-07): the icon kind and the words of
// its grey subtitle ("Merged · #3", "Ready for review · #40"), and the pull
// request the "#N" link opens. Pure: the row only draws what this says.
import type { BotActivityItem, BotActivityStatus } from "@/lib/bot-activity";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export type CodingRowKind =
  | "running" | "waiting" | "queued" | "stopped" | "blocked" | "failed" | "finished"
  | "draft" | "ready" | "changes" | "checks" | "merged" | "closed";

/** What is known of the job's pull request. `draft`, `review` and `checks`
 * come from a live read; without one only `state` is known (what the bot's
 * own calls said). */
export interface CodingRowPull {
  number?: number;
  url?: string;
  state: "open" | "merged" | "closed";
  draft?: boolean;
  review?: "changes_requested" | "approved" | "required";
  checks?: "failing" | "pending" | "passing";
}

export interface CodingRowState {
  kind: CodingRowKind;
  label: string;
  /** The "#N" link: only with a pull request that has a page. */
  pr?: { number?: number; url: string };
}

const LABELS: Record<CodingRowKind, LocaleKey> = {
  running: "botPanel.coding.status.running",
  waiting: "botPanel.coding.status.waiting",
  queued: "botPanel.coding.status.queued",
  stopped: "botPanel.coding.status.stopped",
  blocked: "routines.status.blocked",
  failed: "botPanel.coding.status.failed",
  finished: "botPanel.coding.status.finished",
  draft: "botPanel.coding.row.draft",
  ready: "botPanel.coding.row.ready",
  changes: "botPanel.coding.row.changes",
  checks: "botPanel.coding.row.checks",
  merged: "botPanel.coding.row.merged",
  closed: "botPanel.coding.row.closed",
};

function pullKind(pull: CodingRowPull): CodingRowKind {
  if (pull.state === "merged") return "merged";
  if (pull.state === "closed") return "closed";
  if (pull.checks === "failing") return "checks";
  if (pull.review === "changes_requested") return "changes";
  if (pull.draft) return "draft";
  return "ready";
}

/** Live work and failures say what they are; a settled job says what its
 * pull request is, else how it ended. */
export function codingRowState(status: BotActivityStatus, pull?: CodingRowPull): CodingRowState {
  const link = pull?.url ? { number: pull.number, url: pull.url } : undefined;
  let kind: CodingRowKind;
  if (status === "running" || status === "waiting" || status === "queued" || status === "failed") kind = status;
  else if (pull) kind = pullKind(pull);
  else kind = status;
  return { kind, label: t(LABELS[kind]), ...(link ? { pr: link } : {}) };
}

/** The newest pull request the job's own calls produced: merged, closed, or
 * else open. */
export function pullOfItem(item: Pick<BotActivityItem, "code">): CodingRowPull | undefined {
  const pull = item.code?.pullRequests?.at(-1);
  if (!pull) return undefined;
  return {
    number: pull.number,
    url: pull.url,
    state: pull.action === "merged" ? "merged" : pull.action === "closed" ? "closed" : "open",
  };
}

/** "#40", or "" when the pull request has no number. */
export function prNumberText(pr: { number?: number }): string {
  return pr.number !== undefined ? `#${pr.number}` : "";
}
