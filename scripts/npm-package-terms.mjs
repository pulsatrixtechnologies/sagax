// What the published npm package must not carry: the name of the company
// that runs this project's production servers, personal names, initials and
// handles, internal bot names and tracker ids, and the name of the reference
// design product. Every packed file is scanned; a hit fails the build unless
// its surroundings match an entry of scripts/npm-package-allowlist.json, each
// of which says why it must stay (a third-party format, URL scheme or legacy
// folder the code reads, an interop name, or a minifier's variable name).
//
// The repository is public, so the private words are kept here only as
// truncated SHA-256 digests of a normalized word (NFKC, then lower case for
// the case-insensitive tables), or of two words in a row joined by one space,
// never in clear. Add one with:
//   node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16))' "word"
//
// How text is cut into words: a run of letters, digits and underscores is a
// token; a token is cut again at underscores, at a lower-to-upper case change
// (camelCase) and between letters and digits, so `x_name`, `nameCloud` and
// `NAME103` all expose `name`. Two words in a row form a pair when only a
// space, a hyphen, an underscore, an escaped `\n` or a case change separates
// them. The company name is also found inside any longer word (`namecloud`).
//
// Files: a file with a NUL byte is never skipped. One with a known binary
// extension (images, fonts, models, wasm, archives) is scanned through its
// printable runs (ASCII and UTF-16LE) of eight characters or more, for whole
// words only (three letters occur by chance in compressed data); any other
// file with a NUL byte fails the scan outright, since it may be text that
// hides a NUL to dodge it.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const digest = (word) => createHash("sha256").update(word).digest("hex").slice(0, 16);
const memo = new Map();
const digestOf = (word) => {
  let value = memo.get(word);
  if (value === undefined) {
    value = digest(word);
    if (memo.size > 500_000) memo.clear();
    memo.set(word, value);
  }
  return value;
};
const normalize = (word) => word.normalize("NFKC");

/** Words compared in lower case: digest of the lower-cased word -> term. */
export const LOWER_CASE_WORDS = {
  "95b1f0ce16eec5ba": "company",
  "4013f3f63adf789c": "personal",
  "0d1e0a13c7935528": "personal",
  "5d73a46da19b81d4": "personal",
  "d4343d5772372939": "personal",
  "d4d0195bcb7a7433": "personal", // two words
  "c6530c42a4f21811": "personal", // two words
  "30a8f22d1f57fda8": "personal",
  "6236954eb0980f3a": "bot-name",
  "91a0cfaa688b7e7b": "bot-name",
  f3a5ba05f3002a12: "bot-name",
  a553c8dc7ec47458: "bot-name",
  "00447316ad065bab": "bot-name",
  "8e4325e6f8910469": "tracker", // followed by digits, after at most one separator
};

/** Words compared exactly as written, for those that are also ordinary
 * words or letters in another case. */
export const EXACT_WORDS = {
  a767e517e7eb77fd: "initials",
  b3a70b7ccfdbfae8: "bot-name",
  "6f1a2ccc7674d380": "bot-name",
  bec3edacc0089f86: "bot-name",
  b37e689205876888: "bot-name",
  "3e8abb191e56ce20": "bot-name",
  d9dacb3ee168be4d: "bot-name",
};

/** Words found inside any longer word too (lower case): digest -> { term, length }. */
export const SUBSTRING_WORDS = {
  "95b1f0ce16eec5ba": { term: "company", length: 3 },
};

/** Initials in any case: always when joined to another word by `_` or `-`
 * (`x_ab`, `ab-x`); alone only in prose files, because a minifier picks
 * two-letter names in code. Digest of the lower-cased letters -> term. */
export const JOINED_INITIALS = {
  "9f1c9ed30e18c430": "initials",
};

/** Public names, kept as patterns: the reference design product, also across
 * a line break, including an escaped one inside JSON. */
export const PATTERN_TERMS = [{ id: "grok-bot", pattern: /grok(?:[\s_-]|\\n)*bot/gi }];

/** Files that are prose, not code: lone initials in any case count there. */
const PROSE = /\.(?:md|mdx|markdown|txt|json|jsonl|ya?ml|html?|csv|toml)$/i;
/** Extensions of real binary files, scanned through their printable runs. */
const BINARY = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".icns", ".bmp", ".tif", ".tiff",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".wasm", ".onnx", ".bin", ".node", ".data", ".dat", ".pak",
  ".gz", ".tgz", ".br", ".zip", ".zst",
  ".mp3", ".mp4", ".ogg", ".wav", ".webm", ".m4a", ".flac",
  ".pdf", ".bcmap", ".pfb", ".icc",
]);

