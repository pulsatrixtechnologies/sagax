// How a bot shapes a reply (#2949, 2026-11-08: tables everywhere make
// replies hard to read). Bots put short states and sentences in a two-column table
// ("Piece | State", one sentence per row): harder to read than a short list
// or a few lines of prose. The prompt says the rule (OUTPUT_STYLE_RULE, sent
// to every bot through RICH_OUTPUT_PROMPT, its brief and the cold prompt);
// the reply check (shared/reply-style.ts) rewrites a key/sentence table the
// model still wrote as a bulleted list with bold labels.

/** The output-style rule every bot gets. */
export const OUTPUT_STYLE_RULE =
  " Output style: by default answer in short prose, or a short bulleted list with the label in bold (\"- **Label**: what it is\")."
  + " Use a table only for real tabular data: at least 3 columns of comparable values (numbers, dates, ids), more than about 6 rows of the same kind, or when the person asks for a table."
  + " Never a two-column label and sentence table, never a table for a status or a summary."
  + " When a compact Sagax card fits (an ```email draft, an ```artifact link, a ```cw card the person asked for), it wins over a table or a list.";

/** One short rule for the cold (routine, automation) prompt. */
export const OUTPUT_STYLE_RULE_SHORT =
  " Default to short prose or a short list with bold labels; a table only for 3+ columns of comparable values, 6+ rows of one kind, or on request; never a label and sentence or status table.";

const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** A table row: a line with at least one unescaped pipe. */
const ROW = /(?<!\\)\|/;

/** The cells of one Markdown table row (escaped pipes kept). */
function cells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const columnsOf = (separator: string): number => cells(separator).length;

/** A cell that reads as a sentence, not a value: several words or a stop. */
export function isSentenceCell(cell: string): boolean {
  const text = cell.replace(/<br\s*\/?>/gi, " ").replace(/[*_`]/g, "").trim();
  if (!text || !/\p{L}/u.test(text)) return false;
  const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return words.length >= 5 || (words.length >= 3 && /[.!?;]$/.test(text));
}

export interface KeySentenceTable {
  /** Line index of the header row. */
  start: number;
  /** Line index after the last body row. */
  end: number;
  rows: Array<[string, string]>;
}

/** Markdown tables with two columns whose second column is sentences (at
 * least half its rows, and at least one row). Code fences are skipped. */
export function findKeySentenceTables(text: string): KeySentenceTable[] {
  const lines = text.split("\n");
  const found: KeySentenceTable[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const separator = lines[index + 1];
    if (!ROW.test(line) || separator === undefined || !SEPARATOR.test(separator)) continue;
    if (columnsOf(separator) !== 2 || cells(line).length !== 2) continue;
    const rows: Array<[string, string]> = [];
    let end = index + 2;
    while (end < lines.length && lines[end]!.trim() && ROW.test(lines[end]!)) {
      const row = cells(lines[end]!);
      if (row.length !== 2) break;
      rows.push([row[0]!, row[1]!]);
      end++;
    }
    const sentences = rows.filter(([, value]) => isSentenceCell(value)).length;
    if (rows.length > 0 && sentences > 0 && sentences * 2 >= rows.length) found.push({ start: index, end, rows });
    index = end - 1;
  }
  return found;
}

const unescape = (cell: string): string => cell.replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
const bold = (label: string): string => (/^\*\*.*\*\*$/.test(label) ? label : `**${label.replace(/^\*+|\*+$/g, "")}**`);

/** The reply with every key/sentence table rewritten as a bulleted list with
 * bold labels. Anything else is left as it is. */
export function rewriteKeySentenceTables(text: string): string {
  const tables = findKeySentenceTables(text);
  if (tables.length === 0) return text;
  const lines = text.split("\n");
  for (const table of [...tables].reverse()) {
    const list = table.rows.map(([label, value]) => {
      const key = unescape(label);
      const said = unescape(value);
      return key ? `- ${bold(key)}: ${said}` : `- ${said}`;
    });
    lines.splice(table.start, table.end - table.start, ...list);
  }
  return lines.join("\n");
}
