// Sending an email draft from its card (src/components/EmailCard.tsx).
//
// Nothing is ever sent from the card itself. "Envoyer" asks the server for
// an ordinary approval card in the conversation; only the person's Allow on
// that card sends, once, through a connector that can send:
//   - "bot": the bot's own mail connector (a Microsoft 365, Outlook or Gmail
//     MCP server or connected app). Allow asks the bot, as the person, to
//     send exactly this draft, and leaves a one-shot pass: the bot's next
//     outbound call in that thread that names every recipient and the
//     subject is approved without a second card. Any other send still asks.
//   - "smtp": the server's own mail settings (Settings > Email), sent by the
//     server itself.
// Deny closes the card and nothing is sent. A failed send is shown on the
// draft with Retry, and a retry asks again.
//
// Pure: validation, the card's words, the instruction and the pass check.

import { parseArgs } from "./approval-describe.ts";
import { isOutboundTool } from "./outbound.ts";

/** Absent or true: this bot may write email draft cards. False turns them off. */
export function emailDraftsEnabled(bot: { emailDrafts?: boolean } | null | undefined): boolean {
  return bot?.emailDrafts !== false;
}

export const EMAIL_SEND_REQUEST_PREFIX = "maildraft-";
export const EMAIL_SEND_PASS_MS = 10 * 60_000;
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 300;
const MAX_BODY = 50_000;
const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** One attachment the draft keeps with the send. Bytes stay on the bot's
 * side (a path or a content hash); the card shows the name and size. */
export interface EmailDraftAttachment {
  name: string;
  type: string;
  size: number;
  /** Optional content id or workspace path the connector reads. */
  ref?: string;
}

export interface EmailDraftToSend {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** Preserved through the draft card and the one-shot send pass. */
  attachments?: EmailDraftAttachment[];
}

/** Unrequested outbound mail (routine, proactive, another bot) must become
 * a draft card. A send the person asked for in their own turn follows their
 * usual approval level (Ask / Auto / Full). */
export function outboundMailNeedsDraftCard(input: {
  personAsked: boolean;
  ownerTurn: boolean;
}): boolean {
  return !(input.personAsked && input.ownerTurn);
}

export type EmailConnectorKind = "bot" | "smtp";

export interface EmailConnector {
  kind: EmailConnectorKind;
  /** What the person reads: the server or app name ("outlook", "Gmail"),
   * or the server's mail. */
  label: string;
  /** bot connectors: the MCP server or connected-app slug. */
  id?: string;
}

export type EmailSendStatus = "pending" | "denied" | "sending" | "handed-off" | "sent" | "failed";

export interface EmailSendRequestCard {
  id: string;
  /** A stable key of the draft as the bot wrote it, so the card in the chat
   * finds its send again after a reload. */
  draftKey: string;
  draft: EmailDraftToSend;
  connector: EmailConnector;
  /** The principal who asked to send. */
  by: string;
  status: EmailSendStatus;
  /** A readable reason, on `failed`. Never a secret. */
  error?: string;
  /** Addresses that already received this draft (a partial send), so a
   * retry of the same draft skips them. */
  sentTo?: string[];
  at: number;
}

/** Zero-width characters and bidirectional controls: they make a text read
 * differently from what is sent. */
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/** One plain address as it will be sent: an ASCII local part, and a domain
 * shown as punycode (`xn--...`) when it is not ASCII, so a look-alike
 * domain is never shown as the real one. */
function addressOf(value: string): string | null {
  const trimmed = value.trim();
  if (INVISIBLE.test(trimmed)) return null;
  const angle = /<([^<>]+)>\s*$/.exec(trimmed);
  const address = (angle ? angle[1]! : trimmed).trim();
  const at = address.lastIndexOf("@");
  if (at <= 0) return null;
  const local = address.slice(0, at);
  let domain = address.slice(at + 1);
  if (/[^\x21-\x7e]/.test(local)) return null;
  if (/[^\x21-\x7e]/.test(domain)) {
    try {
      domain = new URL(`http://${domain}/`).hostname;
    } catch {
      return null;
    }
  }
  const plain = `${local}@${domain.toLowerCase()}`;
  return ADDRESS.test(plain) ? plain : null;
}

function addressList(value: unknown, field: string, problems: string[]): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : null;
  if (!raw) {
    problems.push(`${field} must be a list of addresses`);
    return [];
  }
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    const address = addressOf(item);
    if (!address) problems.push(`${field}: "${item.trim().slice(0, 80)}" is not an email address`);
    else if (!list.some((known) => known.toLowerCase() === address.toLowerCase())) list.push(address);
  }
  return list;
}

