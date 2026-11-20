// A record's own text in the opened record card (M-20261119-084): a ticket
// note, a description. The product stores Markdown (an inline image, bold, a
// phone link, escaped brackets) and the card used to show it raw. It is drawn
// by the chat's own renderer (ChatMarkdown, inert: vendor text runs nothing
// and offers no write), the one a bot's bubble uses; this file only adds the
// note's images and a fallback.
//
// Images: the product's inline images need the person's key, so each one is
// read through the card's own detail route (`readImage`, the console reads it
// as the person): the browser never holds a key and never calls the product.
// An image the product does not serve that way is its words, quietly, and
// nothing is fetched. An image inside a link (a signature's network icons) is
// small and quiet, the link kept. Text the renderer cannot draw falls back to
// the plain text: a malformed note never breaks the card.
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";
import { MarkdownImageContext, type MarkdownImage, type MarkdownImageDraw } from "./markdown-image-context";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type ReadRecordImage = (src: string) => Promise<Blob>;

class RecordMarkdownBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <p dir="auto" className="whitespace-pre-wrap break-words" data-record-markdown-fallback="">{this.props.text}</p>;
    return this.props.children;
  }
}

/** The images already read, as object addresses, per reader (one open record) and source; the oldest go first. */
const KEPT_IMAGES = 60;
const kept = new Map<string, Promise<string>>();
const readers = new WeakMap<ReadRecordImage, number>();
let nextReader = 0;

export function recordImageUrl(read: ReadRecordImage, src: string): Promise<string> {
  let reader = readers.get(read);
  if (reader === undefined) {
    reader = ++nextReader;
    readers.set(read, reader);
  }
  const key = `${reader}\u0001${src}`;
  const known = kept.get(key);
  if (known) return known;
  const url = read(src).then((blob) => URL.createObjectURL(blob));
  kept.set(key, url);
  // a failed read is tried again the next time the note is drawn
  url.catch(() => { if (kept.get(key) === url) kept.delete(key); });
  while (kept.size > KEPT_IMAGES) {
    const [oldest, value] = kept.entries().next().value as [string, Promise<string>];
    kept.delete(oldest);
    void value.then((address) => URL.revokeObjectURL(address), () => undefined);
  }
  return url;
}

/** The product writes "[image]" (or a file name) as an image's words: a person reads "Image". */
function imageName(alt: string | undefined): string {
  const words = (alt ?? "").replace(/^\[|\]$/g, "").trim();
  return !words || /^image$/i.test(words) ? t("recordCard.related.noteImage") : words;
}

function RecordImage({ image, read }: { image: MarkdownImage; read?: ReadRecordImage }) {
  const [shown, setShown] = useState<{ src: string; url?: string; failed?: boolean }>({ src: image.src });
  useEffect(() => {
    let live = true;
    setShown({ src: image.src });
    if (!read) {
      setShown({ src: image.src, failed: true });
      return;
    }
    recordImageUrl(read, image.src).then(
      (url) => { if (live) setShown({ src: image.src, url }); },
      () => { if (live) setShown({ src: image.src, failed: true }); },
    );
    return () => { live = false; };
  }, [read, image.src]);
  const name = imageName(image.alt);
  const linked = image.openUrl;
  if (linked) {
    // a signature's icon: small, quiet, its link kept; nothing when it does not come
    if (shown.failed) return null;
    return (
      <button type="button" className="me-1 inline-flex align-middle opacity-80 hover:opacity-100" title={linked} aria-label={name} data-record-note-image="linked" onClick={() => { void openExternalLink(linked); }}>
        {shown.url ? <img src={shown.url} alt="" className="h-4 w-auto max-w-[5rem] object-contain" /> : <span aria-hidden="true" className="inline-block size-4 rounded-[3px] bg-popover-field" />}
      </button>
    );
  }
  if (shown.failed) {
    return <span className="inline-flex items-center gap-1 text-[13px] leading-[18px] text-popover-ink-secondary" data-record-note-image="missing"><ImageOff size={14} aria-hidden="true" />{name}</span>;
  }
  if (!shown.url) return <span role="img" aria-label={name} aria-busy="true" className="my-1 block h-20 w-36 animate-pulse rounded-md bg-popover-field motion-reduce:animate-none" data-record-note-image="loading" />;
  return <img src={shown.url} alt={name} className="my-1 block h-auto max-h-80 max-w-full rounded-md object-contain" data-record-note-image="shown" />;
}

const ENTITY: Record<string, string> = { "(": "&#40;", ")": "&#41;", "[": "&#91;", "]": "&#93;", "$": "&#36;" };

/** The product's Markdown as the chat's renderer must read it: vendor text is
 * no formula. The product escapes brackets and parentheses (`\(`, `\[`),
 * which the chat reads as math delimiters, and a price's `$` would open a
 * formula: each becomes the same character as a reference, which Markdown
 * reads as that character and nothing else. */
export function vendorMarkdown(text: string): string {
  return text.replace(/\\([()[\]])|\$/g, (whole, escaped: string | undefined) => ENTITY[escaped ?? whole] ?? whole);
}

/** A record's Markdown at the card's size, its images read as the person. */
export function RecordMarkdown({ text, readImage, className }: { text: string; readImage?: ReadRecordImage; className?: string }) {
  // every image of the text: an inline raster is drawn by the chat's renderer (no network), any other address
  // goes through the card's route or stays words
  const draw = useMemo<MarkdownImageDraw>(() => (image) => image.src.startsWith("data:") ? undefined : <RecordImage image={image} read={readImage} />, [readImage]);
  return (
    <div dir="auto" data-record-markdown="" className={cn("min-w-0 break-words [&_.chat-md]:leading-[inherit]", className)}>
      <RecordMarkdownBoundary key={text} text={text}>
        <MarkdownImageContext.Provider value={draw}>
          <ChatMarkdown text={vendorMarkdown(text)} inert />
        </MarkdownImageContext.Provider>
      </RecordMarkdownBoundary>
    </div>
  );
}
