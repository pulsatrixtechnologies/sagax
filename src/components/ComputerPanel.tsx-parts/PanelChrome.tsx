import type { ReactNode, RefObject } from "react";
import { ChevronLeft, PanelRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { t } from "@/lib/i18n";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./types";

export function ComputerPanelChrome(props: {
  padClass: string | undefined;
  panelWidth: number;
  separatorRef: RefObject<HTMLDivElement | null>;
  separatorWidth: number | null;
  onSeparatorKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  onBack: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const {
    padClass, panelWidth, separatorRef, separatorWidth,
    onSeparatorKeyDown, onResizeStart, onResizeMove, onResizeEnd,
    onBack, onClose, children,
  } = props;

  return (
    <aside
      className={cn(
        "animate-panel-in relative flex h-full shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-panel",
        // Below md (a phone on remote access) the stored width would push the
        // chat to zero and run off the edge, so cover the window like the
        // settings and inspector panels. `!` beats the inline width.
        "max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full!",
      )}
      style={{ width: panelWidth }}
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("computer.resizeAria")}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={separatorWidth ?? undefined}
        tabIndex={0}
        onKeyDown={onSeparatorKeyDown}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="app-resize-handle -left-[3px] max-md:hidden"
      />
      {/* Header */}
      <div className={cn("relative flex h-11 shrink-0 items-center justify-center px-12", padClass)}>
        <button
          type="button"
          onClick={onBack}
          aria-label={t("computer.back")}
          title={t("computer.back")}
          className="absolute left-2.5 flex size-8 items-center justify-center rounded-full bg-raised text-ink-secondary hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="truncate text-[14px] font-semibold text-ink">{t("botPanel.tab.computer")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("computer.close")}
          title={t("computer.close")}
          className={cn(CIRCLE_BUTTON, "absolute right-2.5")}
        >
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>
      {children}
    </aside>
  );
}
