// Record cards (#4507): a record of a connected product, mentioned by its
// number in a bot's message, opens a card with its content.
//
// The link a bot writes is a Markdown link in the app's own scheme:
//
//   [#481516](sagax://record/<product>/<kind>/<id>)
//
// `product` is a product id of the person's product list
// (shared/person-products.ts), `kind` one of that product's record kinds
// (its `records`), `id` the record's id. Each segment is percent-encoded;
// once decoded, product and kind read `[a-z][a-z0-9_]{1,40}` and the id
// `[A-Za-z0-9._:-]{1,128}` (never only dots). Anything else is not a record
// link and stays text.
//
// The card is the organization console's (GET
// /api/v1/pulsabot/people/me/products/{id}/records/{kind}/{record}),
// read as the person through GET /api/me/records/:product/:kind/:id
// (server/routes/record-cards.ts); `parseRecordCard` reads it again here
// with the same tolerance as the product list: an unknown field is dropped,
// the size caps are enforced again. Sagax names no product and no kind:
// every word of a card is data from the console.
//
// The bot learns a link from its tool result: the console tags a result
// that holds records with `_meta["pulsatrix/records"]` (`parseRecordsMeta`),
// the relay appends one line with the ready-made link (`recordsNote`), and
// at the end of a turn a plain number is linked only when the conversation's
// tool results hold that id for exactly one kind (`linkSeenRecords`).

export const RECORD_LINK_PREFIX = "sagax://record/";
/** Whether a text names the record scheme at all, in any case: a search,
 * never a lowercased copy of the text. */
const RECORD_SCHEME = /sagax:\/\/record\//i;
export function mentionsRecordScheme(text: string): boolean {
  return text.includes("://") && RECORD_SCHEME.test(text);
}
const NAME = /^[a-z][a-z0-9_]{1,40}$/;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** The longest href read as a record link (three encoded segments). */
const RECORD_LINK_MAX = 512;

export interface RecordRef {
  product: string;
  kind: string;
  id: string;
}

/** A kind a product describes (its product list entry's `records`). */
export interface RecordKindInfo {
  kind: string;
  name: { en?: string; fr?: string };
  plural?: { en?: string; fr?: string };
}

/** The most kinds one product lists. */
export const RECORD_KINDS_MAX = 24;

/** The one record field written as text: a ticket's title (M-20261119-084). */
export const RECORD_TITLE_FIELD = "summary";
/** The longest title the product keeps. */
export const RECORD_TITLE_MAX = 100;

/** A title as the product keeps it: one line of 1 to RECORD_TITLE_MAX
 * characters, trimmed; null when it is not one. The route and the card read
 * it here, one rule for both. */
export function recordTitleValue(value: string): string | null {
  const trimmed = value.trim();
  const chars = [...trimmed];
  const control = chars.some((char) => { const code = char.codePointAt(0) ?? 0; return code < 32 || code === 127; });
  return !chars.length || chars.length > RECORD_TITLE_MAX || control ? null : trimmed;
}

export function validRecordName(value: unknown): value is string {
  return typeof value === "string" && NAME.test(value);
}

export function validRecordId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !/^\.+$/.test(value);
}

export function validRecordRef(ref: { product?: unknown; kind?: unknown; id?: unknown } | null | undefined): ref is RecordRef {
  return Boolean(ref) && validRecordName(ref!.product) && validRecordName(ref!.kind) && validRecordId(ref!.id);
}

/** The href of a record link. */
export function recordLink(ref: RecordRef): string {
  return `${RECORD_LINK_PREFIX}${encodeURIComponent(ref.product)}/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}`;
}

/** Link text as Markdown reads it literally: one line, brackets and
 * backslashes escaped. */
export function recordLinkText(label: string): string {
  return label.replace(/\s+/g, " ").trim().replace(/[\\[\]]/g, (char) => `\\${char}`);
}

/** `[label](sagax://record/...)` */
export function recordMarkdown(label: string, ref: RecordRef): string {
  return `[${recordLinkText(label)}](${recordLink(ref)})`;
}

/** Whether a value starts like a record link (the anchor still parses it). */
export function looksLikeRecordLink(value: unknown): boolean {
  return typeof value === "string" && value.slice(0, RECORD_LINK_PREFIX.length).toLowerCase() === RECORD_LINK_PREFIX;
}

