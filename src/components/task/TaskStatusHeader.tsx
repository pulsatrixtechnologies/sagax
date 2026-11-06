// The head of a task's sheet (2026-10-29): the bot in its pill (mascot and
// name), the task's title, then one line in plain words that says where it
// is: "Working · Reading your email · 4m so far", "Waiting for your
// approval", "Finished in 12m", "Failed after 3m". The step is worded like
// the working line under a conversation (shared/working-step.ts), so the
// sheet and the chat name the same thing the same way. The actions
// (Stop, Open conversation) sit at the right of the title, within reach.
// Nothing here fetches: a routine run's detail or a parallel task's passes
// the same props.
import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, activityStatusLabel, formatActivityDuration, type BotActivityStatus } from "@/lib/bot-activity";
import { workingStepLabel } from "@/lib/working-step";
import type { WorkingStep } from "../../../shared/working-step";
import { BotAvatar, type BotAvatarProps } from "../Avatar";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { DIALOG } from "../SettingsPrimitives";

export type TaskWaitingKind = "approval" | "question";

/** Derived stage of a delegated job (server/runtime/stage.ts, DEL-01). Each
 * value maps to task.sheet.stage.* and says who is waited on and for what. */
export type TaskJobStage =
  | "delivery_failed"
  | "awaiting_reply"
  | "to_review"
  | "held"
  | "queued"
  | "inactive"
  | "working"
  | "finished";

const STAGE_KEYS: Record<TaskJobStage, `task.sheet.stage.${TaskJobStage}`> = {
  delivery_failed: "task.sheet.stage.delivery_failed",
  awaiting_reply: "task.sheet.stage.awaiting_reply",
  to_review: "task.sheet.stage.to_review",
  held: "task.sheet.stage.held",
  queued: "task.sheet.stage.queued",
  inactive: "task.sheet.stage.inactive",
  working: "task.sheet.stage.working",
  finished: "task.sheet.stage.finished",
};

/** Map a task-sheet activity status onto a derived job stage for the head
 * line. When an approval or question card is open, waitingFor keeps the
 * finer label; stage covers held / queued / working / finished. Full
 * stageOf(assignment, events) lands when the activity API carries it. */
export function activityJobStage(
  status: BotActivityStatus,
  waitingFor?: TaskWaitingKind,
): TaskJobStage | undefined {
  if (waitingFor) return undefined;
  if (status === "failed" || status === "blocked") return "held";
  if (status === "queued") return "queued";
  if (status === "running") return "working";
  if (status === "waiting") return "inactive";
  if (status === "finished" || status === "stopped") return "finished";
  return undefined;
}

/** The status line's words: the state in plain words, the step in flight,
 * the time, joined with " · ". */
export function taskStatusWords({ status, startedAt, endedAt, now, step, stepLabel, waitingFor, parallel, handedBy, stage }: {
  status: BotActivityStatus;
  startedAt: number;
  endedAt?: number;
  now: number;
  /** The named step in flight (currentTaskStep), worded like the working line. */
  step?: WorkingStep | null;
  /** The step's plain name when the table has no better word for it. */
  stepLabel?: string;
  /** What the task waits on, when it waits. */
  waitingFor?: TaskWaitingKind;
  parallel?: boolean;
  /** The bot that handed the work over, for a hop. */
  handedBy?: string;
  /** Derived delegation stage: who is waited on and for what (DEL-01). */
  stage?: TaskJobStage;
}): string[] {
  const duration = formatActivityDuration((endedAt ?? now) - startedAt);
  const words: string[] = [];
  if (parallel) words.push(t("botPanel.activity.parallel"));
  if (stage) {
    words.push(t(STAGE_KEYS[stage]));
    if (status === "running") {
      if (step) words.push(workingStepLabel(step));
      else if (stepLabel) words.push(stepLabel);
      words.push(t("task.sheet.status.elapsed", { duration }));
    } else if (status === "waiting" || status === "queued") {
      words.push(t("task.sheet.status.elapsed", { duration }));
    } else {
      if (handedBy) words.push(t("botPanel.coding.handedBy", { name: handedBy }));
      words.push(t("task.sheet.status.took", { duration }));
    }
    return words;
  }
  if (status === "running") {
    words.push(t("task.sheet.status.working"));
    if (step) words.push(workingStepLabel(step));
    else if (stepLabel) words.push(stepLabel);
    words.push(t("task.sheet.status.elapsed", { duration }));
  } else if (status === "waiting") {
    words.push(t(waitingFor === "question" ? "task.sheet.status.waitingAnswer" : "task.sheet.status.waitingApproval"));
    words.push(t("task.sheet.status.elapsed", { duration }));
  } else if (status === "queued") {
    words.push(activityStatusLabel(status));
  } else {
    words.push(activityStatusLabel(status));
    if (handedBy) words.push(t("botPanel.coding.handedBy", { name: handedBy }));
    words.push(t("task.sheet.status.took", { duration }));
  }
  return words;
}

