// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372), now the usage
// pill (owner 2026-11-26, M-20261126-095, M-20261126-096, M-20261126-099,
// M-20261126-106, M-20261126-108, #5406). It replaces the orange limit dot of
// the chat bar. One pill: a small shape of three measures and a named
// percentage always in sight, read without a hover:
//   the week and the short session, as a sum of every account that can serve
//   the bot (never the serving account alone: one full account says nothing
//   alarming while others take the turns over);
//   the share of the model's context window this conversation uses.
// The text names the fuller account limit ("wk 44%", "5h 20%") and says
// "back <day> <hour>" only when every account is blocked. A click opens the
// detail: one row per account (UsageAccountsDetail), the context's tokens
// with "Compact now", and the limit's actions only when everything is
// blocked. The figures are read again when the detail opens and every minute
// while it stays open (D-20261125-014). Settings > Appearance chooses the
// shape, hides the pill, and hides the context indicator; with the pill
// hidden the context keeps its own small ring. A measure with no data is
// absent. In a narrow window the pill keeps its shape, without the words.
// With no plan window for the engine (an API key account, a plan read that
// failed), the pill still shows whenever the dot did: it draws from the
// engine's own limit, with its line and its actions (#5372 review).
// Never a banner above the chat. The rules are src/lib/usage-pill.ts and
// src/lib/composer-meter.ts; the pill itself is UsagePill.tsx, reusable
// outside the chat bar.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAutoModelStatus } from "@/lib/auto-model-preview";
import { contextHalf } from "@/lib/composer-meter";
import { engineName, useEngineLimits } from "@/lib/limit-resets";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { contextDetail } from "@/lib/usage";
import { rowsForEngine, weeklyLimitNotice } from "@/lib/usage-notices";
import { servingAccounts, usagePill, type UsageAccount } from "@/lib/usage-pill";
import { contextIndicator, usagePillInBar, usagePillShape, type UsagePillShape } from "@/lib/usage-pill-preferences";
import type { Bot } from "@/state/store";
import { usePlanRows } from "./ChatUsageNotices";
import { useCompact } from "./ContextWarning";
import { EngineLimitActions, useEngineLimitDetail } from "./LimitResetContinue";
import type { PlanUsageViewProps } from "./PlanUsage";
import { UsageAccountsDetail, type UsageAccountsDetailProps } from "./UsageAccountsDetail";
import { UsagePill, usagePillLabel } from "./UsagePill";
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

const HALF = "flex h-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 tabular-nums outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-hover";
/** The words fold away in a narrow window: the shape stays. */
const FIGURE = "@max-[22rem]/composer:hidden";
const DETAIL = cn(MENU_SURFACE, MENU_FIT_ROW, "absolute bottom-full right-0 z-40 mb-1.5 max-w-[min(320px,calc(100vw-16px))]");
/** The usage detail holds the accounts' table: a name, two windows, a return. */
const USAGE_DETAIL = "w-[min(520px,calc(100vw-16px))] max-w-none";

export type MeterHalf = "context" | "usage";

export interface ComposerMeterViewProps {
  /** Absent: no context measure. `detail`: "Context 84k (42% of 200k)". */
  context?: { percent: number; detail: string | null };
  /** Absent, or with no account: no usage pill. */
  usage?: {
    /** Every account that can serve the bot (servingAccounts). */
    accounts: readonly UsageAccount[];
    /** The accounts' star (the plan the account menu's Usage row shows). */
    favorite?: PlanUsageViewProps["favorite"];
    /** The engine's own limit sentence, when its figure comes from the limit
     * report and not from a plan window. */
    line?: string | null;
  };
  /** The person's choices (Settings > Appearance): the pill in the message
   * bar, its shape, the context indicator. Absent: shown, circles, shown. */
  pill?: boolean;
  shape?: UsagePillShape;
  contextShown?: boolean;
  now?: number;
  /** The detail's actions, drawn by the owner: Compact now; the limit's
   * actions (shown only when every account is blocked). */
  contextActions?: ReactNode;
  usageActions?: (close: () => void) => ReactNode;
  /** A detail opened or closed (the owner reads its figures again). */
  onOpenChange?: (open: MeterHalf | null) => void;
  /** Tests and the gallery: render with a detail open, a fold open. */
  initialOpen?: MeterHalf | null;
  initialFolds?: UsageAccountsDetailProps["initialOpen"];
}