const CONTEXT = 48;
const TOKEN = /[\p{L}\p{N}_]+/gu;
// Pieces of a token: a capitalised or lower-case word, an upper-case run not
// followed by a lower-case letter, or digits. Underscores fall between pieces.
const PIECE = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lt}\p{Ll}*|\p{L}+|\p{N}+/gu;
const LETTERS = /\p{L}+/gu;
const PAIR_GAP = /^(?:[\s_-]|\\n)*$/;
const JOIN_GAP = /^[_-]+$/;
const ALNUM = /[\p{L}\p{N}]/u;
const DOTTED_INITIALS = /(?<![\p{L}\p{N}.])(\p{L})\.\s?(\p{L})\.(?![\p{L}\p{N}])/gu;

/** The allowlist: { term, context (a regex source), reason } entries, with
 * an optional `files` regex source limiting the files an entry covers. */
// The source scan's second pass (scripts/check-source-terms.mjs): files the
// package never holds but the public repository shows. Tests and fixtures in
// any case (ios/Tests, ios/UITests, Fixtures/, SagaxTests/, package-fixtures/)
// and the whole iOS tree, which ships as an app, not in the package.
const TEST_OR_FIXTURE_PATH = /(?:\.test\.|\.e2e\.|\.node-test\.|\.spec\.|(?:^|\/)(?:__tests__|testing|[\w-]*?tests?|e2e|[\w-]*?fixtures?|__fixtures__|__snapshots__)\/|(?:Tests?|UITests?)\.swift$)/i;
export const PUBLIC_SOURCE_TREES = ["ios"];
const EVERYWHERE_SKIPPED_PATH = /(?:^|\/)(?:third_party|node_modules)\/|^pnpm-lock\.yaml$|^src\/data\/given-names\/|\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|wasm|zip|gz|mp[34]|m4a|wav|caf|aiff?|mov|pdf|bin|onnx|gguf|p8|car|mlmodelc?)$/i;
export function everywhereSkipped(file) {
  return EVERYWHERE_SKIPPED_PATH.test(file);
}
export function secondPassPath(file) {
  if (!file || everywhereSkipped(file)) return false;
  return TEST_OR_FIXTURE_PATH.test(file) || PUBLIC_SOURCE_TREES.some((tree) => file.startsWith(`${tree}/`));
}

export function loadAllowlist(file) {
  const entries = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${file} must be a JSON array`);
  return entries.map((entry, index) => {
    if (!entry || typeof entry.term !== "string" || typeof entry.context !== "string" || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${file} entry ${index} needs term, context and a reason`);
    }
    if (entry.files !== undefined && typeof entry.files !== "string") throw new Error(`${file} entry ${index}: files must be a regex source`);
    return { term: entry.term, context: new RegExp(entry.context, "g"), files: entry.files === undefined ? null : new RegExp(entry.files), reason: entry.reason };
  });
}

// The allowlisted text must overlap the hit itself, so an allowed name nearby
// never covers a different one.
function covers(pattern, context, from, to) {
  for (const found of context.matchAll(pattern)) {
    if (found.index < to && found.index + found[0].length > from) return true;
  }
  return false;
}

/** Every word piece of `text`, in order, with its position, and the whole
 * tokens and `_` parts of tokens they came from. */
function pieces(text) {
  const out = [];
  const wholes = [];
  for (const token of text.matchAll(TOKEN)) {
    for (const piece of token[0].matchAll(PIECE)) out.push({ value: piece[0], index: token.index + piece.index });
    let at = 0;
    const parts = token[0].split("_");
    for (const part of parts) {
      if (part && parts.length > 1) wholes.push({ value: part, index: token.index + at });
      at += part.length + 1;
    }
    wholes.push({ value: token[0], index: token.index });
  }
  return { words: out, wholes };
}

const trackerFollows = (text, end) => /^(?:[\s_-]|\\n)?\p{N}/u.test(text.slice(end, end + 3));

function lookup(value, text, end, segment) {
  const normal = normalize(value);
  let term = EXACT_WORDS[digestOf(normal)] ?? LOWER_CASE_WORDS[digestOf(normal.toLowerCase())];
  if (term === "initials" && !segment) term = undefined;
  if (term === "tracker" && !trackerFollows(text, end)) term = undefined;
  return term;
}

function wordHits(text, prose) {
  const { words, wholes } = pieces(text);
  const hits = [];
  // Whole tokens and `_` parts: a handle with digits (`name123`) is one word.
  for (const whole of wholes) {
    if (whole.value.length < 2) continue;
    const term = lookup(whole.value, text, whole.index + whole.value.length, true);
    if (term) hits.push({ term, index: whole.index, length: whole.value.length });
  }
  words.forEach((word, i) => {
    const value = normalize(word.value);
    const lower = value.toLowerCase();
    const end = word.index + word.value.length;
    // Initials count only as a whole token or a whole `_` part of one: inside
    // a camelCase or letter-digit run they are noise (hashes, base64, minified names).
    const segment = !ALNUM.test(text[word.index - 1] ?? "") && !ALNUM.test(text[end] ?? "");
    const term = lookup(word.value, text, end, segment);
    if (term) hits.push({ term, index: word.index, length: word.value.length });
    const initials = !term && segment && lower.length === 2 ? JOINED_INITIALS[digestOf(lower)] : undefined;
    if (initials) {
      const before = words[i - 1];
      const after = words[i + 1];
      const joined = (before && JOIN_GAP.test(text.slice(before.index + before.value.length, word.index)))
        || (after && JOIN_GAP.test(text.slice(end, after.index)));
      if (joined || prose) hits.push({ term: initials, index: word.index, length: word.value.length });
    }
    const next = words[i + 1];
    if (next && PAIR_GAP.test(text.slice(end, next.index))) {
      const pair = LOWER_CASE_WORDS[digestOf(`${lower} ${normalize(next.value).toLowerCase()}`)];
      if (pair) hits.push({ term: pair, index: word.index, length: next.index + next.value.length - word.index });
    }
  });
  return hits;
}

