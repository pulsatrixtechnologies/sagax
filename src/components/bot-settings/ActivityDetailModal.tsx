// One Coding entry in full: status, times and duration, who started it, the
// engine and model and whose credentials paid (organization server), the
// tool steps with where each ran (your computer or the server environment),
// files touched and the sub-agents it started, with Stop and Open thread.
// A failed routine run refused for lack of credentials carries its access
// card (audience only), with the same actions as in the thread.
// The server decides what this person may read (server/routes/bot-activity.ts):
// a routine run seen without its thread comes with no steps and no thread.
//
// The window is Settings' own size (ActivityWindow, JC 2026-10-16), in two
// columns when it is wide enough (WIDE_PX): at the left the summary (status,
// the facts card, a message into the run, the sub-agents, the files, Stop and
// Open thread), at the right the Steps and, while it has a thread, its live
// Conversation (ActivityConversation, the real thread in the chat view). A
// narrow window (or History's detail pane) has one column and a third view,
// Summary. A sub-agent opens in place, so its own live conversation is one
// click away from its parent's window.
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ExternalLink, FileText, Loader2, Send, Square } from "lucide-react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import {
  activityStatusActive,
  activityStatusLabel,
  activityViaLabel,
  formatActivityDuration,
  loadBotActivityDetail,
  type BotActivityDetail,
  type BotActivityItem,
} from "@/lib/bot-activity";
import { ActivityCard, ActivityStatusIcon } from "./ActivityCard";
import { ActivitySteps } from "./ActivitySteps";
import { AccessCard, type AccessViewer } from "../AccessCard";
import { DIALOG, GROUP_CARD, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";
import { ActivityWindow, activityChip, useElementWidth } from "./ActivityWindow";

const POLL_MS = 3_000;
/** From this width a task shows its summary and its steps side by side. */
export const WIDE_PX = 720;

// The chat view is large: it loads when a conversation is first shown.
const ActivityConversation = lazy(() => import("./ActivityConversation"));

export type ActivityView = "summary" | "steps" | "conversation";
export type ConversationTarget = { botId: string; threadId: string; title: string };

function formatTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[36px] min-w-0 items-center justify-between gap-3 px-3.5 py-1.5">
      <dt className="shrink-0 text-[13px] text-ink">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] text-ink-secondary">{children}</dd>
    </div>
  );
}

