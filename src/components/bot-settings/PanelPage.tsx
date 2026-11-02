// Pushed page inside the bot panel (2026-11-01, lot 3 of the no-modals
// plan). Same round back control, centred title and panel close as the
// routine page and the task detail. Escape goes back one level (onBack),
// never closes the whole panel. Covers the host with absolute inset-0;
// the host (BotSettingsDialog, persona editor, NewBotDialog) is relative.
import { ChevronLeft, PanelRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome, useMacInsetChrome } from "../DesktopCapabilities";
import { RoutineTitle } from "../routines/RoutineRowMenu";

export type PanelPageHeaderProps = {
  name: string;
  onBack: () => void;
  onClose: () => void;
  /** Double-click the title to rename (routines). */
  onRename?: (name: string) => void;
  backLabel?: string;
  closeLabel?: string;
};

/** The top bar of a pushed page: back, title, close the panel. */
export function PanelPageHeader({ name, onBack, onClose, onRename, backLabel, closeLabel }: PanelPageHeaderProps) {
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  return <>
    {(macInset || browser) && <div className="content-topbar-strip" />}
    <div data-panel-page-header data-routine-detail-header className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
      <button type="button" aria-label={backLabel ?? t("botPanel.routines.back")} onClick={onBack} className={CIRCLE_BUTTON}><ChevronLeft size={18} strokeWidth={1.75} /></button>
      {onRename
        ? <span className="absolute inset-x-14 flex justify-center"><RoutineTitle name={name} editable onRename={onRename} className="truncate text-center text-[14px] font-semibold text-ink" /></span>
        : <span className="pointer-events-none absolute inset-x-14 truncate text-center text-[14px] font-semibold text-ink">{name}</span>}
      <button type="button" aria-label={closeLabel ?? t("botPanel.routines.close")} title={closeLabel ?? t("botPanel.routines.close")} onClick={onClose} className={CIRCLE_BUTTON}><PanelRight size={18} strokeWidth={1.75} /></button>
    </div>
  </>;
}

/** Alias kept for callers that already import RoutineDetailHeader. */
export { PanelPageHeader as RoutineDetailHeader };

export type PanelPageProps = {
  name: string;
  onBack: () => void;
  onClose: () => void;
  onRename?: (name: string) => void;
  backLabel?: string;
  closeLabel?: string;
  /** Sticky footer (Save, Discard...). */
  footer?: ReactNode;
  /** Focus target when the page opens; defaults to the page root. */
  autoFocus?: boolean;
  bodyClassName?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | boolean | undefined;
};

/** A page that covers its relative host. Escape calls onBack. */
export function PanelPage({
  name,
  onBack,
  onClose,
  onRename,
  backLabel,
  closeLabel,
  footer,
  autoFocus = true,
  bodyClassName,
  children,
  ...data
}: PanelPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!autoFocus) return;
    const root = rootRef.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }, [autoFocus, name]);

  return (
    <div
      ref={rootRef}
      data-panel-page=""
      role="dialog"
      aria-modal="false"
      aria-label={name}
      tabIndex={-1}
      {...data}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onBackRef.current();
      }}
      className="absolute inset-0 z-20 flex flex-col bg-panel outline-none"
    >
      <PanelPageHeader name={name} onBack={onBack} onClose={onClose} onRename={onRename} backLabel={backLabel} closeLabel={closeLabel} />
      <div data-panel-page-body="" className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", bodyClassName)}>{children}</div>
      {footer ? <div data-panel-page-footer="" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline/40 px-3 py-3">{footer}</div> : null}
    </div>
  );
}
