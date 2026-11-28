// What a person writes from a record window (M-20261127-101): a note, a time
// entry, an expense, a planned entry, a configuration, an attachment, each
// added, changed or removed, and a planned entry marked done. The app sends
// one action through the record's detail route
// (`POST /api/me/records/:product/:kind/:id/detail { action, id?, set }`),
// the server checks it here, applies the organization's rules to it as a
// write of that product, and hands it to the console, which writes it as the
// person (their key, their scopes, their data policy). Sagax names no product
// field: the console maps each action to its product.
//
// The console says which actions it takes for a record (`actions` in the
// counts answer); one that sends no list takes what it takes, and refuses
// the rest with its own code.

export const RECORD_ACTIONS = [
  "note.add", "note.update", "note.remove",
  "time.add", "time.update", "time.remove",
  "expense.add", "expense.update", "expense.remove",
  "schedule.add", "schedule.update", "schedule.remove", "schedule.done",
  "configuration.add", "configuration.remove",
  "attachment.add", "attachment.remove",
] as const;
export type RecordActionName = (typeof RECORD_ACTIONS)[number];

/** Billable, no charge, do not bill. */
export const RECORD_BILLING = ["B", "NC", "DNB"] as const;
export type RecordBilling = (typeof RECORD_BILLING)[number];
export const RECORD_NOTE_KINDS = ["discussion", "internal", "resolution"] as const;
export type RecordNoteKind = (typeof RECORD_NOTE_KINDS)[number];
export const RECORD_PLAN_KINDS = ["meeting", "resource", "activity"] as const;
export type RecordPlanKind = (typeof RECORD_PLAN_KINDS)[number];

/** The lists a form picks from, read like a field's choices (`section=choices&field=`). */
export const RECORD_ACTION_CHOICES = ["work_type", "expense_type", "member", "configuration", "where"] as const;
export type RecordActionChoice = (typeof RECORD_ACTION_CHOICES)[number];

export const RECORD_NOTE_MAX = 20_000;
export const RECORD_LINE_NOTE_MAX = 4_000;
export const RECORD_SUBJECT_MAX = 200;
export const RECORD_FILE_NAME_MAX = 255;
/** An attachment, in bytes (25 MiB). */
export const RECORD_FILE_MAX = 25 * 1024 * 1024;
/** Its base64, in characters. */
export const RECORD_FILE_BASE64_MAX = 4 * Math.ceil(RECORD_FILE_MAX / 3);

export type RecordActionValue = string | number | boolean;
export interface RecordAction {
  action: RecordActionName;
  /** the entry changed, removed or marked done */
  id?: string;
  /** what it sets (absent: nothing, a removal) */
  set?: Record<string, RecordActionValue>;
}

type Rule =
  | { type: "text"; max: number; min?: number }
  | { type: "id" }
  | { type: "number"; min: number; max: number }
  | { type: "when" }
  | { type: "day" }
  | { type: "flag" }
  | { type: "one"; of: readonly string[] }
  | { type: "base64" };

const TEXT = (max: number, min = 0): Rule => ({ type: "text", max, min });
const ID: Rule = { type: "id" };
const HOURS: Rule = { type: "number", min: 0.01, max: 24 };
const AMOUNT: Rule = { type: "number", min: 0.01, max: 10_000_000 };
const WHEN: Rule = { type: "when" };
const DAY: Rule = { type: "day" };
const BILLING: Rule = { type: "one", of: RECORD_BILLING };
const NOTE_KIND: Rule = { type: "one", of: RECORD_NOTE_KINDS };
const PLAN_KIND: Rule = { type: "one", of: RECORD_PLAN_KINDS };

