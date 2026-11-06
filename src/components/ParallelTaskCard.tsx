// A parallel task's live card in the conversation it answers
// (shared/parallel-tasks.ts): its name, where it stands (from the task's own
// live state: running, waiting for the person's approval, waiting for a
// slot, done, failed, stopped), how long it has run, Stop while it is not
// done and Open to read or steer it in its own thread (threads hidden: in
// the side column, the conversation stays on screen). Its approvals live in
// that thread; the card says when one waits so the person knows which task
// asks.
import { useEffect, useState } from "react";
import { ChevronRight, GitFork, Loader2, Square } from "lucide-react";

import { liveParallelState, type ParallelTaskState } from "../../shared/parallel-tasks";
import { api, openThread, useStore, type Message } from "@/state/store";
import { pendingQuestions } from "@/lib/pending-question";
import { QuestionCard } from "./QuestionCard";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { cn } from "@/lib/cn";
import { formatElapsed } from "@/lib/working-time";

type CardState = ParallelTaskState | "waiting";

const STATE_LABEL: Record<CardState, () => string> = {
  queued: () => t("chat.parallel.state.queued"),
  running: () => t("chat.parallel.state.running"),
  waiting: () => t("chat.parallel.state.waiting"),
  done: () => t("chat.parallel.state.done"),
  failed: () => t("chat.parallel.state.failed"),
  stopped: () => t("chat.parallel.state.stopped"),
};

export function parallelCardState(message: Message, task: { busy?: boolean; activity?: string } | undefined): CardState {
  const ref = message.parallelTask;
  return liveParallelState(ref?.state, task, ref?.state === "queued");
}

/** #2082 (JC, 2026-11-05): in the one conversation (threads off) a parallel
 * task's question lives inline in the bot's chat, under its card, answered
 * right there: no "Open" button, never a side thread. */
function useInlineQuestions(threadId: string | undefined, enabled: boolean, version: unknown): Message[] {
  const [found, setFound] = useState<{ key: string; questions: Message[] }>({ key: "", questions: [] });
  const key = enabled && threadId ? `${threadId}:${String(version)}` : "";
  useEffect(() => {
    if (!key || !threadId) return;
    let live = true;
    void (async () => {
      try {
        const page = await api(`/api/threads/${threadId}/messages?limit=60`) as { messages?: Message[] };
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
  const questions = showThreads ? [] : asked;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!ref || !owner) return null;
  const started = task?.turnStartedAt ?? ref.startedAt ?? message.at;
  const elapsed = live ? now - started : (ref.endedAt ?? now) - started;
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

/** The line above a parallel task's answer: which task it comes from. */
export function ParallelResultLabel({ message }: { message: Message }) {
  const ref = message.parallelTask;
  if (!ref || ref.role !== "result") return null;
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-0.5 text-[11px] text-ink-secondary" data-parallel-result={ref.threadId}>
      <GitFork size={11} aria-hidden="true" />
      <span>{t("chat.parallel.result", { title: ref.title })}</span>
    </div>
  );
}
