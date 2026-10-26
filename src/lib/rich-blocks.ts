// Pure helpers behind the chat's rich blocks: email drafts, sandboxed
// widgets, script-free charts, CSV tables and the GFM table toolbar. Every
// function here takes model text as untrusted input and returns plain data or
// strings; nothing in this module touches the DOM, so the renderers stay thin
// and each rule is unit-tested on its own.
//
// Fence conventions the bots are taught (server/system-prompt.ts,
// RICH_OUTPUT_PROMPT) and the renderer recognizes:
//   ```email   To/Cc/Bcc/Subject header lines, a blank line, then the body
//   ```widget  a self-contained HTML/CSS/JS snippet, run in a sandboxed iframe
//   ```artifact  HTML (same as widget) or JSON {title, url} for a published page
//   ```chart   a JSON spec or CSV rows, drawn as an SVG chart without scripts
//   ```csv / ```tsv  a data table with sort, filter and copy
//   ```cw     a ConnectWise widget (application/vnd.sagax.cw+json)
// Claude harness <antArtifact> tags are rewritten by liftClaudeChatBlocks.

import { WIDGET_KIT_CSS, WIDGET_THEME_LISTENER, widgetThemeFromTokens, type WidgetTheme } from "./widget-kit.ts";

export type RichFenceKind = "email" | "widget" | "chart" | "csv" | "cw";

export {
  formatArtifactFence,
  liftClaudeChatBlocks,
  parseArtifactPage,
  parseArtifactPublish,
  type ArtifactPage,
} from "../../shared/claude-chat-blocks.ts";

const FENCE_KINDS: Readonly<Record<string, RichFenceKind>> = {
  email: "email",
  mail: "email",
  eml: "email",
  widget: "widget",
  "html-widget": "widget",
  // a widget that still failed check_widget after its last attempt
  // (server/widget-check.ts): drawn as usual, with a discreet note
  "widget-imperfect": "widget",
  artifact: "widget",
  chart: "chart",
  csv: "csv",
  tsv: "csv",
  cw: "cw",
};

