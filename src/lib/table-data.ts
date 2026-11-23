import Papa from "papaparse";

export const TABLE_FILE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;
const MAX_CELLS = 500_000;

export interface TextTable { headers: string[]; rows: string[][] }
export type TableSort = { column: number; descending: boolean } | null;

export function tableDelimiter(name: string): "," | "\t" | null {
  return /\.csv$/i.test(name) ? "," : /\.tsv$/i.test(name) ? "\t" : null;
}

/** Strings stay strings: leading zeroes and long IDs must never be coerced. */
export function parseTableFile(text: string, delimiter: "," | "\t"): TextTable {
  if (text.includes("\0")) throw new Error("format");
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter, skipEmptyLines: true, preview: MAX_ROWS + 2,
  });
  if (parsed.errors.length) throw new Error("format");
  const [headers = [], ...rows] = parsed.data;
  const columns = Math.max(headers.length, ...rows.slice(0, 1).map((row) => row.length));
  if (rows.length > MAX_ROWS || parsed.meta.truncated || columns > MAX_COLUMNS) throw new Error("size");
  let cells = headers.length;
  for (const row of rows) {
    cells += row.length;
    if (cells > MAX_CELLS || row.length > MAX_COLUMNS) throw new Error("size");
    // Do not silently discard extra fields or shift malformed data.
    if (row.length !== headers.length) throw new Error("columns");
  }
  return { headers, rows };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export function isTableNumber(text: string): boolean { return NUMBER.test(text.trim()); }

function decimalParts(text: string): { sign: number; order: bigint; digits: string } {
  const negative = text.startsWith("-");
  const [mantissa = "", exponent = "0"] = text.replace(/^[+-]/, "").toLowerCase().split("e");
  const dot = mantissa.indexOf(".");
  const decimals = dot < 0 ? 0 : mantissa.length - dot - 1;
  const digits = mantissa.replace(".", "").replace(/^0+/, "");
  if (!digits) return { sign: 0, order: 0n, digits: "" };
  return { sign: negative ? -1 : 1, order: BigInt(exponent) + BigInt(digits.length - decimals), digits: digits.replace(/0+$/, "") };
}

/** Number() collapses distinct decimals. When it does, the original digits decide. */
function compareTableNumbers(left: string, right: string): number {
  const l = Number(left), r = Number(right);
  if (l < r) return -1;
  if (l > r) return 1;
  const a = decimalParts(left.trim()), b = decimalParts(right.trim());
  if (a.sign !== b.sign) return a.sign - b.sign;
  if (!a.sign) return 0;
  const magnitude = a.order < b.order ? -1 : a.order > b.order ? 1
    : a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0;
  return a.sign * magnitude;
}

export function tableRowOrder(rows: readonly (readonly string[])[], query: string, sort: TableSort): number[] {
  const needle = query.trim().toLocaleLowerCase();
  const order = rows.flatMap((row, index) => !needle || row.some((cell) => cell.toLocaleLowerCase().includes(needle)) ? [index] : []);
  if (sort) order.sort((a, b) => {
    const left = rows[a]![sort.column] ?? "", right = rows[b]![sort.column] ?? "";
    // Empty cells stay at the bottom in either direction.
    if (!left.trim() || !right.trim()) return Number(!left.trim()) - Number(!right.trim()) || a - b;
    const difference = isTableNumber(left) && isTableNumber(right) ? compareTableNumbers(left, right) : collator.compare(left, right);
    return difference * (sort.descending ? -1 : 1) || a - b;
  });
  return order;
}

/** Export the whole current result, not just the rows mounted by virtualization. */
export function tableCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return Papa.unparse([headers, ...rows], { newline: "\r\n", escapeFormulae: true });
}

/** Bound chunked responses too; this is a preview limit, not a download limit.
 * `maxBytes` lets HTML (and similar) previews use a tighter cap than tables. */
export async function readTableResponse(response: Response, signal: AbortSignal, maxBytes = TABLE_FILE_MAX_BYTES): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel(); throw new Error("size");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error("size");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