/** The pill and its details, without a store: every figure comes from its owner. */
export function ComposerMeterView({ context, usage, pill = true, shape = "circles", contextShown = true, now, contextActions, usageActions, onOpenChange, initialOpen = null, initialFolds }: ComposerMeterViewProps) {
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

  const measured = contextShown ? context : undefined;
  const values = pill && usage?.accounts.length ? usagePill({ accounts: usage.accounts, context: measured?.percent ?? null, now }) : null;
  // accounts with no figure and nothing blocked: nothing to say, no pill
  const usageShown = values && (values.named || values.blocked) ? values : null;
  // the context's own ring: only while the pill does not carry it
  const contextAlone = usageShown ? undefined : measured;
  if (!usageShown && !contextAlone) return null;
  const shown = open === "context" ? (contextAlone ? "context" : null) : open === "usage" ? (usageShown ? "usage" : null) : null;
  const contextAria = measured ? t("composer.meter.contextAria", { percent: measured.percent }) : "";
  const usageAria = usageShown ? t("usagePill.aria", { text: usagePillLabel(usageShown, Boolean(measured)) }) : "";
  return (
    <span ref={rootRef} data-composer-meter="" role="group" aria-label={t("composer.meter.aria")} className="relative flex items-center">
      <span className="flex h-6 items-center rounded-full border border-hairline/40 text-[12px] leading-4 text-ink-secondary">
        {contextAlone && (
          <button type="button" data-composer-meter-half="context" aria-haspopup="dialog" aria-expanded={shown === "context"}
            aria-label={contextAria} title={contextAria}
            onClick={() => setOpen(open === "context" ? null : "context")}
            className={HALF}>
            <MeterRing percent={contextAlone.percent} />
            <span className={FIGURE}>{t("composer.meter.percent", { percent: contextAlone.percent })}</span>
          </button>
        )}
        {usageShown && (
          <button type="button" data-composer-meter-half="usage" data-tone={usageShown.tone} aria-haspopup="dialog" aria-expanded={shown === "usage"}
            aria-label={usageAria} title={usageAria}
            onClick={() => setOpen(open === "usage" ? null : "usage")}
            className={HALF}>
            <UsagePill values={usageShown} shape={shape} showContext={Boolean(measured)} textClassName={FIGURE} />
          </button>
        )}
      </span>
      {shown === "context" && contextAlone && (
        <div role="dialog" aria-label={contextAria} data-composer-meter-detail="context" className={DETAIL}>
          {contextAlone.detail && <p className="px-2 py-1 tabular-nums">{contextAlone.detail}</p>}
          {contextActions}
        </div>
      )}
      {shown === "usage" && usageShown && usage && (
        <div role="dialog" aria-label={usageAria} data-composer-meter-detail="usage" className={cn(DETAIL, USAGE_DETAIL)}>
          <UsageAccountsDetail accounts={usage.accounts} favorite={usage.favorite} initialOpen={initialFolds} />
          {usage.line && <p data-composer-meter-limit="" className="px-2 py-1 tabular-nums">{usage.line}</p>}
          {measured && (measured.detail || contextActions) && (
            <div data-composer-meter-context="" className="flex min-h-8 items-center gap-2 border-t border-hairline/40 pt-1">
              {measured.detail && <p className="min-w-0 flex-1 truncate px-2 text-[13px] tabular-nums text-ink-secondary">{measured.detail}</p>}
              {contextActions && <span className="shrink-0">{contextActions}</span>}
            </div>
          )}
          {usageShown.blocked && usageActions?.(() => setOpen(null))}
        </div>
      )}
    </span>
  );
}

/** The meter of one conversation: its readings, from the store and the server. */
export function ComposerMeter({ bot, threadId }: { bot: Bot; threadId: string }) {
  const [open, setOpen] = useState<MeterHalf | null>(null);
  // counts the usage detail's openings: each one reads who can serve again
  const [reads, setReads] = useState(0);
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  const own = threadId === bot.threadId;
  const context = contextHalf(task?.usage, own ? bot.messages : []);

  // the engine this conversation really runs on (Auto resolved): the one marked as serving
  const selection = bot.modelSelection;
  const engine = (selection.auto === true ? task?.autoModel?.instanceId : undefined) ?? selection.instanceId;
  const limits = useEngineLimits();
  const limit = limits.find((candidate) => candidate.engine === engine);
  const rows = usePlanRows(open === "usage");
  // who can serve this conversation: the usage-limit takeover's own pool (no second verdict)
  const serves = useAutoModelStatus(bot.id, threadId, true, String(reads))?.serves;
  const accounts = servingAccounts({ rows, serves, engine, driver: limit?.driver, limits, engineName });
  const detail = useEngineLimitDetail({ limit, weekly: weeklyLimitNotice(rowsForEngine(rows, engine, limit?.driver)), botId: bot.id, threadId, messages: own ? bot.messages : undefined });
  // the serving engine has no plan window: its figure is its own limit's, said by its line
  const serving = accounts.find((account) => account.serving);
  const fromLimit = Boolean(serving && !serving.row && detail.near);
  const compact = useCompact();
  const favorite = useUsageFavorite();
  return (
    <ComposerMeterView
      context={context ? { percent: context.percent, detail: task?.usage ? contextDetail(task.usage) : null } : undefined}
      usage={accounts.length ? { accounts, favorite: { id: favorite, onToggle: toggleUsageFavorite }, line: fromLimit ? detail.line : null } : undefined}
      pill={usagePillInBar.use() === "on"}
      shape={usagePillShape.use()}
      contextShown={contextIndicator.use() === "on"}
      onOpenChange={(next) => {
        setOpen(next);
        if (next === "usage") setReads((count) => count + 1);
      }}
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
