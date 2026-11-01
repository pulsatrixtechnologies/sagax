// The conversation-wide image registry. Every thumbnail in a transcript
// (attachments, generated images, Markdown images) registers here, so the
// lightbox steps through the whole conversation in reading order rather than
// only through the one message that was clicked. Kept apart from the
// provider component so AttachmentPreview can use it without an import cycle.
import { createContext, useContext } from "react";

import type { PreviewImage } from "./preview-image";

export interface GalleryEntry {
  element: Element | null;
  image: PreviewImage;
}

export interface ConversationGalleryRegistry {
  /** Add or replace an entry; the returned function removes it. */
  register(id: string, entry: GalleryEntry): () => void;
  /** Open the lightbox on this entry. False when it is not registered, so the
   * caller falls back to its own single-message viewer. */
  open(id: string): boolean;
}

export const ConversationGalleryContext = createContext<ConversationGalleryRegistry | null>(null);

export function useConversationGallery(): ConversationGalleryRegistry | null {
  return useContext(ConversationGalleryContext);
}

// Node.DOCUMENT_POSITION_FOLLOWING / PRECEDING, spelled out so this module
// also loads where no DOM globals exist (unit tests render to strings).
const FOLLOWING = 4;
const PRECEDING = 2;

/** Entries in document order, skipping unmounted or not-yet-loadable ones,
 * with the same picture shown twice in a row collapsed to one stop. */
export function orderGalleryEntries<T extends { id: string; entry: GalleryEntry }>(entries: readonly T[]): T[] {
  const live = entries.filter(({ entry }) => entry.image.src && (!entry.element || entry.element.isConnected !== false));
  live.sort((left, right) => {
    const a = left.entry.element;
    const b = right.entry.element;
    if (!a || !b || a === b || typeof a.compareDocumentPosition !== "function") return 0;
    const position = a.compareDocumentPosition(b);
    if (position & FOLLOWING) return -1;
    if (position & PRECEDING) return 1;
    return 0;
  });
  return live.filter((item, index) => index === 0 || live[index - 1]!.entry.image.src !== item.entry.image.src);
}
