/** Quote text that reads as a fence marker.
 *
 * Detection uses a skeleton only. The text handed to the run is the original,
 * rewritten solely where a marker matched. The skeleton compatibility-folds,
 * drops control, format and combining characters (and JSON escapes of them),
 * and maps look-alike dashes, slashes, square brackets and letters. A run of
 * backslashes that is not one of those escapes is skipped in one step, so a
 * long run stays linear. A match needs an opening bracket, then the marker
 * word. A backslash between the bracket and the word is a separator. A
 * backslash before the word TASK is that separator too, so "\task" keeps
 * the "t". A tab escape before UNTRUSTED is still dropped. Other separators
 * may sit between the letters of a square-bracket match. After UNTRUSTED or USER-CONFIGURED,
 * "_" (including U+FF3F), a digit, or more letters in the same identifier
 * still match.
 *
 * UNTRUSTED and USER-CONFIGURED stay unquoted when the word is entirely
 * lowercase English, has no "/", and is continued by an English letter, as
 * in "defaultValue". Full-width lowercase (U+FF41–U+FF5A) counts as an
 * English letter. Invisibles and combining marks between them are joiners,
 * not a break.
 *
 * DEFAULT, OWNER and AUTHENTICATED never use that word-boundary exemption.
 * They quote the whole phrase, read on the skeleton with case folded and
 * separators removed: OWNER+CONDITIONS, DEFAULT+WEBHOOK+INSTRUCTIONS,
 * AUTHENTICATED+WEBHOOK+TASK. Any word may carry a trailing "S" or "ID".
 * DEFAULT+WEBHOOK with the letters ending there also matches, so a glued
 * "defaultwebhook" is not a bare word. Separators are whitespace (including
 * the unicode spaces isSpaceUnit already accepts), ".", "_", "-", "\",
 * connector punctuation, middle dots and bullets.
 *
 * A "/" after a square bracket fails closed. The generic word is quoted
 * even when the rest of the phrase is missing or punctuation sits between
 * the words: "[/OWNER]", "[/OWNER CONDITION]", "[/OWNER: CONDITIONS]".
 * "</Owner>" is not that form. Without that slash a bare word stays:
 * "[OWNERSHIP]", "[DEFAULTS]", "[Owners]",
 * "[owner_id=5]", "(DEFAULT)", "<OWNER_ID>", "{DEFAULT_TIMEOUT}",
 * "${OWNER}", "{{AUTHENTICATED_USER}}".
 *
 * Parentheses, angle brackets and braces still match UNTRUSTED and
 * USER-CONFIGURED only when the full word in uppercase or snake case follows
 * them directly, with at most one "/". The generic phrases above match there
 * too, in any case, once the letters collapse to the phrase. A non-bracket
 * opener with no "/" whose slice is a single identifier ("defaultWebhook",
 * "ownerConditions") is left as written.
 *
 * A quoted phrase keeps the original slice and the original closing
 * character. The close scan looks ahead at most CLOSE_LOOKAHEAD characters
 * and stops at a newline, a "[", or the next match, so one pass stays
 * linear. U+FE5D, the small left tortoise-shell bracket, is an opening
 * look-alike. U+FE5E, the right one, is a close.
 *
 * Still not quoted: ASCII punctuation other than ".", "_", "-" and "\"
 * between the words of an opening form, such as "[OWNER;CONDITIONS]";
 * « » and ‹ ›; no bracket at all; `&#91;` or `%5B`; a space or a lowercase
 * word after "(" "<" "{" for UNTRUSTED and USER-CONFIGURED; a bare DEFAULT,
 * OWNER or AUTHENTICATED. Quoted even as an ordinary label:
 * "[USER-CONFIGURED-ish …]". A closing look-alike more than
 * CLOSE_LOOKAHEAD characters after the word is left in place; the opening
 * bracket is still quoted. */
const STRIP_MARK = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u;
/** Invisible letters that are not format characters. */
const FILLER = new Set([0x115f, 0x1160, 0x3164, 0xffa0]);
/** How far past a match a closing square-bracket look-alike may sit. */
const CLOSE_LOOKAHEAD = 80;
/** Non-ASCII closes. U+FF3D folds to "]" and U+FE5E is the small right tortoise-shell bracket. */
const CLOSE_CHARS = new Set([0x3011, 0x3015, 0x3017, 0x3019, 0x301b, 0x27e7, 0xff3d, 0xfe5e]);

