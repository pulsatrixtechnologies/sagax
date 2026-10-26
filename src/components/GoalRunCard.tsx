// The goal.run card of a room's transcript (/goal), laid out like Grok
// Build's goal status and grouped like Grok Bot's task cards (JC,
// 2026-10-16):
//
// - one compact card: status, the goal, turns against the budget, the last
//   detail (or why the run paused, stopped or needs the person);
// - one main action in view, the one that fits the state (Resume a paused
//   goal, Run again a finished one);
// - everything else in a "…" menu: Show details, Copy goal, then Stop the
//   run, last and in red.
//
// Only what the server already exposes: Stop is the room's interrupt (the
// composer's stop button), Resume and Run again send the goal again in goal
// mode. There is no pause endpoint for room goals yet, so no Pause button.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Copy,
  Ellipsis,
  Hand,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Target,
  XCircle,
} from "lucide-react";

import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { Message } from "@/state/store";
import type { GroupGoalRunCardData, GroupGoalRunStatus } from "../../shared/group-goal-run";
import { HOVER_ACTION_BUTTON, HOVER_ICON } from "./MessageHoverActions";
import { useMenuMotion } from "./MenuMotion";

const DETAIL_LIMIT = 280;

type Tone = "accent" | "success" | "warning" | "muted" | "danger";

const STATUS: Record<GroupGoalRunStatus, { label: LocaleKey; tone: Tone }> = {
  working: { label: "goalRun.status.working", tone: "accent" },
  completed: { label: "goalRun.status.completed", tone: "success" },
  "needs-input": { label: "goalRun.status.needsInput", tone: "warning" },
  blocked: { label: "goalRun.status.blocked", tone: "warning" },
  "limit-reached": { label: "goalRun.status.limitReached", tone: "warning" },
  paused: { label: "goalRun.status.paused", tone: "warning" },
  stopped: { label: "goalRun.status.stopped", tone: "muted" },
  failed: { label: "goalRun.status.failed", tone: "danger" },
};

const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  muted: "text-ink-secondary",
  danger: "text-danger",
};

const TONE_BORDER: Record<Tone, string> = {
  accent: "border-accent/30",
  success: "border-success/30",
  warning: "border-warning/35",
  muted: "border-hairline/45",
  danger: "border-danger/35",
};

/** What the detail line is, per status: the last step while it works, the
 * question when it needs the person, otherwise why it ended or paused. */
const DETAIL_LABEL: Partial<Record<GroupGoalRunStatus, LocaleKey>> = {
  working: "goalRun.detail.latest",
  "needs-input": "goalRun.detail.question",
  blocked: "goalRun.detail.reason",
  "limit-reached": "goalRun.detail.reason",
  paused: "goalRun.detail.reason",
  stopped: "goalRun.detail.reason",
  failed: "goalRun.detail.reason",
};

function compact(value: string | undefined, limit: number): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function StatusIcon({ status }: { status: GroupGoalRunStatus }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "working":
      return <Loader2 aria-hidden="true" className={cn(className, "animate-spin text-accent")} />;
    case "completed":
      return <CheckCircle2 aria-hidden="true" className={cn(className, "text-success")} />;
    case "needs-input":
      return <Hand aria-hidden="true" className={cn(className, "text-warning")} />;
    case "blocked":
    case "limit-reached":
    case "paused":
      return <CircleAlert aria-hidden="true" className={cn(className, "text-warning")} />;
    case "stopped":
      return <Square aria-hidden="true" className={cn(className, "text-ink-secondary")} />;
    case "failed":
      return <XCircle aria-hidden="true" className={cn(className, "text-danger")} />;
  }
}

/** "Turn 3 of 12" while it works; "5 of 12 turns" once it ended. */
export function goalRunTurnsLabel(run: Pick<GroupGoalRunCardData, "status" | "turnCount" | "maxTurns">): string {
  if (run.status === "working") {
    return t("goalRun.turns.current", { turn: Math.min(run.turnCount + 1, run.maxTurns), max: run.maxTurns });
  }
  return t(run.turnCount === 1 ? "goalRun.turns.usedOne" : "goalRun.turns.used", { count: run.turnCount, max: run.maxTurns });
}

function time(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(at).toISOString();
  }
}

export interface GoalRunActions {
  /** Stop the running goal (the room's interrupt). Only for a working run. */
  onStop?: () => void;
  /** Send the goal again in goal mode. Only for a run that is over or paused. */
  onRunAgain?: () => void;
}

const MENU_ROW =
  "flex min-h-[30px] w-full items-center gap-2 rounded-[6px] border-0 bg-transparent px-2 py-1.5 text-start text-[13px] leading-[18px] text-ink hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

type MenuEntry = { key: string; label: string; icon: ReactNode; onSelect: () => void; danger?: boolean; separatorBefore?: boolean };