/** A record link's product, kind and id, or null when it is not one. */
export function parseRecordLink(href: unknown): RecordRef | null {
  if (!looksLikeRecordLink(href) || (href as string).length > RECORD_LINK_MAX) return null;
  const segments = (href as string).slice(RECORD_LINK_PREFIX.length).split("/");
  if (segments.length !== 3) return null;
  const decoded: string[] = [];
  for (const segment of segments) {
    if (!segment || /[?#\s]/.test(segment)) return null;
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  const ref = { product: decoded[0]!, kind: decoded[1]!, id: decoded[2]! };
  return validRecordRef(ref) ? ref : null;
}

export function recordKey(ref: RecordRef): string {
  return `${ref.product}\u0000${ref.kind}\u0000${ref.id}`;
}

export function recordKindKey(product: string, kind: string): string {
  return `${product}\u0000${kind}`;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Control characters out, tabs and line breaks kept. */
function withoutControls(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += char;
  }
  return out;
}

/** Plain text, one line or many, collapsed; undefined when empty. */
function plain(value: unknown, max = 2_048): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = withoutControls(value).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text && text.length <= max ? text : undefined;
}

/** Text cut on a word to `max` characters, with whether it was cut. */
export function cutText(value: string, max: number): { text: string; cut: boolean } {
  if (value.length <= max) return { text: value, cut: false };
  const head = value.slice(0, Math.max(1, max - 1));
  const space = head.lastIndexOf(" ");
  return { text: `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`, cut: true };
}

function localized(raw: unknown): { en?: string; fr?: string } | undefined {
  const names = record(raw);
  const single = plain(raw, 80);
  const en = plain(names?.en, 80) ?? single;
  const fr = plain(names?.fr, 80);
  return en || fr ? { ...(en ? { en } : {}), ...(fr ? { fr } : {}) } : undefined;
}

/** A product's `records`: the kinds it describes. Unknown fields dropped,
 * a kind without a valid id or a name skipped, at most RECORD_KINDS_MAX. */
export function parseRecordKinds(raw: unknown): RecordKindInfo[] {
  if (!Array.isArray(raw)) return [];
  const kinds: RecordKindInfo[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = record(entry);
    const kind = item?.kind;
    if (!item || !validRecordName(kind) || seen.has(kind)) continue;
    const name = localized(item.name);
    if (!name) continue;
    const plural = localized(item.plural);
    seen.add(kind);
    kinds.push({ kind, name, ...(plural ? { plural } : {}) });
    if (kinds.length >= RECORD_KINDS_MAX) break;
  }
  return kinds;
}

// ── tool result metadata ─────────────────────────────────────────────────

export const RECORDS_META_KEY = "pulsatrix/records";
/** The most records of one kind a result names (the console sends 50). */
export const RECORDS_META_MAX = 50;
const RECORDS_META_GROUPS_MAX = 8;
const RECORD_LABEL_MAX = 80;

export interface RecordsMetaGroup {
  product: string;
  kind: string;
  records: Array<{ id: string; label: string }>;
  /** how many records the result left out */
  more: number;
}

/** `_meta["pulsatrix/records"]` of a tools/call result, read tolerantly:
 * a group or a record that does not validate is dropped. */
export function parseRecordsMeta(result: unknown): RecordsMetaGroup[] {
  const meta = record(record(result)?._meta);
  const groups = meta?.[RECORDS_META_KEY];
  if (!Array.isArray(groups)) return [];
  const out: RecordsMetaGroup[] = [];
  for (const entry of groups) {
    const group = record(entry);
    if (!group || !validRecordName(group.product) || !validRecordName(group.kind) || !Array.isArray(group.records)) continue;
    const records: RecordsMetaGroup["records"] = [];
    const ids = new Set<string>();
    for (const raw of group.records) {
      const item = record(raw);
      if (!item || !validRecordId(item.id) || ids.has(item.id)) continue;
      const label = plain(item.label, 400)?.replace(/\s+/g, " ");
      ids.add(item.id);
      records.push({ id: item.id, label: label ? cutText(label, RECORD_LABEL_MAX).text : item.id });
      if (records.length >= RECORDS_META_MAX) break;
    }
    if (!records.length) continue;
    const more = typeof group.more === "number" && Number.isInteger(group.more) && group.more > 0 ? Math.min(group.more, 1_000_000) : 0;
    out.push({ product: group.product, kind: group.kind, records, more: more + Math.max(0, group.records.length - RECORDS_META_MAX) });
    if (out.length >= RECORDS_META_GROUPS_MAX) break;
  }
  return out;
}

/** The link draws in the app's chat only: never in a text, a mail or a
 * message a bot sends (those carry the label alone). */
const CHAT_ONLY = "In your chat reply only (never in a text, mail or message you send), ";

/** The longest line the relay appends to a tool result. */
export const RECORDS_NOTE_MAX_BYTES = 600;

/** The one line a tool result holding records gains, so the bot copies
 * the ready-made link: one record, its link; several, the form once per
 * kind and turn (`severalFirst` says whether this turn already had it).
 * Null when there is nothing to add. */
export function recordsNote(
  groups: readonly RecordsMetaGroup[],
  severalFirst: (group: RecordsMetaGroup) => boolean = () => true,
  /** Whether the sentence is still owed this turn (true once per turn); a later line is the link form alone. */
  sentenceFirst: () => boolean = () => true,
): string | null {
  const parts: string[] = [];
  let asked = false;
  const sentence = (): boolean => {
    if (asked) return false;
    asked = true;
    return sentenceFirst();
  };
  let bytes = 0;
  for (const group of groups) {
    let part: string | null = null;
    if (group.records.length === 1 && group.more === 0) {
      const only = group.records[0]!;
      const link = recordMarkdown(only.label, { product: group.product, kind: group.kind, id: only.id });
      part = sentence() ? `${CHAT_ONLY}mention it as ${link}.` : `Link: ${link}`;
    } else if (severalFirst(group)) {
      const numbered = group.records.every((item) => item.label === `#${item.id}`);
      const href = `${RECORD_LINK_PREFIX}${group.product}/${group.kind}/<id>`;
      const link = `[${numbered ? "#<id>" : "<label>"}](${href})`;
      part = sentence() ? `${CHAT_ONLY}mention one of these as ${link}.` : `Link: ${link}`;
    }
    if (!part) continue;
    const size = new TextEncoder().encode(part).length + (parts.length ? 1 : 0);
    if (bytes + size > RECORDS_NOTE_MAX_BYTES) break;
    parts.push(part);
    bytes += size;
  }
  return parts.length ? parts.join(" ") : null;
}

// ── a bot's message: links checked, plain numbers linked ─────────────────

type Segment = { text: string; kind: "plain" | "code" | "link" };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_BLOCK = /^ {0,3}\$\$/;
const INDENTED_CODE = /^(?: {4}|\t)(?!\s*(?:[-*+]|\d{1,9}[.)])\s)/;
/** A link's destination, with an optional title (`"t"`, `'t'` or `(t)`). */
const DESTINATION = String.raw`\(\s*[^)\s]*(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)`;
const LABEL = String.raw`\[(?:\\.|[^\]\\\n])*\]`;
/** Inline spans no number is linked in: code, math, images, links,
 * autolinks and HTML, bare addresses. A link is its own kind. */
const INLINE = new RegExp(String.raw`(\u0060+)[\s\S]*?\1|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$[^$\n]+\$|!${LABEL}${DESTINATION}|(${LABEL}${DESTINATION})|${LABEL}\[[^\]\n]*\]|<[^>\n]+>|(?:https?:\/\/|www\.)[^\s)]+`, "g");

function inlineSegments(line: string, out: Segment[]): void {
  let at = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(line); match; match = INLINE.exec(line)) {
    if (match.index > at) out.push({ text: line.slice(at, match.index), kind: "plain" });
    out.push({ text: match[0], kind: match[2] ? "link" : "code" });
    at = match.index + match[0].length;
    if (match[0].length === 0) INLINE.lastIndex += 1;
  }
  if (at < line.length) out.push({ text: line.slice(at), kind: "plain" });
}

