// The detail of a record window (a ticket, a company, a contact, a board, an
// invoice): the client of GET and POST /api/me/records/:product/:kind/:id/detail
// (server/routes/record-cards.ts).
// It reads the sections of the record window (counts, pages, attachments),
// the images a note names, the choices of an editable field or of a form,
// writes one field (the title as text) and one action of the record window
// (shared/record-actions.ts: a note, a time entry, an expense, a planned
// entry, a configuration, an attachment). The server reads the ticket under
// the person before every access; this module only asks and parses.
//
// A server without the route answers 404 (or 405) with no code of the
// console: `RecordDetailMissing`, and the card stays the original one. A 404
// that carries the console's code (a section the product refused, a record
// it does not know) is that section's failure only: it never takes the
// card's tabs and fields away (M-20261119-084). A console that says it has no
// detail for the record's kind at all (`kind_unknown`, a company or a contact
// before the console serves their sections) is a route that is not there for
// that kind: the window shows what the card says.
//
// A row carries what the window shows and, when the console sends them, what
// it changes: the entry's id (edit, remove, mark done), a person's or a
// configuration's record (a click opens it in the window), a time entry's
// billing (B, NC, DNB) and work type, an instant for the day it is grouped
// under. A console that sends none of them shows its rows as before.
//
// A board and an invoice read their own sections through the same route
// (M-20261127-101, M-20261127-140): a board's active tickets (`tickets`,
// each with its next scheduling, M-20261127-129) and its figures (`stats`),
// an invoice's document (`document`), its payments and its history. A
// console that serves no detail for a kind answers `kind_unknown`: that kind
// then shows what its card holds, as before.
import { api, ApiError } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { downloadBlob } from "@/lib/diagram-view";
import { recordCardLanguage } from "@/lib/record-cards";
import { RECORD_LEVELS, RECORD_TITLE_FIELD, RECORD_TONES, validRecordRef } from "../../shared/record-cards";
import type { RecordLevel, RecordRef, RecordTone } from "../../shared/record-cards";
import { RECORD_BILLING, RECORD_FILE_MAX, parseRecordActions, type RecordAction, type RecordActionChoice, type RecordActionName, type RecordBilling } from "../../shared/record-actions";

export interface RecordChoice {
  value: string;
  label: string;
}

/** The sections the record window reads: each is one console section. A ticket's first, then a company's and a contact's, then a board's and an invoice's (M-20261127-101). */
export const DETAIL_SECTIONS = [
  "notes", "schedule", "activities", "time", "expenses", "configurations", "attachments",
  "sheet", "contacts", "tickets", "projects", "opportunities", "agreements", "sites", "finance", "stats", "history",
  "document", "payments",
] as const;
export type DetailSection = (typeof DETAIL_SECTIONS)[number];