export function TaskStatusHeader({ title, titleId = "activity-detail-title", bot, botName, status, startedAt, endedAt, now, step, stepLabel, waitingFor, parallel, handedBy, stage, actions, onBack, backLabel, className }: {
  title: string;
  titleId?: string;
  /** The bot the work runs on: its mascot and name in a pill. */
  bot?: BotAvatarProps["bot"] & { name: string };
  /** The bot's name when only that is known (no mascot). */
  botName?: string;
  status: BotActivityStatus;
  startedAt: number;
  endedAt?: number;
  now: number;
  step?: WorkingStep | null;
  stepLabel?: string;
  waitingFor?: TaskWaitingKind;
  parallel?: boolean;
  handedBy?: string;
  /** Derived delegation stage (DEL-01). */
  stage?: TaskJobStage;
  /** The main actions, at the right: Stop, Open conversation. */
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}) {
  const words = taskStatusWords({ status, startedAt, endedAt, now, step, stepLabel, waitingFor, parallel, handedBy, stage });
  const active = activityStatusActive(status);
  const name = bot?.name ?? botName;
  return (
    <header data-task-header={status} className={cn(DIALOG.header, "flex flex-col gap-2 pb-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {onBack && (
          <button type="button" data-activity-back onClick={onBack} aria-label={backLabel ?? t("activity.back")} title={backLabel ?? t("activity.back")} className="-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        )}
        {name && (
          <span data-task-bot={name} className="flex min-w-0 items-center gap-1.5 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[3px] pl-[3px] pr-2.5">
            {bot && <BotAvatar bot={bot} size={22} animated={false} state={active ? "working" : "idle"} />}
            <span className="truncate text-[12.5px] font-medium leading-4 text-ink">{name}</span>
          </span>
        )}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5" data-task-actions>{actions}</div>}
      </div>
      <div className="min-w-0">
        <h2 id={titleId} className={cn(DIALOG.title, "break-words")}>{title}</h2>
        <p data-activity-detail-status={status} className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-[18px] text-ink-secondary">
          <ActivityStatusIcon status={status} size={14} />
          {words.map((word, index) => (
            <span key={`${index}-${word}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">·</span>}
              <span
                className={cn("min-w-0 truncate", status === "running" && index === (parallel ? 2 : 1) && (step || stepLabel) && "thinking-shimmer motion-reduce:[&_.thinking-sheen]:hidden")}
                style={status === "running" && index === (parallel ? 2 : 1) && (step || stepLabel) ? ({ "--sheen-period": "2000ms", "--sheen-delay": "0ms" } as CSSProperties) : undefined}
              >
                {word}
                {status === "running" && index === (parallel ? 2 : 1) && (step || stepLabel) ? (
                  <span aria-hidden="true" className="thinking-sheen"><span data-text={word} /></span>
                ) : null}
              </span>
            </span>
          ))}
        </p>
      </div>
    </header>
  );
}
