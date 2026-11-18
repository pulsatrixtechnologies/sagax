// Undo of the bot's edit of a selected passage (the in-place ask,
// src/components/PageSelectionAsk.tsx). The bot answers the ask with a new
// version of the page, drawn in place as soon as it lands; this is the one
// line that says so, with Undo: the page goes back to the version the person
// asked about. A version the bot published (the page stays current) is
// replaced by that one again; a proposal is declined. The version stays in
// the page's list either way, nothing is lost.
import { Undo2, X } from "lucide-react";

import { t } from "@/lib/i18n";
import type { PublishedPageSummary } from "../../shared/published-pages";

/** The edit the person is shown: asked about `from`, answered by `to`. */
export interface PageEdit {
  from: number;
  to: number;
}

/** What undoing `edit` takes: publish `from` again when the bot's version is
 * the one published, else decline it when it is a proposal. Pure. */
export function undoEditPlan(page: Pick<PublishedPageSummary, "status" | "currentVersion" | "versions">, edit: PageEdit): { republish: boolean; decline: boolean } {
  const republish = page.status === "published" && page.currentVersion === edit.to;
  const decline = !republish && page.versions.find((entry) => entry.n === edit.to)?.state === "proposed";
  return { republish, decline };
}

/** The version a newer one from the conversation is drawn as, unless it is
 * one the person sent back (`skipped` and below). Pure. */
export function followedVersion(newer: number | null, skipped: number): number | null {
  return newer !== null && newer <= skipped ? null : newer;
}

export function PageEditUndo({ botName, busy, onUndo, onClose }: { botName: string; busy: boolean; onUndo(): void; onClose(): void }) {
  return (
    <div data-page-edit-undo="" role="status" aria-live="polite"
      className="pointer-events-auto absolute left-1/2 top-16 z-[3] flex max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center gap-1 rounded-full border border-hairline/40 bg-elevated/95 py-1 pl-3.5 pr-1 text-[13px] text-ink shadow-lg backdrop-blur">
      <span className="min-w-0 truncate pr-1.5">{t("pages.edit.applied", { name: botName })}</span>
      <button type="button" data-page-edit-undo-button="" disabled={busy} onClick={onUndo}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-accent hover:bg-hover disabled:opacity-40">
        <Undo2 size={14} aria-hidden="true" />{t("pages.edit.undo")}
      </button>
      <button type="button" data-page-edit-undo-close="" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}
        className="flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-hover">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