export interface TicketNote {
  id?: string;
  author: string;
  authorRef?: RecordRef;
  date: string;
  timestamp: string;
  kind: string;
  body: string;
  /** a company's note written on one of its tickets: that ticket */
  on?: string;
  onRef?: RecordRef;
}
export interface ScheduleRow {
  id?: string;
  /** a meeting or a resource (an activity comes from its own section) */
  kind: "meeting" | "resource";
  resource: string;
  resourceRef?: RecordRef;
  start: string;
  end: string;
  /** the start's and the end's instants, for the order and a range said once */
  at?: string;
  endAt?: string;
  where: string;
  done?: boolean;
  subject?: string;
}
export interface ActivityRow {
  id?: string;
  subject: string;
  type: string;
  date: string;
  at?: string;
  assigned: string;
  assignedRef?: RecordRef;
  done?: boolean;
  /** a company's activity: the contact it is with, and what it is (its icon) */
  contact?: string;
  contactRef?: RecordRef;
  typeKind?: ActivityKind;
}
/** What an activity is, for its icon. */
export const ACTIVITY_KINDS = ["task", "email", "call", "meeting", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export interface TimeRow {
  id?: string;
  date: string;
  /** the start's instant: the day it is listed under */
  at?: string;
  member: string;
  memberRef?: RecordRef;
  hours: string;
  /** the hours as a number, for the totals of a console that sends none */
  value?: number;
  workType?: string;
  billing?: RecordBilling;
  note: string;
}
export interface ExpenseRow {
  id?: string;
  date: string;
  at?: string;
  member: string;
  memberRef?: RecordRef;
  type: string;
  amount: string;
  value?: number;
  billing?: RecordBilling;
  note?: string;
}
export interface ConfigurationRow {
  id?: string; name: string; type: string; status: string; ref?: RecordRef;
  /** a company's fleet: what it is (its system, its model), where, when it was last seen and its icon */
  detail?: string; site?: string; seen?: string; online?: boolean; icon?: ConfigurationKind;
}
/** What a configuration is, for its icon. */
export const CONFIGURATION_KINDS = ["server", "firewall", "network", "workstation", "laptop", "printer", "phone", "other"] as const;
export type ConfigurationKind = (typeof CONFIGURATION_KINDS)[number];
export interface AttachmentRow { id: string; name: string; size: string; date: string; download: () => void; author?: string }
/** The time tab's totals as the console wrote them (never added up here when it sends them). */
export interface TimeTotals {
  hours?: string;
  billable?: string;
  expenses?: string;
  parts?: Partial<Record<RecordBilling, { text?: string; share?: number }>>;
}

// ── a company's and a contact's sections (M-20261127-101, M-20261127-123, D-20261127-010) ──
// Every word is the console's, ready to show; an instant (`at`) is formatted
// here; a number is a count or a share (0 to 100), never a sum made here.

/** A way to reach the record, with its icon and what its button does (call, write, open). */
export const SHEET_REACH_KINDS = ["phone", "fax", "email", "web", "linkedin", "address", "site", "id"] as const;
export type SheetReachKind = (typeof SHEET_REACH_KINDS)[number];
export interface SheetReach { kind: SheetReachKind; value: string; detail?: string }
/** A figure of the sheet (open tickets, the balance, the block of hours, the fleet): a click opens its tab. */
export interface SheetTile { tab?: string; label: string; value: string; detail?: string; tone?: RecordTone; share?: number }
export interface SheetUpcoming { id?: string; subject: string; at?: string; date: string; type: string; assigned?: string; assignedRef?: RecordRef }
/** What moved, for its icon. */
export const SHEET_FEED_KINDS = ["note", "ticket", "attachment", "invoice", "activity", "agreement", "contact", "project", "opportunity", "configuration", "other"] as const;
export type SheetFeedKind = (typeof SHEET_FEED_KINDS)[number];
export interface SheetFeed { kind: SheetFeedKind; at?: string; date: string; who?: string; whoRef?: RecordRef; text: string; ref?: RecordRef; label?: string; tone?: RecordTone }
export interface SheetPerson { name: string; ref?: RecordRef; role?: string; detail?: string }
/** The sheet tab's own facts, beside the card's (the console sends what it has). */
export interface RecordSheet {
  /** its type, its territory, its budget: ready words, said in one line */
  context: string[];
  /** a customer since (a calendar day) */
  since?: string;
  /** a contact's title and roles */
  title?: string;
  roles: string[];
  reach: SheetReach[];
  tiles: SheetTile[];
  upcoming: SheetUpcoming[];
  feed: SheetFeed[];
  people: SheetPerson[];
  prefs: Array<{ label: string; value: string }>;
}
export interface ContactRow { id?: string; name: string; ref?: RecordRef; title: string; roles: string[]; phone: string; email: string; portal: string; inactive?: boolean }
/** Who is planned on a ticket, when, and whether they saw it (M-20261127-129). */
export interface PlannedPerson {
  name: string;
  ref?: RecordRef;
  at?: string;
  endAt?: string;
  seen?: boolean;
}
/** A ticket's next scheduling in a list: planned, going on now, or none. */
export interface NextPlan {
  state: "planned" | "ongoing" | "none";
  at?: string;
  endAt?: string;
  people: PlannedPerson[];
}
/** A ticket as the board shows it (M-20261127-145, M-20261127-129): its next scheduling with who. */
export interface TicketRow {
  id?: string;
  ref?: RecordRef;
  number: string;
  summary: string;
  company?: string;
  companyRef?: RecordRef;
  status: string;
  tone?: RecordTone;
  /** absent: the console does not say (never read as open) */
  statusTone?: RecordTone;
  priority: string;
  level?: RecordLevel;
  type: string;
  next?: NextPlan;
  closed?: boolean;
  owner: string;
  ownerRef?: RecordRef;
  updated?: string;
  updatedText?: string;
  /** the person reading is its owner */
  mine?: boolean;
  /** an instant: when it was entered */
  opened?: string;
}
export interface ProjectRow { id?: string; name: string; ref?: RecordRef; status: string; tone?: RecordTone; share?: number; manager: string; managerRef?: RecordRef; period: string; hours: string }
export interface OpportunityRow { id?: string; name: string; ref?: RecordRef; amount: string; stage: string; step?: number; steps?: number; probability?: number; close: string; owner: string; ownerRef?: RecordRef; tone?: RecordTone }
export interface AgreementRow {
  id?: string; name: string; ref?: RecordRef; status: string; tone?: RecordTone; type: string; period: string; renew?: string;
  /** its block of hours: used, of, the share used, what is left and when it runs out at this pace */
  used?: string; of?: string; share?: number; left?: string; pace?: string;
  months: StatBar[];
}
export interface SiteRow { id?: string; name: string; address: string; city: string; phone: string; contacts?: number; configurations?: number; main?: boolean }
export interface InvoiceRow { id?: string; number: string; ref?: RecordRef; issued: string; due: string; amount: string; state: string; late?: number }
export interface StatBar { label: string; value: number; text: string }
export interface FinanceFacts { tiles: SheetTile[]; aging: Array<{ label: string; text: string; share: number; tone: RecordTone }> }
export interface RecordStats {
  hours: StatBar[];
  types: StatBar[];
  resolution?: { text: string; detail?: string };
  billable: Array<{ billing: RecordBilling; share: number; text?: string }>;
}
/** One week of a board: the tickets entered and closed in it. */
export interface WeekRow {
  /** the week's first day (a calendar day) */
  week: string;
  opened?: number;
  closed?: number;
}
/** A board's figures the window cannot count from its active tickets. */
export interface BoardStats {
  closedThisWeek?: number;
  firstResponse?: { text: string; detail?: string };
}
/** A line of an invoice, its amount as the product wrote it. */
export interface InvoiceLine {
  id?: string;
  label: string;
  detail?: string;
  amount: string;
  ref?: RecordRef;
}
export const INVOICE_STEPS = ["issued", "sent", "due", "reminder", "next_reminder"] as const;
export type InvoiceStep = (typeof INVOICE_STEPS)[number];
/** An invoice as a document: every amount is the product's own text, never computed here. */
export interface InvoiceDocument {
  issued?: string;
  due?: string;
  terms?: string;
  billedTo?: { name: string; ref?: RecordRef; attention?: string; address: string[] };
  /** the tickets, the agreement, the project it was made from */
  links: Array<{ label: string; ref?: RecordRef; detail?: string }>;
  subtotal?: string;
  taxes: Array<{ label: string; amount: string }>;
  total?: string;
  paid?: string;
  balance?: string;
  /** the product says something is still owed */
  owed?: boolean;
  steps: Array<{ step: InvoiceStep; at?: string; who?: string; done?: boolean }>;
  client?: { balance?: string; late?: string; paysIn?: string };
  /** the detail route downloads its PDF (`section=download&field=pdf`) */
  pdf?: boolean;
}
/** A payment: its calendar day (`day`, never shifted) or the words of a console that sends none. */
export interface PaymentRow { id?: string; day?: string; date: string; type: string; amount: string; by?: string; reference?: string }
export interface HistoryRow { id?: string; at?: string; date: string; text: string; who?: string; tone?: RecordTone }

type Lines = {
  notes: TicketNote[];
  schedule: ScheduleRow[];
  activities: ActivityRow[];
  time: TimeRow[];
  expenses: ExpenseRow[];
  configurations: ConfigurationRow[];
  attachments: AttachmentRow[];
  sheet: never[];
  contacts: ContactRow[];
  tickets: TicketRow[];
  projects: ProjectRow[];
  opportunities: OpportunityRow[];
  agreements: AgreementRow[];
  sites: SiteRow[];
  finance: InvoiceRow[];
  stats: WeekRow[];
  history: HistoryRow[];
  document: InvoiceLine[];
  payments: PaymentRow[];
};
export type DetailPage = {
  [K in DetailSection]: { tab: K; lines: Lines[K]; totalHours?: string; totals?: TimeTotals; sheet?: RecordSheet; finance?: FinanceFacts; stats?: RecordStats | BoardStats; document?: InvoiceDocument }
}[DetailSection];
export type DetailPageOf<K extends DetailSection> = Extract<DetailPage, { tab: K }>;

/** The fields a person may change on a ticket by a choice. */
export const RECORD_EDIT_FIELDS = ["status", "priority", "board", "type", "subtype", "item", "owner", "team", "agreement", "contact", "location", "site"] as const;
export type RecordEditField = (typeof RECORD_EDIT_FIELDS)[number];
/** The field a person writes as text, the title, and its one rule (M-20261119-084): shared with the route. */
export { RECORD_TITLE_FIELD, RECORD_TITLE_MAX, recordTitleValue as titleValue } from "../../shared/record-cards";

/** Raised when the server has no detail route: the original card is shown. */
export class RecordDetailMissing extends Error {}

/** A write the console does not take (yet), or the organization refuses: its words say so. */
export class RecordActionRefused extends Error {
  override name = "RecordActionRefused";
}

/** What a failed write says: the refusal's own words, else that the change could not be saved. */
export function actionFailure(failure: unknown): string {
  return failure instanceof RecordActionRefused ? failure.message : t("recordWindow.saveFailed");
}

export interface RecordDetailCounts {
  counts: Partial<Record<DetailSection, number>>;
  fields: RecordEditField[];
  /** the console lists the title as editable */
  title: boolean;
  /** the actions the console takes for this record; null: it lists none (any is tried) */
  actions: ReadonlySet<RecordActionName> | null;
}

export interface RecordDetailPage {
  page: DetailPage;
  next: number | null;
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";

export function recordDetailPath(ref: RecordRef, query: Record<string, string | number | undefined>): string {
  const all: Record<string, string | number | undefined> = { ...query, lang: recordCardLanguage() };
  const parts = Object.keys(all).filter((key) => all[key] !== undefined).map((key) => `${key}=${encodeURIComponent(String(all[key]))}`);
  return `/api/me/records/${encodeURIComponent(ref.product)}/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.id)}/detail?${parts.join("&")}`;
}

/** Only a route that is not there: a 404 or 405 with no code of the console,
 * or the console's `kind_unknown` (it serves no detail for this kind: its card is shown). */
export function detailRouteMissing(error: unknown): boolean {
  if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) return false;
  const body = error.body as { code?: unknown } | undefined;
  const code = body && typeof body === "object" && typeof body.code === "string" ? body.code : "";
  return !code || code === "kind_unknown";
}

/** A console with no detail for this kind of record (a company or a contact before it serves their sections). */
export function detailKindMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && (error.body as { code?: unknown } | undefined)?.code === "kind_unknown";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (detailRouteMissing(error) || detailKindMissing(error)) throw new RecordDetailMissing();
    throw error;
  }
}

