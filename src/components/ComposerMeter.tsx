// The context and usage meter under the message box, at the row's end (owner
// 2026-11-25, M-20261125-070, M-20261125-072 to M-20261125-074, #5372; it
// covers #5283, a usage ring always in sight). It replaces the orange limit
// dot of the chat bar. One wide pill, two halves, each a small ring that
// fills and its percentage, read without a hover:
//   left   the share of the model's context window this conversation uses;
//   right  the most advanced limit (the short session or the week) of the
//          account that serves this bot.
// Only the usage half changes colour, by the dot's own rules. A click on a
// half opens its detail: the tokens used of the total and "Compact now"; the
// account with its provider (D-20261125-015), its windows and their reset,
// then the dot's actions. The figures are read again when a detail opens and
// every minute while it stays open (D-20261125-014). A half with no data is
// absent. In a narrow window the pill keeps its two rings, without figures.
// With no plan window for the engine (an API key account, a plan read that
// failed), the usage half still shows whenever the dot did: it draws from the
// engine's own limit, with its line and its actions (#5372 review).
// Never a banner above the chat. The rules are src/lib/composer-meter.ts.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { contextHalf, limitHalf, usageHalf, usageTone, type UsageTone } from "@/lib/composer-meter";
import { useEngineLimits } from "@/lib/limit-resets";
import { accountRowName, type PlanRow } from "@/lib/plan-usage";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { contextDetail } from "@/lib/usage";
import { weeklyLimitNotice } from "@/lib/usage-notices";
import type { Bot } from "@/state/store";
import { useEnginePlanRows } from "./ChatUsageNotices";
import { useCompact } from "./ContextWarning";
import { EngineLimitActions, useEngineLimitDetail } from "./LimitResetContinue";
import { AccountLimits } from "./PlanUsage";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE } from "./menu-look";

