// Map a ConnectWise PSA tool call (the tool's name, its arguments and its
// result) to a widget. Pure: the server calls it when a call completes, the
// tests call it with recorded results. A call that is not ConnectWise, or a
// result this module cannot read, maps to nothing and the chat shows the
// ordinary tool row.

import {
  CW_MAX_RECORDS,
  CW_WIDGET_VERSION,
  type CwAgreement,
  type CwCompany,
  type CwScheduleEntry,
  type CwSite,
  type CwRecordOf,
  type CwTicket,
  type CwTicketNote,
  type CwTimeEntry,
  type CwWidget,
} from "./types.ts";
import { id, isRecord, num, type CwRecord } from "./read.ts";
import { siteFromRecord } from "./links.ts";
import { looksLikeNote, looksLikeTicket, noteFrom, orderNotes, ticketFrom, ticketIdOfNote } from "./ticket.ts";
import { looksLikeTime, timeFrom } from "./time.ts";
import { looksLikeSchedule, scheduleFrom } from "./schedule.ts";
import { agreementFrom, looksLikeAgreement } from "./agreement.ts";
import { companyFrom, looksLikeCompany } from "./company.ts";

/** The ConnectWise words of a tool's name, from the `cw_psa` prefix on
 * (`mcp__perspicax_x__cw_psa_schedule__query` → cw, psa, schedule, query),
 * or every word of a tool on a ConnectWise server. Null for anything else. */
export function cwToolWords(toolName: string): string[] | null {
  const name = toolName.trim().toLowerCase();
  const at = name.search(/(?:^|_)cw_psa(?:_|$)/);
  if (at >= 0) {
    const from = name.startsWith("cw_psa") ? 0 : at + 1;
    return name.slice(from).split(/_+/).filter(Boolean);
  }
  const server = /^(?:mcp__)?([a-z0-9_.-]*?connectwise[a-z0-9_.-]*?)__([a-z0-9_.-]+)$/.exec(name);
  if (server) return ["cw", "psa", ...server[2]!.split(/_+/).filter(Boolean)];
  return null;
}

export function isCwTool(toolName: string): boolean {
  return cwToolWords(toolName) !== null;
}

/** A Perspicax view tool (`cw_psa__show_<view>`): served only when the
 * person's profile has "Vues interactives" on, and called only when a view
 * was wanted. The one ConnectWise call whose result is drawn as a widget on
 * its tool row; any other call stays an ordinary row and the bot answers in
 * text (JC 2026-10-20: vues CW seulement sur demande). */
export function isCwViewTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const words = cwToolWords(toolName);
  return words !== null && words[0] === "cw" && words[1] === "psa" && words[2] === "show";
}

/** The widget a stored tool row may draw: only a view tool's. Rows written
 * before 2026-10-20 carry a widget on every ConnectWise read; they stay
 * rows. */
export function shownCwWidget<W>(tool: { name?: string; widget?: W } | undefined): W | undefined {
  return tool?.widget && isCwViewTool(tool.name) ? tool.widget : undefined;
}

const READ_WORDS = new Set(["query", "get", "list", "search", "find", "read", "count", "fetch", "lookup"]);
const WRITE_WORDS = new Set([
  "write", "create", "update", "patch", "delete", "remove", "add", "log", "book", "action", "post", "put", "set", "close", "assign",
]);

/** A ConnectWise call that may change a record. A name that says neither
 * (a bare `cw_psa__ticket`) counts as a change: the gate stays closed. */
export function isCwWriteTool(toolName: string): boolean {
  const words = cwToolWords(toolName);
  if (!words) return false;
  if (words.some((word) => WRITE_WORDS.has(word))) return true;
  return !words.some((word) => READ_WORDS.has(word));
}

type Family = CwWidget["family"] | "ticketNotes";

interface CallShape {
  resource?: string;
  /** a record id the call names (the input's `id`, or one in the path) */
  recordId?: number;
  /** ticket notes: the ticket they belong to */
  parentId?: number;
  family?: Family;
}

const RESOURCE_FAMILIES: Array<[RegExp, Family]> = [
  [/^(?:service|project)\/tickets\/\d+\/(?:notes|allnotes)(?:\/|$)/, "ticketNotes"],
  [/^(?:service|project)\/tickets(?:\/|$)/, "ticket"],
  [/^time\/entries(?:\/|$)/, "time"],
  [/^schedule\/entries(?:\/|$)/, "schedule"],
  [/^finance\/agreements(?:\/|$)/, "agreement"],
  [/^company\/companies(?:\/|$)/, "company"],
];

const NAME_FAMILIES: Array<[RegExp, Family]> = [
  [/^notes?$/, "ticketNotes"],
  [/^tickets?$/, "ticket"],
  [/^times?$/, "time"],
  [/^schedules?$/, "schedule"],
  [/^agreements?$/, "agreement"],
  [/^compan(?:y|ies)$/, "company"],
];

