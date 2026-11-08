// Markdown read as plain words, for every surface that shows a message
// without drawing it: a push banner (APNs, FCM), a desktop notification, the
// sidebar's last-message line, a reach-me notice. The chat bubble draws the
// Markdown; everywhere else a person reads what it says.
//
// A bot's push read "Rien à trancher. | Champ | Valeur | | --- | --- | |
// Source | Nova..." (2026-11-08): the server flattened the newlines
// before anything looked at the table, so no line rule could match it. The
// Markdown leaves first here, and the flattening comes after.
//
// This is a reading aid, not a Markdown parser. It never needs to be exact,
// only to never show syntax a person did not type to be read.

import { stripChatSpecialTokens } from "./chat-special-tokens.ts";

export interface PlainTextOptions {
  /** A fenced block whose info string (```lang) this accepts is dropped
   * whole: a rich view's source (widget HTML, chart JSON) is code to draw
   * something, never something to read. */
  isRichFence?: (info: string) => boolean;
  /** Drop every fenced code block instead of reading it as its code (a lock
   * screen has no room for code). Inline `code` still reads as its text. */
  dropCode?: boolean;
}

/** One line of plain text: Markdown gone, whitespace collapsed. */
export function markdownToPlainText(raw: string, options: PlainTextOptions = {}): string {
  return plainTextBody(stripChatSpecialTokens(raw ?? ""), options);
}

/** One line for a banner or a preview, at most `max` characters, cut at a
 * word boundary with an ellipsis when it is longer. */
export function plainPreviewLine(raw: string, max: number, options: PlainTextOptions = { dropCode: true }): string {
  return clipAtWord(markdownToPlainText(raw, options), max);
}

/** `text` at most `max` characters, cut at the last word boundary that keeps
 * most of it, never in the middle of a word when a boundary is near. */
export function clipAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  if (clean.length <= max) return clean;
  if (max === 1) return "…";
  let cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // a boundary far back would throw most of the line away: cut the word then
  if (space >= Math.floor((max - 1) * 0.6)) cut = cut.slice(0, space);
  cut = cut.trimEnd().replace(/[\s,;:·|([{-]+$/u, "");
  return `${cut}…`;
}

/** A table's cells, the outer pipes gone (an escaped pipe was parked). */
function tableCells(row: string): string[] {
  let inner = row.trim();
  if (inner.startsWith("|")) inner = inner.slice(1);
  if (inner.endsWith("|")) inner = inner.slice(0, -1);
  return inner.split("|").map((cell) => cell.trim());
}

/** A row read as a pair: the first cell is the key, the rest its value. */
function tableRowText(cells: string[]): string {
  const filled = cells.filter(Boolean);
  if (!filled.length) return "";
  const [key, ...rest] = cells;
  const value = rest.filter(Boolean).join(", ");
  if (!key) return value;
  return value ? `${key} : ${value}` : key;
}

const SEPARATOR_LINE = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

/** `| a | b |` (or a row the stream cut: `| a | b`). A whole table already
 * flattened on one line (`| a | b | | --- | --- | | x | y |`) is not a row:
 * flattenedTables reads it by its separator. */
function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  if (FLAT_SEPARATOR.test(trimmed) && !isSeparatorLine(trimmed)) return false;
  return trimmed.startsWith("|") && (trimmed.match(/\|/g)?.length ?? 0) >= 2;
}

const FLAT_SEPARATOR = /\|[ \t]*:?-{3,}:?[ \t]*\|/;

function isSeparatorLine(line: string): boolean {
  return line.includes("|") && line.includes("-") && SEPARATOR_LINE.test(line);
}

/** Tables laid out on lines: the header row (it names the columns, not a
 * value) leaves, each body row reads `key : value`, rows joined by `; `. */
function linedTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const next = lines[index + 1];
    const headed = line.includes("|") && next !== undefined && isSeparatorLine(next);
    if (!headed && !isPipeRow(line)) {
      // a separator line alone (a table whose header the stream cut) reads as nothing
      out.push(isSeparatorLine(line) ? "" : line);
      continue;
    }
    const rows: string[] = [];
    let cursor = index;
    if (headed) cursor += 2;
    else {
      rows.push(tableRowText(tableCells(line)));
      cursor += 1;
    }
    while (cursor < lines.length && lines[cursor]!.includes("|") && lines[cursor]!.trim() !== "") {
      if (!isSeparatorLine(lines[cursor]!)) rows.push(tableRowText(tableCells(lines[cursor]!)));
      cursor++;
    }
    out.push(rows.filter(Boolean).join("; "));
    index = cursor - 1;
  }
  return out.join("\n");
}

const INLINE_SEPARATOR = /\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+/g;

/** A table already flattened onto one line (`| a | b | | --- | --- | | x |
 * y |`), as an older server or a clipped body sends it: the separator says
 * how many cells a row holds, which is enough to find the rows again. */
