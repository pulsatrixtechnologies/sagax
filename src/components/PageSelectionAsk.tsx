// Ask the bot about a selected passage of its page, in place (#4099). The
// app's own preview frame says where the person's selection is
// (shared/page-selection.ts: the annotation anchor and its box in the
// frame's viewport, again on scroll and resize, a clear when it goes). The
// app draws, above the frame and never inside the page: an outline in the
// skin's accent around the passage, a "Selected text" tag on its top edge,
// and a composer right under it (the bot's avatar, a field that grows, a
// round send button; the reference app's roomy note editor: 360 wide, 18
// radius, half pixel border, 8 padding and gap, 10 under the passage, over it
// when there is no room under, clear of the docked composer). Send is an ordinary message of the person in the bot's one
// conversation, carrying the page and the passage
// (dataContext.page.selection); while the bot works the composer shows the
// chat's working line in place, and when its new version is drawn the
// outline follows the passage if its words are still found, else it goes.
// Escape (in the field, in the page or anywhere in the app), or a click
// elsewhere, puts it away; the docked composer of the page stays as it is.
// A selection made with the keyboard (Shift and the arrows, Select all) opens
// it too: the frame reports it once the keys rest.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { pageSelectionRequest, parsePageSelectionMessage, type PageSelectionRect } from "../../shared/page-selection";
import type { PageQuote } from "../../shared/page-threads";

export interface PageSelectionAskProps {
  /** The page's own frame (inside the preview wrapper): the only source of a
   * selection message, and the only window the app answers. */
  frame: () => Window | null;
  /** The preview wrapper's element, to place the overlay over the page. */
  frameElement: RefObject<HTMLIFrameElement | null>;
  /** The address drawn now: a new one (the bot's new version) is followed. */
  drawn: string;
  avatar: ReactNode;
  botName: string;
  /** The bot's conversation is working: shown in place once the person has
   * asked, never a reason to hold the ask (it queues like the chat). */
  working: boolean;
  onSend(text: string, selection: PageQuote): void;
  /** Room kept clear at the page's bottom (its docked composer). */
  bottomInset?: number;
}

/** The reference's measures (its note editor, roomy): room kept around the
 * page's edges, the gap under or over the passage, the composer's width and
 * the tallest it grows, and the room kept clear at the bottom for the page's
 * docked composer. */
const EDGE = 8;
const GAP = 10;
export const COMPOSER_WIDTH = 360;
const COMPOSER_MAX_HEIGHT = 144;
export const COMPOSER_BOTTOM_INSET = 96;
/** The outline stands this far off the passage, with this stroke and radius,
 * its stroke and fill being the accent at 90 and 12 % (the classes of the
 * outline: border-[...90%], bg-[...12%]). */
const RING_PAD = 4;
const RING_STROKE = 1.5;
const RING_RADIUS = 8;

/** Where the composer goes in a page of `width` by `height`: under the
 * passage, or over it when there is no room under (and more above); never
 * past a side, never under the docked composer's `inset`. `bottom` is set
 * instead of `top` when it goes over, so it grows upward. Pure. */
export function selectionComposerPlace(rect: PageSelectionRect, width: number, height: number, inset = COMPOSER_BOTTOM_INSET): { left: number; width: number; top?: number; bottom?: number } {
  const composerWidth = Math.max(0, Math.min(COMPOSER_WIDTH, width - 2 * EDGE));
  const left = Math.min(Math.max(EDGE, rect.x), Math.max(EDGE, width - composerWidth - EDGE));
  const under = rect.y + rect.h + GAP;
  const below = height - inset - EDGE - Math.min(under, height - (48 + inset));
  const above = rect.y - GAP - EDGE;
  if (height <= 0 || below >= COMPOSER_MAX_HEIGHT || (above < COMPOSER_MAX_HEIGHT && above <= below)) {
    return { left, width: composerWidth, top: height <= 0 ? under : Math.max(EDGE, Math.min(under, height - (48 + inset))) };
  }
  return { left, width: composerWidth, bottom: height - rect.y + GAP };
}

