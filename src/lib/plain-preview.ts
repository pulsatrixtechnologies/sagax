import { t } from "@/lib/i18n";
import { richFenceKind } from "@/lib/rich-blocks";
import { stripChatSpecialTokens } from "../../shared/chat-special-tokens";
import { markdownToPlainText } from "../../shared/plain-text";

/**
 * One line of plain text for a list preview (the sidebar's bot and room
 * rows): what a person would read in the message, without the Markdown that
 * draws it. `**bold**` reads as bold, `[name](url)` as name, a code fence as
 * its code, a heading or list item as its words and a table row as
 * `key : value` (shared/plain-text.ts, the same reading every notification
 * surface uses).
 *
 * This is a reading aid, not a Markdown parser. It never needs to be exact,
 * only to never show syntax a person did not type to be read.
 */
export function plainPreviewText(raw: string): string {
  // a reply stored before the server dropped a leaked chat-template token
  // (`<|eos|>`) never reads as that token
  const text = stripChatSpecialTokens(raw);
  const out = markdownToPlainText(text, {
    isRichFence,
    attachmentLabels: { image: t("preview.attachment.image"), gif: t("preview.attachment.gif"), file: t("preview.attachment.file") },
  });
  // a reply that is nothing but a rich view (a ```widget, chart, table...)
  // has no sentence to preview: name the view rather than show its source
  return out || (hasRichFence(text) ? t("sidebar.preview.richBlock") : out);
}

const RICH_PREVIEW_LANGS = new Set(["mermaid"]);

function isRichFence(info: string): boolean {
  const lang = info.trim().split(/\s+/)[0] ?? "";
  return richFenceKind(lang) !== null || RICH_PREVIEW_LANGS.has(lang.toLowerCase());
}

function hasRichFence(text: string): boolean {
  for (const match of text.matchAll(/^[ \t]*(?:`{3,}|~{3,})([^\n]*)/gm)) if (isRichFence(match[1] ?? "")) return true;
  return false;
}
