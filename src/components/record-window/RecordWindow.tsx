// The one record window (M-20261127-101): every record of every plugin opens
// in it, a ticket, a company, an invoice or a record of another product
// alike. The frame is the same for all: the head (the plugin's mark, the kind
// and number, the title, the state pills, close) at the top, then the tabs
// when the record has some, the body, and the foot of the opened card (open on
// the web, ask, copy, "up to date at", refresh).
//
// It is moved by its head and resized by its sides, its bottom edge and its
// bottom corners (the app's one handle look, `.app-resize-handle`); its size
// and place are kept per person and per type of window
// (src/lib/record-window-layout.ts, M-20261127-147). It never goes past the
// app's window: what is kept is bounded by the window of now, 16 px from each
// side (M-20261127-124). The body never scrolls as a whole: each side scrolls
// on its own (RecordSplit.tsx) and the tabs stay out of what scrolls
// (M-20261127-134).
//
// The window places itself: HoverCard holds it at the top left of the app's
// window (`placeRecordWindow`) and the frame sits at its own place inside.
// Painted from the popover tokens and the menu family's surface, as the
// opened card was; nothing here writes a colour of its own.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { RECORD_CARD_MARGIN, RECORD_CARD_MIN, keepRecordWindow, recordWindowBox, recordWindowView, useRecordWindow, type RecordWindowBox } from "@/lib/record-window-layout";

/** A step of the keyboard on an edge. */
const KEY_STEP = 24;

/** What a press on the head never drags: the head's own controls. */
const NO_DRAG = "button, a, input, textarea, select, label, [role=button], [role=tab], [role=combobox], [contenteditable=true], [data-record-window-nodrag]";

type Edge = "e" | "w" | "s" | "se" | "sw";

/** The box after a travel of the pointer on one edge, bounded by the window (its minimum readable size too, when the window has room for it). */
export function resizedBox(start: RecordWindowBox, edge: Edge, dx: number, dy: number, view: { width: number; height: number }): RecordWindowBox {
  const m = RECORD_CARD_MARGIN;
  const right = start.left + start.width;
  const bounded = (size: number, most: number, least: number) => Math.min(most, Math.max(Math.min(least, most), size));
  let { left, width, height } = start;
  if (edge === "e" || edge === "se") width = bounded(start.width + dx, view.width - m - start.left, RECORD_CARD_MIN.width);
  if (edge === "w" || edge === "sw") {
    // the right edge stays where it is
    width = bounded(start.width - dx, right - m, RECORD_CARD_MIN.width);
    left = right - width;
  }
  if (edge === "s" || edge === "se" || edge === "sw") height = bounded(start.height + dy, view.height - m - start.top, RECORD_CARD_MIN.height);
  return { left: Math.round(left), top: start.top, width: Math.round(width), height: Math.round(height) };
}

/** The box after the head was dragged, kept whole inside the window. */
export function movedBox(start: RecordWindowBox, dx: number, dy: number, view: { width: number; height: number }): RecordWindowBox {
  const m = RECORD_CARD_MARGIN;
  return {
    ...start,
    left: Math.round(Math.min(Math.max(m, start.left + dx), Math.max(m, view.width - m - start.width))),
    top: Math.round(Math.min(Math.max(m, start.top + dy), Math.max(m, view.height - m - start.height))),
  };
}

function Handle({ edge, label, title, box, view, onLive, onDone, onReset }: {
  edge: Edge; label: string; title: string; box: RecordWindowBox; view: { width: number; height: number };
  onLive: (box: RecordWindowBox | null) => void; onDone: (box: RecordWindowBox) => void; onReset: () => void;
}) {
  const gesture = useRef<{ pointer: number; x: number; y: number; start: RecordWindowBox; last: RecordWindowBox } | null>(null);
  const [resizing, setResizing] = useState(false);
  const corner = edge === "se" || edge === "sw";
  const vertical = edge === "e" || edge === "w";
  const keyboard = edge === "e" || edge === "s";
  return (
    <div
      role="separator"
      aria-orientation={corner || edge === "s" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-hidden={keyboard ? undefined : true}
      aria-valuemin={vertical ? RECORD_CARD_MIN.width : RECORD_CARD_MIN.height}
      aria-valuenow={vertical ? box.width : box.height}
      tabIndex={keyboard ? 0 : undefined}
      title={title}
      data-record-window-edge={edge}
      data-resizing={resizing || undefined}
      data-resize-corner={corner ? edge : undefined}
      className={cn("app-resize-handle", edge === "w" && "-left-[3px] my-3", edge === "e" && "-right-[3px] my-3", edge === "s" && "mx-3")}
      onPointerDown={(event) => {
        if (event.button > 0) return;
        event.preventDefault();
        gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: box, last: box };
        setResizing(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = gesture.current;
        if (!from || from.pointer !== event.pointerId) return;
        from.last = resizedBox(from.start, edge, event.clientX - from.x, event.clientY - from.y, view);
        onLive(from.last);
      }}
      onPointerUp={(event) => {
        const from = gesture.current;
        if (!from || from.pointer !== event.pointerId) return;
        gesture.current = null;
        setResizing(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        // a press that moved nothing keeps what is kept (a window that bounds the box never overwrites it)
        if (from.last.width !== from.start.width || from.last.height !== from.start.height || from.last.left !== from.start.left) onDone(from.last);
        else onLive(null);
      }}
      onPointerCancel={() => { gesture.current = null; setResizing(false); onLive(null); }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); onReset(); return; }
        const across = edge === "e" ? (event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0) : 0;
        const down = edge === "s" ? (event.key === "ArrowUp" ? -KEY_STEP : event.key === "ArrowDown" ? KEY_STEP : 0) : 0;
        if (!across && !down) return;
        event.preventDefault();
        onDone(resizedBox(box, edge, across, down, view));
      }}
    />
  );
}

