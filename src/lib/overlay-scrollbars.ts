/** Overlay scrollbars that fade when unused (macOS and the reference design style, 2026-10-18).
 *
 * The native bars are hidden everywhere (`scrollbar-width: none` in
 * styles.css), so no scroller reserves a gutter and nothing shifts when a bar
 * appears. One thin thumb per axis is drawn over the edge of whichever
 * element the person is scrolling: it shows while that element scrolls under
 * a wheel, touch, key or drag, or while the pointer rests on the bar's strip
 * along the edge, and fades out IDLE_MS after the last of those. The thumb
 * can be dragged. Scrolling itself stays native (keyboard, trackpad, wheel,
 * scrollIntoView), and the thumb is aria-hidden like a native bar.
 *
 * The element being scrolled wears SCROLLING_CLASS while its bar shows.
 * Programmatic scrolls (the chat following a stream) do not show the bar.
 * Hibou 98 keeps its classic 16px bars (src/styles/retro98.css); the
 * terminal draws its own; `data-native-scrollbar` opts an element out.
 *
 * Layering (2026-11-04): the thumb is a fixed part at the end of <body>, so
 * it paints at the stacking level of the scroller it belongs to, never
 * higher (scrollerLayer). A menu, popover or dialog above that scroller
 * paints above its bar too. A thumb part that would still cross an open
 * menu, listbox or popover the scroller is not part of hides while that
 * overlay is open (OVERLAY_SELECTOR).
 */

export const SCROLLING_CLASS = "is-scrolling";
export const IDLE_MS = 1000;
/** A scroll this soon after a wheel, touch, key or drag counts as the person's. */
export const GESTURE_WINDOW_MS = 800;
/** Width of the strip along the edge that reveals the bar on hover. */
export const HOVER_STRIP_PX = 12;
const INSET_PX = 2;
const MIN_THUMB_PX = 32;
/** Width of a thumb's hit area; the visible pill is thinner (styles.css). */
const HIT_PX = 10;

type Axis = "y" | "x";

/** Lowest level of a thumb: over a scroller that sits in the page's own flow. */
export const THUMB_BASE_LAYER = 1;
/** Open overlays a scrollbar never paints over (menus, listboxes, popovers). */
export const OVERLAY_SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"]:not(dialog), [data-task-picker-menu], [popover]:popover-open';

/** z-index of the stacking context `style` makes, or null when it makes none. */
function contextLayer(style: CSSStyleDeclaration, parent: CSSStyleDeclaration | null): number | null {
  const z = style.zIndex;
  const placed = style.position !== "static" || Boolean(parent && /(flex|grid)$/.test(parent.display));
  if (z && z !== "auto" && placed) return Number.parseInt(z, 10) || 0;
  if (style.position === "fixed" || style.position === "sticky") return 0;
  if ((style.opacity && Number(style.opacity) < 1) || (style.transform && style.transform !== "none")
    || (style.filter && style.filter !== "none") || style.isolation === "isolate") return 0;
  return null;
}

/** The stacking level `el` paints at under `host` (body or an open dialog):
 * the z-index of its outermost stacking context below the host, at least
 * THUMB_BASE_LAYER. A thumb at this level, appended last to the host, paints
 * over its own scroller and under anything layered above it. */
export function scrollerLayer(el: Element, host: Element, win: Window): number {
  let layer: number | null = null;
  let node: Element | null = el;
  while (node && node !== host && node !== host.ownerDocument.documentElement) {
    const parent: Element | null = node.parentElement;
    const found = contextLayer(win.getComputedStyle(node), parent ? win.getComputedStyle(parent) : null);
    if (found !== null) layer = found;
    node = parent;
  }
  return Math.max(THUMB_BASE_LAYER, layer ?? 0);
}

interface Box { left: number; top: number; right: number; bottom: number }
const crosses = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether an open overlay that `scroller` is not part of covers `box`. */
export function overlayCovers(doc: Document, scroller: Element, box: Box): boolean {
  let overlays: NodeListOf<Element>;
  try {
    overlays = doc.querySelectorAll(OVERLAY_SELECTOR);
  } catch {
    overlays = doc.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]:not(dialog), [data-task-picker-menu]');
  }
  for (const overlay of overlays) {
    if (overlay.contains(scroller)) continue;
    const rect = overlay.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && crosses(rect, box)) return true;
  }
  return false;
}