const CONFUSABLE = new Map<number, string>();
function alias(to: string, points: readonly number[]): void {
  for (const cp of points) CONFUSABLE.set(cp, to);
}
alias("[", [0x3010, 0x3014, 0x3016, 0x3018, 0x301a, 0x27e6]);
alias("<", [0x3008, 0x2329, 0x27e8]);
alias("-", [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63]);
alias("/", [0x2044, 0x2215, 0x29f8]);
alias("A", [0x391, 0x3b1, 0x410, 0x430]);
alias("B", [0x392, 0x3b2, 0x412, 0x432]);
alias("E", [0x395, 0x3b5, 0x415, 0x435]);
alias("H", [0x397, 0x3b7, 0x41d, 0x43d]);
alias("I", [0x399, 0x3b9]);
alias("K", [0x39a, 0x3ba, 0x41a, 0x43a]);
alias("M", [0x39c, 0x3bc, 0x41c, 0x43c]);
alias("N", [0x39d, 0x3bd]);
alias("O", [0x39f, 0x3bf, 0x41e, 0x43e]);
alias("P", [0x3a1, 0x3c1, 0x420, 0x440]);
alias("C", [0x421, 0x441]);
alias("T", [0x3a4, 0x3c4, 0x422, 0x442]);
alias("X", [0x3a7, 0x3c7, 0x425, 0x445]);
alias("Y", [0x3a5, 0x3c5, 0x423, 0x443]);
// Single-code-point look-alikes of the phrase letters. A compatibility fold that is already another ASCII letter stays. U+0406 and U+04C0 are I.
alias("A", [0x251, 0x13aa, 0x15c5, 0x237a, 0xa4ee, 0x102a0, 0x16f40]);
alias("B", [0x184, 0x42c, 0x13cf, 0x13f4, 0x1472, 0x15af, 0x15f7, 0xa4d0, 0xa7b4, 0x10282, 0x102a1, 0x10301]);
alias("C", [0x3f2, 0x3f9, 0x13df, 0x1d04, 0x2ca4, 0x2ca5, 0xa4da, 0xabaf, 0x102a2, 0x10302, 0x10415, 0x1043d, 0x1051c, 0x118e9, 0x118f2, 0x1f74c]);
alias("D", [0x501, 0x13a0, 0x13e7, 0x146f, 0x15de, 0x15ea, 0xa4d2, 0xa4d3]);
alias("E", [0x4bd, 0x13ac, 0x212e, 0x22ff, 0x2d39, 0xa4f0, 0xab32, 0x10286, 0x118a6, 0x118ae]);
alias("F", [0x3dc, 0x584, 0x15b4, 0x1e9d, 0xa4dd, 0xa798, 0xa799, 0xab35, 0x10287, 0x102a5, 0x10525, 0x118a2, 0x118c2, 0x1d213, 0x1d7ca]);
alias("G", [0x18d, 0x261, 0x50c, 0x581, 0x13c0, 0x13f3, 0x1d83, 0xa4d6]);
alias("H", [0x4bb, 0x570, 0x13bb, 0x13c2, 0x157c, 0x2c8e, 0xa4e7, 0x102cf]);
alias("I", [0x131, 0x269, 0x26a, 0x2db, 0x37a, 0x406, 0x456, 0x4c0, 0x4cf, 0x13a5, 0x2373, 0xa647, 0xab75, 0x118c3, 0x1d6a4]);
alias("K", [0x13e6, 0x16d5, 0x2c94, 0xa4d7, 0x10518]);
alias("L", [0x196, 0x1c0, 0x5c0, 0x5d5, 0x5df, 0x627, 0x661, 0x6f1, 0x7ca, 0x13de, 0x14aa, 0x16c1, 0x2223, 0x23fd, 0x2c92, 0x2cd0, 0x2d4f, 0xa4e1, 0xa4f2, 0xfe8d, 0xfe8e, 0xffe8, 0x1028a, 0x10309, 0x10320, 0x1041b, 0x10526, 0x118a3, 0x118b2, 0x16f16, 0x16f28, 0x1d22a, 0x1d7cf, 0x1d7d9, 0x1d7e3, 0x1d7ed, 0x1d7f7, 0x1e8c7, 0x1ee00, 0x1ee80, 0x1fbf1]);
alias("N", [0x578, 0x57c, 0x2c9a, 0xa4e0, 0x10513]);
alias("O", [0x3c3, 0x555, 0x585, 0x5e1, 0x647, 0x665, 0x6be, 0x6c1, 0x6d5, 0x6f5, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb20, 0xb66, 0xbe6, 0xc02, 0xc66, 0xc82, 0xce6, 0xd02, 0xd20, 0xd66, 0xd82, 0xe50, 0xed0, 0x101d, 0x1040, 0x10ff, 0x12d0, 0x1d0f, 0x1d11, 0x2c9e, 0x2c9f, 0x2d54, 0x3007, 0xa4f3, 0xab3d, 0xfba6, 0xfba7, 0xfba8, 0xfba9, 0xfbaa, 0xfbab, 0xfbac, 0xfbad, 0xfee9, 0xfeea, 0xfeeb, 0xfeec, 0x10292, 0x102ab, 0x10404, 0x1042c, 0x104c2, 0x104ea, 0x10516, 0x114d0, 0x118b5, 0x118c8, 0x118d7, 0x118e0, 0x1d6d4, 0x1d70e, 0x1d748, 0x1d782, 0x1d7bc, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1ee24, 0x1ee64, 0x1ee84, 0x1fbf0]);
alias("R", [0x1a6, 0x433, 0x13a1, 0x13d2, 0x1587, 0x1d26, 0x2c85, 0xa4e3, 0xab47, 0xab48, 0xab81, 0x104b4, 0x16f35, 0x1d216]);
alias("S", [0x1bd, 0x405, 0x455, 0x54f, 0x13d5, 0x13da, 0xa4e2, 0xa731, 0xabaa, 0x10296, 0x10420, 0x10448, 0x118c1, 0x16f3a]);
alias("T", [0x13a2, 0x22a4, 0x27d9, 0x2ca6, 0xa4d4, 0x10297, 0x102b1, 0x10315, 0x118bc, 0x16f0a, 0x1f768]);
alias("U", [0x28b, 0x54d, 0x57d, 0x1200, 0x144c, 0x1d1c, 0x222a, 0x22c3, 0xa4f4, 0xa79f, 0xab4e, 0xab52, 0x104ce, 0x104f6, 0x118b8, 0x118d8, 0x16f42]);
alias("W", [0x26f, 0x461, 0x51c, 0x51d, 0x561, 0x13b3, 0x13d4, 0x1d21, 0xa4ea, 0xab83, 0x1170a, 0x1170e, 0x1170f, 0x118e6, 0x118ef]);
// Latin small capitals of the phrase letters. C, I, O, S, U and W are already mapped above.
alias("A", [0x1d00]);
alias("B", [0x299]);
alias("D", [0x1d05]);
alias("E", [0x1d07]);
alias("F", [0xa730]);
alias("G", [0x262]);
alias("H", [0x29c]);
alias("K", [0x1d0b]);
alias("L", [0x29f]);
alias("N", [0x274]);
alias("R", [0x280]);
alias("T", [0x1d1b]);

