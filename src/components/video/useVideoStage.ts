import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { clampPan, clampZoom, ZOOM_STEP } from "./video-player-state";

/** Pointer and wheel handlers of the stage, outside interactive controls. */
const INTERACTIVE = "button, [role='slider'], input, [role='menu']";

/**
 * Zoom, pan and expand of the video stage: the card expands in the top
 * layer (Popover API) so the <video> never remounts.
 */
export function useVideoStage({
  shellRef,
  cardRef,
  showcase,
  initialExpanded,
}: {
  shellRef: RefObject<HTMLDivElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  showcase?: boolean;
  initialExpanded?: boolean;
}) {
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [expanded, setExpanded] = useState(Boolean(initialExpanded));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const stageBox = useCallback(() => {
    const box = shellRef.current?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  }, [shellRef]);

  const setZoomTo = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    setPan((p) => clampPan(p, z, stageBox()));
  }, [stageBox]);

  // Expand: the same card in the top layer (Popover API), so the <video> is
  // never remounted; data-expanded alone is the fallback without popovers.
  const setExpand = useCallback((next: boolean) => {
    const card = cardRef.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (card && typeof card.showPopover === "function") {
      try {
        if (next) {
          card.setAttribute("popover", "manual");
          card.showPopover();
        } else if (card.hasAttribute("popover")) {
          card.hidePopover?.();
          card.removeAttribute("popover");
        }
      } catch {
        /* already in the requested state */
      }
    }
    setExpanded(next);
    if (!next) setZoomTo(1);
  }, [cardRef, setZoomTo]);

  useEffect(() => {
    if (!expanded || showcase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpand(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, showcase, setExpand]);

  const pointerProps: React.HTMLAttributes<HTMLDivElement> = {
    onWheel: (e) => {
      // pinch (ctrl+wheel on a trackpad) or Cmd/Ctrl+wheel zooms
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomTo(zoom - Math.sign(e.deltaY) * ZOOM_STEP);
    },
    onDoubleClick: (e) => {
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
      setZoomTo(zoom > 1 ? 1 : 2);
      if (zoom > 1) setPan({ x: 0, y: 0 });
    },
    onPointerDown: (e) => {
      if (zoom <= 1 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
      panDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const drag = panDrag.current;
      if (!drag) return;
      setPan(clampPan({ x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y }, zoom, stageBox()));
    },
    onPointerUp: (e) => {
      panDrag.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
  };

  return { expanded, zoom, pan, setZoomTo, setExpand, pointerProps };
}
