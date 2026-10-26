// Phone tools (Grok Bot parity, audit row 81, JC 2026-10-21): a bot asks
// the person's own iPhone for something only the phone knows (where it is,
// a contact, a reminder, the calendar, a photo the person picks, a
// shortcut, the clipboard, battery and network). The person approves each
// request ON the phone (Refuser / Toujours permettre / Permettre une fois),
// the phone runs the iOS API in the foreground, and the answer goes back to
// the bot's turn. Nothing runs in the background, nothing is kept: the
// server holds a result only until the waiting turn reads it.
//
// This file is the wire contract shared by the harness (server/phone-tools.ts,
// server/routes/phone-tools.ts), the agents catalog
// (server/drivers/agents-phone-tools.ts) and the iOS app
// (ios/Sources/CompanionCore/PhoneTools.swift). The result schemas are also
// the data minimization: whatever the phone sends beyond them is dropped
// before the bot sees it.
import { z } from "zod";

import { isSealedCard } from "./phone-card-seal.ts";

export const PHONE_TOOLS = ["location", "contacts", "reminders", "calendar", "photos", "shortcut", "clipboard", "status"] as const;
export type PhoneToolId = typeof PHONE_TOOLS[number];

export function isPhoneTool(value: unknown): value is PhoneToolId {
  return typeof value === "string" && (PHONE_TOOLS as readonly string[]).includes(value);
}

/** What a phone can be asked: the bots' tools, plus card_scan, which only
 * the person's own computer asks (Settings > Vault > New card, "Scanner
 * avec l'iPhone", audit row 84) and never a bot. */
export const PHONE_REQUEST_KINDS = [...PHONE_TOOLS, "card_scan"] as const;
export type PhoneRequestKind = typeof PHONE_REQUEST_KINDS[number];

export function isPhoneRequestKind(value: unknown): value is PhoneRequestKind {
  return typeof value === "string" && (PHONE_REQUEST_KINDS as readonly string[]).includes(value);
}

/** What the person decided on the phone. */
export const PHONE_TOOL_DECISIONS = ["deny", "once", "always"] as const;
export type PhoneToolDecision = typeof PHONE_TOOL_DECISIONS[number];

/** Reading or changing the phone: a grant ("Toujours permettre") covers
 * one bot, one tool and one access, never more. */
export type PhoneToolAccess = "read" | "write";

/** Tools whose card never offers "Toujours permettre": a shortcut can do
 * anything the person's Shortcuts can (send a message, pay), the clipboard
 * may hold a password, and a photo is picked by hand each time anyway. */
export const PHONE_TOOLS_ONCE_ONLY: ReadonlySet<PhoneRequestKind> = new Set(["shortcut", "clipboard", "photos", "card_scan"]);

/** How long a request waits for the phone before it expires. */
export const PHONE_TOOL_REQUEST_TTL_MS = 5 * 60_000;
/** How long one tool call holds the turn before it hands back a request id
 * to wait on again: under every engine's own tool timeout (Codex: 60 s). */
export const PHONE_TOOL_CALL_WAIT_MS = 45_000;

const reason = z.string().trim().max(200).optional();
const isoDate = z.string().trim().min(1).max(40).refine((value) => Number.isFinite(Date.parse(value)), "an ISO 8601 date");

export const CONTACT_FIELDS = ["phone", "email", "address", "birthday", "organization"] as const;
export type ContactField = typeof CONTACT_FIELDS[number];

const MAX_CALENDAR_WINDOW_MS = 31 * 24 * 60 * 60_000;

