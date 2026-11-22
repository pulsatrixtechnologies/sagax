// The spoken register — turning an agent's answer into something worth
// hearing.
//
// Agents write for a screen: fenced code, file paths, tables, link soup,
// bullet scaffolding. Read aloud verbatim that is unbearable — a 40-line
// diff becomes four minutes of punctuation, and `server/drivers/acp/core.ts`
// becomes "server slash drivers slash a c p slash core dot t s".
//
// So every string is passed through here before it reaches a voice. The
// rule is: say the prose, name the artifacts, drop the syntax. A code block
// becomes "a code block" — the user is looking at the screen if they care,
// and this is the half of the feature that decides whether it is pleasant.
//
// Identifiers (UUIDs, hashes, tokens, "#1234") are never said and absolute
// paths keep their last name (shared/spoken-identifiers.ts).
//
// Pure and synchronous on purpose: it is the piece most likely to need
// tuning against real transcripts, so it stays trivially testable.

import { withoutRecordLinks } from "../../shared/record-cards.ts";
import { stripSpokenIdentifiers } from "../../shared/spoken-identifiers.ts";

/** A fenced block becomes a mention of itself, with its language if known. */
function describeCodeBlock(fence: string): string {
  const lang = fence.trim().split(/\s+/)[0]?.replace(/[^a-z0-9+#]/gi, "") ?? "";
  type SpokenLanguages = Record<string, string>;
  const spoken: SpokenLanguages = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    json: "JSON",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    rs: "Rust",
    go: "Go",
    swift: "Swift",
    diff: "diff",
  };
  const name = spoken[lang.toLowerCase()];
  return name ? `. (a ${name} code block) ` : ". (a code block) ";
}

/** `a/b/c/file.ts` → `file.ts`. A path's directories are for the eye. */
function shortenPaths(text: string): string {
  return text.replace(/(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, "$1");
}

/** Trailing punctuation that already ends a sentence. */
const ENDS_SENTENCE = /[.!?:;]\s*$/;

/**
 * Markdown (or any agent output) → a line a voice can read.
 *
 * Not a markdown parser: a sequence of narrow, ordered replacements, which
 * is both fast enough to run per token-flush and easy to reason about when
 * one of them misfires on a real transcript.
 */
export function speakable(input: string): string {
  if (!input) return "";
  // #4507: a record link is said by its label, its address never
  let text = withoutRecordLinks(input);

  // fenced code first — everything inside must survive none of the rules below
  text = text.replace(/```([^\n]*)\n[\s\S]*?(?:```|$)/g, (_m, fence: string) => describeCodeBlock(fence));
  text = text.replace(/~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g, (_m, fence: string) => describeCodeBlock(fence));

  // images before links — the syntax differs by one character
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt ? `. (image: ${alt}) ` : ". (an image) "));
  // [label](url) → label; a bare url becomes a noun rather than an alphabet soup
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<https?:\/\/[^>\s]+>/g, " a link ");
  text = text.replace(/\bhttps?:\/\/\S+/g, " a link ");
  text = text.replace(/\bwww\.[^\s<>()]+/gi, " a link ");

  // tables: a grid is hopeless aloud, and the separator row is pure noise
  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, "");
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", "),
  );

  // inline code: keep short identifiers (they carry meaning), drop long ones
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => (code.length <= 40 ? code : " that snippet "));

  // headings become sentences so the voice pauses instead of running on
  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, head: string) =>
    ENDS_SENTENCE.test(head) ? head : `${head.trim()}.`,
  );

  // list scaffolding: the marker is visual, the pause is what matters
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "");

  // emphasis / strikethrough markers
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // checkboxes read as literal brackets otherwise
  text = text.replace(/\[[ xX]\]\s*/g, "");

  text = stripSpokenIdentifiers(text);
  text = shortenPaths(text);

  // emoji and the pictographic ranges: a voice either ignores them or,
  // worse, announces them by name
  text = text.replace(
    // oxlint-disable-next-line no-misleading-character-class -- variation selectors are stripped on their own, not as part of a grapheme
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u200D\u20E3]/gu,
    "",
  );

  // a blank line is a paragraph break — make it an audible one
  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, ". ");

  // tidy the punctuation the substitutions above inevitably pile up
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([.,!?;:])/g, "$1");
  text = text.replace(/(?:\.\s*){2,}/g, ". ");
  text = text.replace(/,\s*\./g, ".");
  text = text.trim();

  // The paragraph→". " rule turns whitespace-only input into a lone full
  // stop, which a synthesizer happily renders as a click. Nothing to say
  // means nothing to send.
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

/** Longest unfinished word an open utterance holds back (characters): past
 * it the run is cleaned as it is (a run that long without a space is an
 * opaque token, which the identifier filter removes in pieces too). */
export const DELTA_HOLD_MAX = 400;

