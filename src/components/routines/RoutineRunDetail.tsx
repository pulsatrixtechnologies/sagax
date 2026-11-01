// One routine run, the way a person reads it (2026-10-29): a state header
// (running, completed, failed, waiting for them), how long it took and what
// it cost; what waits on them first, answerable in place; then the result
// rendered as Markdown (tables included); then the steps, grouped and folded;
// and the actions to intervene: reply, stop, run again, continue in the
// conversation, open where it reported. The instructions it ran with and the
// routine's settings sit in Configuration. A run of a deleted routine keeps
// all of it, minus Run again.
//
// Wide (WIDE_PX and more): the state, the result and the actions at the
// left; Steps, the live Conversation and Configuration as tabs at the right.
// Narrow: one column, Steps and Configuration folded under the result.
// The steps and the conversation come from the run's activity entry
// (GET /api/bots/:id/activity/item?runId=, the same one History shows).
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarClock, ChevronDown, ChevronRight, CircleAlert, CirclePlay, FileText, History, Loader2, MessageSquareText, RotateCcw, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, type Bot, type Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { loadBotActivityDetail, type BotActivityDetail, type BotActivityStatus } from "@/lib/bot-activity";
import { routineAutoPausedText, routineDateTime, routineQueuePosition, routineRunError, routineRunLabel, routineRunTone } from "@/lib/routine-display";
import { formatUsd } from "@/lib/usage";
import { ChatMarkdown } from "../ChatMarkdown";
import { waitingSources } from "../bot-settings/ActivityDetailModal";
import { ActivityStepGroups } from "../task/ActivityStepGroups";
import { TaskComposer } from "../task/TaskComposer";
import { TaskStatusHeader } from "../task/TaskStatusHeader";
import { WaitingOnYou, waitingKind, type WaitingNote } from "../task/WaitingOnYou";
import { useWaitingCards, type WaitingItem } from "@/lib/use-waiting-cards";
import { activityChip } from "../bot-settings/ActivityWindow";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { RoutineConfiguration } from "./RoutineConfiguration";

const ActivityConversation = lazy(() => import("../bot-settings/ActivityConversation"));
const POLL_MS = 3_000;
/** From this width the run shows its result and its steps side by side. */
export const RUN_WIDE_PX = 720;

/** A run's status in the activity icon's words. */
export function runActivityStatus(run: Pick<RoutineRun, "status">): BotActivityStatus {
  switch (run.status) {
    case "queued": return "queued";
    case "running": return "running";
    case "waiting": return "waiting";
    case "failed": case "missed": return "failed";
    case "cancelled": return "stopped";
    default: return "finished";
  }
}

export type RunView = "result" | "steps" | "conversation" | "configuration";

/** The activity entry of a run (its steps, files, thread), followed while
 * it goes. `load` is the fetch; tests pass their own. */
const loadLive = (botId: string, itemId: string): Promise<BotActivityDetail> => loadBotActivityDetail(api, botId, itemId);

export function useRunActivity(run: Pick<RoutineRun, "id" | "botId" | "status" | "redacted">, load: (botId: string, itemId: string) => Promise<BotActivityDetail> = loadLive) {
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  const live = ["queued", "running", "waiting"].includes(run.status);
  const fetchDetail = useCallback(() => {
    if (run.redacted) return Promise.resolve();
    return load(run.botId, `run:${run.id}`).then((next) => { setDetail(next); setError(false); }).catch(() => setError(true));
  }, [load, run.botId, run.id, run.redacted]);
  useEffect(() => { setDetail(null); void fetchDetail(); }, [fetchDetail]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void fetchDetail(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, fetchDetail]);
  return { detail, error, reload: fetchDetail };
}

function Fold({ id, label, count, defaultOpen = false, children }: { id: string; label: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-run-fold={id} className="border-t border-hairline/40 pt-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={`run-fold-${id}`} className="flex w-full items-center gap-1.5 text-left text-[13px] font-medium text-ink hover:text-accent-text">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        {label}
        {count !== undefined && <span className="rounded-full bg-raised px-1.5 text-[10.5px] text-ink-secondary">{count}</span>}
      </button>
      {open && <div id={`run-fold-${id}`} className="mt-3">{children}</div>}
    </section>
  );
}

