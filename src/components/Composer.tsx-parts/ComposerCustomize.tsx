// Customize mode for the message bar (D-20261126-014, D-20261127-001):
// right-click > Customize; drag or arrow keys reorder +, model, usage, voice;
// Escape or Done leaves; Reset restores the default order. Dragging usage
// above or below the bar updates usagePillPlacement.
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
import { GripVertical } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, useMenuInWindow } from "../menu-look";
import {
  type ComposerBarItem,
  type ComposerBarLayout,
  getComposerBarLayout,
  moveComposerBarItem,
  nudgeComposerBarItem,
  resetComposerBarLayout,
  setComposerBarLayout,
  setComposerBarSide,
} from "@/lib/composer-bar-layout";
import { usagePillPlacement, type UsagePillPlacement } from "@/lib/usage-pill-preferences";

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
};

export function useComposerCustomize(): ComposerCustomizeApi {
  const [customizing, setCustomizing] = useState(false);
  const [dragging, setDragging] = useState<ComposerBarItem | null>(null);
  const dragId = useRef<ComposerBarItem | null>(null);

  const end = useCallback(() => {
    dragId.current = null;
    setDragging(null);
    setCustomizing(false);
  }, []);
  const begin = useCallback(() => setCustomizing(true), []);
  const reset = useCallback(() => {
    setComposerBarLayout(resetComposerBarLayout());
    usagePillPlacement.set("inBar");
  }, []);

  useEffect(() => {
    if (!customizing) return;
    const onKey = (event: Event) => {
      const key = (event as globalThis.KeyboardEvent).key;
      if (key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dragId.current = null;
      setDragging(null);
      setCustomizing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [customizing]);

  const onItemKeyDown = useCallback((id: ComposerBarItem, event: ReactKeyboardEvent) => {
    if (!customizing) return;
    const layout = getComposerBarLayout();
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setComposerBarLayout(nudgeComposerBarItem(layout, id, -1));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setComposerBarLayout(nudgeComposerBarItem(layout, id, 1));
      return;
    }
    if (id === "usage" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const place = usagePillPlacement.get();
      const cycle: UsagePillPlacement[] = ["above", "inBar", "below"];
      const at = cycle.indexOf(place);
      const next = event.key === "ArrowUp"
        ? cycle[Math.max(0, at - 1)]!
        : cycle[Math.min(cycle.length - 1, at + 1)]!;
      usagePillPlacement.set(next);
    }
  }, [customizing]);

  const dragProps = useCallback((id: ComposerBarItem) => ({
    draggable: customizing,
    onDragStart: (event: DragEvent) => {
      if (!customizing) return;
      dragId.current = id;
      setDragging(id);
      event.dataTransfer.setData("text/sagax-composer-item", id);
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
      setDragging(null);
      if (!from || from === id) return;
      const layout = getComposerBarLayout();
      const toIndex = layout.order.indexOf(id);
      if (toIndex < 0) return;
      let next = moveComposerBarItem(layout, from, toIndex);
      // dropping onto a target that sits across the field moves the side too
      const targetOnLeft = layout.order.indexOf(id) < layout.left;
      const fromOnLeft = layout.order.indexOf(from) < layout.left;
      if (targetOnLeft !== fromOnLeft) next = setComposerBarSide(next, from, targetOnLeft ? "left" : "right");
      setComposerBarLayout(next);
      if (from === "usage") usagePillPlacement.set("inBar");
    },
    onDragEnd: () => {
      dragId.current = null;
      setDragging(null);
    },
  }), [customizing]);

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
      setDragging(null);
      if (from !== "usage") return;
      event.preventDefault();
      usagePillPlacement.set(placement);
    },
    "data-composer-drop": placement,
    ...(dragging === "usage" ? { "data-composer-drop-active": "1" as const } : {}),
  }), [customizing, dragging]);

  return { customizing, dragging, begin, end, reset, onItemKeyDown, dragProps, dropZoneProps };
}

/** Right-click menu on the composer box: Customize. */
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

/** Strip shown while customizing: Reset and Done. */
export function ComposerCustomizeChrome({
  customizing,
  onReset,
  onDone,
  children,
  jiggleFrame = false,
}: {
  customizing: boolean;
  onReset: () => void;
  onDone: () => void;
  children: ReactNode;
  /** Freeze mid-jiggle for headless still captures. */
  jiggleFrame?: boolean;
}) {
  return (
    <div
      data-composer-customize={customizing ? "1" : undefined}
      data-composer-jiggle-frame={customizing && jiggleFrame ? "1" : undefined}
      className="relative"
    >
      {customizing && (
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

/** Wraps a movable control while customizing (jiggle + drag handle + keyboard). */
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
  return (
    <span
      data-composer-movable={id}
      tabIndex={0}
      role="button"
      aria-grabbed={grabbed ? "true" : "false"}
      aria-label={t(`composer.customize.item.${id}`)}
      className={cn(
        "composer-movable inline-flex items-center rounded-full outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-accent",
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
        className="composer-movable-handle shrink-0"
      />
      {children}
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
      {/* below zone is rendered by the caller after the box */}
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
