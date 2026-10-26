// IT tools: one check result as a canonical chat widget. The server builds it
// once (bot calls, /check, the panel's "Post to chat"), passes it through
// parseWidgetInput like any widget, and desktop and iOS draw it with their
// existing renderers; Android shows widgetToText. The panel draws the same
// tree with WidgetBody. Pure and browser-safe.
import { WIDGET_LIMITS, parseWidgetInput, type WidgetRoot } from "../widget.ts";
import { NET_CARD_TEXT, NET_CHECK_LABELS, NET_VERDICT_LABELS, netDetailLabel, netFindingWords, netText } from "./findings.ts";
import { NET_RESULT_LIMITS, netSortFindings, type NetCheckResult, type NetLanguage, type NetVerdict } from "./types.ts";

type Raw = Record<string, unknown>;

export interface NetCardOptions {
  /** IANA time zone for the "checked at" time; UTC when absent. */
  timeZone?: string;
}

/** Badge colors and icons: color is never the only signal, every badge
 * also carries the verdict as a word. */
const BADGE_COLOR: Record<NetVerdict, string> = { pass: "success", warn: "warning", fail: "danger", info: "info", unknown: "secondary" };
const ICON: Record<NetVerdict, string> = { pass: "check-circle", warn: "warning", fail: "close", info: "info", unknown: "circle-question" };
const ICON_COLOR: Record<NetVerdict, string> = { pass: "success", warn: "warning", fail: "danger", info: "secondary", unknown: "tertiary" };

/** Explain and Suggest a fix: ordinary widget presses the bot reads as a
 * reply to the card (server/chat-widgets.ts). */
export const NET_ACTION_EXPLAIN = "nettools.explain";
export const NET_ACTION_FIX = "nettools.fix";

/** Room left under WIDGET_LIMITS for what the renderer adds. */
const NODE_BUDGET = WIDGET_LIMITS.nodes - 10;
const BYTE_BUDGET = WIDGET_LIMITS.bytes - 2_000;
const MIN_RAW = 400;
/** A target in an action payload: enough to name it, never the payload limit. */
const PAYLOAD_TARGET = 512;

const INTL_LOCALE: Record<NetLanguage, string> = { en: "en", fr: "fr-CA", "pt-BR": "pt-BR" };