export const phoneToolArgsSchemas = {
  location: z.object({ reason, precise: z.boolean().optional() }).strict(),
  contacts: z.object({
    reason,
    query: z.string().trim().min(1).max(80),
    fields: z.array(z.enum(CONTACT_FIELDS)).max(CONTACT_FIELDS.length).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }).strict(),
  reminders: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list"), reason, list: z.string().trim().min(1).max(80).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
    z.object({
      action: z.literal("create"),
      reason,
      title: z.string().trim().min(1).max(200),
      due: isoDate.optional(),
      notes: z.string().trim().max(1_000).optional(),
      list: z.string().trim().min(1).max(80).optional(),
    }).strict(),
  ]),
  calendar: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list"), reason, from: isoDate, to: isoDate, limit: z.number().int().min(1).max(100).optional() }).strict()
      .refine((args) => Date.parse(args.to) > Date.parse(args.from) && Date.parse(args.to) - Date.parse(args.from) <= MAX_CALENDAR_WINDOW_MS, "to comes after from, at most 31 days later"),
    z.object({
      action: z.literal("create"),
      reason,
      title: z.string().trim().min(1).max(200),
      start: isoDate,
      end: isoDate,
      location: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(1_000).optional(),
    }).strict().refine((args) => Date.parse(args.end) >= Date.parse(args.start), "end is not before start"),
  ]),
  photos: z.object({ reason, max: z.number().int().min(1).max(3).optional() }).strict(),
  shortcut: z.object({ reason, name: z.string().trim().min(1).max(120), input: z.string().max(1_000).optional() }).strict(),
  clipboard: z.object({ reason }).strict(),
  status: z.object({ reason }).strict(),
} satisfies Record<PhoneToolId, z.ZodTypeAny>;

export type PhoneToolArgs<T extends PhoneToolId = PhoneToolId> = z.infer<typeof phoneToolArgsSchemas[T]>;

export type ParsedPhoneToolArgs = { ok: true; tool: PhoneToolId; args: Record<string, unknown> } | { ok: false; error: string };

