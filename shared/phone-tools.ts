// Phone tools (the reference design parity, audit row 81 2026-10-21): a bot asks
// the person's own iPhone for something only the phone knows (where it is,
// a contact, a reminder, the calendar, the home, an alarm, a photo the
// person picks, a shortcut, the clipboard, battery and network). The person
// approves each request ON the phone (Refuser / Toujours permettre / Permettre une fois),
// the phone runs the iOS API in the foreground, and the answer goes back to
// the bot's turn. Nothing runs in the background, nothing is kept: the
// server holds a result only until the waiting turn reads it.
//
// This file is the wire contract shared by the harness (server/phone/phone-tools.ts,
// server/routes/phone-tools.ts), the agents catalog
// (server/drivers/agents-phone-tools.ts) and the iOS app
// (ios/Sources/CompanionCore/PhoneTools.swift). The result schemas are also
// the data minimization: whatever the phone sends beyond them is dropped
// before the bot sees it.
import { z } from "zod";

import { isSealedCard } from "./phone-card-seal.ts";

export const PHONE_TOOLS = ["location", "contacts", "reminders", "calendar", "home", "alarms", "photos", "photo_library", "shortcut", "clipboard", "status"] as const;
export type PhoneToolId = typeof PHONE_TOOLS[number];

export function isPhoneTool(value: unknown): value is PhoneToolId {
  return typeof value === "string" && (PHONE_TOOLS as readonly string[]).includes(value);
}

/** Apple Health on the person's own iPhone (HealthKit, read and write). Two
 * bot tools of their own (health_read, health_write) so an organization's
 * Refuse / Ask-first rules can name each, served through the same device
 * link as the phone tools. The person picks the categories in Settings >
 * Santé on the phone and grants each through the HealthKit sheet; the phone
 * enforces that choice on every call, so these two never open a card. */
export const HEALTH_TOOLS = ["health_read", "health_write"] as const;
export type HealthToolId = typeof HEALTH_TOOLS[number];

export function isHealthTool(value: unknown): value is HealthToolId {
  return typeof value === "string" && (HEALTH_TOOLS as readonly string[]).includes(value);
}

/** What a phone can be asked: the bots' tools, plus card_scan, which only
 * the person's own computer asks (Settings > Vault > New card, "Scanner
 * avec l'iPhone", audit row 84) and never a bot. */
export const PHONE_REQUEST_KINDS = [...PHONE_TOOLS, ...HEALTH_TOOLS, "card_scan"] as const;
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
 * anything the person's Shortcuts can (send a message, pay), so its effect
 * may reach past the phone, and a photo is picked by hand each time anyway.
 * The clipboard is the person's own phone: they may let one bot read it. */
export const PHONE_TOOLS_ONCE_ONLY: ReadonlySet<PhoneRequestKind> = new Set(["shortcut", "photos", "card_scan"]);

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
/** A photo or an album of the phone's library: PhotoKit's own identifier. */
const photoId = z.string().trim().min(1).max(300);
const photoCursor = z.string().trim().regex(/^\d{1,9}$/, "the next value of the previous result").optional();
/** How many photos one export sends back as images (the answer's size). */
export const PHOTO_LIBRARY_EXPORT_MAX = 3;

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
  home: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("list"),
      reason,
      home: z.string().trim().min(1).max(80).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }).strict(),
    z.object({
      action: z.literal("run"),
      reason,
      scene: z.string().trim().min(1).max(80),
      home: z.string().trim().min(1).max(80).optional(),
    }).strict(),
  ]),
  alarms: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list"), reason, limit: z.number().int().min(1).max(50).optional() }).strict(),
    z.object({
      action: z.literal("create"),
      reason,
      label: z.string().trim().min(1).max(80),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    }).strict(),
  ]),
  photos: z.object({ reason, max: z.number().int().min(1).max(3).optional() }).strict(),
  // 2026-11-17: the phone's photo library (PhotoKit), read with the person's
  // own permission (all photos or the ones they chose): albums, a search by
  // album, dates, favorite and kind, details by id, and up to 3 photos sent
  // as images.
  photo_library: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list_albums"), reason, limit: z.number().int().min(1).max(200).optional(), cursor: photoCursor }).strict(),
    z.object({
      action: z.literal("search"),
      reason,
      album: z.string().trim().min(1).max(300).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      favorite: z.boolean().optional(),
      media: z.enum(["photo", "video", "any"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: photoCursor,
    }).strict().refine((args) => !args.from || !args.to || Date.parse(args.to) > Date.parse(args.from), "to comes after from"),
    z.object({ action: z.literal("read"), reason, ids: z.array(photoId).min(1).max(50) }).strict(),
    z.object({ action: z.literal("export"), reason, ids: z.array(photoId).min(1).max(PHOTO_LIBRARY_EXPORT_MAX), original: z.boolean().optional() }).strict(),
  ]),
  shortcut: z.object({ reason, name: z.string().trim().min(1).max(120), input: z.string().max(1_000).optional() }).strict(),
  clipboard: z.object({ reason }).strict(),
  status: z.object({ reason }).strict(),
} satisfies Record<PhoneToolId, z.ZodTypeAny>;

