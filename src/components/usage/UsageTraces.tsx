// Settings > Usage, every signed-in person: their OWN per-job usage traces
// (the `load` prop is fetchMyTraces -> GET /api/me/usage/traces, which keeps
// the caller's own turns only). Each job is one thread under one trigger (a
// routine run, a person's conversation, a bot-to-bot exchange); the row shows
// where it spent its time and its money, and expands to the per-turn trace.
// The whole-ledger variant (fetchTraces) is for an admin console, not here.
//
// Port of OpenMausBot #3316 rebuilt on OUR ledger: no Cloud, no credit, no
// team plumbing. Human labels throughout; the bot and thread ids ride a Copy
// button only, never shown as a UUID (JC's rule). Privacy: counters, time and
// cost only, never a prompt, a message or a secret.
import { useEffect, useState } from "react";
import { ChevronRight, Copy } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { personalUsagePeriods, formatCost } from "@/lib/usage-personal";
import { formatTokens } from "@/lib/usage";
import {
  fetchTraces,
  formatDuration,
  freshInput,
  triggerLabelOf,
  type UsageJobTrace,
  type UsageTraceList,
} from "@/lib/usage-trace";
import { SettingsGroup } from "../SettingsPrimitives";

function CopyId({ botId, threadId }: Pick<UsageJobTrace, "botId" | "threadId">) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-md p-1 text-ink-secondary hover:text-ink"
      title={`bot ${botId} · thread ${threadId}`}
      aria-label={t("usage.trace.copyId")}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(`bot ${botId}\nthread ${threadId}`).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      <Copy className="size-3.5" aria-hidden />
      <span className="sr-only">{done ? t("usage.trace.copied") : t("usage.trace.copyId")}</span>
    </button>
  );
}

function CostLabel({ job }: { job: UsageJobTrace }) {
  if (job.costUsd === null) return <span className="text-ink-secondary">{t("usage.trace.unpriced", { count: String(job.unpriced) })}</span>;
  const estimated = job.estimatedUsd !== null && job.estimatedUsd > 0;
  return (
    <span className="tabular-nums" title={estimated ? t("usage.trace.estimated") : undefined}>
      {formatCost(job.costUsd)}
      {estimated ? ` ${t("usage.trace.estimatedMark")}` : ""}
    </span>
  );
}

function JobRow({ job }: { job: UsageJobTrace }) {
  const [open, setOpen] = useState(false);
  const fresh = freshInput(job);
  return (
    <div className="flex flex-col border-b-[0.5px] border-border last:border-0">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-ink-secondary transition-transform", open && "rotate-90")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-ink">{job.botName}</span>
            <span className="block truncate text-[11px] text-ink-secondary">
              {triggerLabelOf(job)} · {t("usage.trace.turns", { count: String(job.turns) })}
            </span>
          </span>
        </button>
        <span className="shrink-0 text-right text-[12px] text-ink-secondary tabular-nums" title={t("usage.trace.time")}>
          {job.timedTurns > 0 ? formatDuration(job.durationMs) : "—"}
        </span>
        <span className="w-20 shrink-0 text-right text-[12px] text-ink">
          <CostLabel job={job} />
        </span>
        <CopyId botId={job.botId} threadId={job.threadId} />
      </div>
      {open && (
        <div className="flex flex-col gap-1 bg-inset px-3 py-2 text-[11px] text-ink-secondary">
          <div className="flex justify-between tabular-nums">
            <span>{t("usage.colNewTokens")}</span>
            <span>{formatTokens(fresh)} · {formatTokens(job.output)} {t("usage.trace.out")}</span>
          </div>
          {job.steps.map((step, index) => (
            <div key={`${step.at}-${index}`} className="flex items-center justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 truncate">
                {t("usage.trace.turn", { n: String(index + 1) })} · {step.model}
              </span>
              <span className="shrink-0">{step.durationMs !== null ? formatDuration(step.durationMs) : "—"}</span>
              <span className="w-16 shrink-0 text-right">
                {step.costUsd !== null ? formatCost(step.costUsd) : t("usage.trace.na")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The per-job usage traces for the current month. In Settings > Usage the
 * caller passes fetchMyTraces, so a person sees their own jobs only. */
export function UsageTraces({ load = fetchTraces }: { load?: (range: { from: string; to: string }) => Promise<UsageTraceList> }) {
  const [list, setList] = useState<UsageTraceList | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const range = personalUsagePeriods().month;
    load(range).then(
      (next) => { if (alive) setList(next); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [load]);

  const jobs = Array.isArray(list?.jobs) ? list.jobs : [];
  return (
    <SettingsGroup title={t("usage.trace.title")} groupId="usage-traces" plain>
      <p className="px-1 text-[12px] leading-[17px] text-ink-secondary">{t("usage.trace.caption")}</p>
      <div className="flex flex-col rounded-xl border-[0.5px] border-border bg-elevated">
        {failed ? (
          <p className="px-3 py-3 text-[12px] text-ink-secondary">{t("usage.trace.failed")}</p>
        ) : !list ? (
          <p className="px-3 py-3 text-[12px] text-ink-secondary">{t("usage.trace.loading")}</p>
        ) : jobs.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-ink-secondary">{t("usage.trace.empty")}</p>
        ) : (
          <>
            {jobs.map((job) => <JobRow key={job.jobId} job={job} />)}
            {list.truncated && (
              <p className="px-3 py-2 text-[11px] text-ink-secondary">{t("usage.trace.truncated", { count: String(jobs.length) })}</p>
            )}
          </>
        )}
      </div>
    </SettingsGroup>
  );
}