/** The bot's arguments for one tool, checked and trimmed. */
export function parsePhoneToolArgs(tool: unknown, raw: unknown): ParsedPhoneToolArgs {
  if (!isPhoneTool(tool)) return { ok: false, error: `tool is one of ${PHONE_TOOLS.join(", ")}.` };
  const parsed = phoneToolArgsSchemas[tool].safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${tool}: ${where}${issue?.message ?? "invalid arguments"}` };
  }
  return { ok: true, tool, args: parsed.data as Record<string, unknown> };
}

/** Whether a request reads the phone or changes it. */
export function phoneToolAccess(tool: PhoneRequestKind, args: Record<string, unknown>): PhoneToolAccess {
  if ((tool === "reminders" || tool === "calendar") && args.action === "create") return "write";
  if (tool === "shortcut") return "write";
  return "read";
}

/** The key a "Toujours permettre" is saved under, or null when the card
 * never offers one (review of #960): exactly what was allowed, nothing
 * wider. Status; the approximate position (never precise); contacts with
 * that very set of fields; reading reminders or the calendar. Anything
 * that changes the phone (creating a reminder or an event), a precise
 * position, a shortcut, the clipboard and photos are asked each time. */
export function phoneToolGrantKey(tool: PhoneRequestKind, args: Record<string, unknown>): string | null {
  if (PHONE_TOOLS_ONCE_ONLY.has(tool) || phoneToolAccess(tool, args) === "write") return null;
  if (tool === "location") return args.precise === true ? null : "location:read:approximate";
  if (tool === "contacts") {
    const fields = [...new Set((args.fields as string[] | undefined) ?? ["phone", "email"])].sort();
    return `contacts:read:${fields.join("+")}`;
  }
  return `${tool}:read`;
}

/** phone_tool as an engine names it (mcp__agents__phone_tool, agents_phone_tool). */
export function isPhoneToolCallName(name: string | undefined): boolean {
  return typeof name === "string" && /(?:^|[_.])phone_tool$/.test(name);
}

/** What the transcript keeps of a phone_tool answer: never the data. */
export const PHONE_TOOL_OUTPUT_NOT_KEPT = "Phone data not kept in the conversation.";

const text = (max: number) => z.string().max(max);
const short = text(200);
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((rows) => rows.slice(0, max));

const contactSchema = z.object({
  name: short,
  phones: list(text(60), 5).optional(),
  emails: list(text(200), 5).optional(),
  addresses: list(text(300), 3).optional(),
  birthday: text(20).optional(),
  organization: short.optional(),
});

const reminderSchema = z.object({ title: short, due: text(40).optional(), list: short.optional() });
const eventSchema = z.object({
  title: short,
  start: text(40),
  end: text(40),
  allDay: z.boolean().optional(),
  location: short.optional(),
  calendar: short.optional(),
});
/** One picked photo, downscaled on the phone: base64 JPEG, about 1 MB at most. */
const PHOTO_MAX_BASE64 = 1_400_000;
const imageSchema = z.object({ mimeType: z.literal("image/jpeg"), data: z.string().max(PHOTO_MAX_BASE64).regex(/^[A-Za-z0-9+/=]+$/) });

const coordinate = (limit: number) => z.number().finite().min(-limit).max(limit);

export const phoneToolResultSchemas = {
  location: z.object({
    latitude: coordinate(90),
    longitude: coordinate(180),
    accuracyMeters: z.number().finite().min(0).max(1_000_000).optional(),
    at: text(40).optional(),
  }),
  contacts: z.object({ contacts: list(contactSchema, 10) }),
  reminders: z.object({ reminders: list(reminderSchema, 50).optional(), created: reminderSchema.optional() }),
  calendar: z.object({ events: list(eventSchema, 100).optional(), created: eventSchema.optional() }),
  photos: z.object({ images: list(imageSchema, 3) }),
  shortcut: z.object({ started: z.boolean() }),
  clipboard: z.object({ text: text(4_000).optional(), empty: z.boolean().optional() }),
  status: z.object({
    battery: z.object({ level: z.number().min(0).max(1).optional(), state: z.enum(["unknown", "unplugged", "charging", "full"]).optional() }).optional(),
    lowPowerMode: z.boolean().optional(),
    network: z.object({
      status: z.enum(["satisfied", "unsatisfied", "requiresConnection"]),
      type: z.enum(["wifi", "cellular", "wired", "other", "none"]).optional(),
      expensive: z.boolean().optional(),
      constrained: z.boolean().optional(),
    }).optional(),
    focus: z.object({ focused: z.boolean() }).optional(),
  }),
  // read on the phone (Vision) and sealed there for the computer's form
  // (shared/phone-card-seal.ts): the server sees only this envelope
  card_scan: z.object({ encapsulatedKey: z.string().max(200), ciphertext: z.string().max(1_024) }),
} satisfies Record<PhoneRequestKind, z.ZodTypeAny>;


/** Six decimals is about 10 cm; three is about 100 m, enough for "near
 * which street" and the default unless the bot asked for precise. */
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export type CheckedPhoneToolResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

/** The phone's answer, cut down to what the request asked for. The schemas
 * strip unknown keys; this also drops contact fields the bot did not ask
 * for and coarsens a position that was not asked precise. */
export function checkPhoneToolResult(tool: PhoneRequestKind, args: Record<string, unknown>, raw: unknown): CheckedPhoneToolResult {
  const parsed = phoneToolResultSchemas[tool].safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The phone's answer could not be read." };
  const result = parsed.data as Record<string, unknown>;
  if (tool === "card_scan") {
    // an opaque envelope for the form; a card number in clear never passes
    if (!isSealedCard(result)) return { ok: false, error: "The phone's answer could not be read." };
    return { ok: true, result: { encapsulatedKey: result.encapsulatedKey, ciphertext: result.ciphertext } };
  }
  if (tool === "location") {
    const digits = args.precise === true ? 6 : 3;
    const out: Record<string, unknown> = {
      latitude: round(result.latitude as number, digits),
      longitude: round(result.longitude as number, digits),
      precise: args.precise === true,
    };
    if (typeof result.accuracyMeters === "number") out.accuracyMeters = Math.max(Math.round(result.accuracyMeters), args.precise === true ? 0 : 100);
    if (typeof result.at === "string") out.at = result.at;
    return { ok: true, result: out };
  }
  if (tool === "contacts") {
    const wanted = new Set<ContactField>((args.fields as ContactField[] | undefined) ?? ["phone", "email"]);
    const limit = typeof args.limit === "number" ? args.limit : 5;
    const contacts = (result.contacts as Array<z.infer<typeof contactSchema>>).slice(0, limit).map((contact) => ({
      name: contact.name,
      ...(wanted.has("phone") && contact.phones?.length ? { phones: contact.phones } : {}),
      ...(wanted.has("email") && contact.emails?.length ? { emails: contact.emails } : {}),
      ...(wanted.has("address") && contact.addresses?.length ? { addresses: contact.addresses } : {}),
      ...(wanted.has("birthday") && contact.birthday ? { birthday: contact.birthday } : {}),
      ...(wanted.has("organization") && contact.organization ? { organization: contact.organization } : {}),
    }));
    return { ok: true, result: { contacts } };
  }
  if (tool === "reminders" && args.action === "list" && Array.isArray(result.reminders)) {
    const limit = typeof args.limit === "number" ? args.limit : 20;
    return { ok: true, result: { reminders: result.reminders.slice(0, limit) } };
  }
  if (tool === "calendar" && args.action === "list" && Array.isArray(result.events)) {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    return { ok: true, result: { events: result.events.slice(0, limit) } };
  }
  if (tool === "photos") {
    const max = typeof args.max === "number" ? args.max : 1;
    return { ok: true, result: { images: (result.images as unknown[]).slice(0, max) } };
  }
  return { ok: true, result };
}

/** A request as the phone receives it (GET /api/me/phone-tools/requests). */
export interface PhoneToolRequestWire {
  id: string;
  tool: PhoneRequestKind;
  args: Record<string, unknown>;
  access: PhoneToolAccess;
  botId: string;
  botName: string;
  threadId: string;
  /** "Toujours permettre" is offered on this card. */
  allowAlways: boolean;
  /** A "Toujours permettre" saved earlier covers this request: the phone
   * runs it without a card, but only while the app is open on screen. */
  preApproved: boolean;
  createdAt: number;
  expiresAt: number;
}

/** What a phone says it can do (POST /api/me/phone-tools/device). */
export const phoneDeviceSchema = z.object({
  deviceName: z.string().trim().max(80).default(""),
  tools: z.array(z.enum(PHONE_REQUEST_KINDS)).max(PHONE_REQUEST_KINDS.length),
  /** How the phone reaches this server: "protected" is HTTPS or Tailscale.
   * On plain local Wi-Fi the phone offers nothing (JC 2026-10-21): the
   * answers would cross the network in clear. Absent is "local". */
  transport: z.enum(["protected", "local"]).default("local"),
}).strict();

export type PhoneTransport = "protected" | "local";

/** What the bot and the phone read when the phone is on plain local Wi-Fi. */
export const PHONE_TOOLS_NEED_PROTECTED_TRANSPORT = "The person's phone is on plain local Wi-Fi: phone tools need a secure connection (HTTPS or Tailscale). Tell the person; they can turn on Secure phone access or Tailscale, then ask again.";

/** The phone's answer to one request. A refusal carries no result; an
 * approved request carries the result, or the error iOS gave (no
 * permission, nothing found). */
export const phoneAnswerSchema = z.object({
  decision: z.enum(PHONE_TOOL_DECISIONS),
  result: z.unknown().optional(),
  error: z.string().trim().max(300).optional(),
}).strict();

/** The live frame that tells a person's phones to fetch their requests.
 * It carries no data, only whom it is for. */
export const PHONE_TOOLS_FRAME = "phone-tools";

export function phoneToolsFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== PHONE_TOOLS_FRAME) return true;
  return payload.audience === (viewerId ?? localPersonId);
}
