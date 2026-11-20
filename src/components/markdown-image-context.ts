// A surface that draws the images of its Markdown itself (M-20261119-084): a
// ticket note's images are the product's, behind the person's key, so the
// record card reads them through its own detail route instead of the
// browser asking the product. The chat's renderer (ChatMarkdown) asks this
// first; `undefined` leaves the image to its own drawing.
import { createContext, type ReactNode } from "react";

export interface MarkdownImage {
  src: string;
  alt?: string;
  /** the address of the link the image sits in (a signature's network icon), when it does */
  openUrl?: string;
}

export type MarkdownImageDraw = (image: MarkdownImage) => ReactNode | undefined;

export const MarkdownImageContext = createContext<MarkdownImageDraw | undefined>(undefined);
