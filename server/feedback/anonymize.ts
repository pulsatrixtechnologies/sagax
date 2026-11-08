// Feedback anonymizer (#2618): every word of a report passes here on the
// server before anything leaves it. Secrets go through the existing
// redactor (server/redact.ts, which also runs the vault's held-value
// scrubbers); this adds what a public issue must never carry: emails,
// phone numbers, the names of people, organizations and bots this server
// knows, ids, user folders, IP addresses, client domains and GitHub
// mentions. Message content outside the report never reaches it: the report
// is built from named fields only (server/feedback/report.ts).
import { redactSecretsInText } from "../redact.ts";

export interface AnonymizeNames {
  people?: readonly string[];
  orgs?: readonly string[];
  bots?: readonly string[];
}

/** Hosts a report may name as they are: the product's own repository and
 * the machine itself. Anything else that looks like a domain is masked. */
const ALLOWED_HOSTS = new Set(["github.com", "api.github.com", "githubusercontent.com", "raw.githubusercontent.com", "localhost"]);

/** Top-level domains that make a dotted word a host. A file name (index.ts,
 * server.log, spans.jsonl) ends in none of them. */
const TLDS = "com|net|org|ca|io|dev|app|ai|co|us|uk|fr|de|be|ch|info|biz|cloud|tech|online|site|xyz|me|tv|eu|qc|quebec|local|lan|internal|corp|gov|edu|gouv|business|services|solutions|systems|email|team|work|cc";
const HOST = new RegExp(`\\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))\\b(?![\\w-])`, "gi");
const EMAIL = /[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu;
const MENTION = /(^|[^\w`])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\b/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const IPV6 = /(?<![\w:.])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi;
const PHONE_NA = /(?<![\w+])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g;
const PHONE_INTL = /(?<![\w+])\+\d{1,3}(?:[\s.-]?\(?\d+\)?){2,6}(?!\w)/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
/** A word of 12+ letters and digits mixed: a record id, a session key. */
const MIXED_ID = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{12,}\b/g;
/** The date and hour of an ISO timestamp (2026-11-07T23): a log line's time, not an id. */
const TIMESTAMP_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
const MAC_HOME = /(\/Users\/)(?!Shared\/|\[user\])[^/\s]+/g;
const LINUX_HOME = /(\/home\/)(?!\[user\])[^/\s]+/g;
const WIN_HOME = /([A-Za-z]:\\Users\\)(?!Public\\|\[user\])[^\\\s]+/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameReplacer(names: readonly string[] | undefined, mark: string): (text: string) => string {
  const cleaned = [...new Set((names ?? []).map((name) => name.trim()).filter((name) => name.length >= 3))]
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return (text) => text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${cleaned.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return (text) => text.replace(pattern, mark);
}

/** One text, safe for a public issue. */
export function anonymize(text: string, names: AnonymizeNames): string {
  if (!text) return "";
  let out = redactSecretsInText(text);
  out = out.replace(EMAIL, "[email]");
  out = out.replace(MENTION, (_m, lead: string) => `${lead}[handle]`);
  out = out.replace(MAC_HOME, "$1[user]").replace(LINUX_HOME, "$1[user]").replace(WIN_HOME, "$1[user]");
  out = out.replace(UUID, "[id]");
  out = out.replace(IPV4, "[ip]");
  out = out.replace(IPV6, (match) => (match.includes("::") || match.split(":").length >= 5 ? "[ip]" : match));
  out = out.replace(PHONE_INTL, "[phone]").replace(PHONE_NA, "[phone]");
  out = out.replace(HOST, (host: string) => {
    const lower = host.toLowerCase();
    return ALLOWED_HOSTS.has(lower) || [...ALLOWED_HOSTS].some((allowed) => lower.endsWith(`.${allowed}`)) ? host : "[domain]";
  });
  out = out.replace(LONG_HEX, "[id]").replace(MIXED_ID, (match) => (match.startsWith("[") || TIMESTAMP_HEAD.test(match) ? match : "[id]"));
  out = nameReplacer(names.people, "[person]")(out);
  out = nameReplacer(names.orgs, "[org]")(out);
  out = nameReplacer(names.bots, "[bot]")(out);
  return out;
}

/** The last `max` lines, each anonymized and cut to 400 characters. */
export function anonymizeLines(lines: readonly string[], names: AnonymizeNames, max = 40): string[] {
  return lines.slice(-max).map((line) => {
    const clean = anonymize(String(line), names).replace(/\s+/g, " ").trim();
    return clean.length > 400 ? `${clean.slice(0, 399)}…` : clean;
  });
}