export type PhoneToolArgs<T extends PhoneToolId = PhoneToolId> = z.infer<typeof phoneToolArgsSchemas[T]>;

/** The Health categories a person may open on their phone (Settings > Santé). */
export const HEALTH_CATEGORIES = ["sleep", "steps", "exercise", "heart_rate", "resting_heart_rate", "hrv", "mindful_minutes", "water", "weight", "workouts"] as const;
export type HealthCategory = typeof HEALTH_CATEGORIES[number];
/** The categories a bot may add to Health (the others are measured by the phone or a watch). */
export const HEALTH_WRITABLE_CATEGORIES = ["mindful_minutes", "water", "weight", "workouts"] as const;
export type HealthWritableCategory = typeof HEALTH_WRITABLE_CATEGORIES[number];
export const HEALTH_AGGREGATIONS = ["daily_sum", "daily_avg"] as const;
/** The longest window one health_read covers. */
export const MAX_HEALTH_WINDOW_MS = 92 * 24 * 60 * 60_000;

export const healthToolArgsSchemas = {
  health_read: z.object({
    reason,
    category: z.enum(HEALTH_CATEGORIES),
    from: isoDate,
    to: isoDate,
    aggregation: z.enum(HEALTH_AGGREGATIONS).optional(),
  }).strict().refine((args) => Date.parse(args.to) > Date.parse(args.from) && Date.parse(args.to) - Date.parse(args.from) <= MAX_HEALTH_WINDOW_MS, "to comes after from, at most 92 days later"),
  health_write: z.object({
    reason,
    category: z.enum(HEALTH_WRITABLE_CATEGORIES),
    /** minutes (mindful_minutes), millilitres (water), kilograms (weight), minutes (workouts) */
    value: z.number().finite().positive().max(100_000).optional(),
    /** when it happened; defaults to now (for a duration, it ends then) */
    start: isoDate.optional(),
    end: isoDate.optional(),
    /** workouts: running, walking, cycling, swimming, yoga, strength, hiit, other */
    workout_type: z.string().trim().min(1).max(40).optional(),
    note: z.string().trim().max(500).optional(),
  }).strict().refine((args) => args.category === "workouts" || args.value !== undefined, "value is needed (minutes, millilitres or kilograms)")
    .refine((args) => args.start === undefined || args.end === undefined || Date.parse(args.end) >= Date.parse(args.start), "end is not before start")
    .refine((args) => args.category !== "workouts" || args.value !== undefined || (args.start !== undefined && args.end !== undefined), "a workout needs value (minutes) or start and end"),
} satisfies Record<HealthToolId, z.ZodTypeAny>;

export type ParsedPhoneToolArgs = { ok: true; tool: PhoneToolId | HealthToolId; args: Record<string, unknown> } | { ok: false; error: string };