const foldedCodePoints = new Map<number, string>();

/** Middle dots, bullets, and the braille blank. Connector punctuation is matched by category.
 * Checked before the compatibility fold: U+318D would otherwise become U+119E. */
const DOT_OR_BULLET = new Set([
  0x00b7, 0x2022, 0x2023, 0x2024, 0x2027, 0x2043, 0x2219, 0x22c5, 0x25e6, 0x30fb, 0x16eb, 0x2800,
  0x2e31, 0x2e33, 0x318d, 0x2981, 0x05c3,
]);

function foldCodePoint(cp: number): string {
  if (cp < 0x80) {
    if (cp <= 0x1f || cp === 0x7f) return "";
    return CONFUSABLE.get(cp) ?? String.fromCharCode(cp);
  }
  const cached = foldedCodePoints.get(cp);
  if (cached !== undefined) return cached;
  const folded = foldNonAscii(cp);
  foldedCodePoints.set(cp, folded);
  return folded;
}

function foldNonAscii(cp: number): string {
  // A chosen dot can compatibility-fold into a letter (U+318D becomes U+119E).
  // Keep it a separator before that fold. The quoted slice stays the original character.
  if (DOT_OR_BULLET.has(cp)) return " ";
  const direct = CONFUSABLE.get(cp);
  if (direct !== undefined) return direct;
  if (FILLER.has(cp)) return "";
  const compat = String.fromCodePoint(cp).normalize("NFKC").normalize("NFD");
  let out = "";
  for (let i = 0; i < compat.length; ) {
    const next = compat.codePointAt(i)!;
    const len = next > 0xffff ? 2 : 1;
    if (next < 0x80) {
      if (next > 0x1f && next !== 0x7f) out += CONFUSABLE.get(next) ?? String.fromCharCode(next);
    } else if (!FILLER.has(next) && !STRIP_MARK.test(String.fromCodePoint(next))) {
      out += CONFUSABLE.get(next) ?? String.fromCodePoint(next);
    }
    i += len;
  }
  return out;
}

