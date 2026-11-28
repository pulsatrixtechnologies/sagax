// Customize mode for the message bar (D-20261126-014, D-20261127-001;
// whole-app mode D-20261127-004, #5443): right-click > Customize enters the
// global customize mode; drag or arrow keys reorder +, model, usage, voice
// inside the composerBar zone; Escape or Cancel discard; Save persists.
// Dragging usage above or below the bar updates usagePlacement on the draft.
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { EyeOff, GripVertical } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, useMenuInWindow } from "../menu-look";
import {
  type ComposerBarItem,
  type ComposerBarLayout,
  useComposerBarLayout,
} from "@/lib/composer-bar-layout";
import { usagePillPlacement, type UsagePillPlacement } from "@/lib/usage-pill-preferences";
import { useUiCustomize } from "@/components/ui-customize";
import { isHideable } from "@/lib/ui-layout/registry";
import { composerVisibleOrder, isComposerBarItem } from "@/lib/ui-layout/draft";

export type ComposerCustomizeApi = {
  customizing: boolean;
  /** Item currently being dragged, or null. */
  dragging: ComposerBarItem | null;
  begin: () => void;
  end: () => void;
  reset: () => void;
  onItemKeyDown: (id: ComposerBarItem, event: ReactKeyboardEvent) => void;
  dragProps: (id: ComposerBarItem) => {
    draggable: boolean;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  dropZoneProps: (placement: Exclude<UsagePillPlacement, "inBar">) => {
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    "data-composer-drop": string;
    "data-composer-drop-active"?: "1";
  };
  /** Hide one movable composer item (draft). */
  hideItem?: (id: ComposerBarItem) => void;
};

/** Layout + placement the composer should render (draft while customizing). */
export function useComposerCustomizeLayout(): {
  layout: ComposerBarLayout;
  placement: UsagePillPlacement;
  customizing: boolean;
} {
  const ui = useUiCustomize();
  const storedLayout = useComposerBarLayout();
  const storedPlacement = usagePillPlacement.use();
  if (ui.active) {
    const zone = ui.draft.zones.composerBar;
    const slots = composerVisibleOrder(zone);
    const order = [...slots.left, ...slots.right].filter(isComposerBarItem);
    return {
      layout: { order, left: slots.left.length },
      placement: zone.usagePlacement ?? "inBar",
      customizing: true,
    };
  }
  return {
    layout: storedLayout,
    placement: storedPlacement,
    customizing: false,
  };
}

export function useComposerCustomize(): ComposerCustomizeApi {
  const ui = useUiCustomize();
  const customizing = ui.active;
  const dragId = useRef<ComposerBarItem | null>(null);
  const dragging: ComposerBarItem | null =
    ui.dragging?.zoneId === "composerBar" && isComposerBarItem(ui.dragging.id)
      ? ui.dragging.id
      : null;

  const end = useCallback(() => {
    dragId.current = null;
    ui.cancel();
  }, [ui]);
  const begin = useCallback(() => ui.begin(), [ui]);
  const reset = useCallback(() => ui.requestReset(), [ui]);

  const onItemKeyDown = useCallback((id: ComposerBarItem, event: ReactKeyboardEvent) => {
    if (!customizing) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      ui.nudge("composerBar", id, -1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      ui.nudge("composerBar", id, 1);
      return;
    }
    if (id === "usage" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const place = ui.draft.zones.composerBar.usagePlacement ?? "inBar";
      const cycle: UsagePillPlacement[] = ["above", "inBar", "below"];
      const at = cycle.indexOf(place);
      const next = event.key === "ArrowUp"
        ? cycle[Math.max(0, at - 1)]!
        : cycle[Math.min(cycle.length - 1, at + 1)]!;
      ui.setPlacement(next);
    }
  }, [customizing, ui]);

  const dragProps = useCallback((id: ComposerBarItem) => ({
    draggable: customizing,
    onDragStart: (event: DragEvent) => {
      if (!customizing) return;
      dragId.current = id;
      ui.setDragging({ zoneId: "composerBar", id });
      event.dataTransfer.setData("text/sagax-composer-item", id);
      event.dataTransfer.setData("text/sagax-ui-item", `composerBar:${id}`);
      event.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (event: DragEvent) => {
      if (!customizing || !dragId.current || dragId.current === id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: DragEvent) => {
      if (!customizing) return;
      event.preventDefault();
      const from = (event.dataTransfer.getData("text/sagax-composer-item") as ComposerBarItem) || dragId.current;
      dragId.current = null;
      ui.setDragging(null);
      if (!from || from === id) return;
      const zone = ui.draft.zones.composerBar;
      const toIndex = zone.order.indexOf(id);
      if (toIndex < 0) return;
      const targetOnLeft = zone.order.indexOf(id) < (zone.left ?? 0);
      const fromOnLeft = zone.order.indexOf(from) < (zone.left ?? 0);
      ui.move("composerBar", from, toIndex);
      if (targetOnLeft !== fromOnLeft) ui.setSide(from, targetOnLeft ? "left" : "right");
      if (from === "usage") ui.setPlacement("inBar");
    },
    onDragEnd: () => {
      dragId.current = null;
      ui.setDragging(null);
    },
  }), [customizing, ui]);

  const dropZoneProps = useCallback((placement: Exclude<UsagePillPlacement, "inBar">) => ({
    onDragOver: (event: DragEvent) => {
      if (!customizing || dragId.current !== "usage") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event: DragEvent) => {
      if (!customizing) return;
      const from = event.dataTransfer.getData("text/sagax-composer-item") || dragId.current;
      dragId.current = null;
      ui.setDragging(null);
      if (from !== "usage") return;
      event.preventDefault();
      ui.setPlacement(placement);
    },
    "data-composer-drop": placement,
    ...(dragging === "usage" ? { "data-composer-drop-active": "1" as const } : {}),
  }), [customizing, dragging, ui]);

  const hideItem = useCallback((id: ComposerBarItem) => {
    if (!isHideable("composerBar", id)) return;
    ui.hide("composerBar", id);
  }, [ui]);

  return { customizing, dragging, begin, end, reset, onItemKeyDown, dragProps, dropZoneProps, hideItem };
}

/** Right-click menu on the composer box: Customize (opens global mode). */
export function ComposerBarContextMenu({
  anchorRef,
  onCustomize,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onCustomize: () => void;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();
  // Same placement as every other context menu: stay in the window, flip up
  // near the bottom (D-20261127-005).
  useMenuInWindow(menuRef, at);

  useEffect(() => {
    const node = anchorRef.current;
    if (!node) return;
    const open = (event: MouseEvent) => {
      event.preventDefault();
      setAt({ left: event.clientX, top: event.clientY });
    };
    node.addEventListener("contextmenu", open);
    return () => node.removeEventListener("contextmenu", open);
  }, [anchorRef]);

  useEffect(() => {
    if (!at) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setAt(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setAt(null); }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [at]);

  if (!at) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      id={labelId}
      aria-label={t("composer.customize.menuAria")}
      data-composer-bar-menu=""
      style={{ left: at.left, top: at.top }}
      className={cn(MENU_SURFACE, MENU_FIT_ROW, "fixed z-50")}
    >
      <button
        type="button"
        role="menuitem"
        className={MENU_ROW}
        data-composer-customize-menu=""
        onClick={() => { setAt(null); onCustomize(); }}
      >
        {t("composer.customize.action")}
      </button>
    </div>,
    document.body,
  );
}

/** Strip shown while customizing: no-op when the global chrome owns Save/Cancel/Reset. */
export function ComposerCustomizeChrome({
  customizing,
  onReset,
  onDone,
  children,
  jiggleFrame = false,
  /** When true (default in app), hide the local Done/Reset toolbar. */
  globalChrome = true,
}: {
  customizing: boolean;
  onReset: () => void;
  onDone: () => void;
  children: ReactNode;
  /** Freeze mid-jiggle for headless still captures. */
  jiggleFrame?: boolean;
  globalChrome?: boolean;
}) {
  const showLocalToolbar = customizing && !globalChrome;
  return (
    <div
      data-composer-customize={customizing ? "1" : undefined}
      data-ui-customize={customizing ? "1" : undefined}
      data-composer-jiggle-frame={customizing && jiggleFrame ? "1" : undefined}
      className="relative"
    >
      {showLocalToolbar && (
        <div
          data-composer-customize-toolbar=""
          className="mb-1 flex items-center justify-end gap-2 px-1"
        >
          <button
            type="button"
            data-composer-customize-reset=""
            onClick={onReset}
            className="rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-menu-hover hover:text-ink"
          >
            {t("composer.customize.reset")}
          </button>
          <button
            type="button"
            data-composer-customize-done=""
            onClick={onDone}
            className="rounded-full bg-accent px-2.5 py-1 text-[12px] text-accent-ink hover:brightness-110"
          >
            {t("composer.customize.done")}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

/** Wraps a movable control while customizing (jiggle + drag handle + hide + keyboard). */
export function ComposerMovable({
  id,
  customizing,
  api,
  className,
  children,
}: {
  id: ComposerBarItem;
  customizing: boolean;
  api: ComposerCustomizeApi;
  className?: string;
  children: ReactNode;
}) {
  if (!customizing) return <span className={className}>{children}</span>;
  const grabbed = api.dragging === id;
  const canHide = isHideable("composerBar", id);
  return (
    <span
      data-composer-movable={id}
      data-ui-movable={id}
      data-ui-zone="composerBar"
      tabIndex={0}
      role="button"
      aria-grabbed={grabbed ? "true" : "false"}
      aria-label={t(`composer.customize.item.${id}`)}
      className={cn(
        "composer-movable ui-movable inline-flex items-center rounded-full outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      onKeyDown={(event) => api.onItemKeyDown(id, event)}
      {...api.dragProps(id)}
    >
      <GripVertical
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        data-composer-movable-handle=""
        data-ui-movable-handle=""
        className="composer-movable-handle ui-movable-handle shrink-0"
      />
      {children}
      {canHide && api.hideItem ? (
        <button
          type="button"
          data-ui-movable-hide={id}
          aria-label={t("ui.customize.hide")}
          title={t("ui.customize.hide")}
          className="ui-movable-hide ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-ink-tertiary hover:bg-menu-hover hover:text-ink"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            api.hideItem?.(id);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <EyeOff size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/** Drop targets above/below the box for the usage pill while customizing. */
export function ComposerUsageDropZones({
  customizing,
  api,
  above,
  below,
}: {
  customizing: boolean;
  api: ComposerCustomizeApi;
  above?: ReactNode;
  below?: ReactNode;
}) {
  if (!customizing) {
    return (
      <>
        {above}
        {below}
      </>
    );
  }
  return (
    <>
      <div
        className="mb-1 flex min-h-7 items-center justify-end rounded-xl border border-dashed border-hairline px-2"
        {...api.dropZoneProps("above")}
      >
        {above ?? <span className="text-[11px] text-ink-tertiary">{t("composer.customize.dropAbove")}</span>}
      </div>
      <span data-composer-drop-below-host="" hidden />
    </>
  );
}

export function ComposerBelowDropZone({
  customizing,
  api,
  children,
}: {
  customizing: boolean;
  api: ComposerCustomizeApi;
  children?: ReactNode;
}) {
  if (!customizing) return <>{children}</>;
  return (
    <div
      className="mt-1 flex min-h-7 items-center justify-end rounded-xl border border-dashed border-hairline px-2"
      {...api.dropZoneProps("below")}
    >
      {children ?? <span className="text-[11px] text-ink-tertiary">{t("composer.customize.dropBelow")}</span>}
    </div>
  );
}

/** Test helper type re-export. */
export type { ComposerBarLayout };
