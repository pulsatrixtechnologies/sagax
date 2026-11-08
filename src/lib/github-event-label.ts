// A GitHub event kind in plain words ("issue.opened" -> "Issue opened"), so a
// routine's trigger never shows the raw kind (2026-11-07, QA C2 point 8).
// Literal keys, so the unread-key scan sees each one (a `githubEvent.${kind}`
// template has a dotted tail and its parent never matches the catalog).
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const EVENT_KEYS: Record<string, LocaleKey> = {
  "pr.opened": "githubEvent.pr.opened",
  "pr.updated": "githubEvent.pr.updated",
  "pr.merged": "githubEvent.pr.merged",
  "pr.closed": "githubEvent.pr.closed",
  "pr.review_requested": "githubEvent.pr.review_requested",
  "pr.review_submitted": "githubEvent.pr.review_submitted",
  "pr.review_approved": "githubEvent.pr.review_approved",
  "pr.review_changes_requested": "githubEvent.pr.review_changes_requested",
  "pr.review_commented": "githubEvent.pr.review_commented",
  "pr.comment": "githubEvent.pr.comment",
  "pr.review_comment": "githubEvent.pr.review_comment",
  "pr.thread_resolved": "githubEvent.pr.thread_resolved",
  "pr.thread_reopened": "githubEvent.pr.thread_reopened",
  "ci.failed": "githubEvent.ci.failed",
  "ci.succeeded": "githubEvent.ci.succeeded",
  "issue.opened": "githubEvent.issue.opened",
  "issue.labeled": "githubEvent.issue.labeled",
  "issue.assigned": "githubEvent.issue.assigned",
  "push": "githubEvent.push",
  "release.published": "githubEvent.release.published",
};

export function githubEventLabel(kind: string): string {
  const key = EVENT_KEYS[kind];
  return key ? t(key) : kind;
}