function nextPage(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const rowsOf = (raw: unknown): Raw[] => isObject(raw) && Array.isArray(raw.lines) ? raw.lines.filter(isObject) : [];

/** Parse the counts answer; unknown tabs and fields are dropped. */
export function parseDetailCounts(raw: unknown): RecordDetailCounts {
  const counts: Partial<Record<DetailSection, number>> = {};
  const source = isObject(raw) && isObject(raw.counts) ? raw.counts : {};
  for (const tab of DETAIL_SECTIONS) {
    const value = source[tab];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) counts[tab] = value;
  }
  const asked = isObject(raw) && Array.isArray(raw.fields) ? raw.fields : [];
  const fields = RECORD_EDIT_FIELDS.filter((field) => asked.includes(field));
  return { counts, fields, title: asked.includes(RECORD_TITLE_FIELD), actions: parseRecordActions(isObject(raw) ? raw.actions : undefined) };
}

/** Newer consoles include instants. Older ones already formatted the person's local time. */
function localMoment(instant: unknown, fallback: unknown): string {
  const raw = text(instant);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) return text(fallback);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return text(fallback);
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const idOf = (value: unknown): string | undefined => {
  const id = text(value);
  return /^[A-Za-z0-9._:-]{1,64}$/.test(id) ? id : undefined;
};
const refOf = (value: unknown): RecordRef | undefined => isObject(value) && validRecordRef(value as { product?: unknown; kind?: unknown; id?: unknown }) ? { product: String(value.product), kind: String(value.kind), id: String(value.id) } : undefined;
const numberOf = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const billingOf = (value: unknown): RecordBilling | undefined => (RECORD_BILLING as readonly string[]).includes(text(value)) ? text(value) as RecordBilling : undefined;
const instantOf = (value: unknown): string | undefined => {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
};
const doneOf = (r: Raw): boolean | undefined => typeof r.doneFlag === "boolean" ? r.doneFlag : typeof r.done === "boolean" ? r.done
  : ["Yes", "Oui"].includes(text(r.done)) ? true : ["No", "Non"].includes(text(r.done)) ? false : undefined;
