import { useState } from "react";
import { Info, RefreshCw, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { dismissNotice, noticeDismissed } from "@/lib/usage-notices";
import { isHiddenStatusActivity, statusActivity } from "@/lib/activity-runs";
import type { Message } from "@/state/store";
import { CancelledTurnRow } from "./CancelledTurnRow";

/** An engine's own word about this conversation: automatic recovery moved it
 * to another engine, or the engine runs another model than the one saved.
 * Always shown, whatever Settings → Tool calls says. A stopped turn is the
 * quiet line, not this bordered notice. */
export function StatusActivityRow({ message }: { message: Message }) {
  // 2026-11-05 (JC): the person can close the notice; it stays closed
  const key = `status-activity:${message.id}`;
  const [closed, setClosed] = useState(() => noticeDismissed(key));
  if (closed || isHiddenStatusActivity(message)) return null;
  const status = statusActivity(message);
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
