// What of the bot's answer a call reads aloud. Pure.
//
// The bot is told it is on the phone (server/voice/voice-call-prompt.ts), but a
// model still slips in a bold word, a bullet, an emoji or a link. This is the
// safety net on this side, before a sentence goes to text to speech (the
// server's speakable text, server/tts/speech-text.ts, runs again on it).
//
// Identifiers (UUIDs, hashes, tokens, "#1234") are never said and absolute
// paths keep their last name (shared/spoken-identifiers.ts).
//
// The bot ends a call with a written follow-up below a line of only `---`:
// that part is for the chat and is never spoken.

import { stripSpokenIdentifiers } from "../../../shared/spoken-identifiers";

/** A line of only ---, *** or ___: the written follow-up starts below it. */
const FOLLOW_UP_RULE = /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m;

/** The part of an answer to read aloud: everything before the follow-up rule. */
export function spokenPart(text: string): string {
  const rule = FOLLOW_UP_RULE.exec(text);
  return rule ? text.slice(0, rule.index) : text;
}

// oxlint-disable-next-line no-misleading-character-class -- each mark is stripped on its own, not as part of a grapheme
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍⃣︎️]/gu;

/** A sentence without markdown, emoji, URLs or HTML, whitespace folded. */
export function speakableSentence(piece: string): string {
  let text = piece;
  // code fences: the code is for the eye
  text = text.replace(/```[\s\S]*?(```|$)/g, " ");
  text = text.replace(/~~~[\s\S]*?(~~~|$)/g, " ");
  // images, then links: the label stays, the address goes
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<(?:https?:\/\/|mailto:)[^>\s]+>/gi, " ");
  text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,!?;:'"]/gi, " ");
  // HTML tags
  text = text.replace(/<\/?[a-z][^>]*>/gi, " ");
  // table rows and separators
  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, " ");
  text = text.replace(/^\s*\|/gm, "").replace(/\|\s*$/gm, "").replace(/\s*\|\s*/g, ", ");
  // headings, list markers, quotes, rules
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ");
  // checkboxes, emphasis, strikethrough, inline code
  text = text.replace(/\[[ xX]\]\s*/g, "");
  text = text.replace(/(\*\*|__)(.+?)\1/g, "$2");
  text = text.replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\w)/g, "$1$2");
  text = text.replace(/(^|\W)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1$2");
  text = text.replace(/~~(.+?)~~/g, "$1");
  text = text.replace(/`([^`\n]*)`/g, "$1");
  text = text.replace(/[`*]+/g, " ");
  text = text.replace(PICTOGRAPHS, "");
  text = stripSpokenIdentifiers(text);
  text = text.replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").replace(/^[\s,;:]+/, "").trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

/** A bot's answer as the call's transcript shows it: the spoken part only
 * (the written follow-up stays in the chat), without markdown, one
 * sentence per former line or bullet, never `**bold**` or `- ` shown raw.
 * `limit` (the answer budget's cut, answer-budget.ts) keeps what was said;
 * a cut answer ends with an ellipsis, the rest being in the chat. */
export function transcriptText(text: string, cut?: { text: string; cut: string | null }): string {
  const source = cut ? cut.text : spokenPart(text);
  const lines = source
    .split(/\n+/)
    .map((line) => speakableSentence(line))
    .filter(Boolean)
    .map((line) => (/[.!?…:;,]$/.test(line) ? line : `${line}.`));
  const joined = lines.join(" ");
  return cut?.cut === "length" && joined ? `${joined.replace(/[.!?…:;,]$/, "")}…` : joined;
}