const optional = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined && one !== "")) as T;

function totalsOf(raw: unknown): TimeTotals | undefined {
  if (!isObject(raw)) return undefined;
  const parts: TimeTotals["parts"] = {};
  if (isObject(raw.parts)) {
    for (const billing of RECORD_BILLING) {
      const part = raw.parts[billing];
      if (!isObject(part)) continue;
      const share = numberOf(part.share);
      parts[billing] = optional({ text: text(part.text) || undefined, share: share !== undefined && share >= 0 && share <= 100 ? share : undefined });
    }
  }
  const out = optional({ hours: text(raw.hours) || undefined, billable: text(raw.billable) || undefined, expenses: text(raw.expenses) || undefined });
  return Object.keys(parts).length || Object.keys(out).length ? { ...out, ...(Object.keys(parts).length ? { parts } : {}) } : undefined;
}

/** Parse one page of a section, a line's columns being the English keys (the optional ones only when the console sends them). */
export function parseDetailPage(tab: DetailSection, raw: unknown, download: (id: string, name: string) => () => void): RecordDetailPage {
  const rows = rowsOf(raw);
  const next = isObject(raw) ? nextPage(raw.next) : null;
  const totalHours = isObject(raw) && typeof raw.totalHours === "string" && raw.totalHours ? { totalHours: raw.totalHours } : {};
  switch (tab) {
    case "schedule": return { next, page: { tab, lines: rows.map(r => ({
      ...optional({ id: idOf(r.id), resourceRef: refOf(r.member_ref), at: instantOf(r.startTimestamp), endAt: instantOf(r.endTimestamp), subject: text(r.subject) || undefined }),
      kind: text(r.kind) === "meeting" ? "meeting" as const : "resource" as const,
      resource: text(r.member), start: localMoment(r.startTimestamp, r.date), end: localMoment(r.endTimestamp, r.end),
      where: text(r.where), ...(doneOf(r) !== undefined ? { done: doneOf(r) } : {}),
    })) } };
    case "notes": return { next, page: { tab, lines: rows.map(r => ({
      ...optional({ id: idOf(r.id), authorRef: refOf(r.author_ref), on: short(r.on, 80) || undefined, onRef: refOf(r.on_ref) }),
      author: text(r.author), date: localMoment(r.timestamp, r.date), timestamp: text(r.timestamp), kind: text(r.kind), body: text(r.text),
    })) } };
    case "time": {
      const totals = totalsOf(isObject(raw) ? raw.totals : undefined);
      return { next, page: { tab, ...totalHours, ...(totals ? { totals } : {}), lines: rows.map((r) => ({
        ...optional({ id: idOf(r.id), at: instantOf(r.start), memberRef: refOf(r.member_ref), value: numberOf(r.hours_value), workType: text(r.work_type) || undefined, billing: billingOf(r.billing) }),
        date: text(r.date), member: text(r.member), hours: text(r.hours), note: text(r.note),
      })) } };
    }
    case "configurations": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), ref: refOf(r.ref), detail: short(r.detail, 160) || undefined, site: short(r.site, 80) || undefined, seen: short(r.seen, 80) || undefined, icon: oneOf(CONFIGURATION_KINDS, r.icon) }),
      ...(typeof r.online === "boolean" ? { online: r.online } : {}),
      name: text(r.name), type: text(r.type), status: text(r.status),
    })) } };
    case "expenses": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), at: instantOf(r.start), memberRef: refOf(r.member_ref), value: numberOf(r.amount_value), billing: billingOf(r.billing), note: text(r.note) || undefined }),
      date: text(r.date), member: text(r.member), type: text(r.type), amount: text(r.amount),
    })) } };
    case "activities": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), at: instantOf(r.dateStart), assignedRef: refOf(r.assigned_ref), contact: short(r.contact, 80) || undefined, contactRef: refOf(r.contact_ref), typeKind: oneOf(ACTIVITY_KINDS, r.type_kind) }),
      ...(doneOf(r) !== undefined ? { done: doneOf(r) } : {}),
      subject: text(r.subject), type: text(r.type), date: text(r.date), assigned: text(r.assigned),
    })) } };
    case "attachments": return { next, page: { tab, lines: rows.map((r) => ({ ...optional({ author: short(r.author, 80) || undefined }), id: text(r.id), name: text(r.name), size: text(r.size), date: text(r.date), download: download(text(r.id), text(r.name)) })) } };
    case "sheet": return { next: null, page: { tab, lines: [], ...(isObject(raw) && isObject(raw.sheet) ? { sheet: sheetOf(raw.sheet) } : {}) } };
    case "contacts": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), ref: refOf(r.ref) }), ...(r.inactive === true ? { inactive: true } : {}),
      name: short(r.name, 120), title: short(r.title, 120), roles: words(r.roles, 6, 40), phone: short(r.phone, 40), email: short(r.email, 250), portal: short(r.portal, 80),
    })).filter((row) => row.name) } };
    case "tickets": return { next, page: { tab, lines: rows.map(ticketOf).filter((row): row is TicketRow => row !== null) } };
    case "projects": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), ref: refOf(r.ref), tone: toneOf(r.tone), share: shareOf(r.share), managerRef: refOf(r.manager_ref) }),
      name: short(r.name, 160), status: short(r.status, 60), manager: short(r.manager, 120), period: short(r.period, 80), hours: short(r.hours, 60),
    })).filter((row) => row.name) } };
    case "opportunities": return { next, page: { tab, lines: rows.map((r) => {
      const steps = countOf(r.steps), step = countOf(r.step);
      return {
        ...optional({ id: idOf(r.id), ref: refOf(r.ref), tone: toneOf(r.tone), probability: shareOf(r.probability), ownerRef: refOf(r.owner_ref) }),
        ...(steps && step !== undefined && step < steps ? { step, steps: Math.min(steps, 12) } : {}),
        name: short(r.name, 160), amount: short(r.amount, 60), stage: short(r.stage, 60), close: short(r.close, 60), owner: short(r.owner, 120),
      };
    }).filter((row) => row.name) } };
    case "agreements": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), ref: refOf(r.ref), tone: toneOf(r.tone), renew: short(r.renew, 160) || undefined, used: short(r.used, 40) || undefined, of: short(r.of, 40) || undefined, share: shareOf(r.share), left: short(r.left, 60) || undefined, pace: short(r.pace, 160) || undefined }),
      name: short(r.name, 160), status: short(r.status, 60), type: short(r.type, 80), period: short(r.period, 120), months: barsOf(r.months, 24),
    })).filter((row) => row.name) } };
    case "sites": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), contacts: countOf(r.contacts), configurations: countOf(r.configurations) }), ...(r.main === true ? { main: true } : {}),
      name: short(r.name, 80), address: short(r.address, 160), city: short(r.city, 160), phone: short(r.phone, 40),
    })).filter((row) => row.name) } };
    case "finance": {
      const facts = isObject(raw) && isObject(raw.finance) ? raw.finance : undefined;
      return { next, page: { tab, ...(facts ? { finance: { tiles: tilesOf(facts.tiles), aging: listOf(facts.aging, 6).map((r) => ({ label: short(r.label, 60), text: short(r.text, 60), share: shareOf(r.share) ?? 0, tone: toneOf(r.tone) ?? "open" })).filter((part) => part.label) } } : {}), lines: rows.map((r) => ({
        ...optional({ id: idOf(r.id), ref: refOf(r.ref), late: countOf(r.late) }),
        number: short(r.number, 60), issued: short(r.issued, 60), due: short(r.due, 60), amount: short(r.amount, 60), state: short(r.state, 60),
      })).filter((row) => row.number) } };
    }
    case "stats": {
      // a board: weeks as lines plus closed_this_week / first_response; a company's Data: hours/types under stats
      const weeks = rows.map((r) => ({ week: dayText(r.week) ?? "", ...optional({ opened: countOf(r.opened), closed: countOf(r.closed) }) })).filter((row) => row.week);
      const board = isObject(raw) ? boardStatsOf(raw) : undefined;
      if (weeks.length || board) {
        return { next, page: { tab, ...(board ? { stats: board } : {}), lines: weeks } };
      }
      const stats = isObject(raw) && isObject(raw.stats) ? raw.stats : undefined;
      const resolution = stats && isObject(stats.resolution) && short(stats.resolution.text, 40) ? { text: short(stats.resolution.text, 40), ...optional({ detail: short(stats.resolution.detail, 160) || undefined }) } : undefined;
      return { next: null, page: { tab, lines: [], ...(stats ? { stats: {
        hours: barsOf(stats.hours, 24), types: barsOf(stats.types, 12), ...(resolution ? { resolution } : {}),
        billable: listOf(stats.billable, 3).map((r) => ({ billing: billingOf(r.billing), share: shareOf(r.share), text: short(r.text, 40) || undefined }))
          .filter((part): part is { billing: RecordBilling; share: number; text: string | undefined } => Boolean(part.billing) && part.share !== undefined).map((part) => optional(part)),
      } } : {}) } };
    }
    case "document": {
      const document = isObject(raw) && isObject(raw.document) ? documentOf(raw.document) : undefined;
      return { next, page: { tab, ...(document ? { document } : {}), lines: rows.map((r) => ({ ...optional({ id: idOf(r.id), detail: text(r.detail) || undefined, ref: refOf(r.ref) }), label: text(r.label), amount: text(r.amount) })).filter((row) => row.label) } };
    }
    case "payments": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), day: dayText(r.date), by: text(r.by) || undefined, reference: text(r.reference) || undefined }),
      date: dayText(r.date) ? "" : text(r.date), type: text(r.type), amount: text(r.amount),
    })).filter((row) => row.amount) } };
    case "history": return { next, page: { tab, lines: rows.map((r) => ({
      ...optional({ id: idOf(r.id), at: instantOf(r.at), who: short(r.who, 120) || undefined, tone: toneOf(r.tone) }),
      date: instantOf(r.at) ? "" : (short(r.date, 60) || text(r.date)), text: short(r.text, 400) || text(r.text),
    })).filter((row) => row.text) } };
  }
}

