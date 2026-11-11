// A coding job in the chat it was launched from (#2148, JC 2026-11-06).
// #3581: it is the chat's compact card (AskCard), the routine result's form:
// the code glyph (the Coding rows' spinner while it runs), the job's title,
// the time, its short result or current step as the explanation, then the
// state while it is not done, the branch (monospace is right for a branch
// name) and the pull request link. "Details" opens the coding chat; "Stop"
// while it runs. It never opens a thread, a thread panel or "Go to
// conversation" (unified chat).
import { useEffect, useState } from "react";
import { ChevronRight, Code2, GitBranch, GitPullRequest, TriangleAlert } from "lucide-react";

import { activityStatusActive, type BotActivityDetail } from "../../shared/bot-activity";
import { loadBotActivityDetail, activityStatusLabel } from "@/lib/bot-activity";
import { isCodingJob, lastBotText, type CodingJobView } from "@/lib/coding-job-card";
import { openExternalLink } from "@/lib/app-links";
import { routineDateTime } from "@/lib/routine-display";
import { formatElapsed } from "@/lib/working-time";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, formatTime } from "@/state/store";
import { dayLabel, localDay } from "@/lib/transcript-derivations";
import { ASK_QUIET_BUTTON, AskCard } from "./AskCard";
import { DottedSpinner } from "./bot-settings/CodingSessionRow";

const POLL_MS = 4_000;

const STATE_TONE: Partial<Record<CodingJobView["state"], string>> = {
  failed: "text-danger",
  blocked: "text-warning",
  waiting: "text-accent-text",
};

export function CodingJobCard({ job, threadId, now, onStop, onDetails }: {
  job: CodingJobView;
  threadId: string;
  now: number;
  onStop?: () => void;
  /** Opens the job's coding chat. */
  onDetails?: () => void;
}) {
  const live = activityStatusActive(job.state);
  const status = activityStatusLabel(job.state);
  const elapsedMs = (live ? now : job.endedAt ?? now) - job.startedAt;
  const elapsed = job.state !== "queued" && elapsedMs > 0 ? formatElapsed(elapsedMs) : undefined;
  const line = job.result ?? (live ? job.currentStep : undefined);
  const prLabel = job.pr?.number !== undefined ? t("chat.codingJob.pr", { number: job.pr.number }) : t("chat.codingJob.prPlain");
  const warn = job.state === "failed" || job.state === "blocked";
  const at = job.endedAt ?? job.startedAt;
  const posted = localDay(at) === localDay(now) ? formatTime(at) : `${dayLabel(at)} ${formatTime(at)}`;
  // a finished job without a problem says no state word (the routine card's rule)
  const state = live || job.state !== "finished" ? (
    <span data-coding-job-status aria-live="polite" className={cn("text-[12px] leading-snug", STATE_TONE[job.state] ?? "text-ink-secondary")}>
      {status}
      {elapsed && <span data-coding-job-elapsed className="tabular-nums">{" · "}{elapsed}</span>}
    </span>
  ) : null;
  const code = job.branch || job.pr ? (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
      {job.branch && (
        <span data-coding-job-branch={job.branch} title={job.repo ? `${job.repo} · ${job.branch}` : job.branch} className="inline-flex min-w-0 max-w-full items-center gap-1">
          <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-[11.5px]">{job.branch}</span>
          {job.repo && <span className="shrink-0 text-ink-tertiary">· {job.repo}</span>}
        </span>
      )}
      {job.pr && (
        <button
          type="button"
          data-coding-job-pr={job.pr.url}
          title={job.pr.url}
          onClick={() => void openExternalLink(job.pr!.url)}
          aria-label={t("chat.codingJob.openPrAria", { name: prLabel })}
          className="inline-flex items-center gap-1 rounded font-medium text-accent-text transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <GitPullRequest aria-hidden="true" className="size-3.5" />
          {prLabel}
        </button>
      )}
    </div>
  ) : null;
  const stop = live && onStop && (
    <button type="button" data-coding-job-stop onClick={onStop} aria-label={t("chat.codingJob.stopAria", { title: job.title })} className={ASK_QUIET_BUTTON}>
      {t("chat.codingJob.stop")}
    </button>
  );
  const details = onDetails && (
    <button type="button" data-coding-job-details onClick={onDetails} title={job.title} className={ASK_QUIET_BUTTON}>
      {t("routineRun.details")}
      <ChevronRight aria-hidden="true" size={14} />
    </button>
  );
  return (
    <section
      data-coding-job-card={threadId}
      data-coding-job-state={job.state}
      aria-label={t("chat.codingJob.ariaLabel", { title: job.title, status })}
      className="flex w-full min-w-0 flex-col items-start"
    >
      <AskCard
        result
        icon={live ? <DottedSpinner size={16} /> : warn ? <TriangleAlert size={16} className="text-warning" /> : <Code2 size={16} />}
        title={<span data-coding-job-title title={job.title}>{job.title}</span>}
        meta={<time dateTime={new Date(at).toISOString()} title={routineDateTime(job.startedAt)}>{posted}</time>}
        explanation={line ? <p data-coding-job-result dir="auto" title={line} className="line-clamp-2">{line}</p> : undefined}
        ariaLabel={t("chat.codingJob.ariaLabel", { title: job.title, status })}
        footer={stop || details ? <>{stop}{details}</> : undefined}
      >
        {state || code ? (
          <div className="flex flex-col gap-2">
            {state}
            {code}
          </div>
        ) : undefined}
      </AskCard>
    </section>
  );
}

interface Loaded { detail: BotActivityDetail; result?: string }

/** Finished jobs read once per session: their card does not change. */
const settled = new Map<string, Loaded>();

/** The job's activity entry, read again every few seconds while it runs,
 * then once more with the bot's last words once it ends. Null until read,
 * or when the job cannot be read (the caller keeps its own row then). */
export function useCodingJob(ownerId: string | undefined, threadId: string | undefined, hint?: unknown): Loaded | null {
  const key = ownerId && threadId ? `${ownerId}:${threadId}` : "";
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded } | null>(() => {
    const done = key ? settled.get(key) : undefined;
    return done ? { key, value: done } : null;
  });
  useEffect(() => {
    if (!key || !ownerId || !threadId || settled.has(key)) return;
    let alive = true;
    let timer: number | undefined;
    const read = async () => {
      try {
        const detail = await loadBotActivityDetail(api, ownerId, `thread:${threadId}`);
        if (!alive) return;
        if (activityStatusActive(detail.status)) {
          setLoaded({ key, value: { detail } });
          timer = window.setTimeout(() => void read(), POLL_MS);
          return;
        }
        let result: string | undefined;
        if (isCodingJob(detail)) {
          try {
            const page = await api<{ messages?: Array<{ role?: string; kind?: string; text?: string }> }>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=20`);
            result = lastBotText(page.messages ?? []);
          } catch {
            // the card shows the branch and the PR without the result line
          }
        }
        if (!alive) return;
        const value = { detail, result };
        settled.set(key, value);
        setLoaded({ key, value });
      } catch {
        // not readable: the caller keeps its own row
      }
    };
    void read();
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [key, ownerId, threadId, hint]);
  return loaded && loaded.key === key ? loaded.value : null;
}

export function useTick(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  return now;
}
