// The nudge control in the composer of a person-to-person conversation or
// a group chat. Bots and bot rooms do not render it. The server decides
// whether this person may nudge, and whether five minutes have passed.
// While that wait is running the control is gray. The wait sentence is not
// written beside the icon: it appears only when the pointer is over the
// control. The button stays enabled in the DOM. A native disabled control
// swallows the hover, so the tooltip would never open.
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SECONDARY_CIRCLE } from "./ComposerControls";
import { onNudgeSent } from "@/lib/desktop-nudge";
import { nudgeWaitLabel } from "@/lib/nudge-wait";
import { ApiError, api } from "@/state/store";

/** `threadId`: a person conversation's thread the line goes to (the one on
 * screen), so a nudge behaves per thread like a message. */
export function NudgeButton({ principalId, groupId, name, threadId }: { principalId?: string; groupId?: string; name: string; threadId?: string }) {
  const token = (principalId || groupId || "").trim();
  const [wait, setWait] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cooling = until !== null && Date.now() < until;
  const action = t("nudge.action", { name });
  const tooltip = cooling && wait ? wait : hint ?? action;
  const tip = cooling && wait ? wait : hint;

  useEffect(() => {
    if (until === null) return;
    const refresh = () => {
      const left = until - Date.now();
      if (left <= 0) {
        setUntil(null);
        setWait(null);
        return;
      }
      setWait(nudgeWaitLabel(left));
    };
    refresh();
    const tick = window.setInterval(refresh, 15_000);
    const done = window.setTimeout(refresh, Math.max(0, until - Date.now()) + 20);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [until]);

  return (
    <NudgeButtonFace
      token={token}
      cooling={cooling}
      busy={busy}
      tooltip={tooltip}
      tip={tip}
      onClick={() => {
        if (busy || cooling || !token) return;
        setBusy(true);
        setHint(null);
        const body = principalId ? { principalId, ...(threadId ? { threadId } : {}) } : { groupId };
        void api("/api/nudges", { method: "POST", body: JSON.stringify(body) })
          // the sender's own window shakes and rings at once
          .then((sent) => { void onNudgeSent(sent); })
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 429) {
              const ms = error.body?.retryAfterMs;
              const left = typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
              setUntil(Date.now() + left);
              setWait(left > 0 ? nudgeWaitLabel(left) : error.message);
              return;
            }
            setHint(error instanceof Error && error.message ? error.message : t("nudge.failed"));
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function NudgeButtonFace({
  token,
  cooling,
  busy,
  tooltip,
  tip,
  onClick,
}: {
  token: string;
  cooling: boolean;
  busy: boolean;
  tooltip: string;
  tip: string | null;
  onClick: () => void;
}) {
  const tipId = `nudge-tip-${token.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <span className="group/nudge relative inline-flex">
      <button
        type="button"
        data-nudge={token}
        data-nudge-cooling={cooling ? "" : undefined}
        aria-disabled={busy || cooling || undefined}
        aria-label={tooltip}
        aria-describedby={tip ? tipId : undefined}
        title={tip ? undefined : tooltip}
        onClick={onClick}
        className={cn(
          SECONDARY_CIRCLE,
          cooling && "cursor-not-allowed opacity-40 hover:bg-ink/[0.06] hover:text-ink-tertiary",
        )}
      >
        <BellRing size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {tip && (
        <span
          id={tipId}
          role="tooltip"
          data-nudge-tooltip=""
          className="pointer-events-none absolute right-0 bottom-[calc(100%+6px)] z-30 whitespace-nowrap rounded-md bg-[#1c1c1e] px-2 py-1 text-[12px] leading-none text-white opacity-0 shadow-md ring-1 ring-white/15 group-hover/nudge:opacity-100 group-focus-within/nudge:opacity-100"
        >
          {tip}
        </span>
      )}
    </span>
  );
}