const short = (value: unknown, max: number): string => text(value).replace(/\s+/g, " ").trim().slice(0, max);
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined => (list as readonly unknown[]).includes(value) ? value as T : undefined;
const toneOf = (value: unknown): RecordTone | undefined => oneOf(RECORD_TONES, value);
const countOf = (value: unknown): number | undefined => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : undefined;
const shareOf = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
const listOf = (value: unknown, max: number): Raw[] => Array.isArray(value) ? value.filter(isObject).slice(0, max) : [];
const words = (value: unknown, max: number, each: number): string[] => Array.isArray(value) ? value.map((one) => short(one, each)).filter(Boolean).slice(0, max) : [];
/** A bar of a chart: its label, its number (only for its length) and its words. */
const barsOf = (value: unknown, max: number): StatBar[] => listOf(value, max).flatMap((r) => {
  const label = short(r.label, 40), number = typeof r.value === "number" && Number.isFinite(r.value) && r.value >= 0 ? r.value : undefined;
  return label && number !== undefined ? [{ label, value: number, text: short(r.text, 40) || String(number) }] : [];
});
const tilesOf = (value: unknown): SheetTile[] => listOf(value, 4).flatMap((r) => {
  const label = short(r.label, 60), shown = short(r.value, 40);
  if (!label || !shown) return [];
  const tab = text(r.tab);
  return [{ ...optional({ tab: /^[a-z]{1,20}$/.test(tab) ? tab : undefined, detail: short(r.detail, 80) || undefined, tone: toneOf(r.tone), share: shareOf(r.share) }), label, value: shown }];
});

