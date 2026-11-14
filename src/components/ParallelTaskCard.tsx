// A parallel task in the conversation it answers (shared/parallel-tasks.ts).
//
// In the one conversation (threads off, #2099, JC 2026-11-05) a task that
// runs is one step row in the chat's own look (#3581, StepRow): "Working in
// the background", the task's title, the elapsed time and a round Stop; the
// work itself is a row of the bot panel's Coding list. Its question, when it
// has one, stays inline under the row (#2082). Once it has ended the row is
// gone: its answer under it says the same thing (the bubble that quotes the
// person's request, or the task's own row when the bot opened it).
//
// With threads on it is the card: its name, where it stands (from the task's
// own live state: running, waiting for the person's approval, waiting for a
// slot, done, failed, stopped), how long it has run, Stop while it is not
// done and Open to read or steer it in its own thread.
import { useEffect, useState } from "react";
import { ChevronRight, GitFork, Loader2, Square } from "lucide-react";

import { liveParallelState, type ParallelTaskState } from "../../shared/parallel-tasks";
import { openThread, useStore, type Message } from "@/state/store";
import { pendingQuestions } from "@/lib/pending-question";
import { threadHeadPage } from "@/lib/thread-head-page";
import { usePinnedHeld } from "@/lib/pinned-waiting";
import { QuestionCard } from "./QuestionCard";
import { StepRow } from "./StepRow";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { formatElapsed } from "@/lib/working-time";
import { codingJobView, isCodingJob } from "@/lib/coding-job-card";
import { CodingJobCard, useCodingJob } from "./CodingJobCard";

type CardState = ParallelTaskState | "waiting";

const STATE_LABEL: Record<CardState, () => string> = {
  queued: () => t("chat.parallel.state.queued"),
  running: () => t("chat.parallel.state.running"),
  waiting: () => t("chat.parallel.state.waiting"),
  done: () => t("chat.parallel.state.done"),
  failed: () => t("chat.parallel.state.failed"),
  stopped: () => t("chat.parallel.state.stopped"),
};

/** #3581: on a narrow screen the step row of a task keeps the task's title
 * whole (the title is the only thing that tells two tasks apart): the words
 * around it ("Working in the background", an answer's first sentence)
 * shorten first, then drop. `part` is the StepRow piece holding the title.
 * StepRow keeps its own rule (label, then a paler target) everywhere else. */
export function wholeStepTitle(part: "label" | "target"): string {
  return part === "target"
    ? "@container w-full [&>[data-step-row]>*>[data-step-target]]:max-w-full [&>[data-step-row]>*>[data-step-target]]:shrink-0 @max-[20rem]:[&>[data-step-row]>*>[data-step-label]]:hidden"
    : "@container w-full [&>[data-step-row]>*>[data-step-label]]:max-w-full [&>[data-step-row]>*>[data-step-label]]:shrink-0 @max-[20rem]:[&>[data-step-row]>*>[data-step-target]]:hidden";
}

export function parallelCardState(message: Message, task: { busy?: boolean; activity?: string } | undefined): CardState {
  const ref = message.parallelTask;
  return liveParallelState(ref?.state, task, ref?.state === "queued");
}

/** #2082 (JC, 2026-11-05): in the one conversation (threads off) a parallel
 * task's question lives inline in the bot's chat, under its card, answered
 * right there: no "Open" button, never a side thread. */
function useInlineQuestions(threadId: string | undefined, enabled: boolean, version: string | number | undefined): Message[] {
  const [found, setFound] = useState<{ key: string; questions: Message[] }>({ key: "", questions: [] });
  const key = enabled && threadId ? `${threadId}:${String(version)}` : "";
  useEffect(() => {
    if (!key || !threadId) return;
    let live = true;
    void (async () => {
      try {
        // #4187: the page the conversation's approvals read for the same change
        const page = await threadHeadPage(threadId, version ?? 0);
        if (live) setFound({ key, questions: pendingQuestions(page.messages ?? []) });
      } catch {
        // the card still says the task waits on the person
      }
    })();
    return () => { live = false; };
  }, [key, threadId]);
  return key && found.key === key ? found.questions : [];
}