/** The card's "…" menu: the message tray's popup, with a red last group. */
function GoalRunMenu({ entries }: { entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const motion = useMenuMotion(open);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  usePopoverDismiss(open, rootRef, () => close(false));
  useLayoutEffect(() => {
    if (!open) return;
    const box = menuRef.current?.getBoundingClientRect();
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (box && anchor) setAbove(anchor.bottom + 4 + box.height > window.innerHeight - 8 && anchor.top - 4 - box.height > 8);
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number | "home" | "end"> = { ArrowDown: 1, ArrowUp: -1, Home: "home", End: "end" };
    const step = move[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = step === "home" ? 0 : step === "end" ? items.length - 1 : (index + step + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("goalRun.menu")}
        title={t("goalRun.menu")}
        data-goal-run-more
        onClick={() => setOpen((value) => !value)}
        className={HOVER_ACTION_BUTTON}
      >
        <Ellipsis {...HOVER_ICON} aria-hidden="true" />
      </button>
      {motion.shown && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("goalRun.menu")}
          data-goal-run-menu
          onKeyDown={onKey}
          className={cn(
            "absolute right-0 z-40 flex w-max min-w-[200px] flex-col gap-0.5 rounded-[12px] border-[0.5px] border-border bg-elevated p-1.5 popover-surface",
            above ? "bottom-full mb-1" : "top-full mt-1",
            motion.className,
          )}
          {...motion.exitProps}
        >
          {entries.map((entry) => (
            <div key={entry.key} className="contents">
              {entry.separatorBefore && <div role="separator" className="-mx-1.5 my-1 border-t-[0.5px] border-border" />}
              <button
                type="button"
                role="menuitem"
                data-goal-run-action={entry.key}
                onClick={() => {
                  close();
                  entry.onSelect();
                }}
                className={cn(MENU_ROW, entry.danger && "text-danger")}
              >
                <span className={cn("flex size-[18px] shrink-0 items-center justify-center", entry.danger ? "text-danger" : "text-ink-secondary")} aria-hidden="true">
                  {entry.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface GoalHistoryItem {
  id: string;
  goal: string;
  status: string;
}

/** Where this goal sits among the room's goal cards. Null when it is the only one. */
export function goalRunPlace(
  messages: ReadonlyArray<{ id: string; kind?: string; goalRun?: { goal?: string; status: string } | null }>,
  messageId: string,
): { position: number; total: number; earlier: GoalHistoryItem[] } | null {
  const goals = messages.filter((message) => message.kind === "goal.run" && message.goalRun);
  const index = goals.findIndex((message) => message.id === messageId);
  if (index < 0 || goals.length < 2) return null;
  return {
    position: index + 1,
    total: goals.length,
    earlier: goals.slice(0, index).map((message) => ({
      id: message.id,
      goal: message.goalRun?.goal?.trim() || "",
      status: message.goalRun?.status ?? "",
    })),
  };
}

/** One live card per goal-driven room run, patched in place by the server. */
export function GoalRunCard({ message, onStop, onRunAgain, history }: { message: Message; history?: { position: number; total: number; earlier: GoalHistoryItem[] } | null } & GoalRunActions) {
  const [expanded, setExpanded] = useState(false);
  const [announce, setAnnounce] = useState("");
  const run = message.goalRun;
  if (!run) {
    const fallback = compact(message.text, DETAIL_LIMIT);
    return fallback ? (
      <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {fallback}
      </div>
    ) : null;
  }

  const status = STATUS[run.status];
  const label = t(status.label);
  const working = run.status === "working";
  const goalText = run.goal?.trim() ?? "";
  const goal = expanded ? goalText : compact(goalText, 180);
  const detail = expanded ? run.detail?.trim() ?? "" : compact(run.detail, DETAIL_LIMIT);
  const detailLabel = DETAIL_LABEL[run.status];
  const turns = goalRunTurnsLabel(run);
  const progress = run.maxTurns > 0
    ? Math.min(1, (working ? Math.min(run.turnCount + 1, run.maxTurns) : run.turnCount) / run.maxTurns)
    : 0;
  const stop = working ? onStop : undefined;
  const again = working ? undefined : onRunAgain;
  const primary = again
    ? { key: run.status === "paused" ? "resume" : "run-again", label: t(run.status === "paused" ? "goalRun.action.resume" : "goalRun.action.runAgain"), icon: run.status === "paused" ? <Play size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />, onSelect: again }
    : undefined;

  const entries: MenuEntry[] = [
    {
      key: "details",
      label: t(expanded ? "goalRun.action.hideDetails" : "goalRun.action.showDetails"),
      icon: expanded ? <ChevronUp {...HOVER_ICON} /> : <ChevronDown {...HOVER_ICON} />,
      onSelect: () => setExpanded((value) => !value),
    },
    ...(goalText ? [{
      key: "copy",
      label: t("goalRun.action.copyGoal"),
      icon: <Copy {...HOVER_ICON} />,
      onSelect: () => {
        void copyText(goalText).then((result) => { if (result === "copied") setAnnounce(t("goalRun.copied")); });
      },
    }] : []),
    ...(stop ? [{
      key: "stop",
      label: t("goalRun.action.stop"),
      icon: <Square {...HOVER_ICON} />,
      onSelect: stop,
      danger: true,
      separatorBefore: true,
    }] : []),
  ];

  return (
    <section
      aria-label={t("goalRun.aria", { status: label })}
      data-goal-run={run.runId}
      data-goal-run-status={run.status}
      className={cn("w-full max-w-[680px] rounded-2xl border bg-card px-3.5 py-3 shadow-sm", TONE_BORDER[status.tone])}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-inset">
          <StatusIcon status={run.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={cn("text-[11.5px] font-medium", TONE_TEXT[status.tone])} aria-live="polite" data-goal-run-label>
                  {label}
                </span>
                <span className="text-[11.5px] tabular-nums text-ink-tertiary" data-goal-run-turns>{turns}</span>
              </div>
              <h3 className={cn("mt-0.5 text-[13.5px] font-semibold text-ink", expanded ? "whitespace-pre-wrap break-words" : "truncate")}>
                {goal || t("goalRun.untitled")}
              </h3>
              {history && history.total > 1 && (
                <p className="text-[11.5px] text-ink-tertiary" data-goal-run-position>
                  {t("goalRun.position", { position: history.position, total: history.total })}
                </p>
              )}
              {!expanded && goalText.length > 180 && (
                <button type="button" data-goal-run-full className="mt-0.5 text-[12px] text-ink-secondary hover:text-ink" onClick={() => setExpanded(true)}>
                  {t("goalRun.showFull")}
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {primary && (
                <button
                  type="button"
                  data-goal-run-action={primary.key}
                  onClick={primary.onSelect}
                  title={t("goalRun.action.runAgainHint")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline/50 px-3 py-1 text-[12.5px] text-ink transition-colors hover:bg-control"
                >
                  {primary.icon}
                  {primary.label}
                </button>
              )}
              <GoalRunMenu entries={entries} />
            </div>
          </div>
          {run.maxTurns > 0 && (
            <div
              role="progressbar"
              aria-label={turns}
              aria-valuemin={0}
              aria-valuemax={run.maxTurns}
              aria-valuenow={working ? Math.min(run.turnCount + 1, run.maxTurns) : run.turnCount}
              className="mt-2 h-1 overflow-hidden rounded-full bg-inset"
            >
              <div className={cn("h-full rounded-full", working ? "bg-accent" : "bg-ink-tertiary/60")} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {detail && (
            <p className={cn("mt-2 text-[12.5px] leading-relaxed text-ink-secondary", !expanded && "line-clamp-2", expanded && "whitespace-pre-wrap break-words")} data-goal-run-detail>
              {detailLabel && <span className="font-medium text-ink">{t(detailLabel)} </span>}
              {detail}
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-ink-tertiary">
            {t("goalRun.coordinating", { name: run.coordinatorName })}
          </p>
          {history && history.earlier.length > 0 && (
            <details className="mt-2" data-goal-run-history>
              <summary className="cursor-pointer text-[12px] text-ink-secondary">{t("goalRun.history")}</summary>
              <ol className="mt-1 flex flex-col gap-1">
                {history.earlier.map((item) => (
                  <li key={item.id} className="text-[12px] text-ink-secondary">
                    <span className="text-ink-tertiary">{item.status}</span>
                    {item.goal ? ` ${item.goal}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {expanded && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px] text-ink-secondary" data-goal-run-details>
              <dt className="text-ink-tertiary">{t("goalRun.started")}</dt>
              <dd>{time(run.startedAt)}</dd>
              {run.finishedAt && <>
                <dt className="text-ink-tertiary">{t("goalRun.finished")}</dt>
                <dd>{time(run.finishedAt)}</dd>
              </>}
            </dl>
          )}
          <span className="sr-only" role="status">{announce}</span>
        </div>
      </div>
    </section>
  );
}

/** The room header's reminder that a goal is running: status and turns,
 * and a click brings its card into view. */
export function GoalRunHeaderChip({ run, onShow }: { run: GroupGoalRunCardData; onShow: () => void }) {
  const turns = goalRunTurnsLabel(run);
  return (
    <button
      type="button"
      data-goal-run-chip={run.runId}
      onClick={onShow}
      title={run.goal}
      aria-label={t("goalRun.chip.aria", { turns })}
      className="inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-full border-[0.5px] border-hairline-weak bg-elevated px-2.5 text-[12px] text-ink transition-colors duration-[120ms] hover:bg-elevated-hover"
    >
      <Target size={13} aria-hidden="true" className="shrink-0 text-accent" />
      <span className="truncate">{t("goalRun.chip.label")}</span>
      <span className="shrink-0 tabular-nums text-ink-tertiary">{Math.min(run.turnCount + 1, run.maxTurns)}/{run.maxTurns}</span>
    </button>
  );
}