/** The sheet tab's facts, every part dropped when it does not read. */
export function sheetOf(raw: Raw): RecordSheet {
  return {
    context: words(raw.context, 6, 80),
    ...optional({ since: typeof raw.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.since) && Number.isFinite(Date.parse(raw.since)) ? raw.since : undefined, title: short(raw.title, 120) || undefined }),
    roles: words(raw.roles, 6, 40),
    reach: listOf(raw.reach, 12).flatMap((r) => {
      const kind = oneOf(SHEET_REACH_KINDS, r.kind), value = text(r.value).trim().slice(0, 250);
      return kind && value ? [{ kind, value, ...optional({ detail: short(r.detail, 120) || undefined }) }] : [];
    }),
    tiles: tilesOf(raw.tiles),
    upcoming: listOf(raw.upcoming, 6).flatMap((r) => {
      const subject = short(r.subject, 160);
      return subject ? [{ ...optional({ id: idOf(r.id), at: instantOf(r.start), assigned: short(r.assigned, 120) || undefined, assignedRef: refOf(r.assigned_ref) }), subject, date: short(r.date, 60), type: short(r.type, 60) }] : [];
    }),
    feed: listOf(raw.feed, 12).flatMap((r) => {
      const said = short(r.text, 400);
      return said ? [{ ...optional({ at: instantOf(r.at), who: short(r.who, 120) || undefined, whoRef: refOf(r.who_ref), ref: refOf(r.ref), label: short(r.label, 80) || undefined, tone: toneOf(r.tone) }), kind: oneOf(SHEET_FEED_KINDS, r.kind) ?? "other", date: short(r.date, 60), text: said }] : [];
    }),
    people: listOf(raw.people, 6).flatMap((r) => {
      const name = short(r.name, 120);
      return name ? [{ ...optional({ ref: refOf(r.ref), role: short(r.role, 40) || undefined, detail: short(r.detail, 160) || undefined }), name }] : [];
    }),
    prefs: listOf(raw.prefs, 8).map((r) => ({ label: short(r.label, 60), value: short(r.value, 120) })).filter((pref) => pref.label && pref.value),
  };
}

