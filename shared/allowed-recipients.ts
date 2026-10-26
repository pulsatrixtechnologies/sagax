// A bot's allowed recipients (parité Grok Bot X3, JC 2026-10-21: « OUI, par
// bot ; hors liste = carte »). The people and bots this bot may write to
// without a card: an email address, a phone number (Messages, texts), or
// another bot. A send to anyone else keeps its approval card.
//
// Stored on the bot (`allowedRecipients`) as typed entries:
//   bot:<botId>       ask_bot and delegate_bot to that bot, when the bot asks
//                     before contacting other bots (approvePeerComms)
//   email:<address>   an email sent only to listed addresses
//   phone:+<digits>   a message sent only to listed numbers
//
// Shared by the harness (which enforces it) and the app (which edits it), so
// both read an entry the same way. A list is a standing grant, like Always
// allow: the organization can turn standing grants off, and a call in a class
// the person protects with a security key keeps its card.

import { isMessageSendTool } from "./outbound.ts";

export type RecipientKind = "bot" | "email" | "phone";
export type RecipientEntry = { kind: RecipientKind; value: string };

export const MAX_ALLOWED_RECIPIENTS = 200;

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const BOT_ID = /^[\w-]{1,128}$/;

/** An address as it is compared: trimmed, lower case, or null. */
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return value.length <= 254 && EMAIL.test(value) ? value : null;
}

/** A number as it is compared: `+` and its digits. Ten digits with no
 * country code read as North American (+1). Null when it is not a number. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]{7,24}$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+") && digits.length === 10) digits = `1${digits}`;
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

/** One entry, typed (`email:a@b.c`) or bare (an address, a number). */
export function parseRecipientEntry(raw: unknown): RecipientEntry | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const typed = /^(bot|email|phone):(.*)$/i.exec(text);
  if (typed) {
    const kind = typed[1]!.toLowerCase() as RecipientKind;
    const rest = typed[2]!.trim();
    if (kind === "bot") return BOT_ID.test(rest) ? { kind, value: rest } : null;
    const value = kind === "email" ? normalizeEmail(rest) : normalizePhone(rest);
    return value ? { kind, value } : null;
  }
  const email = normalizeEmail(text);
  if (email) return { kind: "email", value: email };
  const phone = normalizePhone(text);
  return phone ? { kind: "phone", value: phone } : null;
}

export function recipientEntryKey(entry: RecipientEntry): string {
  return `${entry.kind}:${entry.value}`;
}

/** The stored list, deduplicated, or null when one entry is not a
 * recipient (the route answers 400 rather than drop it silently). */
export function normalizeAllowedRecipients(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    const entry = parseRecipientEntry(raw);
    if (!entry) return null;
    const key = recipientEntryKey(entry);
    if (!out.includes(key)) out.push(key);
  }
  return out.length > MAX_ALLOWED_RECIPIENTS ? null : out;
}

/** Whether the list names this bot. */
export function botRecipientAllowed(list: readonly string[] | undefined, botId: string): boolean {
  return Boolean(list?.includes(`bot:${botId}`));
}

/** Fields that name who a message goes to. */
const RECIPIENT_FIELDS = new Set([
  "to", "cc", "bcc", "recipient", "recipients", "torecipients", "ccrecipients", "bccrecipients",
  "recipientemail", "recipientemails", "extrarecipients", "recipientphone", "phone", "phonenumber",
  "tonumber", "tophone", "toemail", "toaddress", "toaddresses", "email", "emails", "address", "handle", "handles", "number",
]);
/** Fields that send somewhere the list cannot vouch for: a channel, a chat,
 * a room, a group, a link, a guest list. Their presence keeps the card. */
const OTHER_TARGETS = new Set([
  // a reply or a forward reaches whoever is on the original thread
  "messageid", "threadid", "inreplyto", "conversationid", "replytomessageid", "originalmessageid",
  "channel", "channelid", "channels", "chat", "chatid", "conversation", "conversationid", "room", "roomid", "group", "groupid",
  "team", "teamid", "webhook", "webhookurl", "url", "attendees", "invitees", "guests", "members", "participants",
  "sharewith", "replyall", "space", "spaceid", "list", "listid", "audience", "segment",
]);
/** Inside a recipient object: the parts that hold the address. */
const ADDRESS_PARTS = new Set(["address", "email", "emailaddress", "phone", "phonenumber", "number", "value", "handle"]);
const MAX_DEPTH = 6;

const fieldKey = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** A field named like a recipient that RECIPIENT_FIELDS does not list
 * (`cc_emails`, `send_to`, `phone_numbers`, `receivers`...): read as one, so
 * an unknown spelling never slips a recipient past the list. */
