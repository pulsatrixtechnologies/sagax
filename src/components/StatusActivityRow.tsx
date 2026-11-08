import { useEffect, useState } from "react";
import { Info, RefreshCw, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { dismissNotice, noticeDismissed } from "@/lib/usage-notices";
import { isHiddenStatusActivity, sandboxWakeElapsed, statusActivity } from "@/lib/activity-runs";
import type { Message } from "@/state/store";
import { CancelledTurnRow } from "./CancelledTurnRow";

/** An engine's own word about this conversation: automatic recovery moved it
 * to another engine, or the engine runs another model than the one saved.
 * Always shown, whatever Settings → Tool calls says. A stopped turn is the
 * quiet line, not this bordered notice. */
export function StatusActivityRow({ message, transcript, busy = false }: { message: Message; transcript?: readonly Message[]; busy?: boolean }) {
  // 2026-11-05 (JC): the person can close the notice; it stays closed
  const key = `status-activity:${message.id}`;
  const [closed, setClosed] = useState(() => noticeDismissed(key));
  // QA 0.8.66 F1: a cold start counts its seconds while the turn waits on it
  const [now, setNow] = useState(() => Date.now());
  const elapsed = transcript ? sandboxWakeElapsed(message, transcript, busy, now) : null;
  const ticking = elapsed !== null;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (closed || isHiddenStatusActivity(message)) return null;
  const status = elapsed !== null
    ? { kind: "notice" as const, text: t("chat.sandboxWakingElapsed", { seconds: String(elapsed) }) }
    : statusActivity(message);
  if (!status) return null;
  if (status.kind === "stopped") return <CancelledTurnRow />;
  const Icon = status.kind === "recovery" ? RefreshCw : Info;
  return (
    <div role="status" className="flex w-fit max-w-full items-start gap-2 rounded-xl border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
      <Icon size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{status.text}</span>
      <button
        type="button"
        aria-label={t("common.close")}
        title={t("common.close")}
        className="-mr-1 mt-px shrink-0 rounded p-0.5 text-ink-tertiary hover:bg-inset hover:text-ink-secondary"
        onClick={() => { dismissNotice(key); setClosed(true); }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
