import type { RefObject } from "react";
import { t } from "@/lib/i18n";
import { SIDEBAR_RAIL_WIDTH, type SidebarDensity } from "@/lib/sidebar-preferences";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH_KEY } from "./helpers";

export function SidebarResizeHandle({
  autoRail,
  density,
  sidebarWidth,
  setSidebarWidth,
  sidebarResizing,
  setSidebarResizing,
  sidebarResize,
  setSidebarCollapsed,
  resizeSidebar,
}: {
  autoRail: boolean;
  density: SidebarDensity;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  sidebarResizing: boolean;
  setSidebarResizing: (value: boolean) => void;
  sidebarResize: RefObject<{ x: number; width: number; current: number; collapsed: boolean } | null>;
  setSidebarCollapsed: (collapsed: boolean) => void;
  resizeSidebar: (clientX: number) => void;
}) {
  if (autoRail) return null;
  // The edge: drag to resize, narrower than the snap width to collapse
  // to the rail and back out of it to expand; double-click toggles.
  // Invisible at rest (the aside's hairline border is the edge); a 2px
  // line shows on hover, drag and keyboard focus (`.app-resize-handle`).
  // Not on the automatic rail: there the window's width decides, and
  // the person's own width and density wait for a wider window.
  return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("sidebar.resize")}
        aria-description={t("sidebar.compact.edgeHint")}
        aria-valuemin={SIDEBAR_RAIL_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={density === "icons" ? SIDEBAR_RAIL_WIDTH : sidebarWidth}
        tabIndex={0}
        data-resizing={sidebarResizing || undefined}
        onPointerDown={(event) => {
          const collapsed = density === "icons";
          const width = collapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth;
          sidebarResize.current = { x: event.clientX, width, current: sidebarWidth, collapsed };
          setSidebarResizing(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => resizeSidebar(event.clientX)}
        onPointerUp={(event) => {
          const from = sidebarResize.current;
          if (from && !from.collapsed) {
            try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(from.current)); } catch { /* session only */ }
          }
          sidebarResize.current = null;
          setSidebarResizing(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          sidebarResize.current = null;
          setSidebarResizing(false);
        }}
        onDoubleClick={() => setSidebarCollapsed(density !== "icons")}
        onKeyDown={(event) => {
          // Enter toggles the compact sidebar (the icons rail), as a
          // window splitter does, like the double-click.
          if (event.key === "Enter") {
            event.preventDefault();
            setSidebarCollapsed(density !== "icons");
            return;
          }
          const delta = event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0;
          if (!delta) return;
          event.preventDefault();
          if (density === "icons") {
            if (delta > 0) setSidebarCollapsed(false);
            return;
          }
          if (delta < 0 && sidebarWidth <= SIDEBAR_MIN_WIDTH) {
            setSidebarCollapsed(true);
            return;
          }
          const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth + delta));
          setSidebarWidth(next);
          try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next)); } catch { /* session only */ }
        }}
        className="app-resize-handle -right-[3px]"
      />
  );
}