const SUBSTRING_LENGTHS = () => [...new Set(Object.values(SUBSTRING_WORDS).map((entry) => entry.length))];

function substringHits(text) {
  const hits = [];
  const lengths = SUBSTRING_LENGTHS();
  for (const run of text.matchAll(LETTERS)) {
    const lower = normalize(run[0]).toLowerCase();
    if (lower.length !== run[0].length) continue; // NFKC changed the length: the word path covers it
    for (const length of lengths) {
      for (let at = 0; at + length <= lower.length; at += 1) {
        const found = SUBSTRING_WORDS[digestOf(lower.slice(at, at + length))];
        if (found && found.length === length) hits.push({ term: found.term, index: run.index + at, length });
      }
    }
  }
  return hits;
}

function dottedInitialHits(text) {
  const hits = [];
  for (const match of text.matchAll(DOTTED_INITIALS)) {
    const term = JOINED_INITIALS[digestOf(normalize(match[1] + match[2]).toLowerCase())];
    if (term) hits.push({ term, index: match.index, length: match[0].length });
  }
  return hits;
}

/** Every forbidden hit in `text` (from `file`, relative to the package),
 * with the allowlist entry that covers it, if any. The matched word is
 * masked, so a log of the hits does not spell it out either. */
export function scanText(text, allowlist = [], file = "", { binary = false } = {}) {
  const prose = !binary && PROSE.test(file);
  // Inside the printable runs of a binary file, a three-letter word turns up
  // by chance, so only whole words count there.
  const found = [...wordHits(text, prose), ...(binary ? [] : substringHits(text))];
  if (prose) found.push(...dottedInitialHits(text));
  for (const term of PATTERN_TERMS) {
    for (const match of text.matchAll(term.pattern)) found.push({ term: term.id, index: match.index, length: match[0].length });
  }
  // One report per place: a word found both whole and inside itself counts once.
  const seen = new Set();
  return found
    .sort((a, b) => a.index - b.index || b.length - a.length)
    .filter(({ term, index }) => {
      const key = `${term}:${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ term, index, length }) => {
      const start = Math.max(0, index - CONTEXT);
      const context = text.slice(start, index + length + CONTEXT);
      const at = index - start;
      const allowedBy = allowlist.find((entry) => entry.term === term && (!entry.files || entry.files.test(file)) && covers(entry.context, context, at, at + length));
      const masked = `${context.slice(0, at)}${text[index]}${"*".repeat(length - 1)}${context.slice(at + length)}`;
      return { term, index, context: masked, allowedBy };
    });
}

/** The printable runs of a binary file, ASCII and UTF-16LE, joined by line
 * breaks so a word never spans two runs. */
export function printableRuns(bytes, min = 8) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i += 1) {
    const printable = i < bytes.length && bytes[i] >= 0x20 && bytes[i] < 0x7f;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      if (i - start >= min) runs.push(bytes.toString("latin1", start, i));
      start = -1;
    }
  }
  for (const offset of [0, 1]) {
    let run = "";
    for (let i = offset; i + 1 < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      if (code >= 0x20 && code < 0x7f) run += String.fromCharCode(code);
      else {
        if (run.length >= min) runs.push(run);
        run = "";
      }
    }
    if (run.length >= min) runs.push(run);
  }
  return runs.join("\n");
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Scan a package folder: { blocked, allowed } hits, each with its file. */
export function scanPackage(dir, allowlist = []) {
  const blocked = [];
  const allowed = [];
  for (const path of walk(dir)) {
    const bytes = readFileSync(path);
    const file = relative(dir, path).replaceAll("\\", "/");
    let text;
    const binary = bytes.includes(0);
    if (!binary) text = bytes.toString("utf8");
    else if (BINARY.has(extname(file).toLowerCase())) text = printableRuns(bytes);
    else {
      blocked.push({ file, term: "nul-byte", index: bytes.indexOf(0), context: "a NUL byte in a file that is not a known binary type", allowedBy: undefined });
      continue;
    }
    for (const hit of scanText(text, allowlist, file, { binary })) {
      (hit.allowedBy ? allowed : blocked).push({ file, ...hit });
    }
  }
  return { blocked, allowed };
}
