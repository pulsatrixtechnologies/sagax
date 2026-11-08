import { useState } from "react";

import { t } from "@/lib/i18n";
import { limitLine, nearLimit, resetTime, useEngineLimits } from "@/lib/limit-resets";
import type { Routine } from "@/lib/routines";
import { api, useStore } from "@/state/store";
import { useWeeklyLimit } from "./ChatUsageNotices";

/** The stopped turn's "Continue at 3:40 PM when your limit resets": one click sets up a one-time automation in this
 * conversation that picks up where it stopped. Undefined when there is nothing to offer. */
export function useLimitResetContinue(botId: string | undefined, threadId: string | undefined, resetsAt: number | undefined) {
  const { dispatch } = useStore();
  const [state, setState] = useState<"idle" | "working" | "set">("idle");
  if (!botId || !threadId || !resetsAt || resetsAt <= Date.now() || state === "set") return undefined;
  return {
    label: t("chat.limit.continueAt", { time: resetTime(resetsAt) }),
    onClick: () => {
      if (state === "working") return;
      setState("working");
      void api<{ routine?: Routine }>("/api/limit-resets/continue", { method: "POST", body: JSON.stringify({ botId, threadId }) })
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

/** The quiet limit indicator beside the model picker (JC 2026-11-08: no banner
 * above the chat, ever). A small dot, warning near the limit and danger at it,
 * with the usage line as its tooltip; a click opens a small menu holding the
 * line, the weekly window and "Continue at ...". Nothing renders when the
 * engine is nowhere near its limit. */
export function EngineLimitIndicator({
  engine,
  driver,
  botId,
  threadId,
}: {
  engine: string | undefined;
  driver?: string;
  botId?: string;
  threadId?: string;
}) {
  const { dispatch } = useStore();
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  const weekly = useWeeklyLimit(engine, driver ?? limit?.driver);
  const continueAt = useLimitResetContinue(botId, threadId, limit?.resetsAt ?? undefined);
  const [open, setOpen] = useState(false);
  const near = Boolean(limit && nearLimit(limit));
  if (!near && !weekly) return null;
  const line = near && limit ? limitLine(limit) : t(weekly!.percent >= 100 ? "chat.notice.weekly.reached" : "chat.notice.weekly", { percent: weekly!.percent, name: weekly!.name });
  const hard = Boolean(limit?.blocked) || (!near && (weekly?.percent ?? 0) >= 100);
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
          className="absolute bottom-full right-0 mb-1.5 w-max max-w-[280px] rounded-xl border border-popover-hairline bg-popover p-2 text-[13px] text-popover-ink shadow-2xl shadow-black/50"
        >
          <p className="px-1 py-0.5 tabular-nums">{line}</p>
          {near && weekly && <p className="px-1 py-0.5 text-ink-secondary">{t(weekly.percent >= 100 ? "chat.notice.weekly.reached" : "chat.notice.weekly", { percent: weekly.percent, name: weekly.name })}</p>}
          {near && continueAt && (
            <button
              type="button"
              role="menuitem"
              data-testid="engine-limit-continue"
              onClick={() => { continueAt.onClick(); setOpen(false); }}
              className="mt-1 w-full rounded-lg px-1 py-1 text-left hover:bg-raised"
            >
              {continueAt.label}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); dispatch({ type: "toggleAppSettings", open: true, section: "usage" }); }}
            className="w-full rounded-lg px-1 py-1 text-left text-ink-secondary hover:bg-raised"
          >
            {t("chat.notice.weekly.more")}
          </button>
        </div>
      )}
    </span>
  );
}