const ATTACHMENT_MAX = 20;
const ATTACHMENT_NAME = /^[^\0\r\n]{1,255}$/;

function attachmentList(value: unknown, problems: string[]): EmailDraftAttachment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    problems.push("attachments must be a list");
    return undefined;
  }
  if (value.length > ATTACHMENT_MAX) {
    problems.push(`at most ${ATTACHMENT_MAX} attachments`);
    return undefined;
  }
  const list: EmailDraftAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push("each attachment needs a name, type and size");
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const type = typeof row.type === "string" ? row.type.trim() : "";
    const size = typeof row.size === "number" && Number.isFinite(row.size) ? Math.floor(row.size) : NaN;
    const ref = typeof row.ref === "string" ? row.ref.trim().slice(0, 500) : undefined;
    if (!ATTACHMENT_NAME.test(name) || !type || !Number.isInteger(size) || size < 0) {
      problems.push("each attachment needs a name, type and size");
      continue;
    }
    list.push({ name, type: type.slice(0, 255), size, ...(ref ? { ref } : {}) });
  }
  return list;
}

/** The draft as it may be sent, or the reasons it may not. Header fields
 * never carry a line break (no header injection), addresses are plain.
 * Attachments are kept with the draft for the approval card and the send. */
export function normalizeDraftForSend(value: unknown): { draft: EmailDraftToSend } | { problems: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { problems: ["draft must be an object"] };
  const input = value as Record<string, unknown>;
  const problems: string[] = [];
  const to = addressList(input.to, "to", problems);
  const cc = addressList(input.cc, "cc", problems);
  const bcc = addressList(input.bcc, "bcc", problems);
  if (!to.length) problems.push("to needs at least one address");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) problems.push(`at most ${MAX_RECIPIENTS} recipients`);
  const subject = typeof input.subject === "string" ? input.subject.replace(/[\r\n]+/g, " ").trim() : "";
  if (INVISIBLE.test(subject)) problems.push("subject holds invisible or direction characters");
  if (subject.length > MAX_SUBJECT) problems.push(`subject is longer than ${MAX_SUBJECT} characters`);
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n") : "";
  if (INVISIBLE.test(body)) problems.push("body holds invisible or direction characters");
  if (body.length > MAX_BODY) problems.push(`body is longer than ${MAX_BODY} characters`);
  if (!subject && !body.trim()) problems.push("an email needs a subject or a body");
  const attachments = attachmentList(input.attachments, problems);
  if (problems.length) return { problems };
  return {
    draft: {
      to, cc, bcc, subject, body,
      ...(attachments?.length ? { attachments } : {}),
    },
  };
}

/** FNV-1a of the draft's fields: the same draft has the same key on every
 * device, without a crypto API. */