const RING = 14;
const RADIUS = 5.25;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A small ring that fills clockwise from the top, in the current ink. */
function MeterRing({ percent }: { percent: number }) {
  const share = Math.max(0, Math.min(100, percent)) / 100;
  return (
    <svg data-meter-ring="" aria-hidden="true" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} fill="none" className="shrink-0">
      <circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke="currentColor" strokeWidth={2} strokeLinecap="round"
        strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`} transform={`rotate(-90 ${RING / 2} ${RING / 2})`} />
    </svg>
  );
}

const HALF = "flex h-full items-center gap-1.5 whitespace-nowrap px-2 tabular-nums outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-hover first:rounded-l-full last:rounded-r-full";
/** The figure folds away in a narrow window: the two rings stay. */
const FIGURE = "@max-[22rem]/composer:hidden";
const TONE: Record<UsageTone, string> = { quiet: "", warning: "text-warning", danger: "text-danger" };
const DETAIL = cn(MENU_SURFACE, MENU_FIT_ROW, "absolute bottom-full right-0 z-40 mb-1.5 max-w-[min(320px,calc(100vw-16px))]");
/** The usage detail holds an account's row, its two windows side by side. */
const USAGE_DETAIL = "w-[min(400px,calc(100vw-16px))] max-w-none";

export type MeterHalf = "context" | "usage";

export interface ComposerMeterViewProps {
  /** Absent: no context half. `detail`: "Context 84k (42% of 200k)". */
  context?: { percent: number; detail: string | null };
  /** Absent: no usage half. `line`: the limit's own sentence near the limit. */
  usage?: {
    /** Null: the engine refuses work and gave no share; a full ring, no figure. */
    percent: number | null;
    tone: UsageTone;
    /** The account that serves the bot: one row, its provider and address,
     * its two windows side by side (M-20261125-084), the row of Settings >
     * Usage limits. Absent when the plan report has no window for the
     * engine: the half then reads the engine's own limit. */
    row?: PlanRow;
    /** The account's star (the plan the account menu's Usage row shows). */
    favorite?: { id: string | null; onToggle: (planId: string) => void };
    line?: string | null;
    /** The limit is near: the line shows in the detail too. */
    near?: boolean;
  };
  /** The detail's actions, drawn by the owner: Compact now; the limit's actions. */
  contextActions?: ReactNode;
  usageActions?: (close: () => void) => ReactNode;
  /** A detail opened or closed (the owner reads its figures again). */
  onOpenChange?: (open: MeterHalf | null) => void;
  /** Tests and the gallery: render with a detail open. */
  initialOpen?: MeterHalf | null;
}

/** The pill and its details, without a store: every figure comes from its owner. */
export function ComposerMeterView({ context, usage, contextActions, usageActions, onOpenChange, initialOpen = null }: ComposerMeterViewProps) {
  const [open, setOpenState] = useState<MeterHalf | null>(initialOpen);
  const rootRef = useRef<HTMLSpanElement>(null);
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const setOpen = (next: MeterHalf | null) => {
    setOpenState(next);
    changed.current?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!context && !usage) return null;
  const shown = open === "context" ? (context ? "context" : null) : open === "usage" ? (usage ? "usage" : null) : null;
  const contextAria = context ? t("composer.meter.contextAria", { percent: context.percent }) : "";
  const usageAria = usage ? usage.line ?? (usage.percent === null ? "" : t("composer.meter.usageAria", { percent: usage.percent })) : "";
  return (
    <span ref={rootRef} data-composer-meter="" role="group" aria-label={t("composer.meter.aria")} className="relative flex items-center">
      <span className="flex h-6 items-center rounded-full border border-hairline/40 text-[12px] leading-4 text-ink-secondary">
        {context && (
          <button type="button" data-composer-meter-half="context" aria-haspopup="dialog" aria-expanded={shown === "context"}
            aria-label={contextAria} title={contextAria}
            onClick={() => setOpen(open === "context" ? null : "context")}
            className={HALF}>
            <MeterRing percent={context.percent} />
            <span className={FIGURE}>{t("composer.meter.percent", { percent: context.percent })}</span>
          </button>
        )}
        {context && usage && <span aria-hidden="true" className="h-3 w-px shrink-0 bg-hairline/60" />}
        {usage && (
          <button type="button" data-composer-meter-half="usage" data-tone={usage.tone} aria-haspopup="dialog" aria-expanded={shown === "usage"}
            aria-label={usageAria} title={usageAria}
            onClick={() => setOpen(open === "usage" ? null : "usage")}
            className={cn(HALF, TONE[usage.tone])}>
            <MeterRing percent={usage.percent ?? 100} />
            {usage.percent !== null && <span className={FIGURE}>{t("composer.meter.percent", { percent: usage.percent })}</span>}
          </button>
        )}
      </span>
      {shown === "context" && context && (
        <div role="dialog" aria-label={contextAria} data-composer-meter-detail="context" className={DETAIL}>
          {context.detail && <p className="px-2 py-1 tabular-nums">{context.detail}</p>}
          {contextActions}
        </div>
      )}
      {shown === "usage" && usage && (
        <div role="menu" aria-label={usageAria} data-composer-meter-detail="usage" className={cn(DETAIL, USAGE_DETAIL)}>
          {usage.row && <AccountLimits provider={usage.row} name={accountRowName(usage.row)} favorite={usage.favorite} />}
          {usage.near && usage.line && <p data-composer-meter-limit="" className="px-2 py-1 tabular-nums">{usage.line}</p>}
          {usageActions?.(() => setOpen(null))}
        </div>
      )}
    </span>
  );
}

/** The meter of one conversation: its readings, from the store and the server. */
export function ComposerMeter({ bot, threadId }: { bot: Bot; threadId: string }) {
  const [open, setOpen] = useState<MeterHalf | null>(null);
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  const own = threadId === bot.threadId;
  const context = contextHalf(task?.usage, own ? bot.messages : []);

  // the engine this conversation really runs on (Auto resolved): the only one whose limit shows
  const selection = bot.modelSelection;
  const engine = (selection.auto === true ? task?.autoModel?.instanceId : undefined) ?? selection.instanceId;
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  const rows = useEnginePlanRows(engine, limit?.driver, open === "usage");
  const usage = usageHalf(rows);
  const detail = useEngineLimitDetail({ limit, weekly: weeklyLimitNotice(rows), botId: bot.id, threadId, messages: own ? bot.messages : undefined });
  // no plan window for this engine: its own limit, whenever the dot showed
  const fromLimit = usage || !detail.line ? null : limitHalf(limit);
  const tone = usageTone({ near: detail.near, weeklyNotice: Boolean(detail.weekly), hard: detail.hard });
  const compact = useCompact();
  const favorite = useUsageFavorite();
  return (
    <ComposerMeterView
      context={context ? { percent: context.percent, detail: task?.usage ? contextDetail(task.usage) : null } : undefined}
      usage={usage ? {
        percent: usage.percent,
        tone,
        row: usage.row,
        favorite: { id: favorite, onToggle: toggleUsageFavorite },
        line: detail.line,
        near: detail.near,
      } : fromLimit ? { percent: fromLimit.percent, tone, line: detail.line, near: detail.near } : undefined}
      onOpenChange={setOpen}
      contextActions={own ? (
        <button type="button" data-composer-meter-compact="" disabled={Boolean(bot.busy) || compact.pending}
          title={bot.busy ? t("contextWarning.busy") : undefined}
          onClick={() => compact.run(`/api/bots/${bot.id}/compact`, { threadId })}
          className={cn(MENU_ROW, "disabled:cursor-not-allowed disabled:opacity-50")}>
          {compact.pending ? t("contextWarning.compacting") : t("contextWarning.compactNow")}
        </button>
      ) : undefined}
      usageActions={(close) => <EngineLimitActions detail={detail} botId={bot.id} onDone={close} />}
    />
  );
}