export function PageSelectionAsk({ frame, frameElement, drawn, avatar, botName, working, onSend, bottomInset = COMPOSER_BOTTOM_INSET }: PageSelectionAskProps) {
  const [selection, setSelection] = useState<{ anchor: PageQuote; rect: PageSelectionRect } | null>(null);
  // the passage last asked about: followed into the bot's new version
  const [asked, setAsked] = useState<PageQuote | null>(null);
  const [text, setText] = useState("");
  const [offset, setOffset] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // the frame's messages: a selection with its box, or a clear
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const source = frame();
      if (!source || event.source !== source) return;
      const update = parsePageSelectionMessage(event.data);
      if (!update) return;
      if (update.anchor === null) {
        setSelection(null);
        setAsked(null);
        return;
      }
      setSelection({ anchor: update.anchor, rect: update.rect });
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [frame]);

  // a new version drawn: the frame is asked to find the passage again (its
  // load waits for the page's own frame, whose bridge then listens)
  const askedRef = useRef(asked);
  askedRef.current = asked;
  useEffect(() => {
    const element = frameElement.current;
    if (!element) return;
    setSelection(null);
    const onLoad = () => {
      const anchor = askedRef.current;
      if (anchor) frame()?.postMessage(pageSelectionRequest(anchor), "*");
    };
    element.addEventListener("load", onLoad);
    return () => element.removeEventListener("load", onLoad);
  }, [drawn, frame, frameElement]);

  // the overlay is placed over the page's frame
  useLayoutEffect(() => {
    if (!selection) return;
    const root = rootRef.current?.getBoundingClientRect();
    const page = frameElement.current?.getBoundingClientRect();
    if (!root || !page) return;
    setOffset((current) => {
      const next = { x: page.left - root.left, y: page.top - root.top, width: page.width, height: page.height };
      return current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height ? current : next;
    });
  }, [selection, frameElement]);

  const dismiss = useCallback(() => {
    setSelection(null);
    setAsked(null);
    setText("");
    frame()?.postMessage(pageSelectionRequest(null), "*");
  }, [frame]);

  // a click elsewhere in the app puts it away (a click in the page clears
  // the selection there, and the frame says so); so does Escape anywhere in
  // the app (in the page itself, the frame says so)
  useEffect(() => {
    if (!selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && boxRef.current?.contains(target)) return;
      if (target === frameElement.current) return;
      dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // only this composer goes away: the page stays open
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [selection, dismiss, frameElement]);

  if (!selection) return null;
  const { rect } = selection;
  // the passage scrolled out of the page: nothing drawn until it is back
  if (offset.height > 0 && (rect.y + rect.h < 0 || rect.y > offset.height)) return null;
  const place = selectionComposerPlace(rect, offset.width, offset.height, bottomInset);
  const showWorking = working && asked !== null;
  const send = () => {
    const words = text.trim();
    // a bot busy with something else still takes it: the message queues,
    // as the chat's own composer does
    if (!words) return;
    onSend(words, selection.anchor);
    setAsked(selection.anchor);
    setText("");
  };
  // the composer grows from the point it is anchored to
  const anchorX = Math.max(0, Math.min(rect.x - place.left, place.width));

  return (
    <div ref={rootRef} data-page-selection-ask="" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      <div className="absolute" style={{ left: offset.x, top: offset.y, width: offset.width, height: offset.height }}>
        <div data-page-selection-outline="" aria-hidden="true"
          className="absolute box-border border-[color:color-mix(in_srgb,var(--color-accent)_90%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
          style={{
            left: rect.x - RING_PAD, top: rect.y - RING_PAD, width: rect.w + 2 * RING_PAD, height: rect.h + 2 * RING_PAD,
            borderStyle: "solid", borderWidth: RING_STROKE, borderRadius: RING_RADIUS, borderTopLeftRadius: 0,
          }}>
          <span data-page-selection-tag="" className="absolute left-[-1.5px] whitespace-nowrap rounded-t-[6px] bg-accent px-2 text-[11px] font-medium leading-[18px] text-accent-ink"
            style={{ bottom: `calc(100% + ${RING_STROKE}px)` }}>
            {t("pages.selection.tag")}
          </span>
        </div>
        <div ref={boxRef} data-page-selection-composer={showWorking ? "working" : "ready"}
          role="group" aria-label={t("pages.selection.composer", { name: botName })}
          className="page-selection-composer pointer-events-auto absolute box-border flex min-h-11 flex-wrap items-end gap-2 rounded-[18px] border-[0.5px] border-hairline/70 bg-elevated p-2 text-[14px] text-ink shadow-[0_2px_6px_rgb(28_28_28/0.1),0_10px_24px_rgb(28_28_28/0.1)]"
          style={{ left: place.left, width: place.width, ...(place.bottom !== undefined ? { bottom: place.bottom } : { top: place.top }), transformOrigin: `${Math.round(anchorX)}px ${place.bottom !== undefined ? "100%" : "0px"}` }}>
          <span className="flex size-7 shrink-0 items-center justify-center self-end">{avatar}</span>
          {showWorking ? (
            <span data-page-selection-working="" role="status" aria-live="polite" className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 truncate pr-2 text-ink-secondary">
              <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin" />{t("pages.botWorking")}
            </span>
          ) : (
            <>
              <textarea
                autoFocus
                rows={1}
                value={text}
                aria-label={t("pages.selection.composer", { name: botName })}
                placeholder={t("pages.selection.placeholder")}
                enterKeyHint="send"
                className="box-border max-h-32 min-h-7 min-w-0 flex-1 resize-none overflow-y-auto rounded-[14px] bg-transparent px-1 py-1 text-[14px] leading-5 text-ink [field-sizing:content] placeholder:text-ink-secondary focus:outline-none"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    // the page stays open: only this composer goes away
                    event.preventDefault();
                    event.stopPropagation();
                    dismiss();
                  } else if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button type="button" data-page-selection-send="" aria-label={t("chat.send")} title={t("chat.send")}
                disabled={!text.trim()}
                onClick={send}
                className={cn("flex size-7 shrink-0 items-center justify-center rounded-full bg-accent !text-white hover:brightness-110 disabled:opacity-40")}>
                <ArrowUp size={17} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