/** True when the characters at `tIndex` spell TASK, so `\task` is a separator plus the word. */
function tabStartsTask(text: string, tIndex: number): boolean {
  const want = "TASK";
  let k = 0;
  const limit = Math.min(text.length, tIndex + 16);
  for (let i = tIndex; i < limit && k < want.length; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const folded = foldCodePoint(cp);
    i += len;
    if (!folded) continue;
    for (let p = 0; p < folded.length; p++) {
      const code = folded.charCodeAt(p);
      if (isMarkerSep(code)) {
        if (k === 0) return false;
        continue;
      }
      if (!sameLetter(code, want.charCodeAt(k))) return false;
      k += 1;
      if (k === want.length) return true;
    }
  }
  return false;
}

/** Parallel arrays, one entry per skeleton unit, so a long scan does not allocate an object per character. */
type MarkerSpans = { starts: number[]; ends: number[] };

/** Skeleton used only to find markers. Each unit records the slice of `text` it came from. */
function markerSkeleton(text: string): { skeleton: string; spans: MarkerSpans } {
  const units: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const emit = (chunk: string, start: number, end: number) => {
    for (let i = 0; i < chunk.length; i++) {
      units.push(chunk[i]!);
      starts.push(start);
      ends.push(end);
    }
  };
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (cp === 0x5c) {
      let j = i + 1;
      while (j < text.length && text.charCodeAt(j) === 0x5c) j += 1;
      const next = text[j];
      // `\n` and `\\n` (a JSON string of those two characters) are both a break.
      // `\t` before TASK is a separator plus the word. `\t` before UNTRUSTED is still a tab.
      if (next && "bfnrtv0".includes(next)) {
        const keepT = next === "t" && tabStartsTask(text, j);
        if (!keepT) {
          i = j + 1;
          continue;
        }
        if (j > i + 1) {
          i = j;
          continue;
        }
      }
      // A JSON text escapes a backslash, so `\\/` is the two characters `\/`.
      if (next === "/") {
        emit("/", i, j + 1);
        i = j + 1;
        continue;
      }
      if (j === i + 1 && (next === "u" || next === "U") && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        const decoded = Number.parseInt(text.slice(i + 2, i + 6), 16);
        if (foldCodePoint(decoded) === "") {
          i += 6;
          continue;
        }
      }
      // Not an escape. Skip the whole run once; emitting a pair and rescanning is quadratic.
      if (j > i + 1) {
        i = j;
        continue;
      }
    }
    const folded = foldCodePoint(cp);
    if (folded) emit(folded, i, i + len);
    i += len;
  }
  return { skeleton: units.join(""), spans: { starts, ends } };
}

const MARKER_WORDS = ["USERCONFIGURED", "AUTHENTICATED", "UNTRUSTED", "DEFAULT", "OWNER"] as const;

function isSpaceUnit(code: number): boolean {
  if (code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13) return true;
  return code > 127 && /\s/u.test(String.fromCharCode(code));
}

const markerSepCache = new Map<number, boolean>();
const MARKER_SEP_CACHE_MAX = 2048;

/** Shared separator for square-bracket words and generic phrases.
 * A superset of isSpaceUnit: also ".", "_", "-", "\", Zs/Zl/Zp, Pc, dots and bullets. */
function isMarkerSep(code: number): boolean {
  if (code < 128) return isSpaceUnit(code) || code === 46 || code === 95 || code === 45 || code === 92;
  const cached = markerSepCache.get(code);
  if (cached !== undefined) return cached;
  const ch = String.fromCharCode(code);
  const sep = isSpaceUnit(code) || DOT_OR_BULLET.has(code) || /\p{Z}|\p{Pc}/u.test(ch);
  if (markerSepCache.size < MARKER_SEP_CACHE_MAX) markerSepCache.set(code, sep);
  return sep;
}

function isSepUnit(code: number): boolean {
  return isMarkerSep(code);
}