function normalizeResource(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/+/, "")
    .replace(/^v4_6_release\/apis\/3\.0\//, "")
    .replace(/\?.*$/, "");
}

/** The call's arguments, from the display preview the server keeps (JSON,
 * possibly cut short): what can be read is read, nothing is guessed. */
export function callShape(toolName: string, inputPreview: string | undefined): CallShape {
  const shape: CallShape = {};
  let input: CwRecord | undefined;
  if (inputPreview) {
    try {
      const parsed = JSON.parse(inputPreview) as unknown;
      if (isRecord(parsed)) input = parsed;
    } catch {
      // cut short: read the fields one by one below
    }
  }
  const resource = input && typeof input.resource === "string"
    ? input.resource
    : inputPreview ? /"(?:resource|endpoint|path)"\s*:\s*"([^"]{1,200})"/.exec(inputPreview)?.[1] : undefined;
  if (resource) shape.resource = normalizeResource(resource);
  const inputId = input
    ? id(input, "id", "ticketId", "recordId")
    : inputPreview ? Number(/"(?:id|ticketId|recordId)"\s*:\s*"?(\d{1,12})"?/.exec(inputPreview)?.[1] ?? Number.NaN) : undefined;
  if (inputId && Number.isInteger(inputId) && inputId > 0) shape.recordId = inputId;
  if (shape.resource) {
    for (const [pattern, family] of RESOURCE_FAMILIES) {
      if (pattern.test(shape.resource)) { shape.family = family; break; }
    }
    const pathId = /^[a-z]+\/[a-z]+\/(\d+)(?:\/|$)/.exec(shape.resource)?.[1];
    if (pathId) {
      if (shape.family === "ticketNotes") shape.parentId = Number(pathId);
      else shape.recordId ??= Number(pathId);
    }
  }
  if (!shape.family) {
    const words = cwToolWords(toolName) ?? [];
    for (const word of words.slice(2)) {
      const match = NAME_FAMILIES.find(([pattern]) => pattern.test(word));
      if (match) { shape.family = match[1]; break; }
    }
  }
  if (shape.family === "ticketNotes" && !shape.parentId && shape.recordId && !shape.resource) {
    shape.parentId = shape.recordId;
  }
  return shape;
}

const WRAPPER_KEYS = ["result", "results", "data", "items", "records", "value", "rows", "tickets", "notes", "entries", "companies", "agreements"];