export interface RecordWindowProps {
  /** the type of window ("<product>/<kind>", recordWindowType): its size and place are kept for it */
  type: string;
  /** the head: the mark, kind, number, title and pills (RecordCard's head); it moves the window */
  head: ReactNode;
  /** tabs across the whole window, under the head (a kind whose tabs sit over one side puts them in RecordSplit's `rightHead`) */
  tabs?: ReactNode;
  /** the body: a RecordSplit, or one block that scrolls on its own */
  children: ReactNode;
  /** the foot: the opened card's actions */
  foot?: ReactNode;
  busy?: boolean;
  /** the data attributes of the record's card (its layout, its state), kept on the frame */
  data?: Record<string, string>;
  className?: string;
  /** the frame's box (the container a kind's narrow layout reads) */
  frameRef?: Ref<HTMLDivElement>;
}

/** The frame. In a test renderer with no layout the box is the default one. */
export function RecordWindow({ type, head, tabs, children, foot, busy, data, className, frameRef }: RecordWindowProps) {
  const kept = useRecordWindow(type);
  const [view, setView] = useState(recordWindowView);
  const [live, setLive] = useState<RecordWindowBox | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; start: RecordWindowBox; last: RecordWindowBox } | null>(null);
  useEffect(() => {
    const follow = () => setView(recordWindowView());
    window.addEventListener("resize", follow);
    return () => window.removeEventListener("resize", follow);
  }, []);
  // another type opened in this window (a step from a ticket to its company): its own size and place
  useEffect(() => { setLive(null); }, [type]);
  const box = live ?? recordWindowBox(kept, view);
  const keep = (next: RecordWindowBox) => {
    keepRecordWindow(type, { w: next.width, h: next.height, x: next.left, y: next.top });
    setLive(null);
  };
  const reset = () => {
    keepRecordWindow(type, { w: undefined, h: undefined });
    setLive(null);
  };
  const style: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height };
  const edges: Array<[Edge, string]> = [["w", t("recordCard.resize.width")], ["e", t("recordCard.resize.width")], ["s", t("recordCard.resize.height")], ["sw", t("recordCard.resize.height")], ["se", t("recordCard.resize.height")]];
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0 || (event.target as Element).closest?.(NO_DRAG)) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: box, last: box };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  return (
    <div
      ref={frameRef}
      className={cn("@container absolute flex flex-col overflow-hidden rounded-xl popover-surface menu-surface [background-color:var(--float-fill)] [box-shadow:var(--float-shadow)] text-[15px] leading-[22px] text-popover-ink", className)}
      style={style}
      data-record-window={type}
      {...data}
      aria-busy={busy ? "true" : undefined}
    >
      <div
        data-record-window-head=""
        className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from || from.pointer !== event.pointerId) return;
          from.last = movedBox(from.start, event.clientX - from.x, event.clientY - from.y, view);
          setLive(from.last);
        }}
        onPointerUp={(event) => {
          const from = drag.current;
          if (!from || from.pointer !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (from.last.left !== from.start.left || from.last.top !== from.start.top) keep(from.last);
          else setLive(null);
        }}
        onPointerCancel={() => { drag.current = null; setLive(null); }}
        onDoubleClick={(event) => {
          // a double-click on the head's empty part puts the window back in the middle
          if ((event.target as Element).closest?.(NO_DRAG)) return;
          keepRecordWindow(type, { x: undefined, y: undefined });
        }}
      >
        {head}
      </div>
      {tabs && <div className="shrink-0" data-record-window-tabs="">{tabs}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col border-t border-popover-hairline" data-record-window-body="">{children}</div>
      {foot}
      {edges.map(([edge, label]) => (
        <Handle key={edge} edge={edge} label={label} title={t("recordCard.resize.hint")} box={box} view={view} onLive={setLive} onDone={keep} onReset={reset} />
      ))}
    </div>
  );
}