function sameLetter(code: number, want: number): boolean {
  if (code >= 97 && code <= 122) code -= 32;
  return code === want;
}

type MarkerMode = "square" | "alt";

/** Letters of one marker word. Separators between them are taken greedily, once. */
function matchLetters(skeleton: string, at: number, letters: string, mode: MarkerMode): number {
  let j = at;
  for (let k = 0; k < letters.length; k++) {
    if (j >= skeleton.length) return -1;
    const code = skeleton.charCodeAt(j);
    if (!sameLetter(code, letters.charCodeAt(k))) return -1;
    // An alt opener accepts only an uppercase or snake-case word.
    if (mode === "alt" && (code < 65 || code > 90)) return -1;
    j += 1;
    if (k === letters.length - 1) break;
    if (mode === "alt") {
      while (j < skeleton.length) {
        const sep = skeleton.charCodeAt(j);
        if (sep !== 95 && sep !== 45) break;
        j += 1;
      }
    } else {
      while (j < skeleton.length && isSepUnit(skeleton.charCodeAt(j))) j += 1;
    }
  }
  return j;
}

/** Every letter of the matched word is a lowercase English letter. */
function wordIsLowerEnglish(skeleton: string, from: number, to: number): boolean {
  let saw = false;
  for (let k = from; k < to; k++) {
    const code = skeleton.charCodeAt(k);
    if (code >= 97 && code <= 122) {
      saw = true;
      continue;
    }
    if (code >= 65 && code <= 90) return false;
  }
  return saw;
}

/** Control, format and combining characters, plus the Hangul fillers. A boundary skips these. */
function isJoiner(cp: number): boolean {
  if (cp <= 0x1f || cp === 0x7f || FILLER.has(cp)) return true;
  if (cp < 0x80) return false;
  return STRIP_MARK.test(String.fromCodePoint(cp));
}

/** ASCII Latin, plus full-width Latin (U+FF21–U+FF3A, U+FF41–U+FF5A). */
function isLatinLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a);
}

/** True when the original text continues the word the way "defaultValue" does.
 * "_", a digit, a slash, or any other continuation is still a match.
 * Full-width lowercase counts as an English letter. */
function isProseContinuation(text: string, from: number, lowerEnglish: boolean, slash: boolean): boolean {
  if (slash || !lowerEnglish) return false;
  let i = from;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (isJoiner(cp)) {
      i += len;
      continue;
    }
    if (cp === 0x5f || cp === 0xff3f || (cp >= 0x30 && cp <= 0x39)) return false;
    return isLatinLetter(cp);
  }
  return false;
}

/** The words that follow a generic marker word. INSTRUCTIONS may be absent when the letters end. */
const GENERIC_REST: Readonly<Record<string, readonly string[]>> = {
  DEFAULT: ["WEBHOOK", "INSTRUCTIONS"],
  OWNER: ["CONDITIONS"],
  AUTHENTICATED: ["WEBHOOK", "TASK"],
};

const PHRASE_TAILS = ["S", "ID"] as const;

function isGenericWord(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(GENERIC_REST, word);
}

/** Same separator set as a square-bracket match. Tab is already gone from the skeleton. */
function isPhraseSep(code: number): boolean {
  return isMarkerSep(code);
}

function skipPhraseSep(skeleton: string, j: number): number {
  while (j < skeleton.length && isPhraseSep(skeleton.charCodeAt(j))) j += 1;
  return j;
}

function isSkeletonLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** One phrase word. Separators between its letters are skipped, not required. */
function matchCollapsedWord(skeleton: string, j: number, word: string): number {
  let p = j;
  for (let k = 0; k < word.length; k++) {
    if (k > 0) p = skipPhraseSep(skeleton, p);
    if (p >= skeleton.length || !sameLetter(skeleton.charCodeAt(p), word.charCodeAt(k))) return -1;
    p += 1;
  }
  return p;
}

function lettersEnd(skeleton: string, j: number): boolean {
  const p = skipPhraseSep(skeleton, j);
  return p >= skeleton.length || !isSkeletonLetter(skeleton.charCodeAt(p));
}

/** An optional trailing "S" or "ID" that does not eat the next word. */
function matchTailThenWord(skeleton: string, j: number, word: string): number {
  for (const tail of PHRASE_TAILS) {
    const afterTail = matchCollapsedWord(skeleton, skipPhraseSep(skeleton, j), tail);
    if (afterTail < 0) continue;
    const afterWord = matchCollapsedWord(skeleton, skipPhraseSep(skeleton, afterTail), word);
    if (afterWord >= 0) return afterWord;
  }
  return -1;
}