function cut(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** When the check ran, in the viewer's language and zone (UTC by default). */
export function netCheckedAt(at: number, language: NetLanguage, options: NetCardOptions = {}): string {
  const zone = options.timeZone || "UTC";
  try {
    const when = new Intl.DateTimeFormat(INTL_LOCALE[language], { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(at));
    return options.timeZone ? when : `${when} UTC`;
  } catch {
    return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** A text fence that the content cannot close. */
function fence(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}text\n${content}\n${ticks}`;
}

function countNodes(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const children = (node as Raw).children;
  return 1 + (Array.isArray(children) ? children.reduce((sum: number, child) => sum + countNodes(child), 0) : 0);
}

function cell(value: string, header: boolean): Raw {
  return { type: "Table.Cell", children: [{ type: "Text", value: cut(value.replace(/\s+/g, " ").trim(), NET_RESULT_LIMITS.cell), size: "sm", ...(header ? { color: "secondary", weight: "medium" } : {}) }] };
}

interface Shape {
  findings: number;
  rows: number[];
  rawChars: number;
}

function build(result: NetCheckResult, language: NetLanguage, options: NetCardOptions, shape: Shape): Raw {
  const children: Raw[] = [];
  const verdictWord = netText(NET_VERDICT_LABELS[result.verdict], language);
  children.push({
    type: "Row", gap: 2, align: "center",
    children: [
      { type: "Icon", name: ICON[result.verdict], color: ICON_COLOR[result.verdict] },
      { type: "Badge", label: verdictWord, color: BADGE_COLOR[result.verdict], variant: "soft" },
    ],
  });

  const sorted = netSortFindings(result.findings);
  if (!sorted.length) {
    children.push({ type: "Text", value: netText(NET_CARD_TEXT.noFindings, language), size: "sm", color: "secondary" });
  } else {
    const rows: Raw[] = sorted.slice(0, shape.findings).map((finding) => {
      const words = netFindingWords(finding, language);
      const explanation = [words.text, words.fix].filter(Boolean).join(" ");
      return {
        type: "Row", gap: 2, align: "start",
        children: [
          { type: "Icon", name: ICON[finding.severity], color: ICON_COLOR[finding.severity], size: "sm" },
          {
            type: "Col", flex: 1, gap: 0,
            children: [
              { type: "Text", value: cut(words.title, WIDGET_LIMITS.text), size: "sm", weight: "medium" },
              ...(explanation ? [{ type: "Caption", value: cut(explanation, WIDGET_LIMITS.text) }] : []),
            ],
          },
        ],
      };
    });
    const hidden = sorted.length - Math.min(sorted.length, shape.findings);
    if (hidden > 0) rows.push({ type: "Caption", value: netText(NET_CARD_TEXT.more, language, { count: hidden }), color: "tertiary" });
    children.push({ type: "Col", gap: 2, children: rows });
  }

  result.details.forEach((table, index) => {
    const shown = shape.rows[index] ?? 0;
    const columns = (table.columns ?? []).slice(0, WIDGET_LIMITS.tableCols);
    const width = Math.min(WIDGET_LIMITS.tableCols, table.rows.reduce((most, row) => Math.max(most, row.length), Math.max(columns.length, 1)));
    const pad = (values: string[]) => Array.from({ length: width }, (_unused, at) => values[at] ?? "");
    const rows: Raw[] = [];
    if (columns.length) rows.push({ type: "Table.Row", header: true, children: pad(columns.map((key) => netDetailLabel(key, language))).map((value) => cell(value, true)) });
    for (const row of table.rows.slice(0, shown)) rows.push({ type: "Table.Row", children: pad(row).map((value) => cell(value, false)) });
    if (!rows.length && !table.rows.length) return;
    children.push({ type: "Text", value: cut(netDetailLabel(table.label, language), WIDGET_LIMITS.title), size: "sm", weight: "semibold" });
    if (rows.length) children.push({ type: "Table", children: rows });
    const omitted = table.rows.length - Math.min(table.rows.length, shown);
    if (omitted > 0) children.push({ type: "Caption", value: netText(NET_CARD_TEXT.moreRows, language, { count: omitted }), color: "tertiary" });
  });

  const raw = result.raw.trim();
  if (raw && shape.rawChars > 0) {
    const shown = raw.length > shape.rawChars ? `${raw.slice(0, shape.rawChars).trimEnd()}\n${netText(NET_CARD_TEXT.rawCut, language)}` : raw;
    children.push({ type: "Text", value: netText(NET_CARD_TEXT.raw, language), size: "sm", weight: "semibold" });
    children.push({ type: "Markdown", value: fence(shown) });
  }

  const payload = { check: result.check, target: cut(result.target, PAYLOAD_TARGET) };
  const buttons: Raw[] = [{ type: "Button", label: netText(NET_CARD_TEXT.explain, language), style: "secondary", iconStart: "lightbulb", onClickAction: { type: NET_ACTION_EXPLAIN, payload } }];
  // nothing to fix on a card with no problem: the button would invite a made-up one
  if (result.findings.some((finding) => finding.severity === "fail" || finding.severity === "warn")) {
    buttons.push({ type: "Button", label: netText(NET_CARD_TEXT.fix, language), style: "secondary", iconStart: "sparkle", onClickAction: { type: NET_ACTION_FIX, payload } });
  }
  const seen = new Set<string>();
  for (const link of result.links ?? []) {
    if (seen.size >= NET_RESULT_LIMITS.links) break;
    const label = cut(link.label.replace(/\s+/g, " ").trim(), WIDGET_LIMITS.label);
    if (!label || seen.has(label) || !/^https:\/\//i.test(link.url) || link.url.length > 1_900) continue;
    seen.add(label);
    buttons.push({ type: "Button", label, style: "quiet", iconEnd: "external-link", onClickAction: { type: "open_url", payload: { url: link.url } } });
  }
  children.push({ type: "Row", gap: 2, wrap: true, children: buttons });

  return {
    type: "Card",
    title: cut(`${netText(NET_CHECK_LABELS[result.check], language)}: ${result.target}`, WIDGET_LIMITS.title),
    caption: cut(netText(NET_CARD_TEXT.caption, language, { time: netCheckedAt(result.at, language, options) }), WIDGET_LIMITS.caption),
    children,
  };
}

/** The widget input for a result, shaped to fit WIDGET_LIMITS: details rows
 * and raw output give way first, then findings. */
export function netCheckWidgetInput(result: NetCheckResult, language: NetLanguage, options: NetCardOptions = {}): Raw {
  const shape: Shape = {
    findings: NET_RESULT_LIMITS.cardFindings,
    rows: result.details.map((table) => Math.min(table.rows.length, NET_RESULT_LIMITS.tableRows, WIDGET_LIMITS.tableRows - (table.columns?.length ? 1 : 0))),
    rawChars: Math.min(NET_RESULT_LIMITS.cardRaw, WIDGET_LIMITS.markdown - 400),
  };
  for (;;) {
    const tree = build(result, language, options, shape);
    const nodes = countNodes(tree);
    const bytes = JSON.stringify(tree).length;
    if (nodes <= NODE_BUDGET && bytes <= BYTE_BUDGET) return tree;
    if (bytes > BYTE_BUDGET && shape.rawChars > MIN_RAW) {
      shape.rawChars = Math.max(MIN_RAW, shape.rawChars - (bytes - BYTE_BUDGET) - 200);
      continue;
    }
    const widest = shape.rows.reduce((best, rows, index) => (rows > (shape.rows[best] ?? 0) ? index : best), 0);
    if ((shape.rows[widest] ?? 0) > 0) {
      shape.rows[widest] -= 1;
      continue;
    }
    if (shape.rawChars > 0) {
      shape.rawChars = 0;
      continue;
    }
    if (shape.findings > 1) {
      shape.findings -= 1;
      continue;
    }
    return tree;
  }
}

/** The canonical card for a result. Throws if the mapper ever builds a tree
 * the widget parser refuses: that is a bug here, never bad input. */
export function netCheckWidget(result: NetCheckResult, language: NetLanguage, options: NetCardOptions = {}): WidgetRoot {
  const parsed = parseWidgetInput(netCheckWidgetInput(result, language, options));
  if (!parsed.ok) throw new Error(`net-tools widget: ${parsed.error}`);
  return parsed.value;
}
