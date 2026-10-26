// IT tools (docs/superpowers/specs/2026-10-21-it-tools-design.md): the
// language-neutral model every check produces. A result is storable and
// carries no text in any language: findings are codes with parameters, and
// shared/net-tools/findings.ts turns them into words for the card, the
// fallback text and the model. Browser-safe: no Node imports.

/** The v1 checks, then the v1.1 ones (same module, later batches). */
export const NET_CHECK_NAMES = [
  "dns_lookup",
  "mx_lookup",
  "mail_auth_check",
  "blacklist_check",
  "tls_check",
  "domain_info",
  "http_headers",
  "email_header_analyze",
  "dns_propagation",
  "port_check",
  "tcp_ping",
] as const;

export type NetCheckName = (typeof NET_CHECK_NAMES)[number];

export function isNetCheckName(value: unknown): value is NetCheckName {
  return typeof value === "string" && (NET_CHECK_NAMES as readonly string[]).includes(value);
}

/** The record types `dns_lookup` can ask for. */
export const NET_DNS_TYPES = ["A", "AAAA", "CNAME", "TXT", "NS", "SOA", "CAA", "PTR"] as const;
export type NetDnsType = (typeof NET_DNS_TYPES)[number];

/** What each check takes (appendix A of the spec). */
export interface NetCheckInputs {
  dns_lookup: { name: string; types?: NetDnsType[] };
  mx_lookup: { domain: string };
  mail_auth_check: { domain: string; dkim_selector?: string };
  blacklist_check: { target: string };
  tls_check: { host: string; port?: number };
  domain_info: { domain: string };
  http_headers: { url: string };
  email_header_analyze: { headers: string };
  dns_propagation: { name: string; type?: NetDnsType };
  port_check: { host: string; ports?: number[]; preset?: string };
  tcp_ping: { host: string; port?: number };
}

export type NetCheckInput<N extends NetCheckName = NetCheckName> = NetCheckInputs[N];

export const NET_VERDICTS = ["pass", "warn", "fail", "info", "unknown"] as const;
export type NetVerdict = (typeof NET_VERDICTS)[number];

export type NetFindingParams = Record<string, string | number>;

export interface NetFinding {
  /** A key of NET_FINDINGS (findings.ts). */
  code: string;
  severity: NetVerdict;
  params?: NetFindingParams;
}

/** One table of the result: records, hops, a chain, zones. `label` and the
 * `columns` are keys of NET_DETAIL_LABELS when they have one, else shown as
 * they are (a record type such as "TXT" needs no translation). */
export interface NetDetailTable {
  label: string;
  columns?: string[];
  rows: string[][];
}

/** A link the card offers as a button, such as a list's delisting page. */
export interface NetResultLink {
  label: string;
  url: string;
}

export interface NetCheckResult {
  check: NetCheckName;
  target: string;
  /** When the check ran (ms since epoch). */
  at: number;
  durationMs: number;
  verdict: NetVerdict;
  findings: NetFinding[];
  details: NetDetailTable[];
  /** Plain-text output, capped at NET_RESULT_LIMITS.raw characters. */
  raw: string;
  /** Where the check ran from: always this Sagax server in v1. */
  vantage: "server";
  /** At most NET_RESULT_LIMITS.links https links. */
  links?: NetResultLink[];
}

export const NET_RESULT_LIMITS = {
  /** Raw output kept in a result. */
  raw: 16_000,
  /** Raw output shown on the card. */
  cardRaw: 5_500,
  /** Findings listed on the card before "and N more". */
  cardFindings: 8,
  /** Rows of one details table. */
  tableRows: 60,
  /** Characters of one table cell on the card. */
  cell: 240,
  /** Link buttons on the card. */
  links: 6,
  /** The model's text for one result. */
  modelText: 6_000,
} as const;

/** The order findings are listed in: worst first. */
const LIST_RANK: Record<NetVerdict, number> = { fail: 0, warn: 1, unknown: 2, info: 3, pass: 4 };

/** The order the overall verdict is chosen in. A problem wins; then a
 * conclusive pass; `unknown` (a timeout, a refused query, blocked egress)
 * never counts as a failure and only stands when nothing was conclusive;
 * `info` alone stays info. No finding at all is unknown. */
const VERDICT_RANK: Record<NetVerdict, number> = { fail: 5, warn: 4, pass: 3, unknown: 2, info: 1 };

export function netOverallVerdict(findings: readonly Pick<NetFinding, "severity">[]): NetVerdict {
  let best: NetVerdict = "unknown";
  let rank = 0;
  for (const finding of findings) {
    if (VERDICT_RANK[finding.severity] > rank) {
      best = finding.severity;
      rank = VERDICT_RANK[finding.severity];
    }
  }
  return best;
}

/** Findings worst first, keeping the check's own order within a severity. */
export function netSortFindings<T extends Pick<NetFinding, "severity">>(findings: readonly T[]): T[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => LIST_RANK[a.finding.severity] - LIST_RANK[b.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
}

/** The languages the server renders a card in. */
export const NET_LANGUAGES = ["en", "fr", "pt-BR"] as const;
export type NetLanguage = (typeof NET_LANGUAGES)[number];

/** A setting or request language as one the card is written in: any French
 * is fr, any Portuguese is pt-BR, everything else falls back to en. */
export function netLanguage(language: string | undefined | null): NetLanguage {
  const value = (language ?? "").trim().toLowerCase();
  if (value === "fr" || value.startsWith("fr-") || value.startsWith("fr_")) return "fr";
  if (value === "pt" || value.startsWith("pt-") || value.startsWith("pt_")) return "pt-BR";
  return "en";
}
