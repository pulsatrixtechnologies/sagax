import { ChevronRight } from "lucide-react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { trackInputModality } from "@/lib/input-modality";
import {
  sidebarAttentionLabel,
  type SidebarSectionAttention,
} from "@/lib/sidebar-attention";

export function SidebarSectionHeader({
  name,
  count,
  collapsed,
  attention,
  alert,
  onToggle,
  reorderable,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onContextMenu,
}: {
  name: string;
  /** how many rows the group holds: shown while it is folded (#4093) */
  count?: number;
  collapsed: boolean;
  attention?: SidebarSectionAttention;
  alert?: boolean;
  onToggle?: () => void;
  reorderable: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const attentionLabel = attention ? sidebarAttentionLabel(attention) : "";
  // a click must not draw the focus frame on the header; Tab or an arrow
  // key does (2026-10-15): the app's one rule, src/lib/input-modality.ts
  trackInputModality();
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!reorderable || !event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove?.(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove?.(1);
    }
  };

  const marks = (
    <>
      {attention && attention.waiting > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-warning/15 px-1 text-center text-[9px] font-semibold leading-4 text-warning"
        >
          {attention.waiting}
        </span>
      )}
      {attention && attention.unread > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-accent/15 px-1 text-center text-[9px] font-semibold leading-4 text-accent"
        >
          {attention.unread}
        </span>
      )}
      {attention && attention.working > 0 && (
        <span aria-hidden="true" className="flex size-4 items-center justify-center">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
        </span>
      )}
      {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
      {alert && (
        <>
          <span data-testid="section-alert" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          <span className="sr-only">{t("computer.routines.needsYou")}</span>
        </>
      )}
    </>
  );

  return (
    <div
      className={cn("pb-0.5", dragging && "opacity-40")}
      data-section={name}
      tabIndex={onContextMenu ? -1 : undefined}
      onContextMenu={onContextMenu}
      draggable={reorderable || undefined}
      onDragStart={reorderable ? onDragStart : undefined}
      onDragEnd={reorderable ? onDragEnd : undefined}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={onHeaderKeyDown}
          data-sidebar-section-header=""
          aria-expanded={!collapsed}
          aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={
            reorderable
              ? collapsed
                ? t("sidebar.section.expandReorder", { name })
                : t("sidebar.section.collapseReorder", { name })
              : collapsed
                ? t("sidebar.section.expand", { name })
                : t("sidebar.section.collapse", { name })
          }
          // The reference's group title (#4093): the name, sentence case,
          // 13/18 regular in the secondary ink (its size with 15px chat
          // prose, the owner's configuration), 30px tall, then at the
          // row's end one 16px seat: the count of rows while folded (so a
          // folded group never reads as empty, #1664), the chevron in its
          // place on hover or keyboard focus (pointing down while open),
          // then this app's attention marks. A touch screen has no hover:
          // there the chevron always shows the fold state (#4131).
          className="group/section flex h-[30px] w-full min-w-0 items-center gap-1.5 rounded-md px-2 pb-1.5 pt-2 text-left text-sidebar-ink-secondary transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
        >
          <span className="sidebar-section-label min-w-0 flex-1 truncate text-[13px] font-normal leading-[18px]">{name}</span>
          {marks}
          <span className="relative flex h-4 min-w-4 shrink-0 items-center justify-center">
            {collapsed && count !== undefined && count > 0 && (
              <span data-section-count="" aria-hidden="true" className="text-[13px] leading-[18px] tabular-nums transition-opacity duration-fast group-hover/section:opacity-0 group-focus-visible/section:opacity-0 touch:opacity-0">
                {count}
              </span>
            )}
            <ChevronRight
              size={14}
              aria-hidden="true"
              data-section-chevron=""
              className={cn(
                "absolute -mr-px opacity-0 transition-[opacity,transform] duration-fast group-hover/section:opacity-100 group-focus-visible/section:opacity-100 touch:opacity-100",
                !collapsed && "rotate-90",
              )}
            />
          </span>
        </button>
      ) : (
        <div className="flex h-[30px] min-w-0 items-center gap-2 px-2 pb-1.5 pt-2">
          <span className="sidebar-section-label min-w-0 flex-1 truncate text-[13px] font-normal leading-[18px] text-sidebar-ink-secondary">{name}</span>
          {marks}
        </div>
      )}
    </div>
  );
}