/** A calendar day as sent (`2026-10-31`), never shifted by a zone. */
const dayText = (value: unknown): string | undefined => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(text(value))) ? text(value) : undefined;
const texts = (value: unknown, most: number): string[] => Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, most) : [];

function nextOf(raw: unknown): NextPlan | undefined {
  if (!isObject(raw)) return undefined;
  const state = text(raw.state);
  if (state === "planned" || state === "ongoing" || state === "none") {
    const people = (Array.isArray(raw.people) ? raw.people : []).filter(isObject).slice(0, 12).map((p) => ({
      ...optional({ ref: refOf(p.ref), at: instantOf(p.start), endAt: instantOf(p.end) }),
      ...(typeof p.seen === "boolean" ? { seen: p.seen } : {}),
      name: text(p.name),
    })).filter((p) => p.name);
    return { state, ...optional({ at: instantOf(raw.start), endAt: instantOf(raw.end) }), people: state === "none" ? [] : people };
  }
  // a company's list: next { start, date, who[] } → NextPlan
  const who = words(raw.who, 8, 120);
  const at = instantOf(raw.start);
  const date = short(raw.date, 60);
  if (!who.length && !at && !date) return undefined;
  return { state: "planned", ...optional({ at }), people: who.map((name) => ({ name })) };
}

/** A ticket of a list; null without its number and its words. */
function ticketOf(r: Raw): TicketRow | null {
  const number = short(r.number, 40) || text(r.number);
  const summary = short(r.summary, 200) || text(r.summary);
  if (!number || !summary) return null;
  const tone = toneOf(r.status_tone) ?? toneOf(r.tone);
  const next = nextOf(r.next);
  return {
    ...optional({
      id: idOf(r.id), ref: refOf(r.ref), tone, statusTone: toneOf(r.status_tone) ?? toneOf(r.tone),
      level: oneOf(RECORD_LEVELS, r.level) ?? oneOf(RECORD_LEVELS, r.priority_level),
      ownerRef: refOf(r.owner_ref), companyRef: refOf(r.company_ref),
      updated: instantOf(r.updated), opened: instantOf(r.opened), updatedText: short(r.updated_text, 60) || undefined,
    }),
    ...(typeof r.mine === "boolean" ? { mine: r.mine } : {}),
    ...(r.closed === true ? { closed: true } : {}),
    ...(next ? { next } : {}),
    number, summary, company: text(r.company),
    status: short(r.status, 60) || text(r.status),
    priority: short(r.priority, 60) || text(r.priority), type: short(r.type, 80) || text(r.type),
    owner: short(r.owner, 120) || text(r.owner),
  };
}

function boardStatsOf(raw: Raw): BoardStats | undefined {
  const first = isObject(raw.first_response) && text(raw.first_response.text) ? optional({ text: text(raw.first_response.text), detail: text(raw.first_response.detail) || undefined }) : undefined;
  const stats = optional({ closedThisWeek: countOf(raw.closed_this_week), firstResponse: first });
  return Object.keys(stats).length ? stats : undefined;
}

function documentOf(raw: Raw): InvoiceDocument {
  const billed = isObject(raw.billed_to) && text(raw.billed_to.name) ? raw.billed_to : undefined;
  const client = isObject(raw.client) ? optional({ balance: text(raw.client.balance) || undefined, late: text(raw.client.late) || undefined, paysIn: text(raw.client.pays_in) || undefined }) : {};
  return {
    ...optional({
      issued: dayText(raw.issued), due: dayText(raw.due), terms: text(raw.terms) || undefined,
      subtotal: text(raw.subtotal) || undefined, total: text(raw.total) || undefined, paid: text(raw.paid) || undefined, balance: text(raw.balance) || undefined,
    }),
    ...(typeof raw.owed === "boolean" ? { owed: raw.owed } : {}),
    ...(raw.pdf === true ? { pdf: true } : {}),
    ...(billed ? { billedTo: { name: text(billed.name), ...optional({ ref: refOf(billed.ref), attention: text(billed.attention) || undefined }), address: texts(billed.address, 6) } } : {}),
    links: (Array.isArray(raw.links) ? raw.links : []).filter(isObject).slice(0, 12).map((l) => ({ label: text(l.label), ...optional({ ref: refOf(l.ref), detail: text(l.detail) || undefined }) })).filter((l) => l.label),
    taxes: (Array.isArray(raw.taxes) ? raw.taxes : []).filter(isObject).slice(0, 6).map((tax) => ({ label: text(tax.label), amount: text(tax.amount) })).filter((tax) => tax.label && tax.amount),
    steps: (Array.isArray(raw.steps) ? raw.steps : []).filter(isObject).slice(0, 12).flatMap((s) => {
      const step = text(s.step);
      if (!(INVOICE_STEPS as readonly string[]).includes(step)) return [];
      const at = dayText(s.at) ?? instantOf(s.at);
      return [{ step: step as InvoiceStep, ...optional({ at, who: text(s.who) || undefined }), ...(typeof s.done === "boolean" ? { done: s.done } : {}) }];
    }),
    ...(Object.keys(client).length ? { client } : {}),
  };
}

