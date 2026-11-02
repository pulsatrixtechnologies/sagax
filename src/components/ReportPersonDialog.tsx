// Report a message another person wrote (App Store guideline 1.2,
// src/lib/moderation.ts): a reason, an optional note, then Send. The report
// goes to the organization's admins (the server's owner on a solo server)
// with the message's words. Once sent, the person may also block the author.
// Anchored popover (lot 6): two fields, hung off the report menu control.
import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { REPORT_REASONS, blockPerson, reportMessage, type ReportReason } from "@/lib/moderation";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { FIELD, GROUP_CARD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export function ReportPersonDialog({ threadId, messageId, author, blocked, onClose, anchorRef, open = true }: {
  threadId: string;
  messageId: string;
  author: { id: string; name: string };
  /** already blocked: no "Block" offer after sending */
  blocked: boolean;
  onClose: () => void;
  /** The report menu control that opened this popover. */
  anchorRef: RefObject<HTMLElement | null>;
  open?: boolean;
}) {
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"edit" | "sending" | "sent" | "blocked">("edit");
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(open, dismissRoot, onClose);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusSoon = () => first.current?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSoon);
    else focusSoon();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await reportMessage({ threadId, messageId, reason, note });
      setState("sent");
    } catch (failure) {
      setError(readableError(failure));
      setState("edit");
    }
  };
  const block = async () => {
    try {
      await blockPerson(author);
      setState("blocked");
    } catch (failure) {
      setError(readableError(failure));
    }
  };

  if (!open) return null;

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      align="end"
      gap={8}
      maxHeight={420}
      role="dialog"
      aria-labelledby="report-person-title"
      data-report-dialog=""
      className="popover-surface flex w-[min(360px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated text-ink shadow-2xl shadow-black/40"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-hairline/40 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 id="report-person-title" className="text-[13px] font-semibold text-ink">{t("moderation.report.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-4 text-ink-secondary">{t("moderation.report.subtitle", { name: author.name })}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover">
          <X size={16} className="pointer-events-none" />
        </button>
      </header>
      {state === "sent" || state === "blocked" ? (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
            <p role="status" className="text-[13px] leading-[19px] text-ink">{t("moderation.report.sent")}</p>
            {state === "blocked" && <p className="text-[13px] leading-[19px] text-ink-secondary">{t("moderation.block.done", { name: author.name })}</p>}
            {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-hairline/40 px-3.5 py-2.5">
            {state === "sent" && !blocked && <button type="button" onClick={() => void block()} className={PILL} data-report-block="">{t("moderation.block.action", { name: author.name })}</button>}
            <button type="button" onClick={onClose} className={PRIMARY_PILL}>{t("moderation.done")}</button>
          </footer>
        </>
      ) : (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
            <div className={cn(GROUP_CARD, "flex flex-col gap-3 p-3")}>
              <label className="flex flex-col gap-1 text-[13px] text-ink">
                {t("moderation.report.reason")}
                <select ref={first} value={reason} onChange={(event) => setReason(event.target.value as ReportReason)} className={FIELD} data-report-reason="">
                  {REPORT_REASONS.map((id) => <option key={id} value={id}>{t(`moderation.reason.${id}`)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-ink">
                {t("moderation.report.note")}
                <textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder={t("moderation.report.notePlaceholder")} className={cn(FIELD, "h-auto py-2")} />
              </label>
            </div>
            <p className="text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.report.who")}</p>
            {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-hairline/40 px-3.5 py-2.5">
            <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={state === "sending"} className={PRIMARY_PILL} data-report-send="">{t("moderation.report.send")}</button>
          </footer>
        </form>
      )}
    </AnchoredPopover>
  );
}
