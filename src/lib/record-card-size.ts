// The card a record's chip opens is a window over the chat (#5053): large by
// default, resized by its edges and its bottom corners, and its size is kept
// on the device, where the sidebar's width is (localStorage, one key a size).
// One size for every record: a ticket, a company and an invoice open alike.
// Only the numbers live here; the handle and the kept value are the app's one
// resize mechanism (components/DockedPanelResize.tsx).
import type { DockedPanelBounds } from "@/components/DockedPanelResize";

export type CardView = { width: number; height: number };

/** The least room between the card and the window's sides and foot. */
export const RECORD_CARD_MARGIN = 16;
/** 1000 px wide and 80% of the window's height (840 px at most) when nothing is kept. */
export const RECORD_CARD_DEFAULT = { width: 1000, height: 840, share: 0.8 } as const;
/** Under this the rows no longer read. A smaller window still bounds the card. */
export const RECORD_CARD_MIN = { width: 480, height: 320 } as const;
/** A kept value past this is not believed; the window bounds what is shown anyway. */
const KEPT_MOST = { width: 3840, height: 2160 } as const;

export const RECORD_CARD_WIDTH_KEY = "sagax.recordCard.width.v1";
export const RECORD_CARD_HEIGHT_KEY = "sagax.recordCard.height.v1";

export const RECORD_CARD_WIDTH: DockedPanelBounds = {
  key: RECORD_CARD_WIDTH_KEY,
  min: RECORD_CARD_MIN.width,
  max: KEPT_MOST.width,
  fallback: RECORD_CARD_DEFAULT.width,
};

/** The height's bounds in this window: its default is the window's share. */
export function recordCardHeightBounds(view: CardView): DockedPanelBounds {
  const share = Math.round(view.height * RECORD_CARD_DEFAULT.share);
  return {
    key: RECORD_CARD_HEIGHT_KEY,
    min: RECORD_CARD_MIN.height,
    max: KEPT_MOST.height,
    fallback: Math.max(RECORD_CARD_MIN.height, Math.min(RECORD_CARD_DEFAULT.height, share)),
  };
}

export function windowView(): CardView {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Where the card's top edge sits: a little under the window's top, the same
 * for every record whatever its content, so the head (its Back arrow, its
 * close button) never moves under the pointer from one card to the next. */
export function recordCardTop(view: CardView): number {
  return Math.max(RECORD_CARD_MARGIN, Math.min(72, Math.round(view.height * 0.08)));
}

/** The most the card may be in this window. */
export function recordCardRoom(view: CardView): CardView {
  return {
    width: Math.max(0, view.width - 2 * RECORD_CARD_MARGIN),
    height: Math.max(0, view.height - recordCardTop(view) - RECORD_CARD_MARGIN),
  };
}

/** The size shown: the kept one, bounded by the window. A small window never
 * changes what is kept. */
export function recordCardShown(kept: CardView, view: CardView): CardView {
  const room = recordCardRoom(view);
  return { width: Math.min(kept.width, room.width), height: Math.min(kept.height, room.height) };
}

/** The kept size as the card's two CSS variables. The card's classes bound
 * them by the window (`min(var(--record-card-w), 100vw - 32px)`, and for the
 * height `--hover-card-room`, the room HoverCard gives the card where it
 * sits), so a window that changes size needs no render. */
export function recordCardStyle(kept: CardView): Record<"--record-card-w" | "--record-card-h", string> {
  return { "--record-card-w": `${kept.width}px`, "--record-card-h": `${kept.height}px` };
}

/** Where the card sits (HoverCard's `place`): centred across the window, its
 * top held, with the height it may take there. */
export function placeRecordCard(card: CardView, view: CardView): { left: number; top: number; room: number } {
  return {
    left: Math.max(0, Math.round((view.width - card.width) / 2)),
    top: recordCardTop(view),
    room: recordCardRoom(view).height,
  };
}
