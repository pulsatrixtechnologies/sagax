import { waitingSources } from "./../../lib/activity-waiting-sources.ts";
export { waitingSources } from "./../../lib/activity-waiting-sources.ts";
// One task in full (2026-10-29, the sheet redone): a sub-agent, a parallel
// task, a run or a coding session, at Settings' size (ActivityWindow).
//
// From the top: the head (TaskStatusHeader: the bot's pill, the title, the
// state in plain words with the step in flight and the time, Stop and Open
// conversation at the right); then, when the task or one of its sub-agents
// waits on the person, what it waits for with its answers (WaitingOnYou:
// the conversation's own approval and question cards); then the body. Wide
// (WIDE_PX): the summary at the left (a failed run's note, its access card,
// the sub-agents with the waiting one first, the facts folded under
// Details, and the composer at the bottom) and the Steps (grouped,
// ActivityStepGroups) or the live Conversation at the right. Narrow: one
// column with a Summary view, the composer under it.
//
// The server decides what this person may read (server/routes/bot-activity.ts):
// a routine run seen without its thread comes with no steps and no thread.
// A sub-agent opens in place, so its own sheet is one click away.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Square } from "lucide-react";

import { api, openBotThread, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import {
  activityStatusActive,
  activityTitle,
  activityViaLabel,
  formatActivityDuration,
  loadBotActivityDetail,
  type BotActivityDetail,
  type BotActivityItem,
} from "@/lib/bot-activity";
import { currentTaskStep } from "@/lib/activity-step-groups";
import { useWaitingCards, type WaitingItem } from "@/lib/use-waiting-cards";
import { AccessCard, type AccessViewer } from "../AccessCard";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";
import { activityChip, useElementWidth } from "./ActivityWindow";
import { PanelPage } from "./PanelPage";
import { activityJobStage, TaskStatusHeader } from "../task/TaskStatusHeader";
import { WaitingOnYou, waitingKind, type WaitingNote } from "../task/WaitingOnYou";
import { StepBoundary, stepFallbackText } from "../MessageBoundary";
import { ActivityStepGroups } from "../task/ActivityStepGroups";
import { SubagentList } from "../task/SubagentList";
import { TaskComposer } from "../task/TaskComposer";
import { TaskFacts, taskFacts } from "../task/TaskFacts";

const POLL_MS = 3_000;
/** From this width a task shows its summary and its steps side by side. */
export const WIDE_PX = 720;

// The chat view is large: it loads when a conversation is first shown.
const ActivityConversation = lazy(() => import("./ActivityConversation"));

export type ActivityView = "summary" | "steps" | "conversation";
export type ConversationTarget = { botId: string; threadId: string; title: string };

/** The views a task offers: Summary only in one column (two columns show
 * it at the left), Conversation only with a thread and a way to draw it. */
export function activityViews(wide: boolean, steps: boolean, conversation: boolean): ActivityView[] {
  const views: ActivityView[] = [];
  if (!wide && (steps || conversation)) views.push("summary");
  if (steps) views.push("steps");
  if (conversation) views.push("conversation");
  return views;
}

const VIEW_KEYS = {
  summary: "activity.view.summary",
  steps: "botPanel.activity.steps",
  conversation: "activity.view.conversation",
} as const;



const NO_BOT = () => undefined;

/** The body, without fetching: tests and galleries render it with a fixed detail. */
export function ActivityDetailBody({ item, detail, error, now, engineName, onStop, onOpenThread, onOpenChild, onSteer, stopping = false, viewer, onSignIn, wide = true, renderConversation, onBack, backLabel, initialView, bot, botFor = NO_BOT, waiting = [], factsOpen = false }: {
  item: BotActivityItem;
  /** Who reads the access card of a refused run (the server already sent
   * it to its audience only). */
  viewer?: AccessViewer;
  onSignIn?: () => void;
  detail: BotActivityDetail | null;
  error: boolean;
  now: number;
  engineName?: (instanceId: string) => string | undefined;
  onStop: () => void;
  onOpenThread: (botId: string, threadId: string) => void;
  onOpenChild: (child: BotActivityItem) => void;
  /** Send a message into this running task (it joins the work in progress). */
  onSteer?: (text: string) => Promise<void>;
  stopping?: boolean;
  /** Two columns (summary | steps) rather than one with a Summary view. */
  wide?: boolean;
  /** The task's live thread; without it there is no Conversation view. */
  renderConversation?: (target: ConversationTarget) => React.ReactNode;
  /** Back to the list (History's narrow window) or, after a dive, to the
   * parent task: `backLabel` names where. */
  onBack?: () => void;
  backLabel?: string;
  initialView?: ActivityView;
  /** The bot the work runs on, for the head's pill. */
  bot?: Bot;
  /** The bots of the sub-agents and of the cards, by id. */
  botFor?: (botId: string) => Bot | undefined;
  /** What the task waits on from the person (useWaitingCards). */
  waiting?: readonly WaitingItem[];
  /** The facts fold open at first (tests). */
  factsOpen?: boolean;
}) {
  const shown = detail ?? item;
  const running = activityStatusActive(shown.status);
  const duration = (shown.endedAt ?? now) - shown.startedAt;
  const hasSteps = Boolean(detail && (detail.threadId || detail.steps.length > 0));
  const threadId = detail?.threadId;
  const views = activityViews(wide, hasSteps, Boolean(threadId && renderConversation));
  const [chosen, setChosen] = useState<ActivityView>(initialView ?? "summary");
  // The chosen view when this layout has it; else the first one (two
  // columns never show "Summary" on the right).
  const view: ActivityView | undefined = views.includes(chosen) ? chosen : chosen === "summary" ? views[0] : views.includes("steps") ? "steps" : views[0];
  const split = wide && views.length > 0;

  // What waits: the cards read off the threads, else what the server says
  // a waiting run asks (a routine's own question, read in its conversation).
  const waitingItems: (WaitingItem | WaitingNote)[] = useMemo(() => {
    if (waiting.length > 0) return [...waiting];
    if (shown.status !== "waiting") return [];
    const text = detail?.note ?? shown.currentStep;
    const askingChild = detail?.children.find((child) => child.status === "waiting");
    if (text) return [{ kind: "note", text, botId: shown.botId, ...(threadId ? { threadId } : {}) }];
    if (askingChild) return [{ kind: "note", text: askingChild.currentStep ?? t("botPanel.coding.status.waiting"), botId: askingChild.botId, from: askingChild.title, ...(askingChild.threadId ? { threadId: askingChild.threadId } : {}) }];
    return [];
  }, [waiting, shown.status, shown.currentStep, shown.botId, detail?.note, detail?.children, threadId]);
  const current = detail ? currentTaskStep(detail.steps) : null;

  const actions = (running && detail?.canStop) || shown.threadId ? (
    <>
      {running && detail?.canStop && (
        <button type="button" data-activity-stop onClick={onStop} disabled={stopping} title={t("botPanel.activity.stop")} className={cn(PILL, "gap-1.5 text-danger")}>
          {stopping ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Square size={12} aria-hidden="true" fill="currentColor" />}
          <span className="max-sm:sr-only">{t("botPanel.activity.stop")}</span>
        </button>
      )}
      {shown.threadId && (
        <button type="button" data-activity-open-thread onClick={() => onOpenThread(shown.botId, shown.threadId!)} className={cn(PRIMARY_PILL, "gap-1.5")}>
          <ExternalLink size={13} aria-hidden="true" />
          {t("botPanel.activity.openThread")}
        </button>
      )}
    </>
  ) : undefined;

  const waitingFor = waitingKind(waitingItems);
  const header = (
    <TaskStatusHeader
      title={activityTitle(shown)}
      bot={bot ? { ...bot, name: bot.name } : undefined}
      botName={shown.botName}
      status={shown.status}
      startedAt={shown.startedAt}
      endedAt={shown.endedAt}
      now={now}
      step={current?.step}
      stepLabel={current?.label ?? shown.currentStep}
      waitingFor={waitingFor}
      stage={activityJobStage(shown.status, waitingFor)}
      parallel={shown.parallel}
      handedBy={shown.kind === "hop" ? shown.startedBy?.name : undefined}
      actions={actions}
      onBack={onBack}
      backLabel={backLabel}
    />
  );

  // At the head, before anything else; never more than half the sheet, so
  // the sub-agents and the steps stay in reach (it scrolls on its own).
  const waitingBlock = waitingItems.length > 0 ? (
    <div className="max-h-[50%] shrink-0 overflow-y-auto overscroll-contain px-5 pb-3">
      <WaitingOnYou items={waitingItems} threadId={threadId ?? shown.threadId ?? ""} botFor={botFor} onCancel={onStop} onOpenThread={onOpenThread} />
    </div>
  ) : null;

  const facts = taskFacts({
    startedAt: shown.startedAt,
    endedAt: shown.endedAt,
    duration: formatActivityDuration(duration),
    startedBy: shown.startedBy?.name ? (shown.startedBy.kind === "routine" ? t("botPanel.activity.byRoutine", { name: shown.startedBy.name }) : shown.startedBy.name) : undefined,
    botName: shown.botName && shown.kind === "subagent" ? shown.botName : undefined,
    engine: detail?.engine ? [engineLabel(engineName?.(detail.engine.instanceId), detail.engine.instanceId), detail.engine.model].filter(Boolean).join(" · ") : undefined,
    via: detail?.via ? activityViaLabel(detail.via) : undefined,
    conversation: shown.threadTitle,
  });

  const summary = (
    <div className="flex flex-col gap-4">
      {detail === null && error && <p role="alert" className="text-[12.5px] text-danger">{t("botPanel.activity.error")}</p>}
      {detail?.note && shown.status !== "waiting" && (
        <p data-activity-note className={cn("rounded-lg px-3 py-2 text-[12.5px] leading-[18px] text-ink", shown.status === "failed" ? "bg-danger/10" : "bg-warning/10")}>{detail.note}</p>
      )}
      {detail?.access && (
        <div data-activity-access>
          <AccessCard access={detail.access} viewer={viewer ?? { principalId: null, admin: false }} onSignIn={onSignIn} />
        </div>
      )}
      {detail && !detail.threadId && detail.kind === "routine" && (
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.activity.privateRun")}</p>
      )}
      {detail && detail.children.length > 0 && (
        <SubagentList items={detail.children} now={now} botFor={botFor} onOpen={onOpenChild} />
      )}
      <TaskFacts facts={facts} files={detail?.files ?? []} defaultOpen={factsOpen} />
    </div>
  );

  const composer = running && detail?.canStop && detail.threadId && onSteer
    ? <div className="shrink-0 px-5 pb-4 pt-2"><TaskComposer key={detail.id} onSend={onSteer} /></div>
    : null;

  const steps = detail && (
    detail.steps.length === 0
      ? <p className="text-[12.5px] text-ink-secondary">{t("botPanel.activity.stepsEmpty")}</p>
      : (
        <StepBoundary stepId={detail.id} fallbackText={stepFallbackText(detail.steps[0])}>
          <ActivityStepGroups steps={detail.steps} truncated={detail.stepsTruncated} />
        </StepBoundary>
      )
  );

  const tabs = views.length > 1 || (split && views.length > 0) ? (
    <div role="tablist" aria-label={t("activity.view.aria")} className={cn("flex shrink-0 gap-1", split ? "px-5 pb-2 pt-1" : "px-5 pb-1 pt-1")}>
      {views.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`activity-view-${id}`}
          aria-selected={view === id}
          aria-controls="activity-view-panel"
          data-activity-view={id}
          onClick={() => setChosen(id)}
          className={activityChip(view === id)}
        >
          {id === "conversation" && running && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />}
          {t(VIEW_KEYS[id])}
        </button>
      ))}
    </div>
  ) : null;

  // The right column (or the one column's view other than Summary).
  const panel = view === "conversation" && threadId && renderConversation ? (
    <div id="activity-view-panel" role="tabpanel" aria-labelledby="activity-view-conversation" className="flex min-h-0 flex-1 flex-col border-t border-hairline-weak">
      {renderConversation({ botId: shown.botId, threadId, title: shown.threadTitle ?? shown.title })}
    </div>
  ) : view === "steps" ? (
    <div id="activity-view-panel" role="tabpanel" aria-labelledby="activity-view-steps" data-activity-steps-panel className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-1">
      {steps}
    </div>
  ) : null;

  if (split) {
    return (
      <div data-activity-layout="columns" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        {waitingBlock}
        <div className="flex min-h-0 min-w-0 flex-1 border-t border-hairline-weak">
          <div data-activity-summary className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-hairline-weak">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4">{summary}</div>
            {composer}
          </div>
          <div data-activity-detail-right className="flex min-h-0 min-w-0 flex-1 flex-col pt-2">
            {tabs}
            {panel}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-activity-layout="single" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      {waitingBlock}
      {tabs}
      {view === undefined || view === "summary" ? (
        <div data-activity-summary id={views.length ? "activity-view-panel" : undefined} role={views.length ? "tabpanel" : undefined} aria-labelledby={views.length ? "activity-view-summary" : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
          {summary}
        </div>
      ) : panel}
      {view !== "conversation" && composer}
    </div>
  );
}

/** One task, fetched and followed while it runs, with its actions: the
 * detail window's content and History's right pane. */
export function ActivityDetailPane({ item, wide, onClose, onChanged, onBack }: {
  item: BotActivityItem;
  wide: boolean;
  onClose: () => void;
  onChanged: () => void;
  onBack?: () => void;
}) {
  const { state, dispatch } = useStore();
  // A sub-agent opens in place; Back returns to the task that started it.
  const [current, setCurrent] = useState(item);
  const [parents, setParents] = useState<BotActivityItem[]>([]);
  const parent = parents.at(-1);
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    return loadBotActivityDetail(api, current.botId, current.id)
      .then((next) => { setDetail(next); setError(false); })
      .catch(() => setError(true));
  }, [current.botId, current.id]);

  useEffect(() => { setDetail(null); void load(); }, [load]);
  const running = activityStatusActive((detail ?? current).status);
  useEffect(() => {
    if (!running) return;
    // Live: the steps and status follow the run while it goes.
    const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  // What waits on the person, read again at each poll while it waits.
  const sources = useMemo(() => waitingSources(detail), [detail]);
  const waiting = useWaitingCards(sources, now);

  const stop = () => {
    setStopping(true);
    const finish = () => { setStopping(false); void load(); onChanged(); };
    if (current.id.startsWith("cloud:")) {
      const cloudId = current.id.slice("cloud:".length);
      void api(`/api/bots/${encodeURIComponent(current.botId)}/cloud-agents/${encodeURIComponent(cloudId)}/cancel`, { method: "POST" })
        .catch(() => setStopping(false))
        .finally(finish);
      return;
    }
    if (!detail?.threadId) {
      setStopping(false);
      return;
    }
    // a parallel task stops on its own: its conversation gets the outcome
    if (detail.parallel) dispatch({ type: "stopParallelTask", botId: detail.botId, threadId: detail.threadId });
    else dispatch({ type: "interrupt", botId: detail.botId, threadId: detail.threadId, onError: () => setStopping(false) });
    window.setTimeout(finish, 1_500);
  };
  const showThreads = useShowThreads();
  const openThread = (threadBotId: string, threadId: string) => {
    const target = state.bots.find((candidate) => candidate.id === threadBotId);
    // the one-conversation gate (openBotThread): an earlier topic scrolls
    // the conversation back, a job or a run opens beside it
    if (target) openBotThread(dispatch, target, threadId, showThreads);
    else dispatch({ type: "select", id: threadBotId });
    onClose();
  };
  const engineName = (instanceId: string) => state.instances.find((instance) => instance.instanceId === instanceId)?.displayName;
  const botFor = (botId: string) => state.bots.find((candidate) => candidate.id === botId);

  return (
    <ActivityDetailBody
      item={current}
      detail={detail}
      error={error}
      now={now}
      engineName={engineName}
      bot={botFor(current.botId)}
      botFor={botFor}
      waiting={waiting}
      onStop={stop}
      onOpenThread={openThread}
      // Diving into a sub-agent keeps the view: its conversation, if that
      // was the one on screen.
      onOpenChild={(child) => {
        if (!child.threadId) return;
        setParents((list) => [...list, current]);
        setCurrent(child);
      }}
      onSteer={async (text) => {
        if (!detail?.threadId) return;
        await api(`/api/bots/${detail.botId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text, threadId: detail.threadId, busyMode: "steer", sendId: crypto.randomUUID() }),
        });
        void load();
      }}
      stopping={stopping}
      viewer={{ principalId: state.config?.viewer?.principalId ?? null, admin: state.config?.viewer?.role === "admin" || state.config?.viewer?.role === "owner" }}
      onSignIn={() => { onClose(); dispatch({ type: "toggleAppSettings", open: true, section: "providers" }); }}
      wide={wide}
      onBack={parent ? () => { setParents((list) => list.slice(0, -1)); setCurrent(parent); } : onBack}
      backLabel={parent ? t("activity.backTo", { title: parent.title }) : undefined}
      renderConversation={(target) => (
        <Suspense fallback={<div role="status" className="flex flex-1 items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></div>}>
          <ActivityConversation key={target.threadId} {...target} onOpenInMain={() => openThread(target.botId, target.threadId)} />
        </Suspense>
      )}
    />
  );
}

export function ActivityDetailModal({ item, onClose, onChanged }: {
  item: BotActivityItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { dispatch } = useStore();
  const [frameRef, width] = useElementWidth<HTMLDivElement>(380);
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };
  return (
    <PanelPage
      name={item.title || t("botPanel.history.title")}
      onBack={onClose}
      onClose={closePanel}
      data-activity-detail={item.id}
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      <div ref={frameRef} className="flex min-h-0 flex-1 flex-col">
        <ActivityDetailPane item={item} wide={width >= WIDE_PX} onClose={onClose} onChanged={onChanged} />
      </div>
    </PanelPage>
  );
}