interface Parsed {
  records: CwRecord[];
  total?: number;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    if (start < 0) return undefined;
    const close = trimmed[start] === "[" ? "]" : "}";
    const end = trimmed.lastIndexOf(close);
    if (end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

/** MCP content blocks (`[{ type: "text", text }]`, `{ content: [...] }`)
 * hold the tool's own text; a structured result wins over the text. */
function unwrapContent(value: unknown, depth = 0): unknown {
  if (depth > 3) return value;
  if (isRecord(value)) {
    if (value.structuredContent !== undefined) return unwrapContent(value.structuredContent, depth + 1);
    if (value.structured_content !== undefined) return unwrapContent(value.structured_content, depth + 1);
    if (Array.isArray(value.content)) return unwrapContent(value.content, depth + 1);
  }
  if (Array.isArray(value) && value.length > 0 && value.every((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")) {
    const joined = (value as Array<{ text: string }>).map((block) => block.text).join("\n");
    const inner = parseJson(joined);
    return inner === undefined ? value : unwrapContent(inner, depth + 1);
  }
  if (typeof value === "string") {
    const inner = parseJson(value);
    return inner === undefined ? value : unwrapContent(inner, depth + 1);
  }
  return value;
}

export function parseCwResult(resultText: string | undefined): Parsed | null {
  if (!resultText) return null;
  let value = unwrapContent(parseJson(resultText));
  let total: number | undefined;
  for (let depth = 0; depth < 3 && isRecord(value); depth += 1) {
    const record: CwRecord = value;
    const key = WRAPPER_KEYS.find((name) => Array.isArray(record[name]) || isRecord(record[name]));
    if (!key || (typeof record.id === "number" && !Array.isArray(record[key]))) break;
    total ??= num(record, "total", "totalCount", "count", "totalRecords");
    value = unwrapContent(record[key]);
  }
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    if (records.length !== value.length) return null;
    return { records, ...(total !== undefined ? { total } : {}) };
  }
  if (isRecord(value)) return { records: [value], ...(total !== undefined ? { total } : {}) };
  return null;
}

export interface CwWidgetOptions {
  /** The site deep links open, when the server knows it. */
  site?: CwSite;
}

function siteOf(records: CwRecord[], options: CwWidgetOptions): CwSite | undefined {
  if (options.site) return options.site;
  for (const record of records.slice(0, 5)) {
    const site = siteFromRecord(record);
    if (site) return site;
  }
  return undefined;
}

function finish(widget: CwWidget, total: number | undefined, recordCount: number): CwWidget {
  if (total !== undefined && total > widget.records.length) widget.total = total;
  else if (recordCount > widget.records.length) widget.total = recordCount;
  return widget;
}

function familyOfRecords(records: CwRecord[]): Family | undefined {
  const sample = records.slice(0, 5);
  if (sample.every(looksLikeTicket)) return "ticket";
  if (sample.every(looksLikeNote)) return "ticketNotes";
  if (sample.every(looksLikeTime)) return "time";
  if (sample.every(looksLikeSchedule)) return "schedule";
  if (sample.every(looksLikeAgreement)) return "agreement";
  if (sample.every(looksLikeCompany)) return "company";
  return undefined;
}

function noteWidget(records: CwRecord[], parentId: number | undefined, site: CwSite | undefined): CwWidget | null {
  const notes: CwTicketNote[] = [];
  let ticketId = parentId;
  for (const record of records) {
    const note = noteFrom(record);
    if (!note) continue;
    ticketId ??= ticketIdOfNote(record);
    notes.push(note);
  }
  if (!ticketId || notes.length === 0) return null;
  const ticket = ticketFrom({ id: ticketId, summary: "" }, site) ?? { id: ticketId, summary: "" };
  ticket.notes = orderNotes(notes);
  return { v: CW_WIDGET_VERSION, family: "ticket", view: "card", records: [ticket], ...(site ? { site } : {}) };
}

/** The widget for one completed ConnectWise call, or null. */
export function cwWidgetFromToolCall(
  toolName: string,
  inputPreview: string | undefined,
  resultText: string | undefined,
  options: CwWidgetOptions = {},
): CwWidget | null {
  if (!isCwTool(toolName)) return null;
  const parsed = parseCwResult(resultText);
  if (!parsed || parsed.records.length === 0) return null;
  const shape = callShape(toolName, inputPreview);
  const fromRecords = familyOfRecords(parsed.records);
  // What the records are wins over what the call asked for: a write that
  // answers with the ticket draws the ticket.
  const family = fromRecords ?? (shape.family === "ticketNotes" ? "ticketNotes" : undefined);
  const site = siteOf(parsed.records, options);
  if (family === "ticketNotes") return noteWidget(parsed.records, shape.parentId, site);
  if (family === "ticket") {
    const tickets = parsed.records.slice(0, CW_MAX_RECORDS)
      .map((record) => ticketFrom(record, site))
      .filter((ticket): ticket is CwTicket => Boolean(ticket));
    if (tickets.length === 0) return null;
    const single = tickets.length === 1 && (parsed.total === undefined || parsed.total <= 1);
    return finish(
      { v: CW_WIDGET_VERSION, family: "ticket", view: single ? "card" : "list", records: tickets, ...(site ? { site } : {}) },
      parsed.total,
      parsed.records.length,
    );
  }
  if (family === "time" || shape.family === "time") {
    const records = parsed.records.slice(0, CW_MAX_RECORDS)
      .map((record) => timeFrom(record, site))
      .filter((entry): entry is CwTimeEntry => Boolean(entry));
    return listWidget("time", records, site, parsed);
  }
  if (family === "schedule" || shape.family === "schedule") {
    const records = parsed.records.slice(0, CW_MAX_RECORDS)
      .map((record) => scheduleFrom(record, site))
      .filter((entry): entry is CwScheduleEntry => Boolean(entry));
    return listWidget("schedule", records, site, parsed);
  }
  if (family === "agreement" || shape.family === "agreement") {
    const records = parsed.records.slice(0, CW_MAX_RECORDS)
      .map((record) => agreementFrom(record, site))
      .filter((entry): entry is CwAgreement => Boolean(entry));
    return listWidget("agreement", records, site, parsed);
  }
  if (family === "company" || shape.family === "company") {
    const records = parsed.records.slice(0, CW_MAX_RECORDS)
      .map((record) => companyFrom(record, site))
      .filter((entry): entry is CwCompany => Boolean(entry));
    return listWidget("company", records, site, parsed);
  }
  return null;
}

function listWidget<F extends "time" | "schedule" | "agreement" | "company">(
  family: F,
  records: CwRecordOf<F>[],
  site: CwSite | undefined,
  parsed: Parsed,
): CwWidget | null {
  if (records.length === 0) return null;
  const single = records.length === 1 && (parsed.total === undefined || parsed.total <= 1);
  return finish(
    { v: CW_WIDGET_VERSION, family, view: single ? "card" : "list", records, ...(site ? { site } : {}) } as CwWidget,
    parsed.total,
    parsed.records.length,
  );
}

/** A tool's result as text, for the mapper: a string as is, anything else
 * as JSON. Bounded: a result past `max` is not a widget anyone reads. */
export function cwResultText(value: unknown, max = 2_000_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return text && text.length <= max ? text : undefined;
}
