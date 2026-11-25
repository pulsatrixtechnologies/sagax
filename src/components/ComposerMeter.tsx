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
// Never a banner above the chat. The rules are src/lib/composer-meter.ts.
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { contextHalf, usageHalf, usageTone, type UsageTone } from "@/lib/composer-meter";
import { useEngineLimits } from "@/lib/limit-resets";
import { accountRowName, formatResetDistance, humanPlanName } from "@/lib/plan-usage";
import { contextDetail } from "@/lib/usage";
import { weeklyLimitNotice } from "@/lib/usage-notices";
import type { Bot } from "@/state/store";
import { useEnginePlanRows } from "./ChatUsageNotices";
import { useCompact } from "./ContextWarning";
import { EngineLimitActions, useEngineLimitDetail } from "./LimitResetContinue";
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
const FIGURE = "@max-[35rem]/composer:hidden";
const TONE: Record<UsageTone, string> = { quiet: "", warning: "text-warning", danger: "text-danger" };
const DETAIL = cn(MENU_SURFACE, MENU_FIT_ROW, "absolute bottom-full right-0 z-40 mb-1.5 max-w-[min(320px,calc(100vw-16px))]");

export function ComposerMeter({ bot, threadId }: { bot: Bot; threadId: string }) {
  const [open, setOpen] = useState<"context" | "usage" | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
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
  const tone = usageTone({ near: detail.near, weeklyNotice: Boolean(detail.weekly), hard: detail.hard });
  const compact = useCompact();

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
  const now = Date.now();
  const plan = usage ? humanPlanName(usage.row.plan) ?? usage.row.plan : null;
  const windows = usage ? ([["weekly", t("planUsage.weekly"), usage.row.weekly], ["five-hour", t("planUsage.fiveHour"), usage.row.fiveHour]] as const)
    .filter(([, , window]) => window.available && window.usedPercent !== null) : [];
  return (
    <span ref={rootRef} data-composer-meter="" role="group" aria-label={t("composer.meter.aria")} className="relative flex items-center">
      <span className="flex h-6 items-center rounded-full border border-hairline/40 text-[12px] leading-4 text-ink-secondary">
        {context && (
          <button type="button" data-composer-meter-half="context" aria-haspopup="dialog" aria-expanded={shown === "context"}
            aria-label={t("composer.meter.contextAria", { percent: context.percent })} title={t("composer.meter.contextAria", { percent: context.percent })}
            onClick={() => setOpen((value) => (value === "context" ? null : "context"))}
            className={HALF}>
            <MeterRing percent={context.percent} />
            <span className={FIGURE}>{t("composer.meter.percent", { percent: context.percent })}</span>
          </button>
        )}
        {context && usage && <span aria-hidden="true" className="h-3 w-px shrink-0 bg-hairline/60" />}
        {usage && (
          <button type="button" data-composer-meter-half="usage" data-tone={tone} aria-haspopup="dialog" aria-expanded={shown === "usage"}
            aria-label={detail.line ?? t("composer.meter.usageAria", { percent: usage.percent })} title={detail.line ?? t("composer.meter.usageAria", { percent: usage.percent })}
            onClick={() => setOpen((value) => (value === "usage" ? null : "usage"))}
            className={cn(HALF, TONE[tone])}>
            <MeterRing percent={usage.percent} />
            <span className={FIGURE}>{t("composer.meter.percent", { percent: usage.percent })}</span>
          </button>
        )}
      </span>
      {shown === "context" && context && task?.usage && (
        <div role="dialog" aria-label={t("composer.meter.contextAria", { percent: context.percent })} data-composer-meter-detail="context" className={DETAIL}>
          <p className="px-2 py-1 tabular-nums">{contextDetail(task.usage)}</p>
          {own && (
            <button type="button" data-composer-meter-compact="" disabled={Boolean(bot.busy) || compact.pending}
              title={bot.busy ? t("contextWarning.busy") : undefined}
              onClick={() => compact.run(`/api/bots/${bot.id}/compact`, { threadId })}
              className={cn(MENU_ROW, "disabled:cursor-not-allowed disabled:opacity-50")}>
              {compact.pending ? t("contextWarning.compacting") : t("contextWarning.compactNow")}
            </button>
          )}
        </div>
      )}
      {shown === "usage" && usage && (
        <div role="menu" aria-label={t("composer.meter.usageAria", { percent: usage.percent })} data-composer-meter-detail="usage" className={DETAIL}>
          <p data-composer-meter-account="" className="truncate px-2 pt-1">{[accountRowName(usage.row), plan].filter(Boolean).join(" ")}</p>
          {windows.map(([key, label, window]) => {
            const when = formatResetDistance(window.resetsAt, now);
            return (
              <p key={key} data-composer-meter-window={key} className="flex items-baseline justify-between gap-4 px-2 py-0.5 text-[13px] tabular-nums">
                <span className="min-w-0 truncate text-ink-secondary">{when ? `${label} · ${t("planUsage.resetsIn", { when })}` : label}</span>
                <span className="shrink-0">{t("planUsage.used", { used: Math.round(Math.min(100, Math.max(0, window.usedPercent ?? 0))) })}</span>
              </p>
            );
          })}
          {detail.near && detail.line && <p data-composer-meter-limit="" className="px-2 py-1 tabular-nums">{detail.line}</p>}
          <EngineLimitActions detail={detail} botId={bot.id} onDone={() => setOpen(null)} />
        </div>
      )}
    </span>
  );
}