export function emailDraftKey(draft: Pick<EmailDraftToSend, "to" | "cc" | "subject" | "body">): string {
  const text = [draft.to.join(","), draft.cc.join(","), draft.subject, draft.body].join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The card's one line: who it goes to and its subject. */
export function emailSendSummary(draft: EmailDraftToSend, connector: EmailConnector, language = "fr"): string {
  const fr = language.toLowerCase().startsWith("fr");
  const subject = draft.subject || (fr ? "(sans objet)" : "(no subject)");
  const recipients = [...draft.to, ...draft.cc].join(", ");
  return fr
    ? `Envoyer le courriel « ${subject} » à ${recipients} avec ${connector.label}`
    : `Send the email "${subject}" to ${recipients} with ${connector.label}`;
}

/** What the person's Allow asks their bot: send exactly this, once. */
export function emailSendInstruction(draft: EmailDraftToSend, connector: EmailConnector, language = "fr"): string {
  const fr = language.toLowerCase().startsWith("fr");
  const lines = fr
    ? [
      `J'ai approuvé l'envoi de ce courriel. Envoie-le maintenant, une seule fois, tel quel, avec ton connecteur ${connector.label}. Ne change ni les destinataires, ni l'objet, ni le corps. Si l'envoi échoue, dis-moi pourquoi sans réessayer.`,
      `À : ${draft.to.join(", ")}`,
      ...(draft.cc.length ? [`Cc : ${draft.cc.join(", ")}`] : []),
      ...(draft.bcc.length ? [`Cci : ${draft.bcc.join(", ")}`] : []),
      `Objet : ${draft.subject}`,
      "Corps :",
      draft.body,
    ]
    : [
      `I approved sending this email. Send it now, once, exactly as is, with your ${connector.label} connector. Do not change the recipients, the subject or the body. If sending fails, tell me why and do not retry.`,
      `To: ${draft.to.join(", ")}`,
      ...(draft.cc.length ? [`Cc: ${draft.cc.join(", ")}`] : []),
      ...(draft.bcc.length ? [`Bcc: ${draft.bcc.join(", ")}`] : []),
      `Subject: ${draft.subject}`,
      "Body:",
      draft.body,
    ];
  return lines.join("\n");
}

type RecipientField = "to" | "cc" | "bcc";
const RECIPIENT_FIELD: Record<string, RecipientField> = {
  to: "to", torecipients: "to", recipients: "to", recipient: "to", toemail: "to", emailto: "to", recipientemail: "to", toaddress: "to", toaddresses: "to",
  cc: "cc", ccrecipients: "cc", ccemail: "cc", ccaddresses: "cc",
  bcc: "bcc", bccrecipients: "bcc", bccemail: "bcc", bccaddresses: "bcc",
};
/** Keys an address may sit under inside a recipient (Microsoft Graph's
 * `{ emailAddress: { address, name } }`). */
const ADDRESS_KEYS = new Set(["emailaddress", "address", "email", "name"]);
const BODY_KEYS = new Set(["body", "content", "text", "html", "bodytext", "bodyhtml", "message"]);
/** Every other key a send call may carry. Anything not here (attachments,
 * reply-to, from, sender, headers, an extra field) is not the approved draft. */
const NEUTRAL_KEYS = new Set(["subject", "contenttype", "content_type", "ishtml", "is_html", "mimetype", "format", "savetosentitems", "save_to_sent_items", "importance"]);

function keyOf(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** The body as it will be sent: line endings and the white space around
 * it folded, nothing else. An HTML body is never read as the text it shows:
 * a comment, a link target or an image would ride along unseen. */
export function normalizeEmailBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/** FNV-1a of the body as it will be sent: the approved body, bound to the pass. */
export function emailBodyHash(body: string): string {
  const text = normalizeEmailBody(body);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

interface CallReading {
  recipients: Record<RecipientField, Set<string>>;
  subjects: string[];
  bodies: string[];
  /** a key or a value outside the approved shape */
  extra: boolean;
  /** the call says its body is HTML */
  html: boolean;
}

/** Any address a mail server could deliver to, IDN, punycode and IP
 * literals included: parsed to be compared, never dropped. */
const ANY_ADDRESS = /^[^\s@<>",;]+@(?:\[[^\]\s]+\]|[^\s@<>",;[\]]+)$/u;

function readAddressText(text: string, into: Set<string>, reading: CallReading): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const angle = /^(.*)<([^<>]*)>\s*$/s.exec(trimmed);
  const address = (angle ? angle[2]! : trimmed).trim().toLowerCase();
  // a display name the person never approved can impersonate someone
  if (angle && angle[1]!.trim() && angle[1]!.trim().replace(/^"|"$/g, "").toLowerCase() !== address) reading.extra = true;
  if (!ANY_ADDRESS.test(address)) reading.extra = true;
  else into.add(address);
}

function readAddresses(value: unknown, into: Set<string>, reading: CallReading): void {
  if (typeof value === "string") {
    for (const part of value.split(/[,;]/)) readAddressText(part, into, reading);
  } else if (Array.isArray(value)) {
    for (const item of value) readAddresses(item, into, reading);
  } else if (value && typeof value === "object") {
    let address: string | undefined;
    let name: string | undefined;
    for (const [key, item] of Object.entries(value)) {
      const field = keyOf(key);
      if (!ADDRESS_KEYS.has(field)) reading.extra = true;
      else if (field === "name") {
        if (typeof item === "string") name = item.trim();
        else if (item !== null && item !== undefined) reading.extra = true;
      } else if (typeof item === "string") {
        address = item.trim().toLowerCase();
        readAddressText(item, into, reading);
      } else {
        readAddresses(item, into, reading);
      }
    }
    if (name && name.toLowerCase() !== address) reading.extra = true;
  } else if (value !== null && value !== undefined) {
    reading.extra = true;
  }
}

function readCall(value: unknown, reading: CallReading): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reading.extra = true;
    return;
  }
  for (const [rawKey, item] of Object.entries(value)) {
    const key = keyOf(rawKey);
    const field = RECIPIENT_FIELD[key];
    if (field) {
      readAddresses(item, reading.recipients[field], reading);
    } else if (key === "subject") {
      if (typeof item === "string") reading.subjects.push(item.trim());
      else reading.extra = true;
    } else if (BODY_KEYS.has(key)) {
      if (typeof item === "string") reading.bodies.push(item);
      else readCall(item, reading);
    } else if (NEUTRAL_KEYS.has(key) || NEUTRAL_KEYS.has(rawKey.toLowerCase())) {
      if (item !== null && typeof item === "object") reading.extra = true;
      if ((key === "contenttype" || key === "mimetype" || key === "format") && typeof item === "string" && /html/i.test(item)) reading.html = true;
      if (key === "ishtml" && item === true) reading.html = true;
    } else {
      reading.extra = true;
    }
  }
}