function applyLastTail(skeleton: string, j: number): number {
  for (const tail of PHRASE_TAILS) {
    const after = matchCollapsedWord(skeleton, skipPhraseSep(skeleton, j), tail);
    if (after >= 0 && lettersEnd(skeleton, after)) return after;
  }
  return j;
}

/** Skeleton index after the collapsed phrase, or -1. */
function matchFullPhrase(skeleton: string, at: number, head: string): number {
  const rest = GENERIC_REST[head];
  if (!rest) return -1;
  let j = matchCollapsedWord(skeleton, at, head);
  if (j < 0) return -1;
  const lastOptional = head === "DEFAULT";
  for (let w = 0; w < rest.length; w++) {
    const word = rest[w]!;
    const direct = matchCollapsedWord(skeleton, skipPhraseSep(skeleton, j), word);
    if (direct >= 0) {
      j = direct;
      continue;
    }
    const tailed = matchTailThenWord(skeleton, j, word);
    if (tailed >= 0) {
      j = tailed;
      continue;
    }
    if (w === rest.length - 1 && lastOptional && lettersEnd(skeleton, j)) return applyLastTail(skeleton, j);
    return -1;
  }
  return applyLastTail(skeleton, j);
}

/** Whole phrase, or a square slash form of the head word. A square slash fails closed. */
function matchGenericPhrase(skeleton: string, at: number, head: string, slash: boolean, mode: MarkerMode): number {
  const phrase = matchFullPhrase(skeleton, at, head);
  if (phrase >= 0) return phrase;
  if (!(slash && mode === "square")) return -1;
  return matchCollapsedWord(skeleton, at, head);
}

/** One ASCII identifier, the shape of "defaultWebhook". */
function isBareIdentifier(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const digit = code >= 48 && code <= 57;
    if (i === 0 ? !letter : !letter && !digit) return false;
  }
  return true;
}

type MarkerHit = { skStart: number; skEnd: number; slash: boolean; word: string; phrase: boolean; opener: number };

/** Spaces, and a backslash, between the bracket and the word. Alt openers still refuse a space. */
function skipGap(skeleton: string, j: number, mode: MarkerMode): number {
  while (j < skeleton.length) {
    const code = skeleton.charCodeAt(j);
    if (code === 0x5c || (mode === "square" && isMarkerSep(code))) {
      j += 1;
      continue;
    }
    break;
  }
  return j;
}

/** Longest marker at `i`. One forward pass, no retry. The boundary is read on `text`. */
function matchAt(skeleton: string, i: number, text: string, spans: MarkerSpans, mode: MarkerMode): MarkerHit | null {
  let j = skipGap(skeleton, i + 1, mode);
  const len = skeleton.length;
  let slash = false;
  if (j < len && skeleton.charCodeAt(j) === 0x2f) {
    slash = true;
    j = skipGap(skeleton, j + 1, mode);
  }
  const wordAt = j;
  let best = -1;
  let word = "";
  let phrase = false;
  for (const letters of MARKER_WORDS) {
    if (isGenericWord(letters)) {
      const phraseEnd = matchGenericPhrase(skeleton, wordAt, letters, slash, mode);
      if (phraseEnd <= best) continue;
      // A parenthesized identifier is not a fence line. A slash or a square bracket still quotes.
      if (mode === "alt" && !slash && isBareIdentifier(text.slice(spans.starts[wordAt]!, spans.ends[phraseEnd - 1]!))) continue;
      best = phraseEnd;
      word = letters;
      phrase = true;
      continue;
    }
    const end = matchLetters(skeleton, wordAt, letters, mode);
    if (end <= best) continue;
    const letterEnd = spans.ends[end - 1]!;
    if (isProseContinuation(text, letterEnd, wordIsLowerEnglish(skeleton, wordAt, end), slash)) continue;
    best = end;
    word = letters;
    phrase = false;
  }
  if (best < 0) return null;
  const opener = skeleton.charCodeAt(i);
  if (phrase) {
    const from = spans.starts[wordAt]!;
    const to = spans.ends[best - 1]!;
    return { skStart: i, skEnd: best, slash, word: text.slice(from, to), phrase: true, opener };
  }
  let shown = "";
  for (let k = wordAt; k < best; k++) {
    if (!isSpaceUnit(skeleton.charCodeAt(k))) shown += skeleton[k];
  }
  return { skStart: i, skEnd: best, slash, word: shown || word, phrase: false, opener };
}

