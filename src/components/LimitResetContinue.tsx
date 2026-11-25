import { useState } from "react";

import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE } from "@/components/menu-look";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { limitLine, nearLimit, releaseLimit, resetTime, useEngineLimits, type EngineLimit } from "@/lib/limit-resets";
import type { WeeklyNotice } from "@/lib/usage-notices";
import { openModelWindow } from "@/lib/model-window";
import type { Routine } from "@/lib/routines";
import { api, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { limitMessageHeld, type LimitLineRow } from "../../shared/limit-failover";
import { useWeeklyLimit } from "./ChatUsageNotices";

/** The stopped turn's "Continue at 3:40 PM when your limit resets": one click sets up a one-time automation in this
 * conversation that picks up where it stopped. Undefined when there is nothing to offer. */
export function useLimitResetContinue(botId: string | undefined, threadId: string | undefined, resetsAt: number | undefined) {
  const dispatch = useStoreDispatch();
  const [state, setState] = useState<"idle" | "working" | "set">("idle");
  if (!botId || !threadId || !resetsAt || resetsAt <= Date.now() || state === "set") return undefined;
  return {
    label: t("chat.limit.continueAt", { time: resetTime(resetsAt) }),
    onClick: () => {
      if (state === "working") return;
      setState("working");
      // #3552: a server that already holds the message answers that plan ({ held }) and makes no second run.
      void api<{ routine?: Routine; held?: { at: number } }>("/api/limit-resets/continue", { method: "POST", body: JSON.stringify({ botId, threadId }) })
        .then((response) => {
          if (response.routine) dispatch({ type: "routinePatched", routine: response.routine });
          setState("set");
        })
        .catch((cause) => {
          setState("idle");
          dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
        });
    },
  };
}

/** What a limit detail says and offers for one engine and one conversation:
 * the usage line, the weekly notice, whether the limit is near or reached,
 * and "Continue at ..." (only at the limit with nothing held, #3552). Read by
 * the chat bar's usage meter and by the limit dot. */
export function useEngineLimitDetail({ limit, weekly, botId, threadId, messages }: {
  limit: EngineLimit | undefined;
  weekly: WeeklyNotice | null;
  botId?: string;
  threadId?: string;
  /** The transcript of the conversation shown (`threadId`), when the caller
   * has it: a task, a side chat or a preview is not the bot's main thread. */
  messages?: readonly LimitLineRow[];
}) {
  // #3552: "held" is read for the conversation shown, whichever thread it is.
  // #3624: read as one answer, so another bot's frame renders nothing here
  const held = useStoreSelector((state) => limitMessageHeld(messages ?? shownMessages(state.bots, botId, threadId)));
  const continueAt = useLimitResetContinue(botId, threadId, limit?.blocked && !held ? limit.resetsAt ?? undefined : undefined);
  const near = Boolean(limit && nearLimit(limit));
  const weeklyLine = weekly ? t(weekly.percent >= 100 ? "chat.notice.weekly.reached" : "chat.notice.weekly", { percent: weekly.percent, name: weekly.name }) : null;
  const line = near && limit ? limitLine(limit) : weeklyLine;
  const hard = Boolean(limit?.blocked) || (!near && (weekly?.percent ?? 0) >= 100);
  return { limit, weekly, near, line, weeklyLine, hard, continueAt };
}

/** The actions of a limit detail: "Continue at ...", "Try again now",
 * "Switch engine" and "See usage", each as it always behaved. */
export function EngineLimitActions({ detail, botId, onDone }: {
  detail: ReturnType<typeof useEngineLimitDetail>;
  botId?: string;
  /** An action was taken: the detail closes. */
  onDone: () => void;
}) {
  const dispatch = useStoreDispatch();
  const { limit, near, continueAt } = detail;
  return (
    <>
      {near && continueAt && (
        <button
          type="button"
          role="menuitem"
          data-testid="engine-limit-continue"
          onClick={() => { continueAt.onClick(); onDone(); }}
          className={MENU_ROW}
        >
          {continueAt.label}
        </button>
      )}
      {limit?.held && (
        <button
          type="button"
          role="menuitem"
          data-testid="engine-limit-release"
          onClick={() => {
            onDone();
            void releaseLimit(limit.engine)
              .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
          }}
          className={MENU_ROW}
        >
          {t("chat.limit.tryAgainNow")}
        </button>
      )}
      {botId && (
        <button
          type="button"
          role="menuitem"
          data-testid="engine-limit-switch"
          onClick={() => { onDone(); openModelWindow(botId); }}
          className={MENU_ROW}
        >
          {t("sendBlock.switchEngine")}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        data-testid="engine-limit-usage"
        onClick={() => { onDone(); dispatch({ type: "toggleAppSettings", open: true, section: "usage" }); }}
        className={MENU_ROW}
      >
        {t("chat.notice.weekly.more")}
      </button>
    </>
  );
}

/** The quiet limit indicator beside a model picker outside the chat bar (JC
 * 2026-11-08: no banner above the chat, ever; M-20261125-070: the chat bar
 * itself shows the usage meter under the message box, ComposerMeter.tsx, and
 * no dot). A small dot, warning near the limit and danger at it, with the
 * usage line as its tooltip; a click opens a small menu holding the line,
 * the weekly window and the actions. Nothing renders when the engine is
 * nowhere near its limit. */
export function EngineLimitIndicator({
  engine,
  driver,
  botId,
  threadId,
  messages,
}: {
  engine: string | undefined;
  driver?: string;
  botId?: string;
  threadId?: string;
  messages?: readonly LimitLineRow[];
}) {
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  const weekly = useWeeklyLimit(engine, driver ?? limit?.driver);
  const detail = useEngineLimitDetail({ limit, weekly, botId, threadId, messages });
  const [open, setOpen] = useState(false);
  const { near, line, weeklyLine, hard } = detail;
  if (!line) return null;
  return (
    <span data-limit-indicator="" className="absolute -right-0.5 -top-0.5 z-10">
      <button
        type="button"
        data-testid="engine-limit-indicator"
        aria-label={line}
        aria-expanded={open}
        title={line}
        onClick={() => setOpen((value) => !value)}
        className={`block size-2.5 rounded-full ring-2 ring-app ${hard ? "bg-danger" : "bg-warning"}`}
      />
      {open && (
        <div
          role="menu"
          data-testid="engine-limit-menu"
          className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute bottom-full right-0 mb-1.5")}
        >
          <p className="px-2 py-1 tabular-nums">{line}</p>
          {near && weeklyLine && <p className="px-2 py-1 text-ink-secondary">{weeklyLine}</p>}
          <EngineLimitActions detail={detail} botId={botId} onDone={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}

/** The store's transcript of `threadId`: the bot's thread shown, or the
 * conversation a switch is previewing. */
function shownMessages(bots: readonly Bot[] | undefined, botId: string | undefined, threadId: string | undefined): readonly LimitLineRow[] {
  if (!botId || !threadId) return [];
  const bot = bots?.find((candidate) => candidate.id === botId);
  if (!bot) return [];
  if (bot.threadId === threadId) return bot.messages;
  return bot.switchPreview?.threadId === threadId ? bot.switchPreview.messages : [];
}
