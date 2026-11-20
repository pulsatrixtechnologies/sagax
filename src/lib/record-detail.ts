// The detail of a ticket card: the client of GET and POST
// /api/me/records/:product/:kind/:id/detail (server/routes/record-cards.ts).
// It reads the related tabs (counts, pages, attachments), the images a note
// names, the choices of an editable field and writes one field (the title as
// text). The server reads the ticket under the person before every access;
// this module only asks and parses.
//
// A server without the route answers 404 (or 405) with no code of the
// console: `RecordDetailMissing`, and the card stays the original one. A 404
// that carries the console's code (a section the product refused, a record
// it does not know) is that section's failure only: it never takes the
// card's tabs and fields away (M-20261119-084).
import { api, ApiError } from "@/state/store";
import { activeLocale } from "@/lib/i18n";
import { downloadBlob } from "@/lib/diagram-view";
import { recordCardLanguage } from "@/lib/record-cards";
import { RELATED_TABS, type RelatedPage, type RelatedTab } from "@/components/RecordRelatedTabs";
import type { RecordChoice } from "@/components/RecordFieldSelect";
import { RECORD_TITLE_FIELD } from "../../shared/record-cards";
import type { RecordRef } from "../../shared/record-cards";

/** The fields a person may change on a ticket by a choice. */
export const RECORD_EDIT_FIELDS = ["status", "priority", "board", "type", "subtype", "item", "owner", "team", "agreement", "contact"] as const;
export type RecordEditField = (typeof RECORD_EDIT_FIELDS)[number];
/** The field a person writes as text, the title, and its one rule (M-20261119-084): shared with the route. */
export { RECORD_TITLE_FIELD, RECORD_TITLE_MAX, recordTitleValue as titleValue } from "../../shared/record-cards";

/** Raised when the server has no detail route: the original card is shown. */
export class RecordDetailMissing extends Error {}

export interface RecordDetailCounts {
  counts: Partial<Record<RelatedTab, number>>;
  fields: RecordEditField[];
  /** the console lists the title as editable */
  title: boolean;
}

export interface RecordDetailPage {
  page: RelatedPage;
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

/** Only a route that is not there: a 404 or 405 with no code of the console. */
export function detailRouteMissing(error: unknown): boolean {
  if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) return false;
  const body = error.body as { code?: unknown } | undefined;
  return !(body && typeof body === "object" && typeof body.code === "string" && body.code);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (detailRouteMissing(error)) throw new RecordDetailMissing();
    throw error;
  }
}

function nextPage(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

const rowsOf = (raw: unknown): Raw[] => isObject(raw) && Array.isArray(raw.lines) ? raw.lines.filter(isObject) : [];

/** Parse the counts answer; unknown tabs and fields are dropped. */
export function parseDetailCounts(raw: unknown): RecordDetailCounts {
  const counts: Partial<Record<RelatedTab, number>> = {};
  const source = isObject(raw) && isObject(raw.counts) ? raw.counts : {};
  for (const tab of RELATED_TABS) {
    const value = source[tab];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) counts[tab] = value;
  }
  const asked = isObject(raw) && Array.isArray(raw.fields) ? raw.fields : [];
  const fields = RECORD_EDIT_FIELDS.filter((field) => asked.includes(field));
  return { counts, fields, title: asked.includes(RECORD_TITLE_FIELD) };
}

/** Newer consoles include instants. Older ones already formatted the person's local time. */
function localMoment(instant: unknown, fallback: unknown): string {
  const raw = text(instant);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) return text(fallback);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return text(fallback);
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Parse one page of a tab, a line's columns being the English keys. */
export function parseDetailPage(tab: RelatedPage["tab"], raw: unknown, download: (id: string, name: string) => () => void): RecordDetailPage {
  const rows = rowsOf(raw);
  const next = isObject(raw) ? nextPage(raw.next) : null;
  const totalHours = isObject(raw) && typeof raw.totalHours === "string" && raw.totalHours ? { totalHours: raw.totalHours } : {};
  switch (tab) {
    case "schedule": return { next, page: { tab, lines: rows.map(r => ({
      resource: text(r.member), start: localMoment(r.startTimestamp, r.date), end: localMoment(r.endTimestamp, r.end),
      where: text(r.where), done: typeof r.doneFlag === "boolean" ? r.doneFlag :
        ["Yes", "Oui"].includes(text(r.done)) ? true : ["No", "Non"].includes(text(r.done)) ? false : undefined,
    })) } };
    case "notes": return { next, page: { tab, lines: rows.map(r => ({
      author: text(r.author), date: localMoment(r.timestamp, r.date), timestamp: text(r.timestamp), kind: text(r.kind), body: text(r.text),
    })) } };
    case "time": return { next, page: { tab, ...totalHours, lines: rows.map((r) => ({ date: text(r.date), member: text(r.member), hours: text(r.hours), note: text(r.note) })) } };
    case "configurations": return { next, page: { tab, lines: rows.map((r) => ({ name: text(r.name), type: text(r.type), status: text(r.status) })) } };
    case "expenses": return { next, page: { tab, lines: rows.map((r) => ({ date: text(r.date), member: text(r.member), type: text(r.type), amount: text(r.amount) })) } };
    case "activities": return { next, page: { tab, lines: rows.map((r) => ({ subject: text(r.subject), type: text(r.type), date: text(r.date), assigned: text(r.assigned) })) } };
    case "attachments": return { next, page: { tab, lines: rows.map((r) => ({ name: text(r.name), size: text(r.size), date: text(r.date), download: download(text(r.id), text(r.name)) })) } };
  }
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

export async function readDetailPage(ref: RecordRef, tab: RelatedPage["tab"], page: number, fresh: boolean, onDownloadError: () => void): Promise<RecordDetailPage> {
  const raw = await call(recordDetailPath(ref, { section: tab, page, fresh: fresh ? 1 : undefined }));
  return parseDetailPage(tab, raw, (id, name) => () => { void downloadAttachment(ref, id, name).catch(onDownloadError); });
}

export async function readFieldChoices(ref: RecordRef, field: RecordEditField, fresh: boolean): Promise<RecordChoice[]> {
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