/** A message split into what may be rewritten and what may not. */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const lines = text.split(/(?<=\n)/);
  let fence: string | null = null;
  let math = false;
  for (const line of lines) {
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence) {
      out.push({ text: line, kind: "code" });
      if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length && line.trim() === fenceMark) fence = null;
      continue;
    }
    if (math) {
      out.push({ text: line, kind: "code" });
      if (MATH_BLOCK.test(line)) math = false;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark;
      out.push({ text: line, kind: "code" });
      continue;
    }
    if (MATH_BLOCK.test(line)) {
      // `$$ x $$` on one line closes itself
      if (!line.trim().slice(2).includes("$$")) math = true;
      out.push({ text: line, kind: "code" });
      continue;
    }
    if (INDENTED_CODE.test(line)) {
      out.push({ text: line, kind: "code" });
      continue;
    }
    inlineSegments(line, out);
  }
  return out;
}

const LINK_PARTS = /^\[((?:\\.|[^\]\\])*)\]\(\s*([^)\s]*)[\s\S]*\)$/;

/** A record link whose product, kind or id is not known for the person
 * (`known` false, or a link that does not parse) becomes its text. */
export function unlinkUnknownRecords(text: string, known: (ref: RecordRef) => boolean): string {
  if (!mentionsRecordScheme(text)) return text;
  return segments(text).map((segment) => {
    if (segment.kind !== "link") return segment.text;
    const parts = LINK_PARTS.exec(segment.text);
    if (!parts || !looksLikeRecordLink(parts[2])) return segment.text;
    const ref = parseRecordLink(parts[2]);
    return ref && known(ref) ? segment.text : parts[1]!;
  }).join("");
}

/** A record address written outside a Markdown link (bare, in an
 * autolink, in an HTML attribute). */