export function parseChoices(raw: unknown): { choices: RecordChoice[]; next: number | null } {
  const list = isObject(raw) && Array.isArray(raw.choices) ? raw.choices : [];
  const choices = list.filter(isObject).map((c) => ({ value: text(c.value), label: text(c.label) })).filter((c) => c.value && c.label);
  return { choices, next: isObject(raw) ? nextPage(raw.next) : null };
}

export async function readDetailCounts(ref: RecordRef, fresh: boolean): Promise<RecordDetailCounts> {
  return parseDetailCounts(await call(recordDetailPath(ref, { section: "counts", fresh: fresh ? 1 : undefined })));
}

/** An attachment's bytes, through the same authenticated detail path, then
 * handed to the browser as a download. */
export async function downloadAttachment(ref: RecordRef, id: string, name: string): Promise<void> {
  const body = await call<unknown>(recordDetailPath(ref, { section: "download", field: id }));
  if (!isObject(body) || typeof body.base64 !== "string") throw new Error("missing attachment");
  const bytes = Uint8Array.from(atob(body.base64), char => char.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: text(body.contentType) }), text(body.name) || name);
}

export async function readDetailPage(ref: RecordRef, tab: DetailSection, page: number, fresh: boolean, onDownloadError: () => void): Promise<RecordDetailPage> {
  const raw = await call(recordDetailPath(ref, { section: tab, page, fresh: fresh ? 1 : undefined }));
  return parseDetailPage(tab, raw, (id, name) => () => { void downloadAttachment(ref, id, name).catch(onDownloadError); });
}

export async function readFieldChoices(ref: RecordRef, field: RecordEditField | RecordActionChoice, fresh: boolean): Promise<RecordChoice[]> {
  const all: RecordChoice[] = [];
  let page: number | null = 1;
  while (page !== null) {
    const read = parseChoices(await call(recordDetailPath(ref, { section: "choices", field, page, fresh: fresh ? 1 : undefined })));
    all.push(...read.choices);
    if (read.next !== null && read.next <= page) throw new Error("invalid choice page");
    page = read.next;
  }
  return all;
}

/** An image a note names, through the card's own detail path (the console
 * reads it with the person's key): the browser never calls the product and
 * never holds a key. Only an image comes back (png, jpeg, gif or webp). */
export async function readNoteImage(ref: RecordRef, src: string): Promise<Blob> {
  const body = await call<unknown>(recordDetailPath(ref, { section: "image", field: src }));
  if (!isObject(body) || typeof body.base64 !== "string") throw new Error("missing image");
  const type = text(body.contentType);
  if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) throw new Error("not an image");
  return new Blob([Uint8Array.from(atob(body.base64), char => char.charCodeAt(0))], { type });
}

export async function writeField(ref: RecordRef, field: RecordEditField | typeof RECORD_TITLE_FIELD, value: string): Promise<void> {
  const answer = await call<unknown>(recordDetailPath(ref, {}), { method: "POST", body: JSON.stringify({ field, value }) });
  if (!isObject(answer) || answer.updated !== true) throw new Error("not updated");
}

/** The console's code of a write it does not take: the window says so in words, never as a failure of the network. */
const NOT_TAKEN = new Set(["action_unknown", "detail_invalid", "field_unknown"]);

/** One action of the record window, written as the person (shared/record-actions.ts). */
export async function writeAction(ref: RecordRef, action: RecordAction): Promise<void> {
  let answer: unknown;
  try {
    answer = await call<unknown>(recordDetailPath(ref, {}), { method: "POST", body: JSON.stringify(action) });
  } catch (error) {
    const code = error instanceof ApiError ? (error.body as { code?: unknown } | undefined)?.code : undefined;
    if (error instanceof RecordDetailMissing || (typeof code === "string" && NOT_TAKEN.has(code))) throw new RecordActionRefused(t("recordWindow.notTaken"));
    if (error instanceof ApiError && error.status === 403 && (error.body as { state?: unknown } | undefined)?.state === "org_refused") throw new RecordActionRefused(t("recordCard.state.orgRefused"));
    throw error;
  }
  if (!isObject(answer) || answer.updated !== true) throw new Error("not updated");
}

/** A file read for an attachment: its name, type and base64; too large a file is refused before anything is sent. */
export async function attachmentOf(file: File): Promise<{ name: string; content_type: string; base64: string }> {
  if (file.size > RECORD_FILE_MAX) throw new RecordActionRefused(t("recordWindow.fileTooLarge", { size: Math.round(RECORD_FILE_MAX / 1024 / 1024) }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name.slice(0, 255) || "file", content_type: (file.type || "application/octet-stream").slice(0, 100), base64: btoa(binary) };
}