/** Each action: whether it names an entry, the fields it may set, the ones it must. */
const SHAPES: Record<RecordActionName, { id: boolean; fields: Record<string, Rule>; required?: readonly string[]; some?: boolean }> = {
  "note.add": { id: false, fields: { text: TEXT(RECORD_NOTE_MAX, 1), kind: NOTE_KIND }, required: ["text", "kind"] },
  "note.update": { id: true, fields: { text: TEXT(RECORD_NOTE_MAX, 1), kind: NOTE_KIND }, some: true },
  "note.remove": { id: true, fields: {} },
  "time.add": { id: false, fields: { hours: HOURS, note: TEXT(RECORD_LINE_NOTE_MAX), billing: BILLING, work_type: ID, start: WHEN }, required: ["hours"] },
  "time.update": { id: true, fields: { hours: HOURS, note: TEXT(RECORD_LINE_NOTE_MAX), billing: BILLING, work_type: ID, start: WHEN }, some: true },
  "time.remove": { id: true, fields: {} },
  "expense.add": { id: false, fields: { amount: AMOUNT, note: TEXT(RECORD_LINE_NOTE_MAX), billing: BILLING, type: ID, date: DAY }, required: ["amount"] },
  "expense.update": { id: true, fields: { amount: AMOUNT, note: TEXT(RECORD_LINE_NOTE_MAX), billing: BILLING, type: ID, date: DAY }, some: true },
  "expense.remove": { id: true, fields: {} },
  "schedule.add": { id: false, fields: { kind: PLAN_KIND, member: ID, start: WHEN, end: WHEN, subject: TEXT(RECORD_SUBJECT_MAX), where: ID }, required: ["kind"] },
  "schedule.update": { id: true, fields: { kind: PLAN_KIND, member: ID, start: WHEN, end: WHEN, subject: TEXT(RECORD_SUBJECT_MAX), where: ID }, required: ["kind"] },
  "schedule.remove": { id: true, fields: { kind: PLAN_KIND }, required: ["kind"] },
  "schedule.done": { id: true, fields: { kind: PLAN_KIND, done: { type: "flag" } }, required: ["kind", "done"] },
  "configuration.add": { id: false, fields: { configuration: ID }, required: ["configuration"] },
  "configuration.remove": { id: true, fields: {} },
  "attachment.add": { id: false, fields: { name: TEXT(RECORD_FILE_NAME_MAX, 1), content_type: TEXT(100), base64: { type: "base64" } }, required: ["name", "base64"] },
  "attachment.remove": { id: true, fields: {} },
};

const ENTRY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const CHOICE_ID = /^[1-9][0-9]{0,18}$/;
// a local or offset time, to the minute or the second (the console reads a local one in the person's zone)
const WHEN_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function valid(rule: Rule, value: unknown): RecordActionValue | undefined {
  switch (rule.type) {
    case "text": {
      if (typeof value !== "string") return undefined;
      const text = value.replace(/\r\n?/g, "\n");
      if (text.trim().length < (rule.min ?? 0) || text.length > rule.max) return undefined;
      return rule.min ? text.trim() : text;
    }
    case "id": return typeof value === "string" && CHOICE_ID.test(value) ? value : undefined;
    case "number": {
      const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
      return Number.isFinite(number) && number >= rule.min && number <= rule.max ? Math.round(number * 100) / 100 : undefined;
    }
    case "when": return typeof value === "string" && WHEN_TEXT.test(value) && Number.isFinite(Date.parse(value.length === 16 ? `${value}:00` : value)) ? value : undefined;
    case "day": return typeof value === "string" && DAY_TEXT.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
    case "flag": return typeof value === "boolean" ? value : undefined;
    case "one": return typeof value === "string" && rule.of.includes(value) ? value : undefined;
    case "base64": return typeof value === "string" && value.length > 0 && value.length <= RECORD_FILE_BASE64_MAX && value.length % 4 === 0 && BASE64.test(value) ? value : undefined;
  }
}

export function isRecordActionName(value: unknown): value is RecordActionName {
  return typeof value === "string" && (RECORD_ACTIONS as readonly string[]).includes(value);
}

/** One action as the route accepts it: a known action, its entry when it names one, only its own fields, each in its bounds. Anything else is null. */
export function parseRecordAction(body: unknown): RecordAction | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as { action?: unknown; id?: unknown; set?: unknown };
  if (!isRecordActionName(raw.action)) return null;
  const shape = SHAPES[raw.action];
  const id = raw.id === undefined ? undefined : typeof raw.id === "string" && ENTRY_ID.test(raw.id) && !/^\.+$/.test(raw.id) ? raw.id : null;
  if (id === null || Boolean(id) !== shape.id) return null;
  const given = raw.set === undefined ? {} : raw.set;
  if (!given || typeof given !== "object" || Array.isArray(given)) return null;
  const set: Record<string, RecordActionValue> = {};
  for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
    const rule = shape.fields[key];
    if (!rule) return null;
    if (value === undefined) continue;
    if (value === "") {
      // a change may empty a text that may be empty (a time entry's note); anything else empty is left out
      if (shape.id && rule.type === "text" && !rule.min) set[key] = "";
      continue;
    }
    const clean = valid(rule, value);
    if (clean === undefined) return null;
    set[key] = clean;
  }
  if ((shape.required ?? []).some((key) => set[key] === undefined)) return null;
  if (shape.some && !Object.keys(set).length) return null;
  // a planned entry changed says what changes beside its kind
  if (raw.action === "schedule.update" && Object.keys(set).every((key) => key === "kind")) return null;
  if (set.start !== undefined && set.end !== undefined && Date.parse(String(set.end)) < Date.parse(String(set.start))) return null;
  return { action: raw.action, ...(id ? { id } : {}), set };
}

/** The actions a console lists for a record (`actions` of the counts answer); null when it lists none. */
export function parseRecordActions(raw: unknown): ReadonlySet<RecordActionName> | null {
  if (!Array.isArray(raw)) return null;
  return new Set(raw.filter(isRecordActionName));
}