/** The body, without fetching: tests render it with a fixed detail. */
/** A message into a running task: it joins the work in progress. */
function SteerBox({ onSteer }: { onSteer: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const submit = async () => {
    const words = text.trim();
    if (!words || state === "sending") return;
    setState("sending");
    try {
      await onSteer(words);
      setText("");
      setState("sent");
    } catch {
      setState("error");
    }
  };
  return (
    <section className="mt-4" data-activity-steer="">
      <label htmlFor="activity-steer" className="mb-2 block px-1 text-[13px] text-ink-secondary">{t("activity.steer.label")}</label>
      <div className="flex items-center gap-2">
        <input
          id="activity-steer"
          value={text}
          onChange={(event) => { setText(event.target.value); if (state !== "sending") setState("idle"); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
          placeholder={t("activity.steer.placeholder")}
          className="min-w-0 flex-1 rounded-lg border-[0.5px] border-border bg-inset px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-focus focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!text.trim() || state === "sending"}
          className={cn(PRIMARY_PILL, "shrink-0 gap-1")}
        >
          {state === "sending" ? <Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Send size={12} aria-hidden="true" />}
          {t("activity.steer.send")}
        </button>
      </div>
      {state === "sent" && <p role="status" className="mt-1 text-[11.5px] text-ink-secondary">{t("activity.steer.sent")}</p>}
      {state === "error" && <p role="alert" className="mt-1 text-[11.5px] text-danger">{t("botPanel.activity.error")}</p>}
    </section>
  );
}

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

export function ActivityDetailBody({ item, detail, error, now, engineName, onStop, onOpenThread, onOpenChild, onSteer, stopping = false, viewer, onSignIn, wide = true, renderConversation, onBack, backLabel, initialView }: {
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

  const header = (
    <div className={cn(DIALOG.header, "flex items-start gap-3", !split && "pr-12")}>
      {onBack && (
        <button type="button" data-activity-back onClick={onBack} aria-label={backLabel ?? t("activity.back")} title={backLabel ?? t("activity.back")} className="-ml-1.5 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      )}
      <span className="mt-1"><ActivityStatusIcon status={shown.status} size={18} /></span>
      <div className="min-w-0 flex-1">
        <h2 id="activity-detail-title" className={cn(DIALOG.title, "break-words")}>{shown.title}</h2>
        <p data-activity-detail-status className={DIALOG.subtitle}>
          {shown.parallel ? `${t("botPanel.activity.parallel")} · ` : ""}{activityStatusLabel(shown.status)}
        </p>
      </div>
    </div>
  );

  const summary = (
    <>
      {detail === null && error && <p role="alert" className="py-2 text-[12.5px] text-danger">{t("botPanel.activity.error")}</p>}
      {detail?.note && <p className="mb-2 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-ink">{detail.note}</p>}
      {detail?.access && (
        <div data-activity-access className="mb-2">
          <AccessCard access={detail.access} viewer={viewer ?? { principalId: null, admin: false }} onSignIn={onSignIn} />
        </div>
      )}
      <dl className={GROUP_CARD}>
        <Fact label={t("botPanel.activity.started")}>{formatTime(shown.startedAt)}</Fact>
        {shown.endedAt !== undefined && <Fact label={t("botPanel.activity.ended")}>{formatTime(shown.endedAt)}</Fact>}
        <Fact label={t("botPanel.activity.duration")}>{formatActivityDuration(duration)}</Fact>
        {shown.startedBy?.name && (
          <Fact label={t("botPanel.activity.startedBy")}>
            {shown.startedBy.kind === "routine" ? t("botPanel.activity.byRoutine", { name: shown.startedBy.name }) : shown.startedBy.name}
          </Fact>
        )}
        {shown.botName && shown.kind === "subagent" && <Fact label={t("botPanel.activity.bot")}>{shown.botName}</Fact>}
        {detail?.engine && (
          <Fact label={t("botPanel.activity.engine")}>
            {[engineLabel(engineName?.(detail.engine.instanceId), detail.engine.instanceId), detail.engine.model].filter(Boolean).join(" · ")}
          </Fact>
        )}
        {detail?.via && <Fact label={t("botPanel.activity.via")}>{activityViaLabel(detail.via)}</Fact>}
      </dl>

      {detail && !detail.threadId && detail.kind === "routine" && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.activity.privateRun")}</p>
      )}

      {running && detail?.canStop && detail.threadId && onSteer && <SteerBox key={detail.id} onSteer={onSteer} />}

      {detail && detail.children.length > 0 && (
        <section className="mt-4">
          <h3 className="mb-2 px-1 text-[13px] text-ink-secondary">{t("botPanel.activity.children")}</h3>
          <ul className="flex flex-col gap-1.5">
            {detail.children.map((child) => (
              <li key={child.id}><ActivityCard item={child} onOpen={onOpenChild} /></li>
            ))}
          </ul>
        </section>
      )}

      {detail && detail.files.length > 0 && (
        <section className="mt-4">
          <h3 className="mb-2 px-1 text-[13px] text-ink-secondary">{t("botPanel.activity.files")}</h3>
          <ul className="flex flex-col gap-1">
            {detail.files.map((file) => (
              <li key={file} className="flex min-w-0 items-center gap-2 text-[12px] text-ink">
                <FileText size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <span className="min-w-0 truncate font-mono" title={file}>{file}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  const steps = detail && (
    detail.steps.length === 0
      ? <p className="text-[12.5px] text-ink-secondary">{t("botPanel.activity.stepsEmpty")}</p>
      : <ActivitySteps steps={detail.steps} truncated={detail.stepsTruncated} />
  );

  const tabs = views.length > 1 || (split && views.length > 0) ? (
    <div role="tablist" aria-label={t("activity.view.aria")} className={cn("flex shrink-0 gap-1", split ? "px-5 pb-2 pr-12 pt-4" : "px-5 pb-1 pt-2")}>
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
      {renderConversation({ botId: shown.botId, threadId, title: shown.title })}
    </div>
  ) : view === "steps" ? (
    <div id="activity-view-panel" role="tabpanel" aria-labelledby="activity-view-steps" data-activity-steps-panel className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2">
      {steps}
    </div>
  ) : null;

  const footer = (running && detail?.canStop) || shown.threadId ? (
    <div className={cn(DIALOG.footer, "pt-3")}>
      {running && detail?.canStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className={cn(PILL, "gap-1.5 text-danger")}
        >
          {stopping ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Square size={12} aria-hidden="true" fill="currentColor" />}
          {t("botPanel.activity.stop")}
        </button>
      )}
      {shown.threadId && (
        <button
          type="button"
          data-activity-open-thread
          onClick={() => onOpenThread(shown.botId, shown.threadId!)}
          className={cn(PRIMARY_PILL, "gap-1.5")}
        >
          <ExternalLink size={13} aria-hidden="true" />
          {t("botPanel.activity.openThread")}
        </button>
      )}
    </div>
  ) : null;

  if (split) {
    return (
      <div data-activity-layout="columns" className="flex min-h-0 min-w-0 flex-1">
        <div data-activity-summary className="flex min-h-0 w-[340px] shrink-0 flex-col border-r border-hairline-weak">
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">{summary}</div>
          {footer}
        </div>
        <div data-activity-detail-right className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tabs}
          {panel}
        </div>
      </div>
    );
  }
  return (
    <div data-activity-layout="single" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      {tabs}
      {view === undefined || view === "summary" ? (
        <div data-activity-summary id={views.length ? "activity-view-panel" : undefined} role={views.length ? "tabpanel" : undefined} aria-labelledby={views.length ? "activity-view-summary" : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
          {summary}
        </div>
      ) : panel}
      {footer}
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
  const openThread = (threadBotId: string, threadId: string) => {
    if (threadBotId !== state.selectedId) dispatch({ type: "select", id: threadBotId });
    dispatch({ type: "switchTask", botId: threadBotId, threadId });
    onClose();
  };
  const engineName = (instanceId: string) => state.instances.find((instance) => instance.instanceId === instanceId)?.displayName;

  return (
    <ActivityDetailBody
      item={current}
      detail={detail}
      error={error}
      now={now}
      engineName={engineName}
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
      onSignIn={() => { onClose(); dispatch({ type: "toggleAppSettings", open: true, section: "engines" }); }}
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
  const [frameRef, width] = useElementWidth<HTMLDivElement>(900);
  return (
    <ActivityWindow labelledBy="activity-detail-title" onClose={onClose} frameRef={frameRef} frameProps={{ "data-activity-detail": item.id }}>
      <ActivityDetailPane item={item} wide={width >= WIDE_PX} onClose={onClose} onChanged={onChanged} />
    </ActivityWindow>
  );
}