export interface ThumbInput {
  /** scrollHeight or scrollWidth */
  scrollSize: number;
  /** clientHeight or clientWidth */
  clientSize: number;
  /** scrollTop or scrollLeft (absolute value, so RTL negative offsets work) */
  scrollPos: number;
  /** Length of the strip the thumb runs along, in px. */
  trackLength: number;
  minThumb?: number;
}

/** Thumb size and offset along its track, or null when nothing overflows. */
export function thumbGeometry({ scrollSize, clientSize, scrollPos, trackLength, minThumb = MIN_THUMB_PX }: ThumbInput): { size: number; offset: number } | null {
  const range = scrollSize - clientSize;
  if (range < 1 || clientSize <= 0 || trackLength <= 0) return null;
  const size = Math.min(trackLength, Math.max(Math.min(minThumb, trackLength), (clientSize / scrollSize) * trackLength));
  const travel = trackLength - size;
  const ratio = Math.min(1, Math.max(0, Math.abs(scrollPos) / range));
  return { size, offset: travel * ratio };
}

/** Scroll distance for a thumb dragged by `delta` px. */
export function scrollDeltaForThumbDelta(delta: number, input: ThumbInput): number {
  const geometry = thumbGeometry(input);
  if (!geometry) return 0;
  const travel = input.trackLength - geometry.size;
  if (travel <= 0) return 0;
  return delta * ((input.scrollSize - input.clientSize) / travel);
}