function findMarkers(skeleton: string, text: string, spans: MarkerSpans): MarkerHit[] {
  const hits: MarkerHit[] = [];
  for (let i = 0; i < skeleton.length; i++) {
    const code = skeleton.charCodeAt(i);
    const mode: MarkerMode | null = code === 0x5b ? "square" : code === 0x28 || code === 0x3c || code === 0x7b ? "alt" : null;
    if (!mode) continue;
    const hit = matchAt(skeleton, i, text, spans, mode);
    if (!hit) continue;
    hits.push(hit);
    i = hit.skEnd - 1;
  }
  return hits;
}

function skeletonEnd(spans: MarkerSpans, skEnd: number, textLength: number): number {
  if (skEnd >= spans.starts.length) return textLength;
  const next = spans.starts[skEnd]!;
  const last = skEnd > 0 ? spans.ends[skEnd - 1]! : 0;
  return next > last ? next : last;
}

/** A non-ASCII closing square bracket within a fixed lookahead is part of the marker. */
function absorbClose(text: string, from: number, stopAt: number): { end: number; middle: string } | null {
  const limit = Math.min(text.length, from + CLOSE_LOOKAHEAD, stopAt);
  for (let i = from; i < limit; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (cp === 0x0a || cp === 0x0d || cp === 0x5b) break;
    if (CLOSE_CHARS.has(cp)) return { end: i + len, middle: `${text.slice(from, i)}]` };
    i += len;
  }
  return null;
}

function isPhraseCloser(cp: number, opener: number): boolean {
  if (opener === 0x28) return cp === 0x29;
  if (opener === 0x3c) return cp === 0x3e || cp === 0xff1e || cp === 0x232a || cp === 0x3009 || cp === 0x27e9;
  if (opener === 0x7b) return cp === 0x7d;
  return cp === 0x5d || CLOSE_CHARS.has(cp);
}

/** The original closer, if it sits within the lookahead. `close` is that character, never a forced "]". */
function balancePhrase(text: string, from: number, stopAt: number, opener: number): { end: number; middle: string; close: string } {
  const limit = Math.min(text.length, from + CLOSE_LOOKAHEAD, stopAt);
  for (let i = from; i < limit; ) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (cp === 0x0a || cp === 0x0d || cp === 0x5b) break;
    if (isPhraseCloser(cp, opener)) return { end: i + len, middle: text.slice(from, i), close: text.slice(i, i + len) };
    i += len;
  }
  return { end: from, middle: "", close: "" };
}

/** ASCII with no bracket and no backslash cannot contain a marker or a JSON escape of one. */
function needsScan(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5b || code === 0x5c || code === 0x28 || code === 0x3c || code === 0x7b || code > 0x7f) return true;
  }
  return false;
}

function hasOpener(skeleton: string): boolean {
  for (let i = 0; i < skeleton.length; i++) {
    const code = skeleton.charCodeAt(i);
    if (code === 0x5b || code === 0x28 || code === 0x3c || code === 0x7b) return true;
  }
  return false;
}

export function defang(text: string): string {
  if (!text || !needsScan(text)) return text;
  const { skeleton, spans } = markerSkeleton(text);
  if (!hasOpener(skeleton)) return text;
  const hits = findMarkers(skeleton, text, spans);
  if (hits.length === 0) return text;
  const parts: string[] = [];
  let cursor = 0;
  for (let n = 0; n < hits.length; n++) {
    const hit = hits[n]!;
    const start = spans.starts[hit.skStart]!;
    if (start < cursor) continue;
    let end = skeletonEnd(spans, hit.skEnd, text.length);
    let replacement = `[${hit.slash ? "/" : ""}(quoted) ${hit.word}`;
    const nextStart = n + 1 < hits.length ? spans.starts[hits[n + 1]!.skStart]! : text.length;
    if (hit.phrase) {
      const balanced = balancePhrase(text, end, nextStart, hit.opener);
      replacement += balanced.middle + balanced.close;
      end = balanced.end;
    } else {
      const closed = absorbClose(text, end, nextStart);
      if (closed) {
        replacement += closed.middle;
        end = closed.end;
      }
    }
    parts.push(text.slice(cursor, start), replacement);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}
