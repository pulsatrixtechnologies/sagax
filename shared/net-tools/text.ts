// IT tools: a result as text. `netCheckSummary` is the one line on a bot's
// tool row; `netCheckText` is the readable fallback in the viewer's
// language; `netCheckModelText` is what the bot reads, compact English that
// keeps the finding codes so its answer can name them. Pure and browser-safe.
import { WIDGET_LIMITS } from "../widget.ts";
import { NET_CARD_TEXT, NET_CHECK_LABELS, NET_VERDICT_LABELS, netDetailLabel, netFindingWords, netText } from "./findings.ts";
import { NET_RESULT_LIMITS, netSortFindings, type NetCheckResult, type NetLanguage } from "./types.ts";

function cut(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** How many findings ask for a look: problems and warnings. */
export function netIssueCount(result: Pick<NetCheckResult, "findings">): number {
  return result.findings.filter((finding) => finding.severity === "fail" || finding.severity === "warn").length;
}

/** "SPF, DKIM and DMARC: example.com: Needs attention (2 to review)". */
export function netCheckSummary(result: NetCheckResult, language: NetLanguage): string {
  const issues = netIssueCount(result);
  const head = `${netText(NET_CHECK_LABELS[result.check], language)}: ${cut(result.target, 120)}: ${netText(NET_VERDICT_LABELS[result.verdict], language)}`;
  return issues ? `${head} (${netText(NET_CARD_TEXT.issues, language, { count: issues })})` : head;
}

/** The readable version of the card, within the widget fallback limit. */
export function netCheckText(result: NetCheckResult, language: NetLanguage): string {
  const lines = [`**${netText(NET_CHECK_LABELS[result.check], language)}: ${cut(result.target, 200)}**`, netText(NET_VERDICT_LABELS[result.verdict], language)];
  const sorted = netSortFindings(result.findings);
  if (!sorted.length) lines.push(netText(NET_CARD_TEXT.noFindings, language));
  for (const finding of sorted.slice(0, NET_RESULT_LIMITS.cardFindings)) {
    const words = netFindingWords(finding, language);
    lines.push(`- ${netText(NET_VERDICT_LABELS[finding.severity], language)}: ${words.title}${words.text ? `. ${words.text}` : ""}`);
  }
  const hidden = sorted.length - Math.min(sorted.length, NET_RESULT_LIMITS.cardFindings);
  if (hidden > 0) lines.push(netText(NET_CARD_TEXT.more, language, { count: hidden }));
  const out = lines.join("\n");
  return cut(out, WIDGET_LIMITS.fallback);
}

/** What the bot reads for one result: the verdict, every finding with its
 * code, then the tables and the raw output for as long as they fit in
 * NET_RESULT_LIMITS.modelText characters. Always English. */
export function netCheckModelText(result: NetCheckResult): string {
  const budget: number = NET_RESULT_LIMITS.modelText;
  let out = `${result.check} ${cut(result.target, 300)}: verdict ${result.verdict}. Checked from the Sagax server, not from the person's network.`;
  const add = (block: string, room = budget): boolean => {
    if (out.length + 1 + block.length > room) return false;
    out += `\n${block}`;
    return true;
  };
  const sorted = netSortFindings(result.findings);
  if (sorted.length) add("Findings:");
  // findings first, but leave room for at least some of the tables
  const findingsRoom = budget - (result.details.length || result.raw.trim() ? 1_500 : 60);
  for (const [index, finding] of sorted.entries()) {
    const words = netFindingWords(finding, "en");
    const params = finding.params && Object.keys(finding.params).length ? ` ${JSON.stringify(finding.params)}` : "";
    const line = cut(`- [${finding.severity}] ${finding.code}${params}: ${words.title}.${words.text ? ` ${words.text}` : ""}${words.fix ? ` Fix: ${words.fix}` : ""}`, 600);
    if (!add(line, findingsRoom)) {
      add(`(${sorted.length - index} more findings not shown)`);
      break;
    }
  }
  let full = true;
  for (const table of result.details) {
    if (!full) break;
    const columns = table.columns?.length ? ` (${table.columns.map((key) => netDetailLabel(key, "en")).join(" | ")})` : "";
    full = add(`${netDetailLabel(table.label, "en")}${columns}:`, budget - 40);
    for (const [index, row] of table.rows.entries()) {
      if (!full) break;
      full = add(row.map((value) => cut(value.replace(/\s+/g, " "), 400)).join(" | "), budget - 40);
      if (!full) add(`(${table.rows.length - index} more rows not shown)`);
    }
  }
  const raw = result.raw.trim();
  if (full && raw) {
    const room = budget - out.length - "\nRaw:\n".length - 40;
    if (room > 200) out += `\nRaw:\n${raw.length > room ? `${raw.slice(0, room)}\n(raw output cut)` : raw}`;
  }
  return out.slice(0, budget);
}
