// Ask the bot about a selected passage of its page, in place (#4099). The
// app's own preview frame says where the person's selection is
// (shared/page-selection.ts: the annotation anchor and its box in the
// frame's viewport, again on scroll and resize, a clear when it goes). The
// app draws, above the frame and never inside the page: an outline in the
// skin's accent around the passage, a "Selected text" tag on its top edge,
// and a small composer right under it (the bot's avatar, one field, a round
// send button). Send is an ordinary message of the person in the bot's one
// conversation, carrying the page and the passage
// (dataContext.page.selection); while the bot works the composer shows the
// chat's working line in place, and when its new version is drawn the
// outline follows the passage if its words are still found, else it goes.
// Escape, or a click elsewhere, puts it away; the docked composer of the page
// stays as it is.
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
}

/** Room between the passage and the composer, and around the page's edges. */
const GAP = 8;
/** The composer's height, to put it over the passage when there is no room under it. */
const COMPOSER_HEIGHT = 44;
const COMPOSER_MAX_WIDTH = 380;

/** Where the composer goes in a page of `width` by `height`: under the
 * passage, or over it when it would run past the bottom; never past a side.
 * Pure. */
export function selectionComposerPlace(rect: PageSelectionRect, width: number, height: number): { left: number; top: number; width: number } {
  const composerWidth = Math.max(0, Math.min(COMPOSER_MAX_WIDTH, width - 2 * GAP));
  const left = Math.min(Math.max(GAP, rect.x), Math.max(GAP, width - composerWidth - GAP));
  const under = rect.y + rect.h + GAP;
  const top = under + COMPOSER_HEIGHT + GAP <= height || rect.y - GAP - COMPOSER_HEIGHT < 0 ? under : rect.y - GAP - COMPOSER_HEIGHT;
  return { left, top, width: composerWidth };
}

export function PageSelectionAsk({ frame, frameElement, drawn, avatar, botName, working, onSend }: PageSelectionAskProps) {
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
  // the selection there, and the frame says so)
  useEffect(() => {
    if (!selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && boxRef.current?.contains(target)) return;
      if (target === frameElement.current) return;
      dismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [selection, dismiss, frameElement]);

  if (!selection) return null;
  const { rect } = selection;
  // the passage scrolled out of the page: nothing drawn until it is back
  if (offset.height > 0 && (rect.y + rect.h < 0 || rect.y > offset.height)) return null;
  const place = selectionComposerPlace(rect, offset.width, offset.height);
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

  return (
    <div ref={rootRef} data-page-selection-ask="" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      <div className="absolute" style={{ left: offset.x, top: offset.y, width: offset.width, height: offset.height }}>
        <div data-page-selection-outline="" aria-hidden="true"
          className="absolute rounded-[4px] ring-2 ring-accent"
          style={{ left: rect.x - 2, top: rect.y - 2, width: rect.w + 4, height: rect.h + 4 }}>
          <span data-page-selection-tag="" className="absolute -top-[9px] left-1.5 rounded-[4px] bg-accent px-1.5 text-[11px] font-medium leading-4 text-white">
            {t("pages.selection.tag")}
          </span>
        </div>
        <div ref={boxRef} data-page-selection-composer={showWorking ? "working" : "ready"}
          role="group" aria-label={t("pages.selection.composer", { name: botName })}
          className="pointer-events-auto absolute flex h-11 items-center gap-2 rounded-full border border-hairline/40 bg-elevated/95 py-1.5 pl-1.5 pr-1.5 text-[13px] text-ink shadow-lg backdrop-blur"
          style={{ left: place.left, top: place.top, width: place.width }}>
          <span className="shrink-0">{avatar}</span>
          {showWorking ? (
            <span data-page-selection-working="" role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-1.5 truncate pr-2 text-ink-secondary">
              <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin" />{t("pages.botWorking")}
            </span>
          ) : (
            <>
              <input
                type="text"
                autoFocus
                value={text}
                aria-label={t("pages.selection.composer", { name: botName })}
                placeholder={t("pages.selection.placeholder")}
                enterKeyHint="send"
                className="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-ink placeholder:text-ink-secondary focus:outline-none"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    // the page stays open: only this composer goes away
                    event.preventDefault();
                    event.stopPropagation();
                    dismiss();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button type="button" data-page-selection-send="" aria-label={t("chat.send")} title={t("chat.send")}
                disabled={!text.trim()}
                onClick={send}
                className={cn("flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:brightness-110 disabled:opacity-40")}>
                <ArrowUp size={17} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
