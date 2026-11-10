// How a bot shapes a reply (#2949, 2026-11-08: tables everywhere make
// replies hard to read). Bots put short states and sentences in a two-column table
// ("Piece | State", one sentence per row): harder to read than a short list
// or a few lines of prose. The prompt says the rule (OUTPUT_STYLE_RULE, sent
// to every bot through RICH_OUTPUT_PROMPT, its brief and the cold prompt);
// the reply check (shared/reply-style.ts) rewrites a key/sentence table the
// model still wrote as a bulleted list with bold labels. #3020: a
// "Champ | Valeur" table for three values (a regression of #2949 on another
// engine, in French) gets the same rewrite, whatever its cells hold.

/** #3293: the one table threshold of the served prompt. Every other prompt
 * line (work style, ConnectWise records, show_widget forms) defers to it
 * instead of stating a threshold of its own. */
export const TABLE_RULE =
  "a table only for 3+ columns of comparable values (numbers, dates, ids) across 6 or more rows of one kind, or on request";

/** The output-style rule every bot gets. */
export const OUTPUT_STYLE_RULE =
  " Output style: by default answer in short prose, or a short bulleted list with the label in bold (\"- **Label**: what it is\")."
  + ` Use ${TABLE_RULE}.`
  + " Never a two-column label and sentence table, never a table for a status or a summary."
  + " Never a field and value table (\"Field | Value\", \"Champ | Valeur\") for a handful of values: two or three values are one sentence or a short list, in French as in English, whatever the engine."
  + " When a compact Sagax card fits (an ```email draft, an ```artifact link, a ```cw card the person asked for), it wins over a table or a list.";

/** One short rule for the cold (routine, automation) prompt. */
export const OUTPUT_STYLE_RULE_SHORT =
  ` Default to short prose or a short list with bold labels; ${TABLE_RULE}; never a label and sentence, field and value ("Champ | Valeur") or status table.`;

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

/** #3020: a header that names no data, only "a label and its value"
 * ("Champ | Valeur", "Field | Value"): the table holds a handful of facts. */
const GENERIC_LABEL = /^(?:champs?|fields?|cl[ée]s?|keys?|[ée]l[ée]ments?|items?|propri[ée]t[ée]s?|propert(?:y|ies)|param[èe]tres?|parameters?|settings?|r[ée]glages?|attributs?|attributes?|m[ée]triques?|metrics?|indicateurs?|indicators?|infos?|informations?|donn[ée]es?|data|aspects?|crit[èe]res?|criteria|sujets?|topics?)$/iu;
const GENERIC_VALUE = /^(?:valeurs?|values?|d[ée]tails?|r[ée]sultats?|results?|r[ée]ponses?|answers?|infos?|informations?|contenu|content)$/iu;
const plain = (cell: string): string => cell.replace(/[*_`]/g, "").trim();
/** A two-column header that is only "label | value". */
export function isFieldValueHeader(header: readonly string[]): boolean {
  if (header.length !== 2) return false;
  const [label, value] = header.map(plain) as [string, string];
  return GENERIC_VALUE.test(value) || (GENERIC_LABEL.test(label) && !/\d/.test(value));
}

/** Markdown tables with two columns whose second column is sentences (at
 * least half its rows, and at least one row), or whose header is only
 * "label | value" (#3020). Code fences are skipped. */
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
    const fieldValue = isFieldValueHeader(cells(line));
    if (rows.length > 0 && (fieldValue || (sentences > 0 && sentences * 2 >= rows.length))) found.push({ start: index, end, rows });
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