function sameSet(have: Set<string>, want: readonly string[]): boolean {
  const expected = new Set(want.map((address) => address.toLowerCase()));
  return have.size === expected.size && [...expected].every((address) => have.has(address));
}

/** Whether one outbound call is the approved draft, through the approved
 * connector: an outbound tool of that connector whose To, Cc and Bcc are
 * exactly the draft's, whose subject is the draft's, whose body is the
 * approved body (same normalized hash), and which carries no other field
 * (no attachment, reply-to, from, sender or header). Anything else keeps
 * its card. */
export function emailSendCallMatches(draft: EmailDraftToSend, tool: string, input: string | undefined, connector?: EmailConnector): boolean {
  const qualified = tool.startsWith("mcp__") || !tool.includes("__") ? tool : `mcp__${tool}`;
  if (!isOutboundTool(tool) && !isOutboundTool(qualified)) return false;
  if (connector && !connectorOwnsTool(connector, tool)) return false;
  // a plain send: a forward or a reply carries the earlier thread along
  const actionWords = tool.replace(/^(?:mcp__)?[^_]+?__/, "").toLowerCase().split(/[^a-z0-9]+/);
  if (!actionWords.includes("send") || actionWords.some((word) => ["forward", "reply", "replyall", "respond", "draft"].includes(word))) return false;
  const args = parseArgs(input);
  if (!args) return false;
  const reading: CallReading = { recipients: { to: new Set(), cc: new Set(), bcc: new Set() }, subjects: [], bodies: [], extra: false, html: false };
  readCall(args, reading);
  if (reading.extra) return false;
  if (!sameSet(reading.recipients.to, draft.to) || !sameSet(reading.recipients.cc, draft.cc) || !sameSet(reading.recipients.bcc, draft.bcc)) return false;
  if (reading.subjects.length > 1 || (reading.subjects[0] ?? "") !== draft.subject.trim()) return false;
  if (draft.body.trim() && !reading.bodies.length) return false;
  // exact text, not a hash collision away: the hash binds, equality decides
  const approved = normalizeEmailBody(draft.body);
  if (!reading.bodies.every((body) => normalizeEmailBody(body) === approved)) return false;
  // an HTML send is only the approved draft when that draft was this HTML
  return !reading.html || /<[a-z!/][\s\S]*>/i.test(approved);
}

/** Whether a tool belongs to the connector the person approved: the MCP
 * server of that name, or the connected app's own actions. */
export function connectorOwnsTool(connector: EmailConnector, tool: string): boolean {
  if (connector.kind !== "bot" || !connector.id) return false;
  const id = connector.id.toLowerCase();
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  if (match) {
    const server = match[1]!.toLowerCase();
    if (match[2]!.includes("__")) return false;
    return server === id;
  }
  // a bare engine-connector action: GMAIL_SEND_EMAIL
  return /^[A-Z0-9_]+$/.test(tool) && tool.toLowerCase().startsWith(`${id}_`);
}

/** A mail connector a bot has, from its MCP servers and connected apps. */
export function mailConnectorsOf(bot: { mcpServers?: readonly string[]; connectorTools?: Record<string, unknown> }): EmailConnector[] {
  const found: EmailConnector[] = [];
  const MAIL = /outlook|microsoft|m365|office365|gmail|google[-_ ]?mail|exchange|(^|[-_ ])mail([-_ ]|$)|email/i;
  for (const server of bot.mcpServers ?? []) {
    if (MAIL.test(server)) found.push({ kind: "bot", id: server, label: server });
  }
  for (const slug of Object.keys(bot.connectorTools ?? {})) {
    if (/^(gmail|outlook|microsoft_outlook|office365)$/i.test(slug)) found.push({ kind: "bot", id: slug, label: slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase() });
  }
  return found;
}
