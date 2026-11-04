// The task list of a bot in its panel: the to-do list the bot keeps for the
// person (shared/bot-task-list.ts). The rows come from the server. Not the
// code work journal.
//
// Laid out like the Routines rows below it: one grouped card, a title and a
// line under it, no group titles. What needs the person comes first, in the
// accent, with Answer; then what is in progress. A done task is not listed:
// the one that just moved to Done shows a green check in place of its icon
// for a moment, then its row fades and folds away. A row opens the task in place (full title, the
// note of the bot, every change of state) and its menu (the ... button,
// a right click, Shift+F10 or the menu key) marks it done, puts it back in
// progress, reopens or removes it. Answer opens the conversation with the
// task named in the composer, so the reply goes back to the bot.
//
// The list stays current while the panel is open: the server sends
// `bot.tasks` (ids only) when the bot adds or moves a task, and the section
// reads again; it also reads again when the window comes back into view.
// A server without the route yet (an older one) says it comes with the
// server update, never an error. A list that cannot be read (network, 5xx,
// 403, an invalid answer) shows nothing at all, like an empty one: no red
// line. The cause goes to the console, the last known list stays on screen,
// and the section reads again by itself (backoff) until a read works.
import { Check, CircleDashed, ListTodo, MessageCircleQuestion, MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BOT_TASKS_EVENT, type BotTasksEventDetail } from "@/lib/bot-task-events";
import { cn } from "@/lib/cn";
import { appendComposerDraft } from "@/lib/drafts";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { routeMissingOnServer } from "@/lib/server-route";
import { useShowThreads } from "@/lib/thread-preferences";
import { api, ApiError, openBotThread, useStoreOptional } from "@/state/store";
import { BOT_TASK_DONE_FOLD_MS, BOT_TASK_DONE_LINGER_MS, listBotTasks, personBotTaskActions, type BotTask, type BotTaskAction, type BotTaskState } from "../../../shared/bot-task-list";
import { navigateThreadMenu } from "../BotProjects";
import { PanelPageHeader as RoutineDetailHeader } from "./PanelPage";

type LoadState = "ok" | "failed" | "needsUpdate";
type PersonMove = Exclude<BotTaskAction, "advance">;

const STATE_LABEL: Record<BotTaskState, "botTasks.waiting" | "botTasks.doing" | "botTasks.done"> = {
  waiting: "botTasks.waiting",
  doing: "botTasks.doing",
  done: "botTasks.done",
};
const MOVE_LABEL: Record<PersonMove, "botTasks.complete" | "botTasks.resume" | "botTasks.reopen"> = {
  complete: "botTasks.complete",
  resume: "botTasks.resume",
  reopen: "botTasks.reopen",
};
const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50";
const DETAIL_BUTTON = "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-hairline/50 bg-panel px-3 py-2.5 text-[13px] font-medium text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** How a failed read shows: the route missing on an older server is not an
 * error, and a bot this person cannot reach has no tasks for them. */
export function taskListFailure(error: unknown): { tasks?: BotTask[]; state: LoadState } {
  if (routeMissingOnServer(error)) return { state: "needsUpdate" };
  if (error instanceof ApiError && error.status === 404) return { tasks: [], state: "ok" };
  return { state: "failed" };
}

/** The line under a title: what the task waits on, and since when. */
export function botTaskSubtitle(task: BotTask, now = Date.now()): string {
  const when = relativeTime(task.updatedAt, now);
  if (task.state === "waiting") return t("botTasks.line.waiting", { when });
  if (task.state === "done") return t("botTasks.line.done", { when });
  return t("botTasks.line.doing", { when });
}

/** What Answer puts in the composer: the task named, so the bot knows
 * which one the reply is about. Never sent by itself. */
export function botTaskAnswerDraft(task: Pick<BotTask, "title">): string {
  return t("botTasks.answerDraft", { title: task.title });
}

/** The quiet retry after a failed read: 2 s, then doubling, never past 60 s. */
export function taskListRetryDelay(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));
}