/** The rich renderer a fence language asks for, if any. */
export function richFenceKind(lang: string): RichFenceKind | null {
  return FENCE_KINDS[lang.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Email

export interface EmailDraft {
  from?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

const EMAIL_HEADER = /^(from|to|cc|bcc|subject|reply-to)\s*:\s?(.*)$/i;
const PLAIN_LANGS = new Set(["", "text", "txt", "plain", "plaintext", "markdown", "md"]);

/** Split an address header on commas and semicolons, dropping empties. A
 * display name with a comma inside quotes stays whole. */
export function splitAddresses(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    else if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    if ((character === "," || character === ";") && !quoted && angle === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Read an email draft from a fence body. With an explicit email fence the
 * headers are optional (a bare body is still an email); a plain text fence
 * only counts when it opens with a Subject header and at least one recipient
 * or sender header, so ordinary snippets never turn into cards. */
export function parseEmailBlock(code: string, lang = "email"): EmailDraft | null {
  const explicit = richFenceKind(lang) === "email";
  if (!explicit && !PLAIN_LANGS.has(lang.trim().toLowerCase())) return null;
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  // leading blank lines before the headers are harmless
  let index = 0;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  const draft: EmailDraft = { to: [], cc: [], bcc: [], subject: "", body: "" };
  let headers = 0;
  let sawSubject = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      break;
    }
    const match = EMAIL_HEADER.exec(line);
    if (!match) break;
    headers += 1;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "subject") {
      draft.subject = value;
      sawSubject = true;
    } else if (key === "from") draft.from = value;
    else if (key === "to") draft.to.push(...splitAddresses(value));
    else if (key === "cc") draft.cc.push(...splitAddresses(value));
    else if (key === "bcc") draft.bcc.push(...splitAddresses(value));
  }
  if (!explicit && (!sawSubject || headers < 2)) return null;
  draft.body = lines.slice(headers === 0 ? 0 : index).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  if (!explicit && !draft.body) return null;
  return draft;
}

/** Markdown-light body as the plain text a mail client or clipboard wants:
 * emphasis markers and link syntax are removed, line structure is kept. */
export function emailPlainBody(body: string): string {
  return body
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => (label === url ? url : `${label} (${url})`))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

/** The whole draft as copyable plain text, headers first. */
export function emailPlainText(draft: EmailDraft): string {
  const head = [
    draft.from ? `From: ${draft.from}` : "",
    draft.to.length ? `To: ${draft.to.join(", ")}` : "",
    draft.cc.length ? `Cc: ${draft.cc.join(", ")}` : "",
    draft.bcc.length ? `Bcc: ${draft.bcc.join(", ")}` : "",
    draft.subject ? `Subject: ${draft.subject}` : "",
  ].filter(Boolean);
  const body = emailPlainBody(draft.body);
  return head.length ? `${head.join("\n")}\n\n${body}` : body;
}

/** Longest mailto URL handed to the OS. Mail clients on Windows truncate or
 * refuse far shorter URLs than browsers accept, so a long body is left out
 * (the card copies it to the clipboard instead). */
export const MAILTO_MAX_LENGTH = 1900;

/** Bare address from "Name <a@b.c>", or the value when there is no bracket. */
function bareAddress(value: string): string {
  const bracket = /<([^<>]+)>/.exec(value);
  return (bracket ? bracket[1]! : value).trim();
}

// RFC 6068: the address list sits in the path, and ?, #, % and & must be
// escaped there; encodeURIComponent keeps @ readable only after we restore it.
const encodeAddress = (value: string) => encodeURIComponent(bareAddress(value)).replace(/%40/g, "@");

export function emailMailtoUrl(draft: EmailDraft, maxLength = MAILTO_MAX_LENGTH): { url: string; bodyIncluded: boolean } {
  const params = (withBody: boolean) => {
    const parts: string[] = [];
    if (draft.cc.length) parts.push(`cc=${draft.cc.map(encodeAddress).join(",")}`);
    if (draft.bcc.length) parts.push(`bcc=${draft.bcc.map(encodeAddress).join(",")}`);
    if (draft.subject) parts.push(`subject=${encodeURIComponent(draft.subject)}`);
    if (withBody && draft.body) parts.push(`body=${encodeURIComponent(emailPlainBody(draft.body).replace(/\r?\n/g, "\r\n"))}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  const base = `mailto:${draft.to.map(encodeAddress).join(",")}`;
  const full = base + params(true);
  if (full.length <= maxLength || !draft.body) return { url: full, bodyIncluded: Boolean(draft.body) };
  return { url: base + params(false), bodyIncluded: false };
}

// ---------------------------------------------------------------------------
// Widgets

/** The only sandbox token a widget iframe ever gets: scripts run, but in an
 * opaque origin with no same-origin access, no forms, no popups, no top
 * navigation, no downloads and no pointer lock. */
export const WIDGET_SANDBOX = "allow-scripts";

/** Content Security Policy stamped as the first element of every widget
 * document. No network at all: inline code and styles, plus data:/blob:
 * media only. A widget cannot fetch, beacon, load remote scripts, fonts or
 * images, submit forms, or frame anything. */
export const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export const WIDGET_MESSAGE = "omb-widget-size";
export const WIDGET_MIN_HEIGHT = 48;
export const WIDGET_MAX_HEIGHT = 1600;

/** Clamp a height a widget reported; garbage becomes null (ignored). */
export function clampWidgetHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(Math.max(value, WIDGET_MIN_HEIGHT), WIDGET_MAX_HEIGHT));
}

/** The srcdoc for a widget. The CSP meta comes before any widget byte, so the
 * policy is in force before the first widget script parses; a widget that
 * adds its own CSP can only narrow it further. The size reporter is ours and
 * posts only a number. */
export function buildWidgetDocument(source: string, theme: WidgetTheme | "light" | "dark", font = ""): string {
  const resolved = typeof theme === "string" ? widgetThemeFromTokens({ "--code-color-scheme": theme }) : theme;
  // the body's own height, not the viewport's: the frame shrinks to a short
  // widget instead of keeping the empty space of its first height
  const reporter = `(function(){var last=0;function send(){var b=document.body;var h=Math.ceil(b?Math.max(b.getBoundingClientRect().height,b.scrollHeight):document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({type:${JSON.stringify(WIDGET_MESSAGE)},height:h},"*");}}`
    + "addEventListener('load',send);if(typeof ResizeObserver!=='undefined'){var o=new ResizeObserver(send);o.observe(document.documentElement);addEventListener('DOMContentLoaded',function(){if(document.body)o.observe(document.body);});}setTimeout(send,50);setTimeout(send,500);})();";
  // theme first, kit second, the widget's own <style> last: a widget that
  // sets its own colors still wins over the kit
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="sagax-theme">${resolved.css}</style><style id="sagax-kit">${font}${WIDGET_KIT_CSS}</style><script>${reporter}${WIDGET_THEME_LISTENER}</script></head><body>${source}</body></html>`;
}

// ---------------------------------------------------------------------------
// Tables and delimited data

/** Parse one CSV/TSV document. Quotes follow RFC 4180 ("" is a quote); the
 * delimiter is a tab when the first line has one and no comma-free reading
 * is better, otherwise a comma (or a semicolon when the header has only
 * semicolons). Rows are capped to keep a huge paste from freezing the UI. */
export function parseDelimited(text: string, delimiter?: string, maxRows = 5000): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!source) return [];
  const firstLine = source.split("\n", 1)[0]!;
  const sep = delimiter ?? (firstLine.includes("\t")
    ? "\t"
    : !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (character === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n") {
      row.push(cell.trim());
      rows.push(row);
      if (rows.length >= maxRows) return rows;
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

const NUMBER_SHAPE = /^[+-]?(?:\d{1,3}(?:[,   ]\d{3})+|\d+)?(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/** A table cell read as a number: currency signs, percent, thousands
 * separators, a Unicode minus and accounting parentheses are understood.
 * Anything else, including an empty cell, is null. */
export function parseNumeric(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text
    .replace(/−/g, "-")
    .replace(/^([+-]?)\s*(?:[$€£¥₹]|USD|CAD|EUR)\s*/i, "$1")
    .replace(/\s*(?:[$€£¥₹%]|USD|CAD|EUR)$/i, "");
  if (!text || !/\d/.test(text) || !NUMBER_SHAPE.test(text)) return null;
  const number = Number(text.replace(/[,   ]/g, ""));
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

/** Columns whose every non-empty body cell is a number (and at least one is). */
export function numericColumns(rows: readonly (readonly string[])[], width: number): boolean[] {
  return Array.from({ length: width }, (_unused, column) => {
    let seen = 0;
    for (const row of rows) {
      const value = row[column] ?? "";
      if (!value.trim()) continue;
      if (parseNumeric(value) === null) return false;
      seen += 1;
    }
    return seen > 0;
  });
}

const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;

/** Sort order for two cells; empties always sink to the bottom. */
export function compareCells(left: string, right: string, numeric: boolean): number {
  const leftEmpty = !left.trim();
  const rightEmpty = !right.trim();
  if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
  if (numeric) {
    const a = parseNumeric(left);
    const b = parseNumeric(right);
    if (a !== null && b !== null) return a - b;
  }
  return collator ? collator.compare(left, right) : left.localeCompare(right);
}

export type SortState = { column: number; direction: "asc" | "desc" } | null;

/** Row indices after filtering by a case-insensitive query and sorting. */
export function visibleRowOrder(
  rows: readonly (readonly string[])[],
  { query = "", sort = null, numeric = [] }: { query?: string; sort?: SortState; numeric?: readonly boolean[] },
): number[] {
  const needle = query.trim().toLocaleLowerCase();
  const order = rows.map((_row, index) => index).filter((index) =>
    !needle || rows[index]!.some((cell) => cell.toLocaleLowerCase().includes(needle)));
  if (sort) {
    const factor = sort.direction === "asc" ? 1 : -1;
    order.sort((a, b) => {
      const left = rows[a]![sort.column] ?? "";
      const right = rows[b]![sort.column] ?? "";
      // empties sink whatever the direction
      if (!left.trim() || !right.trim()) return compareCells(left, right, false) || a - b;
      return compareCells(left, right, Boolean(numeric[sort.column])) * factor || a - b;
    });
  }
  return order;
}

/** Next state when a header is clicked: ascending, descending, off. */
export function nextSort(current: SortState, column: number): SortState {
  if (!current || current.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

const csvCell = (value: string) => (/[",\n\r]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** RFC 4180 CSV with CRLF line ends, the form spreadsheets import cleanly.
 * A cell that starts with a formula trigger is prefixed with a quote so a
 * pasted table cannot run a spreadsheet formula. */
export function tableToCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const safe = (value: string) => csvCell(/^[=+\-@\t\r]/.test(value) && parseNumeric(value) === null ? `'${value}` : value);
  return [header, ...rows].map((row) => row.map(safe).join(",")).join("\r\n");
}

export type ColumnAlign = "left" | "right" | "center" | null;

const mdCell = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** GitHub-flavored Markdown for the table as currently shown. */
export function tableToMarkdown(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly ColumnAlign[] = [],
): string {
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const cells = (row: readonly string[]) => `| ${Array.from({ length: width }, (_unused, index) => mdCell(row[index] ?? "")).join(" | ")} |`;
  const rule = `| ${Array.from({ length: width }, (_unused, index) => {
    const value = align[index];
    return value === "right" ? "---:" : value === "center" ? ":---:" : value === "left" ? ":---" : "---";
  }).join(" | ")} |`;
  return [cells(header), rule, ...rows.map(cells)].join("\n");
}

// ---------------------------------------------------------------------------
// Charts

export type ChartType = "bar" | "line" | "area" | "pie";

export interface ChartSeries {
  name: string;
  values: Array<number | null>;
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  labels: string[];
  series: ChartSeries[];
  /** Series dropped past the palette's eight slots. */
  truncatedSeries: number;
}

export const CHART_MAX_SERIES = 8;
export const CHART_MAX_POINTS = 500;

const CHART_TYPES: Readonly<Record<string, ChartType>> = {
  bar: "bar",
  column: "bar",
  line: "line",
  area: "area",
  pie: "pie",
  donut: "pie",
  doughnut: "pie",
};

function chartType(value: unknown): ChartType {
  return typeof value === "string" ? CHART_TYPES[value.trim().toLowerCase()] ?? "bar" : "bar";
}

const asText = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined);

function chartNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseNumeric(value);
  return null;
}

function finishChart(spec: Omit<ChartSpec, "truncatedSeries">): ChartSpec | { error: string } {
  const labels = spec.labels.slice(0, CHART_MAX_POINTS);
  const usable = spec.series
    .map((series) => ({ name: series.name.slice(0, 120), values: labels.map((_label, index) => series.values[index] ?? null) }))
    .filter((series) => series.values.some((value) => value !== null));
  if (!labels.length || !usable.length) return { error: "no numeric data" };
  const series = usable.slice(0, spec.type === "pie" ? 1 : CHART_MAX_SERIES);
  const truncatedSeries = usable.length - series.length;
  if (spec.type === "pie" && labels.length > CHART_MAX_SERIES) {
    // a ninth hue is never generated: the smallest slices fold into "Other"
    const values = series[0]!.values;
    const keep = labels.map((_label, index) => index)
      .sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0))
      .slice(0, CHART_MAX_SERIES - 1)
      .sort((a, b) => a - b);
    const other = values.reduce<number>((sum, value, index) => (keep.includes(index) ? sum : sum + Math.max(0, value ?? 0)), 0);
    return {
      ...spec,
      labels: [...keep.map((index) => labels[index]!), "Other"],
      series: [{ name: series[0]!.name, values: [...keep.map((index) => values[index] ?? null), other] }],
      truncatedSeries,
    };
  }
  return { ...spec, labels, series, truncatedSeries };
}

/** Read a ```chart fence. JSON comes in three spellings models write:
 *   {"type","labels":[..],"series":[{"name","data":[..]}]}
 *   {"type","x":"month","y":["a","b"],"data":[{"month":..,"a":..}]}
 *   {"type","labels":[..],"datasets":[{"label","data":[..]}]}   (Chart.js)
 * Anything else is CSV: a header row, labels in the first column and one
 * numeric series per remaining column; an optional first line "type: line"
 * picks the chart type. */
export function parseChartSpec(code: string): ChartSpec | { error: string } {
  const text = code.trim();
  if (!text) return { error: "empty chart" };
  if (text.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "invalid JSON" };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "chart JSON must be an object" };
    const value = raw as Record<string, unknown>;
    const base = {
      type: chartType(value.type),
      title: asText(value.title),
      xLabel: asText(value.xLabel ?? value.x_label ?? value.xAxis),
      yLabel: asText(value.yLabel ?? value.y_label ?? value.yAxis),
    };
    if (Array.isArray(value.data) && value.data.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      const rows = value.data as Array<Record<string, unknown>>;
      const keys = Object.keys(rows[0] ?? {});
      const x = typeof value.x === "string" ? value.x : keys[0];
      if (!x) return { error: "chart data has no columns" };
      const ys = Array.isArray(value.y)
        ? value.y.filter((key): key is string => typeof key === "string")
        : typeof value.y === "string" ? [value.y] : keys.filter((key) => key !== x);
      return finishChart({
        ...base,
        labels: rows.map((row) => String(row[x] ?? "")),
        series: ys.map((key) => ({ name: key, values: rows.map((row) => chartNumber(row[key])) })),
      });
    }
    const labels = Array.isArray(value.labels) ? value.labels.map((label) => String(label ?? "")) : null;
    const list = Array.isArray(value.series) ? value.series : Array.isArray(value.datasets) ? value.datasets : null;
    if (labels && list) {
      return finishChart({
        ...base,
        labels,
        series: list.flatMap((entry, index) => {
          if (Array.isArray(entry)) return [{ name: `Series ${index + 1}`, values: entry.map(chartNumber) }];
          if (!entry || typeof entry !== "object") return [];
          const series = entry as Record<string, unknown>;
          const data = Array.isArray(series.data) ? series.data : Array.isArray(series.values) ? series.values : [];
          return [{ name: asText(series.name ?? series.label) ?? `Series ${index + 1}`, values: data.map(chartNumber) }];
        }),
      });
    }
    return { error: "chart JSON needs labels with series, or data rows" };
  }
  const lines = text.split(/\r?\n/);
  let type: ChartType = "bar";
  let title: string | undefined;
  while (lines.length && /^(type|title)\s*:/i.test(lines[0]!)) {
    const [key, ...rest] = lines.shift()!.split(":");
    if (key!.trim().toLowerCase() === "type") type = chartType(rest.join(":"));
    else title = asText(rest.join(":"));
  }
  const rows = parseDelimited(lines.join("\n"));
  if (rows.length < 2) return { error: "CSV chart needs a header row and data" };
  const [header, ...body] = rows as [string[], ...string[][]];
  return finishChart({
    type,
    title,
    xLabel: header[0] || undefined,
    labels: body.map((row) => row[0] ?? ""),
    series: header.slice(1).map((name, column) => ({ name: name || `Series ${column + 1}`, values: body.map((row) => parseNumeric(row[column + 1] ?? "")) })),
  });
}

/** Round-number axis ticks covering [min, max], including zero for bars. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => span / candidate <= count) ?? 10 * power;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** Compact tick label: 1.2k, 3.4M; small values keep two significant decimals. */
export function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${Number((value / 1e9).toPrecision(3))}B`;
  if (abs >= 1e6) return `${Number((value / 1e6).toPrecision(3))}M`;
  if (abs >= 1e4) return `${Number((value / 1e3).toPrecision(3))}k`;
  return String(Number(value.toPrecision(6)));
}

// ---------------------------------------------------------------------------
// Markdown extras

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";
const CALLOUT = /^\s*\[!(note|tip|important|warning|caution|info|danger|success)\][ \t]*(.*)$/i;
const CALLOUT_ALIASES: Readonly<Record<string, CalloutKind>> = { info: "note", danger: "caution", success: "tip" };

/** GitHub alert marker at the start of a blockquote: "[!NOTE] optional title". */
export function parseCalloutMarker(text: string): { kind: CalloutKind; title: string } | null {
  const match = CALLOUT.exec(text.split("\n", 1)[0] ?? "");
  if (!match) return null;
  const key = match[1]!.toLowerCase();
  return { kind: CALLOUT_ALIASES[key] ?? (key as CalloutKind), title: match[2]!.trim() };
}

/** URL fragment for a heading, GitHub style: lowercase, spaces to dashes,
 * punctuation removed, letters of every script kept. */
export function headingSlug(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

/** Offset where a still-open fence starts (the message ends inside it), or
 * -1 when every fence is closed. A block past this offset is still being
 * written: widgets and charts wait for it instead of flashing errors. */
export function unclosedFenceOffset(text: string): number {
  const opener = /(^|\r?\n)((?: {0,3}>[ \t]?)* {0,3})(?:(`{3,})[^`\r\n]*|(~{3,})[^\r\n]*)(?:\r?\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text)) !== null) {
    const fence = match[3] ?? match[4]!;
    const closer = new RegExp(`(^|\\r?\\n)(?: {0,3}>[ \\t]?)* {0,3}${fence[0]}{${fence.length},}[ \\t]*(?=\\r?\\n|$)`, "g");
    closer.lastIndex = opener.lastIndex;
    const closing = closer.exec(text);
    if (!closing) return match.index + match[1]!.length;
    opener.lastIndex = closing.index + closing[0].length;
  }
  return -1;
}

const WIDE_FENCE = /(^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*(?:email|mail|eml|widget|html-widget|artifact|chart|csv|tsv|mermaid|cw)\b/i;
const TABLE_RULE = /(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(\n|$)/;
const ANT_ARTIFACT = /<antArtifact\b/i;

/** A bot message holding a table, a diagram or one of the rich fences gets
 * the wide bubble; prose keeps the narrow reading measure. */
export function prefersWideBubble(text: string): boolean {
  return WIDE_FENCE.test(text) || TABLE_RULE.test(text) || ANT_ARTIFACT.test(text);
}

/** Raster data: URLs are safe to show inline (no network, no script); SVG
 * and every other media type stay blocked. */
export function isInlineRasterDataUrl(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value) && value.length <= 8_000_000;
}