/** A label that names the identifier coming next ("id:", "uuid =", "#"). */
const ID_LABEL_TAIL = /(^|\s)((?:id|uuid|guid)\b\s*[:=#]?\s*)$/i;
/** The text ends a sentence: its last word is whole. */
const SENTENCE_END_TAIL = /[.!?…]["'»)\]]*$/;

/**
 * Split appended text where the identifier filter can see whole words.
 * The streaming voice gets an answer in pieces that may cut a word (a UUID,
 * a hash, "#1234") in two, and each half alone passes the filter
 * (shared/spoken-identifiers.ts). So the last, unfinished word is held
 * until a space or a sentence end follows it (or the utterance finishes),
 * and an id label is held with it. `ready` may be cleaned and said now.
 */
export function splitHeldDelta(text: string): { ready: string; held: string } {
  if (!text) return { ready: "", held: "" };
  if (text.length > DELTA_HOLD_MAX || SENTENCE_END_TAIL.test(text)) return { ready: text, held: "" };
  // the held word keeps the space before it, so the words stay apart
  const cut = /\s$/.test(text) ? text.length : text.search(/\s*\S+$/);
  let ready = text.slice(0, cut);
  let held = text.slice(cut);
  const label = ID_LABEL_TAIL.exec(ready);
  if (label) {
    const tail = `${label[1]}${label[2]}`;
    held = `${tail}${held}`;
    ready = ready.slice(0, ready.length - tail.length);
  }
  return { ready, held };
}

/**
 * Words appended to an open utterance, made speakable like `speakable` but
 * with their edges kept: " pense" stays apart from the word before it, and a
 * lone "." or "?" still ends the sentence. Nothing to say: "".
 */
export function speakableDelta(input: string): string {
  if (!/\S/.test(input)) return "";
  const before = /^\s/.test(input) ? " " : "";
  const after = /\s$/.test(input) ? " " : "";
  const core = speakable(input) || input.replace(/[^.,!?;:…]/g, "");
  return core ? `${before}${core}${after}` : "";
}

/** Sentence-ish boundary: `.`/`!`/`?` followed by space, but not inside a
 * decimal, an ellipsis, or a common abbreviation. */
const BOUNDARY = /(?<!\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|No|approx))(?<![.\d])([.!?])(["')\]]*)\s+/g;
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Split speakable text into utterances a synthesizer can start on.
 *
 * Both tiers want this: cloud TTS charges and buffers per request, and the
 * local model generates per utterance — so the unit of work is a sentence
 * either way. Very short fragments are glued onto their neighbour, because
 * a synthesizer given two words produces two words of flat, contextless
 * prosody.
 */
export function toUtterances(input: string, { minChars = 12, maxChars = 320 } = {}): string[] {
  const text = speakable(input);
  if (!text) return [];

  // Split on a sentinel, never on the whitespace itself: the boundary
  // match consumes the trailing space, so splitting on " " would split
  // every word in the text rather than every sentence.
  const MARK = "\u0000";
  const rough = text
    .replace(BOUNDARY, `$1$2${MARK}`)
    .split(MARK)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of rough) {
    // a sentence longer than the cap is broken at a clause, never mid-word
    const parts = piece.length <= maxChars ? [piece] : splitLong(piece, maxChars);
    for (const part of parts) {
      const prev = out[out.length - 1];
      if (prev && prev.length + part.length + 1 <= maxChars && (prev.length < minChars || part.length < minChars)) {
        out[out.length - 1] = `${prev} ${part}`;
      } else {
        out.push(part);
      }
    }
  }
  return out;
}

function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // prefer a clause break, then any space; never cut a word in half
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" — "));
    let cut = at > maxChars / 2 ? at + 1 : window.lastIndexOf(" ");
    if (cut <= 0) cut = unspacedCut(rest, maxChars);
    // No word boundary inside the cap: still take a piece the speak route
    // accepts, on a grapheme boundary so a mark or a surrogate stays whole.
    if (cut <= 0) cut = graphemeCut(rest, maxChars);
    if (cut <= 0) break;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The last word start that still fits, or a grapheme inside one Katakana run. */
function unspacedCut(text: string, maxChars: number): number {
  let firstWord: Intl.SegmentData | undefined;
  let cut = -1;
  for (const segment of WORD_SEGMENTER.segment(text)) {
    if (segment.index > maxChars) break;
    if (!segment.isWordLike) continue;
    if (firstWord) cut = segment.index;
    else firstWord = segment;
  }
  if (cut > 0 || !firstWord || !/^[\p{Script_Extensions=Katakana}\p{M}]+$/u.test(firstWord.segment)) return cut;
  for (const { index } of GRAPHEME_SEGMENTER.segment(firstWord.segment)) {
    const boundary = firstWord.index + index;
    if (boundary > maxChars) break;
    if (index > 0) cut = boundary;
  }
  return cut;
}

function graphemeCut(text: string, maxChars: number): number {
  let cut = -1;
  for (const { index } of GRAPHEME_SEGMENTER.segment(text)) {
    if (index > maxChars) break;
    if (index > 0) cut = index;
  }
  return cut;
}

/** A tool-activity chip as a spoken progress line ("reading core.ts").
 * Returns null for chips not worth interrupting the ear for. */
export function narrateTool(toolName: string): string | null {
  const name = toolName.replace(/^mcp__[^_]+__/, "").trim();
  if (!name) return null;
  // the harness writes these as chips too; they are already spoken elsewhere
  if (/^(auto-approved|error):/i.test(name)) return null;

  const bare = name.toLowerCase();
  const verbs: Array<[RegExp, string]> = [
    [/^(bash|shell|terminal|run_command|execute|computer_exec)$/, "running a command"],
    [/^(read|read_file|view)$/, "reading a file"],
    [/^(write|create_file)$/, "writing a file"],
    [/^(edit|apply_patch|str_replace|multiedit)$/, "editing a file"],
    [/^(grep|search|glob|find)$/, "searching"],
    [/^(web_?search|websearch)$/, "searching the web"],
    [/^(web_?fetch|fetch)$/, "reading a page"],
    [/^screenshot$/, "looking at the screen"],
    [/^(click|type_text|press_key|scroll|computer_batch)$/, "using the computer"],
    [/^open_url$/, "opening a page"],
    [/^list_bots$/, "checking who's around"],
    [/^ask_bot$/, "asking a teammate"],
  ];
  for (const [pattern, phrase] of verbs) {
    if (pattern.test(bare)) return phrase;
  }
  // an unrecognized tool still deserves a beat, but not its raw argv
  const short = shortenPaths(name).slice(0, 40);
  return /^[\w .:/-]+$/.test(short) ? `running ${short}` : null;
}