function recipientish(name: string): boolean {
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  // a display name next to an address ("to_name", "recipientName") is not one
  if (snake.endsWith("name")) return false;
  return /(?:^|[_\-\s])(?:to|cc|bcc)(?:$|[_\-\s])/.test(snake)
    || /recipient|e_?mail|phone|mobile|number|address|dest|target|receiver|contact|handle|attendee|invitee/.test(snake);
}
/** Free text: what a message says, never who it goes to. A string elsewhere
 * that reads as an address or a number keeps the card. */
const CONTENT_FIELDS = new Set(["subject", "body", "text", "content", "message", "messagebody", "html", "ishtml", "plaintext", "title", "preview", "signature", "markdown", "note", "comment"]);
const SENDER_FIELDS = new Set(["from", "fromemail", "fromaddress", "sender", "senderemail", "replyto", "userid"]);

type Found = { emails: string[]; phones: string[]; unknown: boolean; other: boolean };

/** Every address in one recipient value: a string ("a@b.c, Name <d@e.f>"),
 * a list, or an object such as Graph's `{ emailAddress: { address } }`. */
function collectAddresses(value: unknown, found: Found, depth: number): void {
  if (depth > MAX_DEPTH) { found.unknown = true; return; }
  if (value === null || value === undefined || value === "") return;
  if (typeof value === "string") {
    for (const part of value.split(/[,;]/)) {
      const piece = part.trim();
      if (!piece) continue;
      const angle = /<([^<>]+)>\s*$/.exec(piece);
      const raw = angle ? angle[1]! : piece;
      const email = normalizeEmail(raw);
      if (email) { found.emails.push(email); continue; }
      const phone = normalizePhone(raw);
      if (phone) { found.phones.push(phone); continue; }
      found.unknown = true;
    }
    return;
  }
  if (typeof value === "number") { collectAddresses(String(value), found, depth + 1); return; }
  if (Array.isArray(value)) { for (const item of value) collectAddresses(item, found, depth + 1); return; }
  if (typeof value === "object") {
    let any = false;
    for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
      if (!ADDRESS_PARTS.has(fieldKey(name))) continue;
      any = true;
      collectAddresses(child, found, depth + 1);
    }
    if (!any) found.unknown = true;
    return;
  }
  found.unknown = true;
}

/** A short string that holds an address or a number somewhere. */
function looksLikeAddress(value: string): boolean {
  if (value.length > 400) return false;
  return /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/.test(value) || /(?:^|[^\w])\+?\d[\d\s().-]{6,}\d(?:$|[^\w])/.test(value);
}

/** Walk a call's arguments for its recipient fields. */
function walk(value: unknown, found: Found, depth: number): void {
  if (depth > MAX_DEPTH) { found.unknown = true; return; }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) walk(item, found, depth + 1); return; }
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const key = fieldKey(name);
    if (OTHER_TARGETS.has(key)) {
      if (child !== null && child !== undefined && child !== "" && child !== false && !(Array.isArray(child) && child.length === 0)) found.other = true;
      continue;
    }
    if (RECIPIENT_FIELDS.has(key) || (!CONTENT_FIELDS.has(key) && !SENDER_FIELDS.has(key) && recipientish(name))) {
      collectAddresses(child, found, depth + 1);
    } else if (typeof child === "string" && !CONTENT_FIELDS.has(key) && !SENDER_FIELDS.has(key) && looksLikeAddress(child)) {
      found.unknown = true;
    } else walk(child, found, depth + 1);
  }
}

/** Who a message send goes to, read from its arguments: the addresses and
 * numbers, or null when the call is not a plain message send or names a
 * recipient the list cannot vouch for (an id, a channel, a guest list). */
export function sendRecipients(tool: string, input: unknown): { emails: string[]; phones: string[] } | null {
  if (!isMessageSendTool(tool)) return null;
  let args = input;
  if (typeof input === "string") {
    try { args = JSON.parse(input); } catch { return null; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const found: Found = { emails: [], phones: [], unknown: false, other: false };
  walk(args, found, 0);
  if (found.unknown || found.other) return null;
  if (found.emails.length + found.phones.length === 0) return null;
  return { emails: [...new Set(found.emails)], phones: [...new Set(found.phones)] };
}

/** Whether every recipient of this send is on the bot's list: the send
 * then goes without a card. Anyone else, or a recipient that cannot be
 * read, keeps the card. */
export function sendRecipientsAllowed(list: readonly string[] | undefined, tool: string, input: unknown): boolean {
  if (!list?.length) return false;
  const recipients = sendRecipients(tool, input);
  if (!recipients) return false;
  return recipients.emails.every((email) => list.includes(`email:${email}`))
    && recipients.phones.every((phone) => list.includes(`phone:${phone}`));
}