function flattenedTables(text: string): string {
  let out = text;
  for (let guard = 0; guard < 32; guard++) {
    INLINE_SEPARATOR.lastIndex = 0;
    let replaced = false;
    for (let match = INLINE_SEPARATOR.exec(out); match; match = INLINE_SEPARATOR.exec(out)) {
      const columns = match[0].match(/-{3,}/g)!.length;
      const before = out.slice(0, match.index);
      const header = before.match(new RegExp(`\\|(?:[^|\\n]*\\|){${columns}}[ \\t]*$`));
      let end = match.index + match[0].length;
      const rows: string[] = [];
      const row = new RegExp(`^[ \\t]*\\|((?:[^|\\n]*\\|){${columns}})`);
      for (let found = out.slice(end).match(row); found; found = out.slice(end).match(row)) {
        rows.push(tableRowText(tableCells(`|${found[1]}`)));
        end += found[0].length;
      }
      // the last row of a clipped body has no closing pipe: it runs to the end of the line
      const partial = out.slice(end).match(/^[ \t]*\|([^\n]*)/);
      if (partial && partial[1]!.trim()) {
        rows.push(tableRowText(tableCells(partial[1]!)));
        end += partial[0].length;
      }
      const start = header ? match.index - header[0].length : match.index;
      const pairs = rows.filter(Boolean).join("; ");
      out = `${out.slice(0, start).trimEnd()}${start > 0 ? " " : ""}${pairs}${end < out.length ? " " : ""}${out.slice(end).trimStart()}`;
      replaced = true;
      break;
    }
    if (!replaced) break;
  }
  return out;
}

function plainTextBody(text: string, options: PlainTextOptions): string {
  const isRichFence = options.isRichFence ?? (() => false);
  // backslash escapes read as the character: park them out of the way so
  // no rule below takes an escaped * or _ (or a cell's \|) for markup
  const escaped: string[] = [];
  let out = text.replace(/\r\n?/g, "\n").replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_match, char: string) => {
    escaped.push(char);
    return `${escaped.length - 1}`;
  });
  // code reads as its code, untouched by the rules below: park each fenced
  // block's body (dropping the fence lines and language tag, closed or cut
  // off mid-stream) and each inline code span's text
  const code: string[] = [];
  const park = (body: string) => {
    // inside code a backslash is literal, so an escape reads as typed
    code.push(body.replace(/(\d+)/g, (_match, index: string) => `\\${escaped[Number(index)] ?? ""}`));
    return `${code.length - 1}`;
  };
  // (a closing fence is the same character, at least as long as the opening)
  out = out.replace(/^[ \t]*((`|~)\2{2,})([^\n]*)(?:\n([\s\S]*?))?(?:\n[ \t]*\1\2*[ \t]*(?=\n|$(?![\s\S]))|$(?![\s\S]))/gm, (_block, _fence: string, _char: string, info: string, body: string | undefined) => {
    if (options.dropCode || isRichFence(info)) return "\n";
    return `\n${park(body ?? "")}\n`;
  });
  out = out.replace(/(`+)([^`]*?)\1/g, (_span, _ticks: string, body: string) => park(body));
  // images read as their alt text, links as their label
  out = out.replace(/!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1");
  out = out.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  out = out.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1");
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  // a link reference definition is not something to read
  out = out.replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]+\S+.*$/gm, "");
  // <https://example.com> autolinks read as the address
  out = out.replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1");
  // html line breaks and simple inline tags
  // (until stable, so a tag split by another, <sp<b>an>, leaves none behind;
  // capped so deeply nested hostile input cannot stall a preview)
  for (let previous = "", pass = 0; previous !== out && pass < 32; pass++) {
    previous = out;
    out = out.replace(/<br\s*\/?>/gi, " ");
    out = out.replace(/<\/?(?:b|strong|i|em|u|s|del|ins|mark|code|kbd|sub|sup|small|span|p|div)\b[^>]*>/gi, "");
  }
  // tables read as `key : value` pairs, laid out on lines or already flat
  out = linedTables(out);
  out = flattenedTables(out);
  // block markers at the start of a line: headings, quotes, list bullets,
  // task boxes and horizontal rules
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]*$/gm, "");
  out = out.replace(/^[ \t]*(?:>[ \t]?)+/gm, "");
  out = out.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "");
  out = out.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, "");
  // emphasis: ***x***, **x**, __x__, *x*, _x_, ~~x~~. Underscores inside a
  // word (snake_case) are not emphasis, and a lone * (2 * 3) is not either.
  out = out.replace(/(\*{1,3}|_{1,3})(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}])/gu, (match, marks: string, inner: string, offset: number, whole: string) => {
    if (marks[0] === "_" && offset > 0 && /[\p{L}\p{N}]/u.test(whole[offset - 1]!)) return match;
    return inner;
  });
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  // a reply cut off mid-stream leaves an unclosed ** or ``` behind
  out = out.replace(/\*\*+|`{3,}|~~/g, "");
  out = out.replace(/(\d+)/g, (_match, index: string) => code[Number(index)] ?? "");
  out = out.replace(/(\d+)/g, (_match, index: string) => escaped[Number(index)] ?? "");
  return out.replace(/\s+/g, " ").trim();
}