const listPath = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/task-list`;

type MenuState = { task: BotTask; x: number; y: number; trigger: HTMLElement };

/** A group's panel (2026-11-03): the task lists of the viewer's bots in the
 * group, narrowed to the tasks those bots added from the group's
 * conversations; Answer goes back to the group. */
export interface BotTaskScope {
  botIds: readonly string[];
  threadIds: ReadonlySet<string>;
  onAnswer: (task: BotTask) => void;
}

/** Several task lists read as one: the tasks of every list that answered,
 * narrowed to the scope's conversations. Every read failed: the first
 * failure stands for them. */
export function mergeTaskLists(results: ReadonlyArray<PromiseSettledResult<{ tasks: BotTask[] }>>, threadIds?: ReadonlySet<string>): { tasks: BotTask[] } {
  const answered = results.filter((result): result is PromiseFulfilledResult<{ tasks: BotTask[] }> => result.status === "fulfilled");
  if (answered.length === 0 && results.length > 0) throw (results[0] as PromiseRejectedResult).reason;
  const tasks: BotTask[] = [];
  for (const result of answered) {
    if (!Array.isArray(result.value?.tasks)) throw new Error("the task list answer is not a list");
    for (const task of result.value.tasks) if (!threadIds || (task.threadId !== undefined && threadIds.has(task.threadId))) tasks.push(task);
  }
  return { tasks };
}

export function BotTaskSection({ botId, scope }: { botId: string; scope?: BotTaskScope }) {
  const store = useStoreOptional();
  const threadsShown = useShowThreads();
  const bot = store?.state.bots.find((candidate) => candidate.id === botId);
  // The lists read: this bot's, or every bot of the group's scope.
  const listIds = scope ? scope.botIds : [botId];
  const listKey = listIds.join(",");
  const threadKey = scope ? [...scope.threadIds].sort().join(",") : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const canAnswer = scope ? true : Boolean(bot);
  const [tasks, setTasks] = useState<BotTask[] | null>(null);
  const [state, setState] = useState<LoadState>("ok");
  // Tasks that just moved to Done: "check" shows the green check, "fold" the
  // row going away. Done tasks that are not in here are not listed.
  const [finishing, setFinishing] = useState<Record<string, "check" | "fold">>({});
  const seenStates = useRef<Map<string, BotTaskState> | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Only the newest read lands: a slow answer never overwrites a newer one.
  const readSeq = useRef(0);
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({ timer: null, attempt: 0 });
  // The row a closed detail hands the focus back to.
  const returnFocus = useRef<string | null>(null);

  const clearTimers = () => { for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); };
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); run(); }, ms);
    timers.current.add(timer);
  };

  const load = useCallback(() => {
    const seq = ++readSeq.current;
    if (retry.current.timer) { clearTimeout(retry.current.timer); retry.current.timer = null; }
    const ids = listKey ? listKey.split(",") : [];
    const read = scopeRef.current
      ? Promise.allSettled(ids.map((id) => api<{ tasks: BotTask[] }>(listPath(id)))).then((results) => mergeTaskLists(results, scopeRef.current?.threadIds))
      : api<{ tasks: BotTask[] }>(listPath(botId));
    read
      .then((body) => {
        if (seq !== readSeq.current) return;
        if (!Array.isArray(body?.tasks)) throw new Error("the task list answer is not a list");
        retry.current.attempt = 0;
        setTasks(body.tasks);
        setState("ok");
      })
      .catch((error: unknown) => {
        if (seq !== readSeq.current) return;
        const next = taskListFailure(error);
        if (next.tasks) setTasks(next.tasks);
        setState(next.state);
        if (next.state !== "failed") { retry.current.attempt = 0; return; }
        // Not shown: the last known list stays, or nothing. Read again quietly.
        console.warn(`[bot-tasks] the task list of ${listKey} could not be loaded`, error);
        const delay = taskListRetryDelay(retry.current.attempt++);
        retry.current.timer = setTimeout(() => { retry.current.timer = null; load(); }, delay);
      });
  }, [botId, listKey, threadKey]);

  useEffect(() => {
    setTasks(null);
    setState("ok");
    setFinishing({});
    seenStates.current = null;
    retry.current.attempt = 0;
    clearTimers();
    setOpenId(null);
    setMenu(null);
    load();
    // the bot added or moved a task (frame `bot.tasks`, src/state/store.tsx)
    const onFrame = (event: Event) => {
      const changed = (event as CustomEvent<BotTasksEventDetail>).detail?.botId;
      if (changed && listKey.split(",").includes(changed)) load();
    };
    // back on the window: read again, in case a frame was missed
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(BOT_TASKS_EVENT, onFrame);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      readSeq.current += 1;
      if (retry.current.timer) { clearTimeout(retry.current.timer); retry.current.timer = null; }
      clearTimers();
      window.removeEventListener(BOT_TASKS_EVENT, onFrame);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [botId, listKey, load]);

  // A task that goes from open to Done (the bot finished it, or the person
  // did) keeps its row a moment with the check, then the row folds away.
  // A task already done when it first shows is never listed.
  useEffect(() => {
    if (!tasks) return;
    const before = seenStates.current;
    seenStates.current = new Map(tasks.map((task) => [task.id, task.state]));
    if (!before) return;
    for (const task of tasks) {
      const was = before.get(task.id);
      if (task.state !== "done" || !was || was === "done") continue;
      const id = task.id;
      setFinishing((current) => ({ ...current, [id]: "check" }));
      later(() => setFinishing((current) => id in current ? { ...current, [id]: "fold" } : current), BOT_TASK_DONE_LINGER_MS);
      later(() => setFinishing((current) => { const { [id]: _gone, ...rest } = current; return rest; }), BOT_TASK_DONE_LINGER_MS + BOT_TASK_DONE_FOLD_MS);
    }
  }, [tasks]);

  // A reopened task is listed again at once, never folding.
  useEffect(() => {
    if (!tasks) return;
    setFinishing((current) => {
      const stale = Object.keys(current).filter((id) => tasks.find((task) => task.id === id)?.state !== "done");
      if (stale.length === 0) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [tasks]);

  // A closed detail gives the focus back to its row.
  useEffect(() => {
    if (openId || !returnFocus.current) return;
    const id = returnFocus.current;
    returnFocus.current = null;
    document.querySelector<HTMLElement>(`[data-bot-task-open="${CSS.escape(id)}"]`)?.focus();
  }, [openId]);

  const fail = (error: unknown) => {
    const next = taskListFailure(error);
    setState(next.state === "ok" ? "failed" : next.state);
  };
  const move = (task: BotTask, action: PersonMove) => {
    // shown at once; the server answer (and its frame) confirms it
    const next = action === "complete" ? "done" : "doing";
    setTasks((current) => current?.map((item) => item.id === task.id ? { ...item, state: next, updatedAt: Date.now() } : item) ?? current);
    void api(`${listPath(task.botId || botId)}/${encodeURIComponent(task.id)}/${action}`, { method: "POST", body: "{}" }).then(load).catch((error: unknown) => { fail(error); load(); });
  };
  const remove = (task: BotTask) => {
    setTasks((current) => current?.filter((item) => item.id !== task.id) ?? current);
    if (openId === task.id) setOpenId(null);
    void api(`${listPath(task.botId || botId)}/${encodeURIComponent(task.id)}`, { method: "DELETE" }).then(load).catch((error: unknown) => { fail(error); load(); });
  };
  const answer = (task: BotTask) => {
    if (scope) { scope.onAnswer(task); return; }
    if (!store || !bot) return;
    const threadId = task.threadId ?? bot.threadId;
    openBotThread(store.dispatch, bot, threadId, threadsShown);
    appendComposerDraft(`bot:${bot.id}:${threadId}`, botTaskAnswerDraft(task));
  };
  const openTask = (task: BotTask) => { setMenu(null); setOpenId(task.id); };
  const closeTask = () => { returnFocus.current = openId; setOpenId(null); };
  const openMenu = (task: BotTask, trigger: HTMLElement, at?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    setMenu({ task, trigger, x: at?.x ?? rect.right - 220, y: at?.y ?? rect.bottom + 4 });
  };
  const closeMenu = (focusTrigger = true) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (focusTrigger) trigger?.focus();
  };

  const listed = tasks ? listBotTasks(tasks, new Set(Object.keys(finishing))) : null;
  const total = listed?.length ?? 0;
  const open = openId ? tasks?.find((task) => task.id === openId) ?? null : null;

  const row = (task: BotTask) => {
    const subtitle = botTaskSubtitle(task);
    const waiting = task.state === "waiting";
    const done = task.state === "done";
    const folding = finishing[task.id] === "fold";
    // the row folds by its height (grid 1fr to 0fr) and fades; its hairline goes with it
    return (
      <li key={task.id} data-bot-task={task.state} data-bot-task-finishing={done ? finishing[task.id] ?? "check" : undefined}
        onContextMenu={(event) => { event.preventDefault(); openMenu(task, event.currentTarget, { x: event.clientX, y: event.clientY }); }}
        style={{ transitionDuration: `${BOT_TASK_DONE_FOLD_MS}ms` }}
        className={cn("group/task grid transition-[grid-template-rows,opacity] ease-out", folding ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
          waiting ? "bg-accent/[0.07] hover:bg-accent/[0.11]" : "hover:bg-hover", "border-b border-hairline-weak last:border-b-0")}>
      <div className="flex min-h-0 items-center gap-2.5 overflow-hidden px-3 py-2">
        <StateIcon state={task.state} />
        <button type="button" data-bot-task-open={task.id} onClick={() => openTask(task)}
          onKeyDown={(event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMenu(task, event.currentTarget); }
          }}
          aria-keyshortcuts="Shift+F10"
          aria-label={`${task.title}, ${t(STATE_LABEL[task.state])}`}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <span title={task.title} className={cn("line-clamp-2 break-words text-[13px] leading-[18px]", done ? "text-ink-tertiary" : "text-ink", waiting && "font-medium")}>{task.title}</span>
          {waiting && task.note ? <span data-bot-task-note-preview="true" title={task.note} className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-ink">{task.note}</span> : null}
          <span className={cn("block truncate text-[12px] leading-4", done ? "text-ink-tertiary" : "text-ink-secondary")}>{subtitle}</span>
        </button>
        {waiting && canAnswer ? (
          <button type="button" data-bot-task-answer="true" onClick={() => answer(task)}
            className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium leading-4 text-accent-ink hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            {t("botTasks.answer")}
          </button>
        ) : null}
        <button type="button" data-bot-task-menu={task.id}
          aria-label={t("botTasks.menu", { title: task.title })} title={t("botTasks.menu", { title: task.title })}
          aria-haspopup="menu" aria-expanded={menu?.task.id === task.id}
          onClick={(event) => openMenu(task, event.currentTarget)}
          className={cn("size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 group-hover/task:flex touch:flex",
            menu?.task.id === task.id ? "flex" : "hidden")}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      </li>
    );
  };

  // Nothing to show, nothing rendered: no title, no empty line. The section
  // stays while a task is open in place, and for the server-update line. A
  // failed read is not shown: the last known list, or nothing.
  if (state !== "needsUpdate" && total === 0 && !open) return null;

  return (
    <section data-bot-settings-section="task-list" aria-labelledby={`bot-tasks-${botId}`} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ListTodo size={16} aria-hidden="true" className="text-ink-secondary" />
        <h2 id={`bot-tasks-${botId}`} className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("botTasks.title")}</h2>
      </div>
      {state === "needsUpdate" ? <p data-bot-tasks-needs-update="true" className="text-[12px] text-ink-tertiary">{t("serverRoute.needsUpdate")}</p> : null}
      {state !== "needsUpdate" && listed && total > 0 ? (
        <ul data-bot-task-list="true" className={cn(GROUPED_CARD, listed.some((task) => task.state === "waiting") && "border-accent/40")}>{listed.map(row)}</ul>
      ) : null}

      {menu && createPortal(
        <div className="fixed inset-0 z-40" onMouseDown={() => closeMenu(false)} onContextMenu={(event) => { event.preventDefault(); closeMenu(false); }}>
          <div role="menu" data-bot-task-menu-open={menu.task.id} aria-label={menu.task.title}
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 228)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 220)) }}
            className="absolute flex w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-ink shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
              navigateThreadMenu(event);
            }}>
            <TaskActions task={menu.task} canAnswer={canAnswer} kind="menu"
              onOpen={() => openTask(menu.task)}
              onAnswer={() => { closeMenu(false); answer(menu.task); }}
              onMove={(action) => { closeMenu(); move(menu.task, action); }}
              onRemove={() => { closeMenu(false); remove(menu.task); }} />
          </div>
        </div>, document.body)}

      {open ? (
        <TaskDetail task={open} canAnswer={canAnswer} onBack={closeTask}
          onClose={store ? () => { store.dispatch({ type: "toggleSettings", open: false }); store.dispatch({ type: "toggleComputer", open: false }); } : closeTask}
          onAnswer={() => answer(open)}
          onMove={(action) => move(open, action)}
          onRemove={() => { returnFocus.current = null; remove(open); }} />
      ) : null}
    </section>
  );
}

function StateIcon({ state }: { state: BotTaskState }) {
  if (state === "waiting") return <MessageCircleQuestion size={16} aria-hidden="true" className="shrink-0 text-accent" />;
  if (state === "done") return <span aria-hidden="true" data-bot-task-check="true" className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success/20 text-success"><Check size={11} strokeWidth={2.5} /></span>;
  return <CircleDashed size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />;
}

/** The moves on a task, the same in its menu and its detail. */
function TaskActions({ task, canAnswer, kind, onOpen, onAnswer, onMove, onRemove }: {
  task: BotTask;
  canAnswer: boolean;
  kind: "menu" | "detail";
  onOpen?: () => void;
  onAnswer: () => void;
  onMove: (action: PersonMove) => void;
  onRemove: () => void;
}) {
  const moves = personBotTaskActions(task.state).filter((action): action is PersonMove => action !== "advance");
  const item = (key: string, label: ReactNode, onClick: () => void, options: { autoFocus?: boolean; danger?: boolean; primary?: boolean } = {}) => kind === "menu"
    ? <button key={key} type="button" role="menuitem" data-bot-task-action={key} autoFocus={options.autoFocus} onClick={onClick} className={cn(MENU_ITEM, options.danger && "text-danger")}>{label}</button>
    : <button key={key} type="button" data-bot-task-action={key} onClick={onClick}
      className={cn(DETAIL_BUTTON, options.primary && "basis-full border-transparent bg-accent text-accent-ink hover:bg-accent hover:brightness-110", options.danger && "flex-none px-3 text-ink-secondary hover:text-danger")}>{label}</button>;
  return <>
    {kind === "menu" && onOpen ? item("open", t("botTasks.open"), onOpen, { autoFocus: true }) : null}
    {task.state === "waiting" && canAnswer ? item("answer", t("botTasks.answer"), onAnswer, { primary: true }) : null}
    {moves.map((action) => item(action, t(MOVE_LABEL[action]), () => onMove(action)))}
    {kind === "menu" ? <div role="separator" className="my-1 h-px bg-hairline-weak" /> : null}
    {item("remove", kind === "menu" ? <><Trash2 size={14} aria-hidden="true" />{t("botTasks.remove")}</> : <><Trash2 size={15} aria-hidden="true" /><span className="sr-only">{t("botTasks.remove")}</span></>, onRemove, { danger: true })}
  </>;
}

/** The task opened in place over the panel, like the page of a routine. */
function TaskDetail({ task, canAnswer, onBack, onClose, onAnswer, onMove, onRemove }: {
  task: BotTask;
  canAnswer: boolean;
  onBack: () => void;
  onClose: () => void;
  onAnswer: () => void;
  onMove: (action: PersonMove) => void;
  onRemove: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.focus(); }, [task.id]);
  const history = [...(task.history ?? [])].reverse();
  return (
    <div data-bot-task-detail={task.id} role="dialog" aria-modal="false" aria-label={task.title}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onBack(); } }}
      className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutineDetailHeader name={t("botTasks.title")} onBack={onBack} onClose={onClose} />
      <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none">
        <div className="flex items-center gap-2">
          <StateIcon state={task.state} />
          <span data-bot-task-detail-state={task.state} className={cn("rounded-md px-1.5 text-[11.5px] leading-[18px]", task.state === "waiting" ? "bg-accent/15 text-accent" : "bg-inset text-ink-secondary")}>{t(STATE_LABEL[task.state])}</span>
          <span className="text-[12px] text-ink-tertiary">{botTaskSubtitle(task)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-[15px] font-semibold leading-snug text-ink">{task.title}</p>
        {task.note ? (
          <div className="mt-4">
            <div className="text-[12px] leading-[17px] text-ink-tertiary">{t("botTasks.detail.note")}</div>
            <p data-bot-task-note="true" className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">{task.note}</p>
          </div>
        ) : null}
        <div className="mt-4">
          <div className="text-[12px] leading-[17px] text-ink-tertiary">{t("botTasks.detail.history")}</div>
          {history.length > 0 ? (
            <ol data-bot-task-history="true" className={cn(GROUPED_CARD, "mt-1.5")}>
              {history.map((event, index) => (
                <li key={`${event.at}-${index}`} className={cn(GROUPED_ROW, "flex items-center gap-2 py-2 text-[12.5px]")}>
                  <StateIcon state={event.state} />
                  <span className="min-w-0 flex-1 text-ink">{t(STATE_LABEL[event.state])}<span className="text-ink-secondary"> · {t(event.by === "bot" ? "botTasks.by.bot" : "botTasks.by.person")}</span></span>
                  <span className="shrink-0 text-ink-tertiary" title={new Date(event.at).toLocaleString()}>{relativeTime(event.at)}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-1 text-[12.5px] text-ink-secondary">{t("botTasks.detail.since", { when: relativeTime(task.createdAt) })}</p>}
        </div>
      </div>
      <div data-bot-task-detail-actions="true" className="flex flex-wrap items-center gap-2 border-t border-hairline/40 px-3 py-3">
        <TaskActions task={task} canAnswer={canAnswer} kind="detail" onAnswer={onAnswer} onMove={onMove} onRemove={onRemove} />
      </div>
    </div>
  );
}
