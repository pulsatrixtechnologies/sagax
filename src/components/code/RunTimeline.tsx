// A run's conversation: the task, "Worked N min", the agent's messages
// (Markdown, inert: no widget runs and nothing reaches the network), tool
// calls folded per burst, approval cards answered inline, the PR link.
// Same contract as the Perspicax console's `RunTimeline` (its spec, section
// 8.0): the events in props, `onApprove` for the approval buttons.
import { Check, ChevronRight, ExternalLink, GitPullRequest, ListChecks, ShieldQuestion, Wrench, X } from "lucide-react";

import type { RunEvent } from "../../../shared/cloud-agents.ts";
import { ChatMarkdown } from "../ChatMarkdown";
import { timelineItems, type TimelineItem } from "@/lib/code-runs";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface RunTimelineProps {
  events: RunEvent[];
  onApprove?: (approvalId: string, option: string) => void;
  /** "Worked N min" under the task, when known. */
  workedMinutes?: number;
  /** The run is working right now (a discreet line at the end). */
  working?: boolean;
}

function Tools({ item }: { item: Extract<TimelineItem, { kind: "tools" }> }) {
  return (
    <details data-run-tools className="group rounded-lg text-[12.5px] text-ink-secondary">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-hover">
        <ChevronRight size={12} aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        <Wrench size={12} aria-hidden />
        {item.calls.length === 1 ? t("code.timeline.tools.one") : t("code.timeline.tools", { n: item.calls.length })}
      </summary>
      <ul className="ml-5 mt-1 flex flex-col gap-1">
        {item.calls.map((call, index) => (
          <li key={`${call.id}:${index}`} className="flex min-w-0 items-start gap-1.5">
            {call.ok === false ? <X size={12} aria-label={t("code.timeline.failed")} className="mt-0.5 shrink-0 text-danger" /> : <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-success" />}
            <span className="min-w-0">
              <span className="font-medium text-ink">{call.name}</span>
              {call.summary && <span className="ml-1.5 font-mono text-[11.5px]">{call.summary}</span>}
              {call.output && <span className="block truncate text-[11.5px] text-ink-tertiary">{call.output}</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Verify({ item }: { item: Extract<TimelineItem, { kind: "verify" }> }) {
  return (
    <details data-run-verify className="group rounded-lg text-[12.5px] text-ink-secondary">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-hover">
        <ChevronRight size={12} aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        <ListChecks size={12} aria-hidden className={item.failed ? "text-danger" : "text-success"} />
        {item.failed ? t("code.timeline.verify.failed", { passed: item.passed, failed: item.failed }) : t("code.timeline.verify.ok", { n: item.passed })}
      </summary>
      <ul className="ml-5 mt-1 flex flex-col gap-1">
        {item.commands.map((command, index) => (
          <li key={`${command.cmd}:${index}`} className="flex min-w-0 items-start gap-1.5">
            {command.ok ? <Check size={12} aria-hidden className="mt-0.5 shrink-0 text-success" /> : <X size={12} aria-label={t("code.timeline.failed")} className="mt-0.5 shrink-0 text-danger" />}
            <span className="min-w-0">
              <span className="font-mono text-[11.5px] text-ink">{command.cmd}</span>
              {!command.ok && command.tail && <span className="mt-0.5 block whitespace-pre-wrap font-mono text-[11px] text-ink-tertiary">{command.tail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Approval({ item, onApprove }: { item: Extract<TimelineItem, { kind: "approval" }>; onApprove?: RunTimelineProps["onApprove"] }) {
  return (
    <div data-run-approval={item.approvalId} className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
      <div className="flex items-start gap-2 text-[13px] text-ink">
        <ShieldQuestion size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">{item.title || t("code.timeline.approval")}</span>
      </div>
      {item.detail && <p className="ml-6 mt-1 whitespace-pre-wrap text-[12.5px] text-ink-secondary">{item.detail}</p>}
      {item.answer ? (
        <p className="ml-6 mt-1 text-[12px] text-ink-secondary">{t("code.timeline.answered", { option: item.answer })}</p>
      ) : onApprove ? (
        <div className="ml-6 mt-2 flex flex-wrap gap-2">
          {item.options.map((option, index) => (
            <button
              key={`${option}:${index}`}
              type="button"
              onClick={() => onApprove(item.approvalId, option)}
              className={cn("ui-button h-7 px-3 text-[12.5px]", index === 0 && "ui-button-primary")}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunTimeline({ events, onApprove, workedMinutes, working }: RunTimelineProps) {
  const items = timelineItems(events);
  return (
    <ol data-run-timeline className="flex flex-col gap-3" aria-live="polite">
      {items.map((item, index) => {
        const key = `${item.kind}:${item.seq}`;
        switch (item.kind) {
          case "task":
          case "followup":
            return (
              <li key={key} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-bubble-user px-3.5 py-2 text-[13.5px] text-ink">{item.text}</div>
                {item.kind === "followup" && item.mode !== "queue" && <span className="text-[11px] text-ink-tertiary">{t(`code.followup.mode.${item.mode}` as "code.followup.mode.steer")}</span>}
                {item.kind === "task" && index === 0 && workedMinutes !== undefined && (
                  <span data-run-worked className="self-start text-[12px] text-ink-tertiary">{workedMinutes < 1 ? t("code.timeline.worked.lt1") : t("code.timeline.worked", { n: workedMinutes })}</span>
                )}
              </li>
            );
          case "message":
            return <li key={key} className="text-[13.5px] leading-6 text-ink"><ChatMarkdown text={item.text} inert /></li>;
          case "tools":
            return <li key={key}><Tools item={item} /></li>;
          case "approval":
            return <li key={key}><Approval item={item} onApprove={onApprove} /></li>;
          case "verify":
            return <li key={key}><Verify item={item} /></li>;
          case "pr":
            return (
              <li key={key}>
                <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-card px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised">
                  <GitPullRequest size={13} aria-hidden />
                  {t("code.timeline.pr", { number: item.number })}
                  <ExternalLink size={11} aria-hidden className="text-ink-tertiary" />
                </a>
              </li>
            );
          case "status":
            return <li key={key} className="text-[12px] text-ink-tertiary">{item.text}</li>;
          default:
            return null;
        }
      })}
      {working && (
        <li data-run-working className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <span className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          {t("code.timeline.working")}
        </li>
      )}
    </ol>
  );
}