export function RoutineRunDetail({ run, runs, routine, bots, groups = [], viewerPrincipalId, now = Date.now(), wide = false, detail = null, detailError = false, waiting = [], onOpenThread, editable = true, canRunAgain = false, inFlight = false, working = false, canContinue = false, onReply, onStop, onRunAgain, onResume, onContinue, onOpenRoutine, onLogs, renderConversation, error }: {
  run: RoutineRun;
  /** Every run the viewer sees: a queued run shows its place in its bot's
   * queue (2026-11-01). */
  runs?: readonly RoutineRun[];
  /** Null: the routine was deleted since (the run stays, #1567). */
  routine: Routine | null;
  bots: Bot[];
  groups?: Group[];
  viewerPrincipalId?: string | null;
  now?: number;
  wide?: boolean;
  detail?: BotActivityDetail | null;
  detailError?: boolean;
  /** The open approvals and questions of the run's thread (useWaitingCards),
   * answered in place with the conversation's own cards. */
  waiting?: readonly WaitingItem[];
  onOpenThread?: (botId: string, threadId: string) => void;
  /** The viewer may stop this run (its routine's canEdit). */
  editable?: boolean;
  canRunAgain?: boolean;
  /** Another run of the routine is in flight: Run again waits. */
  inFlight?: boolean;
  working?: boolean;
  canContinue?: boolean;
  /** A message into the run (an answer while it waits, a nudge while it runs). */
  onReply?: (text: string) => Promise<void>;
  onStop?: () => void;
  onRunAgain?: () => void;
  /** 2026-10-26: this failure paused the routine; turn it back on. */
  onResume?: () => void;
  onContinue?: () => void;
  /** The routine's own page (absent for a deleted routine). */
  onOpenRoutine?: () => void;
  onLogs?: () => void;
  renderConversation?: (target: { botId: string; threadId: string; title: string }) => ReactNode;
  error?: string;
}) {
  const status = runActivityStatus(run);
  // 2026-11-01: completed, but not all of it went right.
  const problems = run.status === "completed" && run.problems?.trim() ? run.problems.trim() : "";
  const queue = runs ? routineQueuePosition(run, runs) : null;
  const queuePlace = queue && queue.count > 1 ? t("routineRun.queuePosition", { position: queue.position, count: queue.count }) : "";
  const live = ["queued", "running", "waiting"].includes(run.status);
  const bot = bots.find((candidate) => candidate.id === run.botId);
  const isRoomGoal = run.target === "room-goal";
  const group = groups.find((candidate) => candidate.id === run.groupId);
  const cost = run.cost != null && run.cost > 0 ? formatUsd(run.cost) : null;
  const threadId = detail?.threadId ?? run.threadId ?? run.executionThreadId;
  const steps = detail?.steps ?? [];
  const hasConversation = Boolean(threadId && renderConversation && !run.redacted);
  const views: RunView[] = wide ? ["steps", ...(hasConversation ? ["conversation" as const] : []), "configuration"] : [];
  // The waiting card sits at the left, answerable there: the steps open
  // first, the conversation one tab away.
  const [chosen, setChosen] = useState<RunView>("steps");
  const view = views.includes(chosen) ? chosen : views[0];
  const quiet = run.status === "completed" && run.quiet;
  const reported = Boolean(run.output?.trim()) && !run.redacted;
  const errorText = routineRunError(run.error);
  const canReply = Boolean(onReply && live && threadId && editable && !run.redacted);

  // What waits on the person: the thread's own cards when they could be
  // read, else what the run says it waits on (its attention line).
  const waitingItems: readonly (WaitingItem | WaitingNote)[] = run.status !== "waiting" || run.redacted ? []
    : waiting.length > 0 ? waiting
    : [{ kind: "note", text: run.attention || t("routineCalendar.runWaiting"), botId: run.botId, ...(threadId && onOpenThread ? { threadId } : {}) }];
  const stopButton = live && editable && onStop
    ? <button type="button" data-run-stop onClick={onStop} disabled={working} title={t("routineRun.stop")} className={cn(PILL, "gap-1.5 text-danger")}>{working ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Square size={12} aria-hidden="true" fill="currentColor" />}{t("routineRun.stop")}</button>
    : null;

  // The head is the task sheet's own (TaskStatusHeader): the bot's pill,
  // the routine's name, the state in words with its time. Under it, what
  // only a run has: when it was due, what started it, its cost, and that
  // its routine is gone.
  const header = (
    <div data-run-state={run.status} className="flex flex-col gap-1.5">
      <TaskStatusHeader
        title={run.routineName}
        titleId={`run-title-${run.id}`}
        bot={bot}
        botName={bot ? undefined : routine?.bot?.name ?? t("routines.unavailableBot")}
        status={status}
        startedAt={run.startedAt ?? run.scheduledFor}
        endedAt={run.finishedAt}
        now={now}
        waitingFor={waitingKind(waitingItems)}
        actions={stopButton}
        // The dialog's own head already names the routine.
        className="px-0 pb-0 pr-0 pt-0 [&_h2]:sr-only"
      />
      <div data-run-meta className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-secondary">
        {(run.quiet || run.goalStatus || run.retried || run.status === "missed" || problems) && <><span data-run-state-label className={cn("font-medium", routineRunTone(run))}>{routineRunLabel(run)}</span><span aria-hidden="true">·</span></>}
        <time dateTime={new Date(run.scheduledFor).toISOString()}>{routineDateTime(run.scheduledFor)}</time>
        <span aria-hidden="true">·</span>
        <span>{t(`routines.trigger.${run.triggerSource ?? (run.manual ? "manual" : "schedule")}`)}</span>
        {cost && <><span aria-hidden="true">·</span><span data-run-cost title={t("routineRun.cost")}>{cost}</span></>}
        {isRoomGoal && group && <><span aria-hidden="true">·</span><span>{t("routineCalendar.teamGoalIn", { name: group.name })}</span></>}
        {!routine && <span data-deleted-routine className="rounded-full bg-raised px-2 py-0.5 text-[11.5px] text-ink-secondary" title={t("routineRun.deletedHelp")}>{t("routineCalendar.deletedRoutine")}</span>}
      </div>
    </div>
  );

  const attention = (
    <>
      {waitingItems.length > 0 && <div data-run-waiting><WaitingOnYou items={waitingItems} threadId={threadId ?? ""} botFor={(id) => bots.find((candidate) => candidate.id === id)} onCancel={() => onStop?.()} onOpenThread={onOpenThread} /></div>}
      {run.status === "queued" && (run.attention || queuePlace) && <div data-run-deferred className="rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-[12.5px] text-accent-text"><span className="font-medium">{t("routineRun.deferred")}</span>{run.attention && <> · {run.attention}</>}{queuePlace && <> · <span data-run-queue-position>{queuePlace}</span></>}</div>}
      {problems && <div data-run-problems role="status" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning"><CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 whitespace-pre-wrap"><span className="font-medium">{t("routines.status.completedWithProblems")}</span>{"\n"}{problems}</span></div>}
      {run.status !== "waiting" && errorText && <div data-run-error role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger"><CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 whitespace-pre-wrap">{errorText}</span></div>}
      {run.autoPaused && <div data-run-auto-paused className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] text-warning"><span className="font-medium">{routineAutoPausedText(run.autoPaused.failures)}</span>{onResume && <button type="button" data-routine-resume onClick={onResume} disabled={working} className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 font-medium hover:bg-warning/25 disabled:opacity-50"><CirclePlay size={11} aria-hidden="true" />{t("routines.autoPause.resume")}</button>}</div>}
      {detail?.note && run.status !== "waiting" && !errorText && <p className="rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-ink">{detail.note}</p>}
      {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] text-danger">{error}</div>}
    </>
  );

  // A failed, missed, cancelled or waiting run without a report: the state
  // card already says it, no empty result card under it.
  const showResult = reported || quiet || run.redacted || !["failed", "missed", "cancelled", "waiting"].includes(run.status);
  const result = showResult && (
    <section data-run-result aria-label={t("routineRun.result")} className="rounded-xl border border-hairline/40 bg-card px-4 py-3">
      {run.redacted ? <p className="text-[12.5px] text-ink-secondary">{t("routines.scope.redacted")}</p>
        : reported ? <div className="chat-markdown max-w-[72ch] text-[13.5px] leading-relaxed text-ink"><ChatMarkdown text={run.output!} inert /></div>
        : quiet ? <p className="text-[12.5px] text-ink-secondary">{t("routineRun.quiet")}</p>
        : run.status === "running" || run.status === "queued" ? <p className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />{t(run.status === "running" ? "routineRun.resultPending" : "routineRun.resultQueued")}</p>
        : <p className="text-[12.5px] text-ink-secondary">{t("routines.noOutput")}</p>}
    </section>
  );

  const stepsBlock = run.redacted ? <p className="text-[12.5px] text-ink-secondary">{t("routines.scope.redacted")}</p>
    : detail === null ? (detailError ? <p className="text-[12.5px] text-ink-secondary">{t("routineRun.stepsUnavailable")}</p> : <p className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("routineRun.stepsLoading")}</p>)
    : steps.length === 0 ? <p className="text-[12.5px] text-ink-secondary">{detail.threadId ? t("botPanel.activity.stepsEmpty") : t("routineRun.stepsUnavailable")}</p>
    : <>
        <ActivityStepGroups steps={steps} truncated={detail.stepsTruncated} />
        {detail.files.length > 0 && <ul className="mt-3 flex flex-col gap-1" aria-label={t("botPanel.activity.files")}>{detail.files.map((file) => <li key={file} className="flex min-w-0 items-center gap-2 text-[12px] text-ink"><FileText size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" /><span className="min-w-0 truncate font-mono" title={file}>{file}</span></li>)}</ul>}
      </>;

  const configuration = <RoutineConfiguration routine={routine} run={run} bots={bots} groups={groups} viewerPrincipalId={viewerPrincipalId} compact={!wide} />;

  // A message into the run: an answer while it waits, a nudge while it
  // works. The task sheet's composer, at the bottom where a composer sits.
  const composer = canReply ? <div className="shrink-0 px-4 pb-1 pt-2"><TaskComposer key={run.id} onSend={onReply!} /></div> : null;
  const footer = (
    <div data-run-actions className="flex flex-wrap items-center gap-2 border-t border-hairline/40 px-4 py-3">
      {!live && canRunAgain && onRunAgain && <button type="button" data-run-again onClick={onRunAgain} disabled={working || inFlight} title={inFlight ? t("routines.runNow.inFlight") : t("routineRun.runAgain")} className={cn(PRIMARY_PILL, "gap-1.5")}>{working ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}{t("routineRun.runAgain")}</button>}
      {canContinue && onContinue && <button type="button" data-run-continue onClick={onContinue} title={isRoomGoal ? t("routineCalendar.openGroupThread") : t("routineRun.continue")} className={cn(PILL, "gap-1.5")}><MessageSquareText size={13} aria-hidden="true" />{isRoomGoal ? t("routineCalendar.openGroupThread") : t("routineRun.continue")}</button>}
      <div className="ml-auto flex items-center gap-1">
        {routine && onOpenRoutine && <button type="button" data-run-open-routine onClick={onOpenRoutine} title={t("routineRun.openRoutine")} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><CalendarClock size={13} aria-hidden="true" />{t("routineRun.openRoutine")}</button>}
        {onLogs && <button type="button" data-run-logs onClick={onLogs} title={t("routines.logs")} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><History size={13} aria-hidden="true" />{t("routines.logs")}</button>}
      </div>
    </div>
  );

  if (wide) {
    return (
      <div data-routine-run-detail="columns" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,5fr)_minmax(0,6fr)] overflow-hidden">
          <div data-run-main className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-hairline/40 px-5 py-4">
            {header}
            {attention}
            {result}
          </div>
          <div data-run-side className="flex min-h-0 min-w-0 flex-col">
            <div role="tablist" aria-label={t("activity.view.aria")} className="flex shrink-0 gap-1 px-5 pb-2 pt-4">
              {views.map((id) => (
                <button key={id} type="button" role="tab" id={`run-view-${id}`} aria-selected={view === id} aria-controls="run-view-panel" data-run-view={id} onClick={() => setChosen(id)} className={activityChip(view === id)}>
                  {id === "conversation" && live && <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />}
                  {id === "steps" ? t("botPanel.activity.steps") : id === "conversation" ? t("activity.view.conversation") : t("routineRun.configuration")}
                  {id === "steps" && steps.length > 0 && <span className="rounded-full bg-raised px-1.5 text-[10.5px] text-ink-secondary">{steps.length}</span>}
                </button>
              ))}
            </div>
            {view === "conversation" && threadId && renderConversation ? (
              <div id="run-view-panel" role="tabpanel" aria-labelledby="run-view-conversation" className="flex min-h-0 flex-1 flex-col border-t border-hairline/40">
                <Suspense fallback={<div role="status" className="flex flex-1 items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></div>}>
                  {renderConversation({ botId: run.botId, threadId, title: run.routineName })}
                </Suspense>
              </div>
            ) : (
              <div id="run-view-panel" role="tabpanel" aria-labelledby={`run-view-${view}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2">
                {view === "configuration" ? configuration : stepsBlock}
              </div>
            )}
          </div>
        </div>
        {composer}
        {footer}
      </div>
    );
  }
  return (
    <div data-routine-run-detail="single" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {header}
        {attention}
        {result}
        <Fold id="steps" label={t("botPanel.activity.steps")} count={steps.length || undefined} defaultOpen={run.status === "failed" || run.status === "running"}>{stepsBlock}</Fold>
        <Fold id="configuration" label={t("routineRun.configuration")}>{configuration}</Fold>
      </div>
      {composer}
      {footer}
    </div>
  );
}

/** Steps and conversation wired to the live server: the run detail as the
 * Automations page and the bot panel open it. */
export function ConnectedRunActivity({ run, children }: { run: RoutineRun; children: (activity: { detail: BotActivityDetail | null; error: boolean; reload: () => Promise<void>; waiting: WaitingItem[]; conversation: (target: { botId: string; threadId: string; title: string }, onOpenInMain: () => void) => ReactNode }) => ReactNode }) {
  const activity = useRunActivity(run);
  // Read the waiting thread's cards again on each poll of the activity.
  const waiting = useWaitingCards(run.status === "waiting" ? waitingSources(activity.detail) : [], `${activity.detail?.updatedAt ?? ""}:${run.status}`);
  const conversation = (target: { botId: string; threadId: string; title: string }, onOpenInMain: () => void) => (
    <ActivityConversation key={target.threadId} {...target} onOpenInMain={onOpenInMain} />
  );
  return <>{children({ ...activity, waiting, conversation })}</>;
}
