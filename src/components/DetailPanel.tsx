// The right-hand detail panel a page opens instead of a modal (2026-11-01,
// "no modals", Grok Bot style): one object's details, its editor or a short
// list, beside the page that stays usable. Plan and the other lots:
// /Users/Workspace/plans/2026-11-01-sagax-ux-no-modals.md.
//
// - Where: App's right-edge slot (panel-slot.tsx), the same edge, look and
//   resize handle as the bot, person and group panels (`app-docked-panel`).
//   Outside the app (galleries, tests) it renders in place, so the page puts
//   it in its own row.
// - Non-modal: no scrim, no focus trap. Focus moves in when it opens (unless a
//   field inside took it) and goes back to the opener when it closes. Escape
//   inside closes it, unless something closer already used the key (a picker
//   closing its list, an editor asking about unsaved changes).
// - One panel: opening it closes the bot panel and a person panel, so the
//   window never shows two right panels.
// - Narrow window: it covers the page (`max-lg:absolute inset-0`), like the
//   other panels.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useStoreOptional } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { DockedPanelResizeHandle, useDockedPanelWidth, type DockedPanelBounds } from "./DockedPanelResize";
import { usePanelSlot } from "./panel-slot";

/** Its own remembered width: details read better wider than the bot panel. */
export const DETAIL_PANEL_BOUNDS: DockedPanelBounds = { key: "sagax.detailPanelWidth.v1", min: 360, max: 760, fallback: 480 };

export const DETAIL_PANEL_CLASS =
  "app-docked-panel detail-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!";

export type DetailPanelProps = {
  /** The panel's accessible name (also its region label). */
  label: string;
  /** The heading row's title; omit with `bare`. */
  title?: ReactNode;
  /** Before the title: a back chevron or a colour mark. */
  leading?: ReactNode;
  /** Between the title and Close. */
  actions?: ReactNode;
  /** A sticky row under the body (Save, Delete...). */
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  /** The content brings its own heading row (the routine editor): no header,
   * the body is a positioned box the content fills. */
  bare?: boolean;
  /** Close the bot and person panels when this one opens (default true). */
  exclusive?: boolean;
  bodyClassName?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | boolean | undefined;
};

export function DetailPanel({
  label,
  title,
  leading,
  actions,
  footer,
  onClose,
  closeLabel,
  bare = false,
  exclusive = true,
  bodyClassName,
  children,
  ...data
}: DetailPanelProps) {
  // Galleries and component tests render the panel with no app store.
  // Closing the other right panels only applies inside the app.
  const store = useStoreOptional();
  const slot = usePanelSlot();
  const rootRef = useRef<HTMLElement>(null);
  const width = useDockedPanelWidth(DETAIL_PANEL_BOUNDS);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // One right panel at a time.
  const otherPanelOpen = Boolean(store?.state.settingsOpen || store?.state.computerOpen || store?.state.personPanelId);
  useEffect(() => {
    if (!exclusive || !store || !otherPanelOpen) return;
    if (store.state.settingsOpen) store.dispatch({ type: "toggleSettings", open: false });
    if (store.state.computerOpen) store.dispatch({ type: "toggleComputer", open: false });
    if (store.state.personPanelId) store.dispatch({ type: "openPersonPanel", personId: null });
    // Only when it opens: a panel the person reopens afterwards stays.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const focusWasHere = !active || active === document.body || root.contains(active);
      if (focusWasHere && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const panel = (
    <aside
      ref={rootRef}
      role="region"
      aria-label={label}
      tabIndex={-1}
      data-detail-panel=""
      data-detail-panel-placement={slot ? "slot" : "inline"}
      {...data}
      style={{ width: width.width }}
      className={DETAIL_PANEL_CLASS}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }}
    >
      <DockedPanelResizeHandle label={t("computer.resizeAria")} panel={width} />
      {bare ? (
        <div data-detail-panel-body="" className={cn("relative min-h-0 flex-1", bodyClassName)}>{children}</div>
      ) : <>
        <div data-detail-panel-header="" className="content-topbar flex h-12 shrink-0 items-center gap-2 border-b border-hairline/40 pl-4 pr-2">
          {leading}
          <div className="min-w-0 flex-1">{typeof title === "string" ? <h2 className="truncate text-[16px] font-medium text-ink">{title}</h2> : title}</div>
          {actions}
          <button type="button" data-detail-panel-close="" onClick={() => onCloseRef.current()} aria-label={closeLabel ?? t("common.close")} title={closeLabel ?? t("common.close")} className={cn(CIRCLE_BUTTON, "shrink-0")}>
            <X size={17} strokeWidth={1.75} />
          </button>
        </div>
        {/* The card (Pulsatrix Light draws it under the navy top band): the
            footer sits inside it, on the card's own ground. */}
        <div className="content-card-body flex min-h-0 flex-1 flex-col">
          <div data-detail-panel-body="" className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", bodyClassName)}>{children}</div>
          {footer && <div data-detail-panel-footer="" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline/40 px-4 py-3">{footer}</div>}
        </div>
      </>}
    </aside>
  );
  return slot ? createPortal(panel, slot) : panel;
}
