import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { DANGER_PILL, DIALOG, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

export type ConfirmTone = "danger" | "neutral";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Consequence in plain words. Omit when the title alone is enough. */
  body?: string;
  confirmLabel: string;
  /** "danger" for irreversible actions (filled red button, red frame);
   * "neutral" for reversible ones like archiving. */
  tone?: ConfirmTone;
  icon?: ReactNode;
  /** Optional controls between the body and the buttons (checkbox, list,
   * reason field). Keep them short: this stays a confirmation, not a form. */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  /** Disable only the confirm action (Cancel stays available). */
  confirmDisabled?: boolean;
  /** Stable fallback when a context-menu trigger disappears before opening. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Opened from the header's thread picker: marks the dialog as one of its
   * overlays (data-thread-overlay) so working in it keeps the picker open. */
  threadOverlay?: boolean;
}

/** In-app replacement for window.confirm, following the FullAccessWarning
 * pattern: backdrop, focus trap, Escape cancels, Cancel focused by default so
 * a stray Enter never confirms. Portalled to <body> because the sidebar
 * translates below md and would otherwise become the containing block. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onCancel, returnFocusRef } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAction.current();
        return;
      }
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!controls?.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = opener?.isConnected && opener !== document.body ? opener : returnFocusRef?.current;
      target?.focus();
    };
  }, [open, returnFocusRef]);

  // Capture the opener above before moving focus on open or pending changes.
  useEffect(() => {
    if (!open) return;
    if (props.pending) dialogRef.current?.focus();
    else cancelRef.current?.focus();
  }, [open, props.pending]);

  if (!open) return null;

  const layer = (
    <div
      className={DIALOG.backdrop}
      data-thread-overlay={props.threadOverlay ? "" : undefined}
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <ConfirmDialogCard ref={dialogRef} cancelRef={cancelRef} {...props} />
    </div>
  );
  // Portal when a real document body exists (sidebar translate). Static
  // markup tests and early SSR keep the layer inline.
  if (typeof document === "undefined" || !document.body) return layer;
  return createPortal(layer, document.body);
}

/** The card alone, without the portal or key handling — exported so it can be
 * rendered to static markup in tests. Drawn like Settings (2026-10-16): the
 * title and one grey line, then the pills at the right, the action red when
 * it erases. */
export function ConfirmDialogCard({
  ref,
  cancelRef,
  title,
  body = "",
  confirmLabel,
  tone = "danger",
  icon,
  extra,
  onCancel,
  onConfirm,
  pending = false,
  confirmDisabled = false,
}: ConfirmDialogProps & {
  ref?: React.Ref<HTMLDivElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const danger = tone === "danger";
  const describedBy = body ? "confirm-dialog-body" : undefined;
  return (
    <div
      ref={ref}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-busy={pending}
      aria-labelledby="confirm-dialog-title"
      aria-describedby={describedBy}
      data-confirm-tone={tone}
      className={cn(DIALOG.frame, DIALOG.width.md)}
    >
      <div className="flex items-start gap-2.5 px-5 pb-4 pt-5">
        {icon && <span aria-hidden="true" className={cn("mt-[3px] shrink-0", danger ? "text-danger" : "text-ink-secondary")}>{icon}</span>}
        <div className="min-w-0 flex-1">
          <h2 id="confirm-dialog-title" className={DIALOG.title}>
            {title}
          </h2>
          {body ? (
            <p id="confirm-dialog-body" className="mt-1 text-[13px] leading-[19px] text-ink-secondary">
              {body}
            </p>
          ) : null}
          {extra ? <div className="mt-3">{extra}</div> : null}
        </div>
      </div>
      <div className={DIALOG.footer}>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={PILL}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending || confirmDisabled}
          data-confirm-action=""
          className={cn(danger ? DANGER_PILL : PRIMARY_PILL, "min-h-[44px] md:min-h-0")}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