/** Keys that scroll the focused element or the one under it. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function scrollsOn(style: CSSStyleDeclaration, axis: Axis): boolean {
  const value = axis === "y" ? style.overflowY : style.overflowX;
  return value === "auto" || value === "scroll" || value === "overlay";
}

function overflows(el: Element, axis: Axis): boolean {
  return axis === "y" ? el.scrollHeight - el.clientHeight >= 1 : el.scrollWidth - el.clientWidth >= 1;
}

function optedOut(el: Element): boolean {
  return Boolean(el.closest("[data-native-scrollbar], .xterm, [data-overlay-scrollbar-part]"));
}

function overlayDisabled(doc: Document): boolean {
  return doc.documentElement?.dataset.skin === "retro98";
}

interface Part {
  axis: Axis;
  node: HTMLDivElement;
}

/** Install the controller on a document. Returns an uninstall function. */
export function installOverlayScrollbars(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win || !doc.body) return () => undefined;

  let active: Element | null = null;
  let hovering = false;
  let dragging: { axis: Axis; start: number; startScroll: number; pointerId: number } | null = null;
  let lastGesture = Number.NEGATIVE_INFINITY;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;

  const parts: Part[] = (["y", "x"] as const).map((axis) => {
    const node = doc.createElement("div");
    node.dataset.overlayScrollbarPart = axis;
    node.setAttribute("aria-hidden", "true");
    node.className = "overlay-scrollbar-thumb";
    node.dataset.axis = axis;
    return { axis, node };
  });

  const host = (el: Element): Element => el.closest("dialog[open]") ?? doc.body;

  function hide() {
    for (const part of parts) part.node.dataset.visible = "false";
    if (active) active.classList.remove(SCROLLING_CLASS);
  }

  function clearIdle() {
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function scheduleIdle() {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (hovering || dragging) return;
      hide();
    }, IDLE_MS);
  }

  function track(el: Element, axis: Axis) {
    const rect = el.getBoundingClientRect();
    const style = win!.getComputedStyle(el);
    if (axis === "y") {
      const top = parseFloat(style.getPropertyValue("--glass-top")) || 0;
      const bottom = parseFloat(style.getPropertyValue("--glass-bottom")) || 0;
      const rtl = style.direction === "rtl";
      return {
        start: rect.top + top + INSET_PX,
        length: rect.height - top - bottom - INSET_PX * 2 - (overflows(el, "x") && scrollsOn(style, "x") ? 8 : 0),
        cross: rtl ? rect.left + INSET_PX : rect.right - INSET_PX,
        rtl,
      };
    }
    return {
      start: rect.left + INSET_PX,
      length: rect.width - INSET_PX * 2 - (overflows(el, "y") && scrollsOn(style, "y") ? 8 : 0),
      cross: rect.bottom - INSET_PX,
      rtl: false,
    };
  }

  function input(el: Element, axis: Axis, trackLength: number): ThumbInput {
    return axis === "y"
      ? { scrollSize: el.scrollHeight, clientSize: el.clientHeight, scrollPos: el.scrollTop, trackLength }
      : { scrollSize: el.scrollWidth, clientSize: el.clientWidth, scrollPos: el.scrollLeft, trackLength };
  }

  function paint() {
    frame = 0;
    const el = active;
    if (!el || !el.isConnected) {
      hide();
      return;
    }
    const style = win!.getComputedStyle(el);
    const ink = style.getPropertyValue("--color-ink").trim();
    const target = host(el);
    for (const part of parts) {
      const { axis, node } = part;
      if (!scrollsOn(style, axis) || !overflows(el, axis)) {
        node.dataset.visible = "false";
        continue;
      }
      const t = track(el, axis);
      const geometry = thumbGeometry(input(el, axis, t.length));
      if (!geometry) {
        node.dataset.visible = "false";
        continue;
      }
      if (node.parentElement !== target) target.appendChild(node);
      node.style.zIndex = String(scrollerLayer(el, target, win!));
      if (ink) node.style.setProperty("--overlay-scrollbar-ink", ink);
      // The part is a HIT_PX strip; its ::before paints the pill against the
      // scroller's edge. left/top only, then one correction for a host that
      // is a containing block of its own (a transformed dialog).
      let left: number;
      let top: number;
      if (axis === "y") {
        left = t.rtl ? t.cross : t.cross - HIT_PX;
        top = t.start + geometry.offset;
        node.style.height = `${geometry.size}px`;
        node.style.width = "";
      } else {
        left = t.start + geometry.offset;
        top = t.cross - HIT_PX;
        node.style.width = `${geometry.size}px`;
        node.style.height = "";
      }
      node.dataset.side = t.rtl ? "left" : "right";
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      if (target !== doc.body) {
        const placed = node.getBoundingClientRect();
        const dx = left - placed.left;
        const dy = top - placed.top;
        if (Math.abs(dx) > 0.5) node.style.left = `${left + dx}px`;
        if (Math.abs(dy) > 0.5) node.style.top = `${top + dy}px`;
      }
      // an open menu over this strip wins: the bar waits under it
      node.dataset.visible = overlayCovers(doc, el, node.getBoundingClientRect()) ? "false" : "true";
    }
  }

  function requestPaint() {
    if (frame) return;
    frame = win!.requestAnimationFrame(paint);
  }

  /** Show the bar on `el` and restart the fade timer. */
  function activate(el: Element) {
    if (overlayDisabled(doc) || optedOut(el)) return;
    if (active && active !== el) active.classList.remove(SCROLLING_CLASS);
    active = el;
    el.classList.add(SCROLLING_CLASS);
    requestPaint();
    if (!hovering && !dragging) scheduleIdle();
    else clearIdle();
  }

  const gesture = () => {
    lastGesture = Date.now();
  };

  const onKey = (event: KeyboardEvent) => {
    if (!SCROLL_KEYS.has(event.key)) return;
    if (event.key === " " && isEditable(event.target)) return;
    gesture();
  };

  const onScroll = (event: Event) => {
    const raw = event.target;
    const el = raw === doc || raw === doc.defaultView ? doc.scrollingElement : (raw as Element | null);
    if (!el || typeof (el as Element).getBoundingClientRect !== "function") return;
    if (el === active && (el.classList.contains(SCROLLING_CLASS) || dragging)) {
      // Already showing: keep it in step with the content.
      requestPaint();
      if (!hovering && !dragging) scheduleIdle();
      return;
    }
    if (Date.now() - lastGesture > GESTURE_WINDOW_MS) return;
    activate(el);
  };

  /** Nearest scroller whose bar strip lies under the pointer. */
  function scrollerAtEdge(target: EventTarget | null, x: number, y: number): Element | null {
    let el = target instanceof win!.Element ? (target as Element) : null;
    while (el && el !== doc.documentElement) {
      const style = win!.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (scrollsOn(style, "y") && overflows(el, "y")) {
        const rtl = style.direction === "rtl";
        const near = rtl ? x - rect.left <= HOVER_STRIP_PX : rect.right - x <= HOVER_STRIP_PX;
        if (near && y >= rect.top && y <= rect.bottom) return el;
      }
      if (scrollsOn(style, "x") && overflows(el, "x")) {
        if (rect.bottom - y <= HOVER_STRIP_PX && x >= rect.left && x <= rect.right) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  let pendingMove: PointerEvent | null = null;
  let moveFrame = 0;
  const onPointerMove = (event: PointerEvent) => {
    if (dragging || event.pointerType === "touch") return;
    pendingMove = event;
    if (moveFrame) return;
    moveFrame = win!.requestAnimationFrame(() => {
      moveFrame = 0;
      const move = pendingMove;
      pendingMove = null;
      if (!move || overlayDisabled(doc)) return;
      const onThumb = parts.some((part) => part.node === move.target);
      if (onThumb) return;
      const el = scrollerAtEdge(move.target, move.clientX, move.clientY);
      if (el && !optedOut(el)) {
        hovering = true;
        activate(el);
      } else if (hovering) {
        hovering = false;
        scheduleIdle();
      }
    });
  };

  const onLeaveWindow = () => {
    if (!hovering) return;
    hovering = false;
    scheduleIdle();
  };

  const listeners: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (event: DocumentEventMap[K]) => void, options: AddEventListenerOptions) => {
    doc.addEventListener(type, fn as EventListener, options);
    listeners.push(() => doc.removeEventListener(type, fn as EventListener, options));
  };

  on("scroll", onScroll, { capture: true, passive: true });
  on("wheel", gesture, { capture: true, passive: true });
  on("touchmove", gesture, { capture: true, passive: true });
  on("keydown", onKey, { capture: true });
  on("pointermove", onPointerMove, { capture: true, passive: true });
  on("pointerleave", onLeaveWindow, { passive: true });

  for (const part of parts) {
    const { node, axis } = part;
    node.addEventListener("pointerenter", () => {
      hovering = true;
      clearIdle();
    });
    node.addEventListener("pointerleave", () => {
      hovering = false;
      if (!dragging) scheduleIdle();
    });
    node.addEventListener("pointerdown", (event) => {
      if (!active || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      node.setPointerCapture?.(event.pointerId);
      dragging = {
        axis,
        start: axis === "y" ? event.clientY : event.clientX,
        startScroll: axis === "y" ? active.scrollTop : active.scrollLeft,
        pointerId: event.pointerId,
      };
      node.dataset.dragging = "true";
      clearIdle();
    });
    node.addEventListener("pointermove", (event) => {
      if (!dragging || dragging.axis !== axis || dragging.pointerId !== event.pointerId || !active) return;
      const t = track(active, axis);
      const delta = (axis === "y" ? event.clientY : event.clientX) - dragging.start;
      const next = dragging.startScroll + scrollDeltaForThumbDelta(delta, input(active, axis, t.length));
      if (axis === "y") active.scrollTop = next;
      else active.scrollLeft = next;
      requestPaint();
    });
    const endDrag = (event: PointerEvent) => {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      dragging = null;
      delete node.dataset.dragging;
      node.releasePointerCapture?.(event.pointerId);
      if (!hovering) scheduleIdle();
    };
    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);
  }

  return () => {
    for (const off of listeners) off();
    clearIdle();
    if (frame) win.cancelAnimationFrame(frame);
    if (moveFrame) win.cancelAnimationFrame(moveFrame);
    if (active) active.classList.remove(SCROLLING_CLASS);
    for (const part of parts) part.node.remove();
    active = null;
  };
}
