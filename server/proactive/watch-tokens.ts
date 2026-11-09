// Template tokens of Pulsatrix Flow watches, resolved by the host before the
// observe call (Flow contract px-proactive, 2026-11-09):
//   {{fact:<topic>.<key>}}   a tenant fact (`px_flow.py reference <topic>`)
//   {{today_date_only}}      today as a ConnectWise date-only value
//   {{days_ago:N}} {{days_ahead:N}} {{months_ago:N}}   local midnight
//   {{hours_ago:N}} {{hours_ahead:N}}                  local wall time
// Times are the tenant's local time without an offset (the connector
// converts them). A token the host cannot resolve leaves the watch out: no
// call is made with a raw template.

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface WatchTokenContext {
  now: number;
  timeZone: string;
  /** A fact's value, undefined when the tenant does not set it. */
  fact(topic: string, key: string): unknown;
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; unresolved: string[] };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

interface LocalDay { y: number; mo: number; d: number }

function localParts(at: number, timeZone: string): LocalDay & { h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Calendar arithmetic on a local day (no zone involved). */
function shiftDays(day: LocalDay, days: number): LocalDay {
  const at = new Date(Date.UTC(day.y, day.mo - 1, day.d + days));
  return { y: at.getUTCFullYear(), mo: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

function shiftMonths(day: LocalDay, months: number): LocalDay {
  const index = day.y * 12 + (day.mo - 1) - months;
  const y = Math.floor(index / 12);
  const mo = index - y * 12 + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { y, mo, d: Math.min(day.d, last) };
}

const dateOf = (day: LocalDay) => `${pad(day.y, 4)}-${pad(day.mo)}-${pad(day.d)}`;

/** The value of one token (without braces), or undefined. */
export function tokenValue(token: string, ctx: WatchTokenContext): unknown {
  const fact = /^fact:([a-z0-9_-]+)\.([\w.-]+)$/i.exec(token);
  if (fact) return ctx.fact(fact[1]!.toLowerCase(), fact[2]!.toLowerCase());
  const today = localParts(ctx.now, ctx.timeZone);
  // the Flow engine's form: a date-only field is 00:00 UTC of the local day
  if (token === "today_date_only") return `${dateOf(today)}T00:00:00Z`;
  const counted = /^(days_ago|days_ahead|months_ago|hours_ago|hours_ahead):(\d{1,5})$/.exec(token);
  if (!counted) return undefined;
  const n = Number(counted[2]);
  switch (counted[1]) {
    case "days_ago": return `${dateOf(shiftDays(today, -n))}T00:00:00`;
    case "days_ahead": return `${dateOf(shiftDays(today, n))}T00:00:00`;
    case "months_ago": return `${dateOf(shiftMonths(today, n))}T00:00:00`;
    default: {
      const at = localParts(ctx.now + (counted[1] === "hours_ago" ? -n : n) * 3_600_000, ctx.timeZone);
      return `${dateOf(at)}T${pad(at.h)}:${pad(at.mi)}:${pad(at.s)}`;
    }
  }
}

/** A list fact inside a longer string is its comma-separated values. */
function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map(asText).join(", ") || "none";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Every token of a string, an object or a list, resolved. A string that is
 * one whole token takes the value's own type (a number, a list of ids). */
export function resolveWatchTokens<T>(value: T, ctx: WatchTokenContext): Resolved<T> {
  const unresolved = new Set<string>();
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    if (typeof node !== "string" || !node.includes("{{")) return node;
    const whole = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(node.trim());
    if (whole) {
      const resolved = tokenValue(whole[1]!, ctx);
      if (resolved === undefined || resolved === null || resolved === "") unresolved.add(whole[0]);
      return resolved;
    }
    return node.replace(TOKEN, (raw, inner: string) => {
      const resolved = tokenValue(inner, ctx);
      if (resolved === undefined || resolved === null || resolved === "") {
        unresolved.add(raw);
        return raw;
      }
      return asText(resolved);
    });
  };
  const out = walk(value);
  return unresolved.size ? { ok: false, unresolved: [...unresolved] } : { ok: true, value: out as T };
}

/** The fact tokens a value uses, as `topic` names. */
export function factTopics(value: unknown): string[] {
  const topics = new Set<string>();
  const text = JSON.stringify(value ?? null);
  for (const match of text.matchAll(/\{\{\s*fact:([a-z0-9_-]+)\./gi)) topics.add(match[1]!.toLowerCase());
  return [...topics].sort();
}

const norm = (text: string) => text.trim().replace(/^`+|`+$/g, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

function cellValue(raw: string): unknown {
  const cell = raw.trim().replace(/^`+|`+$/g, "").trim();
  if (!cell || /^stop\b/i.test(cell)) return undefined;
  const scalar = (part: string): unknown => {
    const bare = part.trim().replace(/^`+|`+$/g, "").trim();
    return /^-?\d+$/.test(bare) ? Number(bare) : bare;
  };
  return cell.includes(",") ? cell.split(",").map(scalar).filter((part) => part !== "") : scalar(cell);
}

/** The facts of one reference topic: the first two columns of its Markdown
 * tables (key, value), as the Flow engine reads them. `STOP: not set` or an
 * empty value is no fact. */
export function factsOfReference(body: string): Map<string, unknown> {
  const facts = new Map<string, unknown>();
  for (const line of body.split("\n")) {
    const row = line.trim();
    if (!row.startsWith("|") || /^\|[\s:|-]+\|$/.test(row)) continue;
    const cells = row.replace(/^\||\|$/g, "").split(/(?<!\\)\|/);
    if (cells.length < 2) continue;
    const key = norm(cells[0]!);
    if (!key || facts.has(key)) continue;
    const value = cellValue(cells[1]!);
    if (value !== undefined) facts.set(key, value);
  }
  return facts;
}