const BARE_RECORD = /<?sagax:\/\/record\/[^\s"'<>)\]]*>?/gi;

/**
 * The text with no record address left: each record link reduced to its
 * label, any other record address dropped. What leaves the app (a text, a
 * mail, speech, a push, a message to another bot, a page) never carries a
 * `sagax://` address. The same rule as unlinkUnknownRecords, every link
 * unknown.
 */
export function withoutRecordLinks(text: string): string {
  if (!mentionsRecordScheme(text)) return text;
  return unlinkUnknownRecords(text, () => false).replace(BARE_RECORD, "");
}

/** Every string of a tool's arguments without a record address (depth and
 * size bounded; anything else as it is). */
export function withoutRecordLinksIn<T>(value: T, depth = 0): T {
  if (typeof value === "string") return withoutRecordLinks(value) as T;
  if (depth > 12 || !value || typeof value !== "object") return value;
  // the same object back when nothing changed: no copy of a large tree
  let changed = false;
  if (Array.isArray(value)) {
    const mapped = value.map((item) => {
      const next = withoutRecordLinksIn(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? mapped : value) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = withoutRecordLinksIn(item, depth + 1);
    if (next !== item) changed = true;
    out[key] = next;
  }
  return (changed ? out : value) as T;
}

/**
 * A bot's message as stored (#4507): `text` is what every surface and
 * every client reads, so it holds no record address; `recordText` is the
 * same words with their record links, for a client that draws them.
 * A message without a record link is returned as it is.
 */
export function splitRecordText<T extends { role?: string; text?: unknown; recordText?: unknown }>(message: T): T {
  if (message.role !== "bot" || typeof message.text !== "string" || !mentionsRecordScheme(message.text)) return message;
  const plainText = withoutRecordLinks(message.text);
  if (plainText === message.text) return message;
  return { ...message, text: plainText, recordText: message.text };
}

/** The words a client that draws record links shows: `recordText` while it
 * is still the same message as `text`, else `text`. */
export function recordTextOf(message: { text?: string; recordText?: string }): string | undefined {
  const linked = message.recordText;
  if (typeof linked !== "string" || typeof message.text !== "string") return message.text;
  return withoutRecordLinks(linked) === message.text ? linked : message.text;
}

/** The most streamed text held back while it could still become a record
 * link (`[label](sagax://record/...)`: an 80-character label, a short address). */
export const RECORD_STREAM_HOLD_MAX = 256;
const RECORD_LABEL_HOLD_MAX = 96;

/** Whether `tail`, which starts with `[`, could still grow into a record link. */
function couldBecomeRecordLink(tail: string): boolean {
  let close = -1;
  for (let at = 1; at < tail.length; at++) {
    const char = tail[at];
    if (char === "\\") { at++; continue; }
    if (char === "\n") return false;
    if (char === "]") { close = at; break; }
  }
  if (close < 0) return tail.length - 1 <= RECORD_LABEL_HOLD_MAX;
  if (close - 1 > RECORD_LABEL_HOLD_MAX) return false;
  const rest = tail.slice(close + 1);
  if (!rest) return true;
  if (rest[0] !== "(") return false;
  const destination = rest.slice(1).replace(/^ +/, "");
  if (/[)\s]/.test(destination)) return false;
  const lower = destination.toLowerCase();
  return lower.length < RECORD_LINK_PREFIX.length ? RECORD_LINK_PREFIX.startsWith(lower) : lower.startsWith(RECORD_LINK_PREFIX);
}

/**
 * Streamed text (#4507): where the part that must wait starts, because it
 * could still become a record link or a record address once the next chunk
 * arrives (a `[` whose link is not finished, a `sagax:` not yet ended).
 * Everything before goes out at once; text with no such opening is never
 * held. Past RECORD_STREAM_HOLD_MAX nothing is held.
 */
export function recordLinkHoldStart(text: string): number {
  const from = Math.max(0, text.length - RECORD_STREAM_HOLD_MAX);
  for (let at = text.indexOf("[", from); at >= 0; at = text.indexOf("[", at + 1)) {
    if (couldBecomeRecordLink(text.slice(at))) return at;
  }
  const bare = /<?sagax:[^\s"'<>)\]]*$/i.exec(text.slice(from));
  return bare ? from + bare.index : text.length;
}

/** One chunk of a stream: what goes out now (no record address in it) and
 * what waits for the next chunk. */
export function streamRecordText(held: string, delta: string): { ready: string; held: string } {
  const text = held + delta;
  const cut = recordLinkHoldStart(text);
  return { ready: withoutRecordLinks(text.slice(0, cut)), held: text.slice(cut) };
}

/** A record a conversation's tool results named. */
export interface SeenRecord extends RecordRef {
  label?: string;
}

/** Ids shorter than this are linked only after `#` or the kind's name. */
const SHORT_ID = 5;
const NUMBER = /(^|[^\p{L}\p{N}_#/.,:@$\\-])(#?)(\d{1,96})(?![\p{L}\p{N}_]|[.,:-]\d)/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Link a plain number of a bot's message when the conversation's tool
 * results (`seen`) hold that exact id for exactly one product and kind.
 * Never inside code, math, a link, an image or an address; an id of fewer
 * than five digits only when written `#<id>` or right after the kind's name
 * (`kindNames`, either language); the link text keeps what the bot wrote.
 * A second pass changes nothing.
 */
export function linkSeenRecords(text: string, seen: readonly SeenRecord[], kindNames: (product: string, kind: string) => readonly string[] = () => []): string {
  if (!seen.length) return text;
  return linkSeenIds(linkSeenLabels(text, seen), seen, kindNames);
}

/** A label is number-like when it has a digit, no space and four characters at least. */
export function numberLikeLabel(label: string): boolean {
  return label.length >= 4 && label.length <= 96 && /\d/.test(label) && !/\s/.test(label);
}

const LABEL_LEAD = String.raw`(?<![\p{L}\p{N}_#/.@$\\-])`;
const LABEL_TAIL = String.raw`(?![\p{L}\p{N}_]|-[\p{L}\p{N}]|[.,:]\d)`;

/**
 * Link a seen label that is a number-like token (an invoice or purchase order
 * number) when it labels exactly one seen record. A label two records share is
 * never linked, nor one that is also the id of another record (the id pass owns
 * it), nor a name with a space. Never inside code, a link or an address.
 */
function linkSeenLabels(text: string, seen: readonly SeenRecord[]): string {
  const ids = new Set(seen.map((item) => item.id));
  const byLabel = new Map<string, Map<string, RecordRef>>();
  for (const item of seen) {
    const label = item.label?.trim();
    if (!label || !numberLikeLabel(label) || !validRecordRef(item)) continue;
    // a label that is the record's own id (`481516`, `#481516`) is the id pass's work
    if (label === item.id || label === `#${item.id}` || ids.has(label.replace(/^#/, ""))) continue;
    const refs = byLabel.get(label) ?? new Map<string, RecordRef>();
    refs.set(recordKey(item), { product: item.product, kind: item.kind, id: item.id });
    byLabel.set(label, refs);
  }
  for (const [label, refs] of byLabel) if (refs.size !== 1 || !text.includes(label)) byLabel.delete(label);
  if (!byLabel.size) return text;
  const names = [...byLabel.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`${LABEL_LEAD}(?:${names.join("|")})${LABEL_TAIL}`, "gu");
  return segments(text).map((segment) => {
    if (segment.kind !== "plain") return segment.text;
    return segment.text.replace(pattern, (whole) => recordMarkdown(whole, [...byLabel.get(whole)!.values()][0]!));
  }).join("");
}

function linkSeenIds(text: string, seen: readonly SeenRecord[], kindNames: (product: string, kind: string) => readonly string[]): string {
  if (!/\d/.test(text)) return text;
  const byId = new Map<string, Map<string, RecordRef>>();
  for (const item of seen) {
    if (!/^\d+$/.test(item.id) || !validRecordRef(item)) continue;
    const kinds = byId.get(item.id) ?? new Map<string, RecordRef>();
    kinds.set(recordKindKey(item.product, item.kind), { product: item.product, kind: item.kind, id: item.id });
    byId.set(item.id, kinds);
  }
  if (!byId.size) return text;
  const nameCache = new Map<string, RegExp | null>();
  const namedBefore = (ref: RecordRef, before: string): boolean => {
    const key = recordKindKey(ref.product, ref.kind);
    if (!nameCache.has(key)) {
      const names = [...new Set([...kindNames(ref.product, ref.kind), ref.kind.replace(/_/g, " ")].map((name) => name.trim()).filter(Boolean))];
      nameCache.set(key, names.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${names.map(escapeRegExp).join("|")})\\s+$`, "iu") : null);
    }
    return nameCache.get(key)?.test(before) ?? false;
  };
  return segments(text).map((segment) => {
    if (segment.kind !== "plain") return segment.text;
    return segment.text.replace(NUMBER, (whole, lead: string, hash: string, digits: string, offset: number) => {
      const kinds = byId.get(digits);
      if (!kinds || kinds.size !== 1) return whole;
      const ref = [...kinds.values()][0]!;
      if (digits.length < SHORT_ID && !hash && !namedBefore(ref, segment.text.slice(0, offset + lead.length))) return whole;
      return `${lead}[${hash}${digits}](${recordLink(ref)})`;
    });
  }).join("");
}

// ── the card ─────────────────────────────────────────────────────────────

export const RECORD_TONES = ["open", "waiting", "done", "alert"] as const;
export type RecordTone = typeof RECORD_TONES[number];
export const RECORD_LEVELS = ["urgent", "high", "normal", "low"] as const;
export type RecordLevel = typeof RECORD_LEVELS[number];
export const RECORD_NOTES_STATES = ["ok", "none", "forbidden", "unavailable"] as const;
export type RecordNotesState = typeof RECORD_NOTES_STATES[number];
export const RECORD_DATE_KEYS = ["opened", "updated", "due", "closed"] as const;
export type RecordDateKey = typeof RECORD_DATE_KEYS[number];
/** How a field of a card is drawn (#4572). A field without a type, or with a
 * type this app does not know, is text: its `value` is always ready to show.
 * `phone` and `email` are text too, ready to show; they say what a record
 * window's call and write buttons reach (M-20261127-101). */
export const RECORD_FIELD_TYPES = ["text", "date", "ago", "money", "duration", "percent", "person", "ref", "state", "phone", "email"] as const;
export type RecordFieldType = typeof RECORD_FIELD_TYPES[number];
export const RECORD_LINES_STATES = ["ok", "none", "forbidden", "unavailable"] as const;
export type RecordLinesState = typeof RECORD_LINES_STATES[number];

/** The card caps (the console's own, enforced again). */
export const RECORD_CARD_CAPS = {
  title: 200, description: 600, note: 400, fieldValue: 120, name: 80, label: 80,
  people: 4, fields: 10, tag: 24, notes: 3, chips: 2, lines: 6, lineLabel: 160, lineDetail: 80, lineValue: 80, heading: 80,
} as const;

/** One key field. `value` is the product's own ready text; the typed parts
 * beside it say how to draw it, never what it is worth: a money `amount` is
 * the product's number, never computed here. */
export interface RecordField {
  editKey?: string;
  label: string;
  value: string;
  type?: RecordFieldType;
  /** money: the product's number as a decimal string */
  amount?: string;
  /** money: the product's currency code */
  currency?: string;
  /** date, ago: an instant (ISO 8601 with its offset) or, with `day`, a calendar day */
  at?: string;
  /** date: `at` is a calendar day (`2026-11-05`): no time, never shifted by a zone */
  day?: boolean;
  /** percent: 0 to 100, for the bar */
  share?: number;
  /** ref, person: the record this names, opened in place */
  ref?: RecordRef;
  /** person, ref: a second, quieter text */
  detail?: string;
  /** person: the icon (`owner`, `contact`) */
  role?: string;
  /** state */
  tone?: RecordTone;
}

/** A line of the right pane's list (an invoice's products, an agreement's additions). */
export interface RecordLine {
  label: string;
  detail?: string;
  value?: string;
  ref?: RecordRef;
}

export interface RecordCard {
  product: { id: string; name: string; icon?: { url: string } };
  kind: { id: string; name: string };
  id: string;
  /** the human label (`#481516`, a company's name): never an internal id */
  number: string;
  title: string;
  state?: { label: string; tone: RecordTone };
  priority?: { label: string; level: RecordLevel };
  /** more header chips after the state and the priority (two at most) */
  chips?: Array<{ label: string; tone: RecordTone }>;
  company?: { name: string; ref?: RecordRef };
  people?: Array<{ role: string; label: string; name: string; detail?: string; ref?: RecordRef }>;
  /** ISO 8601 with the organization's offset; format in `tz` */
  dates?: Partial<Record<RecordDateKey, string>>;
  fields?: RecordField[];
  description?: { text: string; more: boolean };
  /** the right pane's list, between the description and the activity */
  lines?: { state: RecordLinesState; title?: string; items: RecordLine[]; total?: number; more: boolean };
  notes: {
    state: RecordNotesState;
    /** the activity's name as the console words it ("Timeline") */
    title?: string;
    items: Array<{ author?: string; at?: string; internal?: boolean; /** a short marker the product gives the entry (a channel, a kind: "Email", "Time entry") */ tag?: string; text: string; more: boolean }>;
    total?: number;
    /** there are notes beyond `items` */
    more: boolean;
  };
  /** https only */
  openUrl?: string;
  /** the organization's time zone */
  tz?: string;
  asOf?: string;
  cached: boolean;
}

/** What GET /api/me/records/:product/:kind/:id answers when there is no
 * card: the page says why in one sentence. The card reads at once whatever
 * the organization's Ask first rule (#4566); only a Refuse rule refuses. */
export const RECORD_CARD_STATES = [
  "sign_in", "no_access", "unknown", "not_connected", "busy", "down", "unavailable", "org_refused",
] as const;
export type RecordCardState = typeof RECORD_CARD_STATES[number];

export interface RecordCardMiss {
  state: RecordCardState;
  /** the console's code (a tooltip only) */
  code?: string;
  /** seconds, for `busy` */
  retryAfter?: number;
  /** the product's state, for `not_connected` (shared/person-products.ts ProductState) */
  productState?: string;
  /** the organization rule, for `org_refused` */
  rule?: { id: string; text: string };
}

export type RecordCardAnswer = { card: RecordCard } | RecordCardMiss;

function capped(value: unknown, max: number): { text: string; cut: boolean } | undefined {
  const text = plain(value, 16_384);
  return text ? cutText(text, max) : undefined;
}

function isoDate(value: unknown): string | undefined {
  const text = plain(value, 64);
  return text && /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text) && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  const text = plain(value, 2_048);
  if (!text || /\s/.test(text)) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function tone(value: unknown): RecordTone {
  return (RECORD_TONES as readonly unknown[]).includes(value) ? value as RecordTone : "open";
}

/** A `ref` as sent ({ product, kind, id }), or undefined when it is not a valid one:
 * a record named without a product the person holds is plain words. */
function typedRef(raw: unknown): RecordRef | undefined {
  const ref = record(raw);
  return ref && validRecordRef(ref) ? { product: ref.product as string, kind: ref.kind as string, id: ref.id as string } : undefined;
}

const DECIMAL = /^-?\d{1,24}(?:\.\d{1,12})?$/;
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The typed parts of a field. An unknown type reads as text; a type whose own
 * part does not validate is text too (the row stays, drawn flat from `value`).
 * Only the parts of the field's own type are kept. */
function typedPart(field: Record<string, unknown>): Partial<RecordField> {
  const type = field.type;
  if (typeof type !== "string" || !(RECORD_FIELD_TYPES as readonly string[]).includes(type) || type === "text") return {};
  switch (type as RecordFieldType) {
    case "money": {
      const amount = plain(field.amount, 40);
      if (!amount || !DECIMAL.test(amount)) return {};
      const currency = plain(field.currency, 3);
      return { type: "money", amount, ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}) };
    }
    case "date":
    case "ago": {
      const at = isoDate(field.at);
      if (!at) return {};
      // a calendar day is only a date, and only when sent as a bare day
      return type === "date" && field.day === true && BARE_DAY.test(at) ? { type: "date", at, day: true } : { type: type as "date" | "ago", at };
    }
    case "percent": {
      const share = field.share;
      return typeof share === "number" && Number.isFinite(share) && share >= 0 && share <= 100 ? { type: "percent", share } : {};
    }
    case "person": {
      const detail = capped(field.detail, RECORD_CARD_CAPS.fieldValue);
      const role = plain(field.role, 40);
      const ref = typedRef(field.ref);
      return { type: "person", ...(detail ? { detail: detail.text } : {}), ...(role && /^[a-z][a-z0-9_]{0,39}$/.test(role) ? { role } : {}), ...(ref ? { ref } : {}) };
    }
    case "ref": {
      const ref = typedRef(field.ref);
      if (!ref) return {};
      const detail = capped(field.detail, RECORD_CARD_CAPS.fieldValue);
      return { type: "ref", ref, ...(detail ? { detail: detail.text } : {}) };
    }
    case "state":
      return { type: "state", tone: tone(field.tone) };
    default:
      return { type: type as RecordFieldType };
  }
}

/** The console's card, read tolerantly: null without the parts every card
 * has (product, kind, id, number, title); every other part dropped when it
 * does not validate; the caps enforced again. */
export function parseRecordCard(raw: unknown): RecordCard | null {
  const card = record(raw);
  if (!card) return null;
  const productRaw = record(card.product);
  const kindRaw = record(card.kind);
  const productId = productRaw?.id;
  const kindId = kindRaw?.id;
  const productName = plain(productRaw?.name, 256);
  const kindName = plain(kindRaw?.name, RECORD_CARD_CAPS.label);
  const id = card.id;
  const number = plain(card.number, 400)?.replace(/\s+/g, " ");
  const title = capped(card.title, RECORD_CARD_CAPS.title);
  if (!validRecordName(productId) || !validRecordName(kindId) || !validRecordId(id) || !productName || !kindName || !number || !title) return null;
  const iconUrl = httpsUrl(record(productRaw!.icon)?.url);
  const out: RecordCard = {
    product: { id: productId, name: productName, ...(iconUrl ? { icon: { url: iconUrl } } : {}) },
    kind: { id: kindId, name: kindName },
    id,
    number: cutText(number, RECORD_CARD_CAPS.name).text,
    title: title.text,
    notes: { state: "none", items: [], more: false },
    cached: card.cached === true,
  };
  const state = record(card.state);
  const stateLabel = plain(state?.label, 400);
  if (stateLabel) {
    out.state = { label: cutText(stateLabel, RECORD_CARD_CAPS.label).text, tone: tone(state!.tone) };
  }
  const priority = record(card.priority);
  const priorityLabel = plain(priority?.label, 400);
  if (priorityLabel) {
    const level = (RECORD_LEVELS as readonly unknown[]).includes(priority!.level) ? priority!.level as RecordLevel : "normal";
    out.priority = { label: cutText(priorityLabel, RECORD_CARD_CAPS.label).text, level };
  }
  const company = record(card.company);
  const companyName = capped(company?.name, RECORD_CARD_CAPS.name);
  if (companyName) {
    const companyRef = typedRef(company!.ref);
    out.company = { name: companyName.text, ...(companyRef ? { ref: companyRef } : {}) };
  }
  if (Array.isArray(card.people)) {
    const people: NonNullable<RecordCard["people"]> = [];
    for (const entry of card.people) {
      const person = record(entry);
      const name = capped(person?.name, RECORD_CARD_CAPS.name);
      const role = plain(person?.role, 40);
      if (!person || !name || !role || !/^[a-z][a-z0-9_]{0,39}$/.test(role)) continue;
      const label = plain(person.label, 400);
      const detail = capped(person.detail, RECORD_CARD_CAPS.fieldValue);
      const personRef = typedRef(person.ref);
      people.push({ role, label: label ? cutText(label, RECORD_CARD_CAPS.label).text : "", name: name.text, ...(detail ? { detail: detail.text } : {}), ...(personRef ? { ref: personRef } : {}) });
      if (people.length >= RECORD_CARD_CAPS.people) break;
    }
    if (people.length) out.people = people;
  }
  const dates = record(card.dates);
  if (dates) {
    const kept: NonNullable<RecordCard["dates"]> = {};
    for (const key of RECORD_DATE_KEYS) {
      const value = isoDate(dates[key]);
      if (value) kept[key] = value;
    }
    if (Object.keys(kept).length) out.dates = kept;
  }
  if (Array.isArray(card.chips)) {
    const chips: NonNullable<RecordCard["chips"]> = [];
    for (const entry of card.chips) {
      const chip = record(entry);
      const chipLabel = plain(chip?.label, 400);
      if (!chip || !chipLabel) continue;
      chips.push({ label: cutText(chipLabel, RECORD_CARD_CAPS.label).text, tone: tone(chip.tone) });
      if (chips.length >= RECORD_CARD_CAPS.chips) break;
    }
    if (chips.length) out.chips = chips;
  }
  if (Array.isArray(card.fields)) {
    const fields: RecordField[] = [];
    for (const entry of card.fields) {
      const field = record(entry);
      const label = plain(field?.label, 400);
      const value = capped(field?.value, RECORD_CARD_CAPS.fieldValue);
      if (!field || !label || !value) continue;
      const editKey = field.edit_key ?? field.editKey;
      fields.push({
        label: cutText(label, RECORD_CARD_CAPS.label).text,
        value: value.text,
        ...(typeof editKey === "string" && /^[a-z]{1,32}$/.test(editKey) ? { editKey } : {}),
        ...typedPart(field),
      });
      if (fields.length >= RECORD_CARD_CAPS.fields) break;
    }
    if (fields.length) out.fields = fields;
  }
  const description = record(card.description);
  const descriptionText = capped(description?.text, RECORD_CARD_CAPS.description);
  if (descriptionText) out.description = { text: descriptionText.text, more: descriptionText.cut || description!.more === true };
  const lines = record(card.lines);
  if (lines) {
    const state = (RECORD_LINES_STATES as readonly unknown[]).includes(lines.state) ? lines.state as RecordLinesState : "unavailable";
    const items: RecordLine[] = [];
    let dropped = false;
    if (state === "ok" && Array.isArray(lines.items)) {
      for (const entry of lines.items) {
        const line = record(entry);
        const lineLabel = capped(line?.label, RECORD_CARD_CAPS.lineLabel);
        if (!line || !lineLabel) continue;
        if (items.length >= RECORD_CARD_CAPS.lines) {
          dropped = true;
          break;
        }
        const detail = capped(line.detail, RECORD_CARD_CAPS.lineDetail);
        const value = capped(line.value, RECORD_CARD_CAPS.lineValue);
        const ref = typedRef(line.ref);
        items.push({ label: lineLabel.text, ...(detail ? { detail: detail.text } : {}), ...(value ? { value: value.text } : {}), ...(ref ? { ref } : {}) });
      }
    }
    const linesTitle = capped(lines.title, RECORD_CARD_CAPS.heading);
    const total = typeof lines.total === "number" && Number.isInteger(lines.total) && lines.total >= 0 ? lines.total : undefined;
    out.lines = {
      state, items,
      ...(linesTitle ? { title: linesTitle.text } : {}),
      ...(total !== undefined ? { total } : {}),
      more: lines.more === true || dropped || (total !== undefined && total > items.length),
    };
  }
  const notes = record(card.notes);
  if (notes) {
    const state = (RECORD_NOTES_STATES as readonly unknown[]).includes(notes.state) ? notes.state as RecordNotesState : "unavailable";
    const items: RecordCard["notes"]["items"] = [];
    let dropped = false;
    if (state === "ok" && Array.isArray(notes.items)) {
      for (const entry of notes.items) {
        const note = record(entry);
        const noteText = capped(note?.text, RECORD_CARD_CAPS.note);
        if (!note || !noteText) continue;
        if (items.length >= RECORD_CARD_CAPS.notes) {
          dropped = true;
          break;
        }
        const author = capped(note.author, RECORD_CARD_CAPS.name);
        const at = isoDate(note.at);
        const tag = capped(note.tag, RECORD_CARD_CAPS.tag);
        items.push({
          ...(author ? { author: author.text } : {}),
          ...(at ? { at } : {}),
          ...(typeof note.internal === "boolean" ? { internal: note.internal } : {}),
          ...(tag ? { tag: tag.text } : {}),
          text: noteText.text,
          more: noteText.cut || note.more === true,
        });
      }
    }
    const total = typeof notes.total === "number" && Number.isInteger(notes.total) && notes.total >= 0 ? notes.total : undefined;
    const notesTitle = capped(notes.title, RECORD_CARD_CAPS.heading);
    out.notes = {
      state, items,
      ...(notesTitle ? { title: notesTitle.text } : {}),
      ...(total !== undefined ? { total } : {}),
      more: notes.more === true || dropped || (total !== undefined && total > items.length),
    };
  }
  const openUrl = httpsUrl(card.open_url ?? card.openUrl);
  if (openUrl) out.openUrl = openUrl;
  const tz = plain(card.tz, 64);
  if (tz && /^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) out.tz = tz;
  const asOf = isoDate(card.as_of ?? card.asOf);
  if (asOf) out.asOf = asOf;
  return out;
}

/** The route's answer as the app reads it: a card, or a state. */
export function parseRecordCardAnswer(raw: unknown): RecordCardAnswer {
  const body = record(raw);
  if (body && "card" in body) {
    const card = parseRecordCard(body.card);
    return card ? { card } : { state: "unavailable" };
  }
  const state = (RECORD_CARD_STATES as readonly unknown[]).includes(body?.state) ? body!.state as RecordCardState : "unavailable";
  const code = plain(body?.code, 64);
  const retryAfter = typeof body?.retryAfter === "number" && Number.isFinite(body.retryAfter) && body.retryAfter > 0 ? Math.min(Math.ceil(body.retryAfter), 3_600) : undefined;
  const productState = plain(body?.productState, 64);
  const rule = record(body?.rule);
  const ruleId = plain(rule?.id, 128);
  const ruleText = plain(rule?.text, 600);
  return {
    state,
    ...(code ? { code } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(productState ? { productState } : {}),
    ...(ruleId && ruleText ? { rule: { id: ruleId, text: ruleText } } : {}),
  };
}