export function ParallelTaskCard({ message, botId }: { message: Message; botId: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const ref = message.parallelTask;
  const owner = state.bots.find((candidate) => candidate.id === (message.threadRef?.botId ?? botId));
  const task = owner?.tasks?.find((candidate) => candidate.threadId === ref?.threadId);
  const status = ref ? parallelCardState(message, task) : "queued";
  const live = status === "running" || status === "waiting" || status === "queued";
  const asked = useInlineQuestions(ref?.threadId, status === "waiting", task?.updatedAt);
  // #3681: a question the pinned card over the box holds is drawn there only
  const held = usePinnedHeld();
  const questions = showThreads ? [] : asked.filter((question) => !held.has(question.id));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  // #2148: a coding job stays in the chat as a coding card (never a thread).
  const coding = useCodingJob(owner?.id, ref?.threadId, status);
  if (!ref || !owner) return null;
  if (coding && isCodingJob(coding.detail)) {
    const job = codingJobView(coding.detail, coding.result);
    return (
      <div className="flex w-full flex-col items-start gap-2" data-parallel-card={ref.threadId} data-parallel-state={status}>
        <CodingJobCard
          job={job}
          threadId={ref.threadId}
          now={now}
          onStop={() => dispatch({ type: "stopParallelTask", botId: owner.id, threadId: ref.threadId })}
          onDetails={() => dispatch({ type: "openCodingChat", target: { botId: owner.id, itemId: `thread:${ref.threadId}`, threadId: ref.threadId } })}
        />
        {questions.map((question) => (
          <div key={question.id} className="w-full" data-parallel-inline-question={ref.threadId}>
            <QuestionCard threadId={ref.threadId} bot={{ id: owner.id, name: owner.name }} message={question} />
          </div>
        ))}
      </div>
    );
  }
  const started = task?.turnStartedAt ?? ref.startedAt ?? message.at;
  const elapsed = live ? now - started : (ref.endedAt ?? now) - started;
  if (!showThreads) {
    // ended: the answer under it tells the same state
    if (!live) return null;
    const label = status === "queued" ? STATE_LABEL.queued()
      : status === "waiting" ? (asked.length > 0 ? t("chat.parallel.state.waitingAnswer") : STATE_LABEL.waiting())
        : t("chat.parallel.background");
    return (
      <div className="flex w-full flex-col items-start gap-2" data-parallel-card={ref.threadId} data-parallel-state={status}>
        <div className={wholeStepTitle("target")} data-step-whole="target">
          <StepRow
            testId="parallel-task-row"
            label={label}
            target={ref.title}
            title={t("chat.parallel.title", { title: ref.title })}
            phase={status === "running" ? "running" : "done"}
            duration={status !== "queued" && elapsed > 0 ? formatElapsed(elapsed) : undefined}
            extra={
              <button
                type="button"
                data-parallel-stop={ref.threadId}
                onClick={() => dispatch({ type: "stopParallelTask", botId: owner.id, threadId: ref.threadId })}
                title={t("chat.parallel.stop")}
                aria-label={t("chat.parallel.stop")}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-danger/10 hover:text-danger"
              >
                <Square size={9} className="fill-current" aria-hidden="true" />
              </button>
            }
          />
        </div>
        {questions.map((question) => (
          <div key={question.id} className="w-full" data-parallel-inline-question={ref.threadId}>
            <QuestionCard threadId={ref.threadId} bot={{ id: owner.id, name: owner.name }} message={question} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2" data-parallel-card={ref.threadId} data-parallel-state={status}>
      <div className={cn(
        "flex max-w-[560px] items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]",
        status === "waiting" ? "border-accent/50 bg-accent/10" : "border-hairline/40 bg-panel",
      )}>
        {live && status !== "waiting"
          ? <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
          : <GitFork size={14} className={cn("shrink-0", status === "failed" ? "text-danger" : "text-ink-secondary")} aria-hidden="true" />}
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{t("chat.parallel.title", { title: ref.title })}</div>
          <div className="text-[11px] text-ink-secondary">
            {status === "waiting" && asked.length > 0 ? t("chat.parallel.state.waitingAnswer") : STATE_LABEL[status]()}
            {status !== "queued" && elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ""}
          </div>
        </div>
        {live && (
          <button
            type="button"
            data-parallel-stop={ref.threadId}
            onClick={() => dispatch({ type: "stopParallelTask", botId: owner.id, threadId: ref.threadId })}
            title={t("chat.parallel.stop")}
            aria-label={t("chat.parallel.stop")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Square size={12} className="fill-current" />
          </button>
        )}
        {showThreads && <button
          type="button"
          data-parallel-open={ref.threadId}
          onClick={() => openThread(dispatch, { botId: owner.id, threadId: ref.threadId }, state, showThreads)}
          title={status === "waiting" ? t("chat.parallel.openApproval") : t("chat.parallel.open")}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"
        >
          {status === "waiting" ? t("chat.parallel.openApproval") : t("chat.parallel.open")}
          <ChevronRight size={12} />
        </button>}
      </div>
      {questions.map((question) => (
        <div key={question.id} className="w-full max-w-[640px]" data-parallel-inline-question={ref.threadId}>
          <QuestionCard threadId={ref.threadId} bot={{ id: owner.id, name: owner.name }} message={question} />
        </div>
      ))}
    </div>
  );
}
