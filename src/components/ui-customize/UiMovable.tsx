// Movable wrapper for customize mode (D-20261127-004, #5443).
// Grip handle, jiggle class, optional Hide, keyboard arrows within the zone.
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { EyeOff, GripVertical } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { isHideable } from "@/lib/ui-layout/registry";
import type { ZoneId } from "@/lib/ui-layout/types";
import { useUiCustomize } from "./UiCustomizeMode";

export function UiMovable({
  zoneId,
  id,
  label,
  className,
  children,
  /** When false, skip the Hide control even if the registry says hideable. */
  allowHide = true,
}: {
  zoneId: ZoneId;
  id: string;
  /** Accessible name; falls back to id. */
  label?: string;
  className?: string;
  children: ReactNode;
  allowHide?: boolean;
}) {
  const api = useUiCustomize();
  if (!api.active) return <span className={className}>{children}</span>;

  const grabbed = api.dragging?.zoneId === zoneId && api.dragging.id === id;
  const canHide = allowHide && isHideable(zoneId, id);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      api.nudge(zoneId, id, -1);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      api.nudge(zoneId, id, 1);
    }
  };

  const dragProps = {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      api.setDragging({ zoneId, id });
      event.dataTransfer.setData("text/sagax-ui-item", `${zoneId}:${id}`);
      event.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (event: DragEvent) => {
      if (!api.dragging || api.dragging.zoneId !== zoneId || api.dragging.id === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("text/sagax-ui-item") || "";
      // Payload is `${zoneId}:${componentId}`; componentId may itself contain ":".
      const prefix = `${zoneId}:`;
      const fullFrom = raw.startsWith(prefix)
        ? raw.slice(prefix.length)
        : (api.dragging?.zoneId === zoneId ? api.dragging.id : null);
      api.setDragging(null);
      if (!fullFrom || fullFrom === id) return;
      const toIndex = api.draft.zones[zoneId].order.indexOf(id);
      if (toIndex < 0) return;
      api.move(zoneId, fullFrom, toIndex);
    },
    onDragEnd: () => api.setDragging(null),
  };

  return (
    <span
      data-ui-movable={id}
      data-ui-zone={zoneId}
      tabIndex={0}
      role="button"
      aria-grabbed={grabbed ? "true" : "false"}
      aria-label={label ?? id}
      className={cn(
        "ui-movable composer-movable inline-flex items-center rounded-full outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      onKeyDown={onKeyDown}
      {...dragProps}
    >
      <GripVertical
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        data-ui-movable-handle=""
        data-composer-movable-handle=""
        className="ui-movable-handle composer-movable-handle shrink-0"
      />
      {children}
      {canHide ? (
        <button
          type="button"
          data-ui-movable-hide={id}
          aria-label={t("ui.customize.hide")}
          title={t("ui.customize.hide")}
          className="ui-movable-hide ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:bg-menu-hover hover:text-ink"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            api.hide(zoneId, id);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <EyeOff size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
