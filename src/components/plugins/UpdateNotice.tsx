// A failed update, said calmly (#4504): the item's name, one sentence in the
// person's language (never the server's raw words), that the old version
// stays, a Retry and a close. Not a red bar.
import { CircleCheck, TriangleAlert, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { updateReasonKey, type AutoUpdatedLine, type UpdateFailure } from "@/lib/capability-updates";

export function UpdateNotice({ failure, onRetry, onClose, inline = false }: { failure: UpdateFailure; onRetry: () => void; onClose: () => void; /** under the row that failed, in the list's own width */ inline?: boolean }) {
  return (
    <div role="status" data-update-failure={failure.key}
      data-update-failure-row={inline ? "" : undefined}
      className={cn("flex items-start gap-2.5 rounded-xl border-[0.5px] border-ink/[0.1] bg-card px-3 py-2.5 text-[13px] leading-[18px] text-ink", inline ? "mb-2 mt-0.5" : "mx-6 mt-2 sm:mx-8")}>
      <TriangleAlert size={16} className="mt-px shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium" data-update-failure-name="">{failure.name}</span>
        <span className="text-ink-secondary"><span aria-hidden="true"> {"\u00b7"}</span> {t(failure.unknown ? "connectApps.updates.reason.uncheckable" : updateReasonKey(failure.error))} {t("connectApps.updates.oldStays")}</span>
      </span>
      <button type="button" data-update-retry="" onClick={onRetry} className="shrink-0 rounded-full px-2.5 py-0.5 text-[13px] text-ink hover:bg-ink/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">
        {t("connectApps.updates.retry")}
      </button>
      <button type="button" data-update-dismiss="" onClick={onClose} aria-label={t("connectApps.updates.dismiss")} title={t("connectApps.updates.dismiss")}
        className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A plugin the app brought up to date by itself, said in one calm line: its
 * name, from and to, and that its routines follow it. */
export function AutoUpdatedNotice({ line, onClose }: { line: AutoUpdatedLine; onClose: () => void }) {
  return (
    <div role="status" data-auto-updated={line.name}
      className="mx-6 mt-2 flex items-start gap-2.5 rounded-xl border-[0.5px] border-ink/[0.1] bg-card px-3 py-2.5 text-[13px] leading-[18px] text-ink sm:mx-8">
      <CircleCheck size={16} className="mt-px shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{line.name}</span>
        <span className="text-ink-secondary"><span aria-hidden="true"> {"\u00b7"}</span> {line.from && line.to ? t("connectApps.updates.autoUpdatedFromTo", { from: line.from, to: line.to }) : t("connectApps.updates.autoUpdated")} {t("connectApps.updates.routinesFollow")}</span>
        {line.notes && <span className="mt-0.5 block text-[12px] text-ink-tertiary">{line.notes}</span>}
      </span>
      <button type="button" data-update-dismiss="" onClick={onClose} aria-label={t("connectApps.updates.dismiss")} title={t("connectApps.updates.dismiss")}
        className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
