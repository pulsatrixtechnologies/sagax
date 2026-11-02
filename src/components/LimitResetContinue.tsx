import { useState } from "react";
import { Hourglass, X } from "lucide-react";

import { t } from "@/lib/i18n";
import { limitLine, nearLimit, resetTime, useEngineLimits } from "@/lib/limit-resets";
import type { Routine } from "@/lib/routines";
import { dismissNotice, noticeDismissed } from "@/lib/usage-notices";
import { api, useStore } from "@/state/store";

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

/** Dismissal key for one engine limit event. A new resetsAt (or a newly blocked
 * window) is a new event, so the banner comes back after a prior dismiss. */
export function engineLimitNoticeKey(limit: { engine: string; blocked: boolean; resetsAt: number | null }): string {
  return `engine-limit:${limit.engine}:${limit.blocked ? "blocked" : "near"}:${limit.resetsAt ?? "-"}`;
}

/** Full-width dismissible banner above the conversation when this bot's engine
 * is near or at its usage limit. Same shell as the other chat banners. */
export function EngineLimitNotice({
  engine,
  botId,
  threadId,
}: {
  engine: string | undefined;
  botId?: string;
  threadId?: string;
}) {
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  const continueAt = useLimitResetContinue(botId, threadId, limit?.resetsAt ?? undefined);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!limit || !nearLimit(limit)) return null;
  const key = engineLimitNoticeKey(limit);
  if (dismissed === key || noticeDismissed(key)) return null;
  return (
    <div className="w-full px-5">
      <div
        role="status"
        data-testid="engine-limit-notice"
        data-notice="engine-limit"
        title={t("limits.chatHint")}
        className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning"
      >
        <Hourglass size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1 break-words">
          <span className="tabular-nums text-ink">{limitLine(limit)}</span>
          {continueAt && (
            <>
              {" "}
              <button
                type="button"
                data-testid="engine-limit-continue"
                onClick={continueAt.onClick}
                className="underline hover:no-underline"
              >
                {continueAt.label}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            dismissNotice(key);
            setDismissed(key);
          }}
          aria-label={t("limits.dismiss")}
          title={t("limits.dismiss")}
          className="shrink-0 rounded p-0.5 hover:bg-warning/15"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