/** The bot's arguments for one tool, checked and trimmed. */
export function parsePhoneToolArgs(tool: unknown, raw: unknown): ParsedPhoneToolArgs {
  if (!isPhoneTool(tool) && !isHealthTool(tool)) return { ok: false, error: `tool is one of ${[...PHONE_TOOLS, ...HEALTH_TOOLS].join(", ")}.` };
  const schema: z.ZodTypeAny = isHealthTool(tool) ? healthToolArgsSchemas[tool] : phoneToolArgsSchemas[tool];
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${tool}: ${where}${issue?.message ?? "invalid arguments"}` };
  }
  return { ok: true, tool, args: parsed.data as Record<string, unknown> };
}

/** Whether a request reads the phone or changes it. */
export function phoneToolAccess(tool: PhoneRequestKind, args: Record<string, unknown>): PhoneToolAccess {
  if (tool === "health_write") return "write";
  if ((tool === "reminders" || tool === "calendar" || tool === "alarms") && args.action === "create") return "write";
  if (tool === "home" && args.action === "run") return "write";
  if (tool === "shortcut") return "write";
  return "read";
}

/** The key a "Toujours permettre" is saved under, or null when the card
 * never offers one (review of #960): exactly what was allowed, nothing
 * wider, for one bot (the grant is saved per bot, so another bot asks
 * again). Status; the approximate and the precise position, each its own
 * key; contacts with that very set of fields; reading reminders, the
 * calendar, the home, alarms or the clipboard; creating a reminder, creating
 * an event, running one home scene or creating an alarm, each its own key,
 * never a read. A shortcut and photos are asked each time. */
export function phoneToolGrantKey(tool: PhoneRequestKind, args: Record<string, unknown>): string | null {
  if (PHONE_TOOLS_ONCE_ONLY.has(tool) || isHealthTool(tool)) return null;
  if ((tool === "reminders" || tool === "calendar" || tool === "alarms") && phoneToolAccess(tool, args) === "write") return `${tool}:write:create`;
  if (tool === "home" && phoneToolAccess(tool, args) === "write") return "home:write:run";
  if (phoneToolAccess(tool, args) === "write") return null;
  if (tool === "location") return args.precise === true ? "location:read:precise" : "location:read:approximate";
  if (tool === "contacts") {
    const fields = [...new Set((args.fields as string[] | undefined) ?? ["phone", "email"])].sort();
    return `contacts:read:${fields.join("+")}`;
  }
  return `${tool}:read`;
}

/** phone_tool, health_read and health_write as an engine names them
 * (mcp__agents__phone_tool, agents_health_read): their answers are never
 * kept in the conversation's steps. */
export function isPhoneToolCallName(name: string | undefined): boolean {
  return typeof name === "string" && /(?:^|[_.])(?:phone_tool|health_read|health_write)$/.test(name);
}

/** A health request needs no card: the person already chose the category
 * and granted it through the HealthKit sheet on the phone, which checks
 * both on every call. Shown to the phone as pre-approved. */
export function phoneToolSelfApproved(tool: PhoneRequestKind): boolean {
  return isHealthTool(tool);
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
const homeAccessorySchema = z.object({ name: short, room: short.optional(), on: z.boolean().optional() });
const homeSchema = z.object({
  name: short,
  scenes: list(short, 50).optional(),
  accessories: list(homeAccessorySchema, 50).optional(),
});
const alarmSchema = z.object({
  label: short,
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  enabled: z.boolean().optional(),
});
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
/** One exported photo of the library: up to 3 fit the phone's answer (6 MB). */
const LIBRARY_PHOTO_MAX_BASE64 = 1_900_000;
const libraryImageSchema = z.object({
  id: text(300),
  mimeType: z.literal("image/jpeg"),
  data: z.string().max(LIBRARY_PHOTO_MAX_BASE64).regex(/^[A-Za-z0-9+/=]+$/),
  width: z.number().int().min(0).max(100_000).optional(),
  height: z.number().int().min(0).max(100_000).optional(),
});
const libraryPhotoSchema = z.object({
  id: text(300),
  date: text(40).optional(),
  filename: short.optional(),
  width: z.number().int().min(0).max(100_000).optional(),
  height: z.number().int().min(0).max(100_000).optional(),
  favorite: z.boolean().optional(),
  media: z.enum(["photo", "video", "audio", "unknown"]).optional(),
  duration: z.number().min(0).max(1_000_000).optional(),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).optional(),
});
const libraryAlbumSchema = z.object({ id: text(300), name: short, count: z.number().int().min(0).optional(), smart: z.boolean().optional() });

const healthDay = z.object({ date: text(10).regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number().finite(), samples: z.number().int().min(0).max(1_000_000).optional() });
const healthWorkout = z.object({
  type: text(40),
  start: text(40),
  end: text(40),
  minutes: z.number().finite().min(0).max(100_000),
  energyKcal: z.number().finite().min(0).max(100_000).optional(),
  distanceMeters: z.number().finite().min(0).max(10_000_000).optional(),
  note: text(500).optional(),
});

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
  home: z.object({
    homes: list(homeSchema, 20).optional(),
    ran: z.object({ home: short, scene: short }).optional(),
  }),
  alarms: z.object({ alarms: list(alarmSchema, 50).optional(), created: alarmSchema.optional() }),
  photos: z.object({ images: list(imageSchema, 3) }),
  photo_library: z.object({
    albums: list(libraryAlbumSchema, 200).optional(),
    photos: list(libraryPhotoSchema, 100).optional(),
    images: list(libraryImageSchema, PHOTO_LIBRARY_EXPORT_MAX).optional(),
    failed: list(z.object({ id: text(300), error: short }), 50).optional(),
    total: z.number().int().min(0).optional(),
    next: text(12).optional(),
    limited: z.boolean().optional(),
  }),
  shortcut: z.object({ started: z.boolean() }),
  health_read: z.object({
    category: z.enum(HEALTH_CATEGORIES),
    unit: text(20),
    aggregation: z.enum(HEALTH_AGGREGATIONS).optional(),
    days: list(healthDay, 93).optional(),
    workouts: list(healthWorkout, 100).optional(),
  }),
  health_write: z.object({
    saved: z.object({ category: z.enum(HEALTH_WRITABLE_CATEGORIES), value: z.number().finite().optional(), unit: text(20).optional(), start: text(40), end: text(40) }),
  }),
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
  if (tool === "home" && args.action === "list" && Array.isArray(result.homes)) {
    const limit = typeof args.limit === "number" ? args.limit : 20;
    const want = typeof args.home === "string" ? args.home.toLowerCase() : "";
    const homes = (result.homes as Array<{ name?: string }>).filter((home) => !want || String(home.name ?? "").toLowerCase() === want).slice(0, limit);
    return { ok: true, result: { homes } };
  }
  if (tool === "alarms" && args.action === "list" && Array.isArray(result.alarms)) {
    const limit = typeof args.limit === "number" ? args.limit : 20;
    return { ok: true, result: { alarms: result.alarms.slice(0, limit) } };
  }
  if (tool === "photo_library") {
    const limit = typeof args.limit === "number" ? args.limit : args.action === "list_albums" ? 100 : 30;
    const out: Record<string, unknown> = { ...result };
    if (Array.isArray(result.albums)) out.albums = result.albums.slice(0, limit);
    if (Array.isArray(result.photos)) out.photos = result.photos.slice(0, args.action === "read" ? 50 : limit);
    if (Array.isArray(result.images)) out.images = result.images.slice(0, Array.isArray(args.ids) ? args.ids.length : PHOTO_LIBRARY_EXPORT_MAX);
    return { ok: true, result: out };
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
   * On plain local Wi-Fi the phone offers nothing (2026-10-21): the
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
