// Turns a permission ask (tool id + arguments) into words a person reads:
// "consulter l'horaire dans ConnectWise PSA · jcproulx, 2 oct. au 3 oct."
// with a risk level. The raw tool id and JSON stay available for the
// card's collapsed technical details; nothing here decides anything.
//
// One generator for every place an approval is shown: the web and desktop
// card word it in the person's language (src/lib/approval-describe.ts
// passes the app's catalog), and the server words the card's plain fields
// and the push notification with the English below (the server has no
// i18n; the phones read those fields). APPROVAL_EN mirrors
// src/locales/en.json exactly; a test holds them together.

import { connectorWriteKind, type ConnectorWriteKind } from "./engine-connectors.ts";

export type ApprovalTranslate = (key: string, vars?: Record<string, string | number>) => string;
export interface ApprovalWords {
  t: ApprovalTranslate;
  /** BCP 47 tag for dates and quotes */
  locale: string;
}

export const APPROVAL_EN: Readonly<Record<string, string>> = Object.freeze({
  "approval.card.allowTo": "Allow {name} to {action}?",
  "approval.card.allowToUnnamed": "Allow this bot to {action}?",
  "approval.connector.calendarCancel": "cancel a calendar event",
  "approval.connector.calendarInvite": "send a calendar invitation",
  "approval.connector.calendarRespond": "answer a calendar invitation",
  "approval.connector.filesWrite": "write to {store}",
  "approval.connector.mailAutoReply": "turn on an automatic reply",
  "approval.connector.mailSend": "send an email",
  "approval.connector.teamsChat": "start a Teams chat",
  "approval.connector.teamsPost": "post a message in Teams",
  "approval.line.destructive": "Deletes data.",
  "approval.line.destructiveIn": "Deletes data in {product}.",
  "approval.line.execute": "Runs an action.",
  "approval.line.executeIn": "Runs an action in {product}.",
  "approval.line.other": "Uses a tool.",
  "approval.line.otherIn": "Uses {product}.",
  "approval.line.read": "Only reads data. Nothing changes.",
  "approval.line.readIn": "Only reads data in {product}. Nothing changes.",
  "approval.line.write": "Makes changes.",
  "approval.line.writeIn": "Makes changes in {product}.",
  "approval.resource.activities": "activities",
  "approval.resource.activities.one": "an activity",
  "approval.resource.agreements": "agreements",
  "approval.resource.agreements.one": "an agreement",
  "approval.resource.alerts": "alerts",
  "approval.resource.alerts.one": "an alert",
  "approval.resource.calendar": "the calendar",
  "approval.resource.calendar.one": "an event",
  "approval.resource.companies": "companies",
  "approval.resource.companies.one": "a company",
  "approval.resource.configurations": "configurations",
  "approval.resource.configurations.one": "a configuration",
  "approval.resource.contacts": "contacts",
  "approval.resource.contacts.one": "a contact",
  "approval.resource.devices": "devices",
  "approval.resource.devices.one": "a device",
  "approval.resource.files": "files",
  "approval.resource.files.one": "a file",
  "approval.resource.invoices": "invoices",
  "approval.resource.invoices.one": "an invoice",
  "approval.resource.members": "members",
  "approval.resource.members.one": "a member",
  "approval.resource.messages": "messages",
  "approval.resource.messages.one": "a message",
  "approval.resource.notes": "notes",
  "approval.resource.notes.one": "a note",
  "approval.resource.opportunities": "opportunities",
  "approval.resource.opportunities.one": "an opportunity",
  "approval.resource.other": "{name}",
  "approval.resource.projects": "projects",
  "approval.resource.projects.one": "a project",
  "approval.resource.schedule": "the schedule",
  "approval.resource.schedule.one": "a schedule entry",
  "approval.resource.tickets": "tickets",
  "approval.resource.tickets.one": "a ticket",
  "approval.resource.timeEntries": "time entries",
  "approval.resource.timeEntries.one": "a time entry",
  "approval.resource.timesheets": "timesheets",
  "approval.resource.timesheets.one": "a timesheet",
  "approval.risk.destructive": "Destructive",
  "approval.risk.execute": "Runs an action",
  "approval.risk.read": "Read-only",
  "approval.risk.write": "Makes changes",
  "approval.rule.askBot": "Ask {target} for help",
  "approval.rule.delegateBot": "Hand work to {target}",
  "approval.rule.postToRoom": "Post in {target}",
  "approval.rule.tool": "{action}, with any details",
  "approval.summary.dateRange": "{from} to {to}",
  "approval.summary.more": "{who} and {count} more",
  "approval.summary.to": "to {who}",
  "approval.tool.action": "an action",
  "approval.tool.changeRoutine": "change a routine",
  "approval.tool.deleteFile": "delete a file",
  "approval.tool.editFile": "edit a file",
  "approval.tool.enableSkill": "enable a learned skill",
  "approval.tool.fetchWebPage": "fetch a web page",
  "approval.tool.readFile": "read a file",
  "approval.tool.runCommand": "run a command",
  "approval.tool.runCommandCloud": "run a command on your cloud computer",
  "approval.tool.runCommandComputer": "run a command on your computer",
  "approval.tool.scheduleRoutine": "schedule a routine",
  "approval.tool.searchWeb": "search the web",
  "approval.tool.takeAction": "take an action",
  "approval.tool.think": "think",
  "approval.tool.updateProfile": "update its profile",
  "approval.tool.updateSkill": "update a learned skill",
  "approval.tool.useTool": "use a tool",
  "approval.tool.writeFile": "write a file",
  "approval.verb.create": "create {resource}",
  "approval.verb.create.bare": "create a record",
  "approval.verb.delete": "delete {resource}",
  "approval.verb.delete.bare": "delete data",
  "approval.verb.read": "view {resource}",
  "approval.verb.read.bare": "read data",
  "approval.verb.run": "run the {resource} action",
  "approval.verb.run.bare": "run an action",
  "approval.verb.update": "change {resource}",
  "approval.verb.update.bare": "change data",
  "approval.verb.use": "use {name}",
"approval.phrase.inProduct": "{action} in {product}",
});

/** English, for the server. */
export const ENGLISH_WORDS: ApprovalWords = {
  locale: "en",
  t: (key, vars) => {
    const text = APPROVAL_EN[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
  },
};

export type ApprovalRisk = "read" | "write" | "destructive" | "execute";
type Operation = "read" | "create" | "update" | "delete" | "run";

export interface ToolHints {
  readOnly?: boolean;
  destructive?: boolean;
}

export interface ParsedToolId {
  /** the MCP server id, e.g. perspicax_pulsatrix_flow_jc */
  server?: string;
  /** the tool without its mcp__<server>__ prefix */
  name: string;
}

export interface ApprovalDescription {
  /** verb phrase that follows "wants to", e.g. "view the schedule" */
  action?: string;
  /** the product the tool acts on, e.g. "ConnectWise PSA" */
  product?: string;
  /** a short plain-language reading of the key arguments */
  summary?: string;
  risk?: ApprovalRisk;
  server?: string;
  /** the arguments as pretty JSON, when they are JSON */
  argsJson?: string;
  /** `action` is only the tool's own words (no known verb): "Allow X to
   * computer batch?" needs a verb, so approvalAction says "use …" */
  verbless?: boolean;
}

/** `mcp__<server>__<tool>` (Claude, Codex) or the engine's own
 * `<server>__<tool>` (Grok: perspicax_dispatch_agent__flow_action): the
 * server id may itself hold single underscores (perspicax_pulsatrix_flow_jc)
 * and the tool may hold double ones (cw_psa__query), so split on the first
 * `__` after the optional prefix. A name with spaces, or a built-in such as
 * Bash, is no MCP tool. */
export function parseToolId(tool: string): ParsedToolId {
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  if (!match) return { name: tool };
  return { server: match[1], name: match[2]! };
}

/** Servers that are the app itself: they name no product. */
const INTERNAL_SERVERS = new Set(["ogb", "sagax", "maus", "harness"]);

const PRODUCT_BY_PREFIX: Array<[RegExp, string, number]> = [
  // [tool-name prefix, product, tokens the prefix takes]
  [/^cw_psa(_|$)/, "ConnectWise PSA", 2],
  [/^cw_rmm(_|$)/, "ConnectWise RMM", 2],
  [/^cw_automate(_|$)/, "ConnectWise Automate", 2],
  [/^(sc|screenconnect)(_|$)/, "ScreenConnect", 1],
  [/^(m365|outlook|graph)(_|$)/, "Microsoft 365", 1],
  [/^bookstack(_|$)/, "BookStack", 1],
  [/^passportal(_|$)/, "Passportal", 1],
  [/^axcient(_|$)/, "Axcient", 1],
  [/^itglue(_|$)/, "IT Glue", 1],
];

const PRODUCT_BY_SERVER: Array<[RegExp, string]> = [
  [/connectwise|(^|_)cw(_|$)/i, "ConnectWise PSA"],
  [/microsoft_?365|outlook/i, "Microsoft 365"],
  [/screen_?connect/i, "ScreenConnect"],
  [/perspicax|pulsatrix/i, "Pulsatrix"],
];

const ACRONYMS = new Set(["psa", "rmm", "api", "mcp", "ai", "it", "id", "url", "cw", "sso", "vpn", "dns"]);

export function titleCase(words: string): string {
  return words
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** The product a tool acts on, from its name first (cw_psa_* is
 * ConnectWise PSA whichever server serves it), then its server's id. */
export function productFor(parsed: ParsedToolId): { product?: string; prefixTokens: number } {
  const lower = parsed.name.toLowerCase();
  for (const [prefix, product, tokens] of PRODUCT_BY_PREFIX) {
    if (prefix.test(lower)) return { product, prefixTokens: tokens };
  }
  const server = parsed.server;
  if (!server || INTERNAL_SERVERS.has(server.toLowerCase())) return { prefixTokens: 0 };
  for (const [pattern, product] of PRODUCT_BY_SERVER) {
    if (pattern.test(server)) return { product, prefixTokens: 0 };
  }
  // claude.ai connectors arrive as claude_ai_<Name>
  return { product: titleCase(server.replace(/^claude_ai_/i, "").replace(/^plugin_[^_]+_/i, "")), prefixTokens: 0 };
}

const VERBS: Array<[RegExp, Operation]> = [
  [/^(query|read|list|get|search|find|describe|fetch|show|view|lookup|count|browse|inspect|status)$/, "read"],
  [/^(create|add|new|post|insert|submit|open|book)$/, "create"],
  [/^(write|update|patch|put|set|edit|modify|upsert|assign|move|rename|change|close|merge)$/, "update"],
  [/^(delete|remove|destroy|purge|erase|drop|wipe|uninstall)$/, "delete"],
  [/^(action|run|execute|exec|invoke|trigger|start|stop|restart|reboot|send|call|isolate|kill)$/, "run"],
];

function operationOf(word: string | undefined): Operation | undefined {
  if (!word) return undefined;
  const lower = word.toLowerCase();
  for (const [pattern, op] of VERBS) if (pattern.test(lower)) return op;
  return undefined;
}

/** HTTP methods and free-form operation names in the arguments
 * (cw_psa__write { operation: "create" }, { method: "DELETE" }). */
function operationFromArgs(args: Record<string, unknown> | undefined): Operation | undefined {
  if (!args) return undefined;
  for (const key of ["operation", "method", "op", "verb", "mode", "action"]) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const upper = value.toUpperCase();
    if (upper === "GET") return "read";
    if (upper === "POST") return "create";
    if (upper === "PUT" || upper === "PATCH") return "update";
    if (upper === "DELETE") return "delete";
    const op = operationOf(value.split(/[\s_-]+/)[0]);
    if (op) return op;
  }
  return undefined;
}

const RESOURCES: Array<[RegExp, string]> = [
  [/^schedule(s|entr(y|ies))?$/, "schedule"],
  [/^time(entr(y|ies))?$/, "timeEntries"],
  [/^timesheets?$/, "timesheets"],
  [/^(service)?tickets?$/, "tickets"],
  [/^compan(y|ies)$/, "companies"],
  [/^contacts?$/, "contacts"],
  [/^projects?$/, "projects"],
  [/^agreements?$/, "agreements"],
  [/^invoices?$/, "invoices"],
  [/^members?$/, "members"],
  [/^configurations?$/, "configurations"],
  [/^opportunit(y|ies)$/, "opportunities"],
  [/^activit(y|ies)$/, "activities"],
  [/^notes?$/, "notes"],
  [/^(agents?|endpoints?|devices?)$/, "devices"],
  [/^(threats?|alerts?|incidents?)$/, "alerts"],
  [/^(mail|messages?|emails?)$/, "messages"],
  [/^(events?|calendar)$/, "calendar"],
  [/^(files?|documents?)$/, "files"],
];

function resourceKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // `service.notes`: the dot separates the module from the resource
  const clean = raw.toLowerCase().replace(/\./g, "/").replace(/[^a-z0-9/_ -]/g, "");
  const joined = clean.replace(/[/_ -]+/g, "");
  const last = clean.split(/[/_ -]+/).filter(Boolean).pop() ?? "";
  for (const candidate of [joined, last]) {
    for (const [pattern, key] of RESOURCES) if (pattern.test(candidate)) return key;
  }
  return undefined;
}

function resourcePhrase(raw: string | undefined, op: Operation, words: ApprovalWords): string | undefined {
  const key = resourceKey(raw);
  if (key) return words.t(`approval.resource.${key}${op === "create" ? ".one" : ""}`);
  if (!raw) return undefined;
  const text = raw.replace(/[/_-]+/g, " ").trim().toLowerCase();
  return text ? words.t("approval.resource.other", { name: text }) : undefined;
}

const OP_RISK: Record<Operation, ApprovalRisk> = {
  read: "read",
  create: "write",
  update: "write",
  delete: "destructive",
  run: "execute",
};

/** Built-in and ACP tool names that carry their own risk. */
const BUILTIN_RISK: Record<string, ApprovalRisk> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  WebFetch: "read",
  WebSearch: "read",
  read: "read",
  fetch: "read",
  search: "read",
  think: "read",
  Write: "write",
  Edit: "write",
  MultiEdit: "write",
  NotebookEdit: "write",
  edit: "write",
  Bash: "execute",
  shell: "execute",
  execute: "execute",
  delete: "destructive",
};

/** Annotations win when present (MCP readOnlyHint/destructiveHint);
 * otherwise the operation's own verb decides. */
export function riskFor(op: Operation | undefined, hints?: ToolHints, builtin?: ApprovalRisk): ApprovalRisk | undefined {
  if (hints?.destructive === true) return "destructive";
  if (hints?.readOnly === true) return "read";
  const guessed = builtin ?? (op ? OP_RISK[op] : undefined);
  if (hints?.readOnly === false && (!guessed || guessed === "read")) return "write";
  return guessed;
}

export function parseArgs(text: string | undefined): Record<string, unknown> | undefined {
  if (!text || !/^\s*\{/.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Is this card subtitle raw arguments (JSON), rather than a command,
 * URL or question a person can read as is? */
export function isTechnicalText(text: string | undefined): boolean {
  return Boolean(text && /^\s*[[{]/.test(text));
}

const PERSON_KEYS = /^(member|memberidentifier|member_identifier|owner|assignee|assignedto|user|username|technician|identifier|resource)$/i;
const PERSON_IN_TEXT = /(?:member|owner|assignee|resource|user)(?:\/|\.|_)?(?:identifier|name|id)?\s*(?:=|eq|==)\s*['"]([A-Za-z0-9._@-]{2,40})['"]/i;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g;

function findPerson(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PERSON_KEYS.test(key)) {
      if (typeof child === "string" && /^[A-Za-z0-9._@-]{2,40}$/.test(child) && !/^\d+$/.test(child)) return child;
      if (child && typeof child === "object") {
        const inner = (child as Record<string, unknown>).identifier ?? (child as Record<string, unknown>).name;
        if (typeof inner === "string" && inner.length <= 40) return inner;
      }
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findPerson(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Every date the arguments mention, read in the viewer's time zone
 * (ConnectWise sends UTC). A range's exclusive end at local midnight
 * ("dateStart < [2026-10-04T04:00:00Z]") counts as the day before. */
export function dateRange(text: string): { from: Date; to: Date } | undefined {
  const dates: Array<{ date: Date; midnight: boolean }> = [];
  for (const match of text.matchAll(ISO)) {
    const [, y, mo, d, h, mi, s, zone] = match;
    let date: Date;
    if (h === undefined) date = new Date(Number(y), Number(mo) - 1, Number(d));
    else if (zone) date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`);
    else date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
    if (Number.isNaN(date.getTime())) continue;
    dates.push({ date, midnight: h !== undefined && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 });
    if (dates.length > 20) break;
  }
  if (dates.length === 0) return undefined;
  dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const from = dates[0]!.date;
  let to = dates[dates.length - 1]!.date;
  if (dates.length > 1 && dates[dates.length - 1]!.midnight && to.getTime() > from.getTime()) {
    const before = new Date(to.getTime() - 1);
    if (before.getTime() >= from.getTime()) to = before;
  }
  return { from, to };
}

function formatDay(date: Date, withYear: boolean, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).format(date);
  } catch {
    return date.toDateString();
  }
}

export function formatDateRange(range: { from: Date; to: Date }, now = new Date(), words: ApprovalWords = ENGLISH_WORDS): string {
  const withYear = range.from.getFullYear() !== now.getFullYear() || range.to.getFullYear() !== now.getFullYear();
  const from = formatDay(range.from, withYear, words.locale);
  if (dayKey(range.from) === dayKey(range.to)) return from;
  return words.t("approval.summary.dateRange", { from, to: formatDay(range.to, withYear, words.locale) });
}

const NAME_KEYS = ["summary", "name", "title", "subject"];
const REF_KEYS = ["ticketId", "chargeToId", "ticket", "projectId", "companyId", "id"];

/** A short reading of the arguments: who, which record, when. Works on
 * truncated JSON too (old cards kept only 200 characters). */
export function summarizeArgs(args: Record<string, unknown> | undefined, text: string, now = new Date(), words: ApprovalWords = ENGLISH_WORDS): string | undefined {
  const parts: string[] = [];
  const person = findPerson(args) ?? PERSON_IN_TEXT.exec(text)?.[1];
  if (person) parts.push(person);
  const body = args && typeof args.body === "object" && args.body ? (args.body as Record<string, unknown>) : undefined;
  for (const source of [args, body]) {
    if (!source) continue;
    const name = NAME_KEYS.map((key) => source[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 80);
    if (name) {
      parts.push(words.locale.startsWith("fr") ? `« ${name.trim()} »` : `“${name.trim()}”`);
      break;
    }
  }
  for (const source of [args, body]) {
    if (!source) continue;
    const ref = REF_KEYS.map((key) => source[key]).find((value) => (typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && /^\d{1,10}$/.test(value)));
    if (ref !== undefined) {
      parts.push(`#${ref}`);
      break;
    }
  }
  const range = dateRange(text);
  if (range) parts.push(formatDateRange(range, now, words));
  return parts.length ? parts.join(", ") : undefined;
}

function prettyJson(args: Record<string, unknown> | undefined, text: string | undefined): string | undefined {
  if (args) return JSON.stringify(args, null, 2);
  return text && isTechnicalText(text) ? text : undefined;
}

/** "other-write" (an engine connector's call that names no known action)
 * keeps the generic wording; it still always asks. */
const CONNECTOR_ACTION: Record<Exclude<ConnectorWriteKind, "other-write">, string> = {
  "mail-send": "approval.connector.mailSend",
  "mail-auto-reply": "approval.connector.mailAutoReply",
  "teams-post": "approval.connector.teamsPost",
  "teams-chat": "approval.connector.teamsChat",
  "calendar-invite": "approval.connector.calendarInvite",
  "calendar-cancel": "approval.connector.calendarCancel",
  "calendar-respond": "approval.connector.calendarRespond",
  "files-write": "approval.connector.filesWrite",
};

const RECIPIENT_KEYS = ["to", "cc", "bcc", "toRecipients", "ccRecipients", "recipients", "attendees", "requiredAttendees", "optionalAttendees", "members", "participants", "emails"];
const SHOWN_RECIPIENTS = 3;

/** One recipient as a person reads it. The address always shows: a
 * display name is the sender's to choose ("Ana Tremblay (GOX)" can sit on
 * anyone's address), so it only ever comes beside the address, and a name
 * that itself looks like an address or a domain is dropped. */
function recipientName(value: unknown): string | undefined {
  const clean = (text: unknown) => (typeof text === "string" && text.trim() && text.length <= 120 ? text.trim().replace(/\s+/g, " ") : undefined);
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inner = record.emailAddress && typeof record.emailAddress === "object" ? record.emailAddress as Record<string, unknown> : undefined;
  const address = [record.email, record.address, inner?.address, record.mail, record.userPrincipalName].map(clean).find(Boolean);
  const name = [record.name, record.displayName, inner?.name].map(clean).find(Boolean);
  if (!address) return name ? `${name} (?)` : undefined;
  if (!name || name.toLowerCase() === address.toLowerCase() || /[@<>]|\b[\w-]+\.[a-z]{2,}\b/i.test(name)) return address;
  return `${name} <${address}>`;
}

/** "to Ana, bo@example.com and 2 more": who a mail, a post or an
 * invitation reaches, from the call's own arguments. */
function recipientsOf(args: Record<string, unknown> | undefined, words: ApprovalWords): string | undefined {
  if (!args) return undefined;
  const names: string[] = [];
  for (const key of RECIPIENT_KEYS) {
    const value = args[key];
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
    for (const item of list) {
      const name = recipientName(item);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  if (!names.length) return undefined;
  const shown = names.slice(0, SHOWN_RECIPIENTS).join(", ");
  const who = names.length > SHOWN_RECIPIENTS ? words.t("approval.summary.more", { who: shown, count: names.length - SHOWN_RECIPIENTS }) : shown;
  return words.t("approval.summary.to", { who });
}

/** The whole reading of one permission ask. `input` is the card's full
 * JSON when the server sent it, else its (maybe truncated) subtitle. */
export function describeApproval(
  tool: string | undefined,
  input: string | undefined,
  hints?: ToolHints,
  now = new Date(),
  words: ApprovalWords = ENGLISH_WORDS,
): ApprovalDescription {
  const text = input ?? "";
  const args = parseArgs(text);
  const argsJson = prettyJson(args, input);
  if (!tool) return { argsJson };
  const builtin = BUILTIN_RISK[tool];
  const parsed = parseToolId(tool);
  if (!parsed.server) {
    return { risk: riskFor(undefined, hints, builtin), argsJson };
  }
  const { product, prefixTokens } = productFor(parsed);
  // cw_psa_schedule__query → [cw, psa, schedule, query]; the product
  // prefix goes, the verb is the last word (or the first: list_sites).
  const tokens = parsed.name.split(/_+/).filter(Boolean).slice(prefixTokens);
  let op = operationOf(tokens[tokens.length - 1]);
  let rest = tokens.slice(0, -1);
  if (!op) {
    op = operationOf(tokens[0]);
    rest = tokens.slice(1);
  }
  // generic verbs (cw_psa__write, cw_psa__action) read the arguments
  const argsOp = operationFromArgs(args);
  if (argsOp && (op === undefined || op === "update" || op === "run") && (tokens.length <= 1 || rest.length === 0)) op = argsOp;
  const resourceRaw = rest.length
    ? rest.join(" ")
    : op === "run" && typeof args?.action === "string"
      ? args.action
      : typeof args?.resource === "string"
      ? args.resource
      : typeof args?.entity === "string"
        ? args.entity
        : typeof args?.action === "string" && op === "run"
          ? args.action
          : undefined;
  const risk = riskFor(op, hints, builtin);
  const summary = summarizeArgs(args, text, now, words);
  const connector = connectorWriteKind(tool);
  if (connector && connector !== "other-write") {
    const store = /onedrive/i.test(tool) ? "OneDrive" : "SharePoint";
    const action = words.t(CONNECTOR_ACTION[connector], { store });
    const who = recipientsOf(args, words);
    const joined = [summary, who].filter(Boolean).join(", ") || undefined;
    // a connector named for what it acts on (Grok's sharepoint, Microsoft
    // Teams): "write to SharePoint", not "write to SharePoint in Sharepoint"
    const last = product?.split(/\s+/).pop()?.toLowerCase();
    const named = Boolean(last && action.toLowerCase().includes(last));
    return { action, ...(product && !named ? { product } : {}), summary: joined, risk, server: parsed.server, argsJson };
  }
  if (!op) {
    // a tool named for itself (flow, memory): "use flow"
    return { action: tokens.join(" ") || parsed.name, verbless: true, product, summary, risk, server: parsed.server, argsJson };
  }
  // an action's name is not a record: "run the isolate action"
  const resource = op === "run"
    ? resourceRaw?.replace(/[/_-]+/g, " ").trim().toLowerCase() || undefined
    : resourcePhrase(resourceRaw, op, words);
  // run_command / exec_shell: "run a command", not "run the command action"
  // 2026-10-20 (JC): where it runs, in the person's words: their cloud
  // computer (sagax-environment), their own computer (sagax-desktop)
  const action = op === "run" && resource && RUN_COMMAND_NOUN.test(resource)
    ? words.t(parsed.server === "sagax-environment" ? "approval.tool.runCommandCloud" : parsed.server === "sagax-desktop" ? "approval.tool.runCommandComputer" : "approval.tool.runCommand")
    : resource
    ? words.t(`approval.verb.${op}`, { resource })
    : words.t(`approval.verb.${op}.bare`);
  return { action, product, summary, risk, server: parsed.server, argsJson };
}

export const RISK_LABEL: Record<ApprovalRisk, string> = {
  read: "approval.risk.read",
  write: "approval.risk.write",
  destructive: "approval.risk.destructive",
  execute: "approval.risk.execute",
};

// ---------------------------------------------------------------------------
// The words every surface shows: card title, the line under it, the push
// notification, the always-allow rule. Same inputs, same words, wherever.

/** A run tool whose object is a shell command (run_command, exec_shell). */
const RUN_COMMAND_NOUN = /^(?:shell |terminal |bash )?(?:command|commands|cmd|shell|bash|terminal)$/;

/** Built-in tools and ACP tool kinds as verb phrases (never "wants to
 * other"): an ACP driver can send the protocol's kind as the tool. */
const BUILTIN_ACTION: Record<string, string> = {
  Bash: "approval.tool.runCommand",
  Read: "approval.tool.readFile",
  Write: "approval.tool.writeFile",
  Edit: "approval.tool.editFile",
  WebFetch: "approval.tool.fetchWebPage",
  WebSearch: "approval.tool.searchWeb",
  schedule_routine: "approval.tool.scheduleRoutine",
  manage_routine: "approval.tool.changeRoutine",
  stage_skill: "approval.tool.enableSkill",
  update_skill: "approval.tool.updateSkill",
  update_profile: "approval.tool.updateProfile",
  shell: "approval.tool.runCommand",
  edit: "approval.tool.editFile",
  read: "approval.tool.readFile",
  fetch: "approval.tool.fetchWebPage",
  delete: "approval.tool.deleteFile",
  think: "approval.tool.think",
  other: "approval.tool.takeAction",
  tool: "approval.tool.useTool",
};

/** The verb phrase after "wants to" / "Allow X to": Bash is "run a
 * command", mcp__…__cw_psa_schedule__query is "view the schedule in
 * ConnectWise PSA". Never the raw tool id. */
export function approvalAction(tool: string | undefined, input: string | undefined, hints?: ToolHints, words: ApprovalWords = ENGLISH_WORDS, now = new Date()): string {
  if (!tool) return words.t("approval.tool.takeAction");
  const builtin = BUILTIN_ACTION[tool];
  if (builtin) return words.t(builtin);
  const { server, name } = parseToolId(tool);
  if (!server) return name.replace(/_/g, " ");
  const described = describeApproval(tool, input, hints, now, words);
  const action = described.action && described.verbless
    ? words.t("approval.verb.use", { name: described.action })
    : described.action ?? name.replace(/_+/g, " ");
  // Sagax's own built-in servers (sagax-environment, sagax-computer) are the
  // bot itself: "run a command", not "run a command in Sagax Environment"
  const builtinServer = server.startsWith("sagax-");
  return described.product && !builtinServer ? words.t("approval.phrase.inProduct", { action, product: described.product }) : action;
}

const capitalize = (text: string) => (text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text);
const sentence = (text: string) => (/[.!?…»”]$/.test(text) ? text : `${text}.`);
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export interface ApprovalPlain {
  /** "Allow Cryptic to run a command?" */
  title: string;
  /** "view the schedule in ConnectWise PSA": the action alone */
  action: string;
  /** one plain line: what exactly and where. Never a raw tool id or JSON. */
  line: string;
  risk?: ApprovalRisk;
}

/** The card's headline and line, and the push notification's title and
 * body: one function so they can never say different things.
 * `detail` is the card's readable subtitle (a command, a URL), used as the
 * line when it is not raw JSON or the tool id itself. */
export function approvalPlain(
  input: { botName?: string; tool?: string; toolInput?: string; detail?: string; hints?: ToolHints },
  words: ApprovalWords = ENGLISH_WORDS,
  now = new Date(),
): ApprovalPlain {
  const raw = input.toolInput ?? input.detail;
  const action = approvalAction(input.tool, raw, input.hints, words, now);
  const described = describeApproval(input.tool, raw, input.hints, now, words);
  const name = input.botName?.trim();
  const title = name ? words.t("approval.card.allowTo", { name, action }) : words.t("approval.card.allowToUnnamed", { action });
  const detail = input.detail?.trim() ?? "";
  // the subtitle is readable as is (a command, a URL, a question) unless it
  // is JSON or just repeats the tool's own id
  const parsed = input.tool ? parseToolId(input.tool) : undefined;
  const readable = detail && !isTechnicalText(detail) && detail !== input.tool && detail !== parsed?.name
    && !(parsed?.server && detail.startsWith(`${parsed.server}__`)) && !detail.startsWith("mcp__")
    ? detail : "";
  const risk = described.risk;
  // Sagax's own built-in servers are the bot itself: no "in Sagax Environment"
  const product = described.server?.startsWith("sagax-") ? undefined : described.product;
  const riskKey = risk ?? "other";
  const fallback = product ? words.t(`approval.line.${riskKey}In`, { product }) : words.t(`approval.line.${riskKey}`);
  const line = described.summary
    ? sentence(capitalize(oneLine(described.summary, 160)))
    : readable
      ? oneLine(readable, 160)
      : fallback;
  return { title, action, line, risk };
}

/** One always-allow rule (BotRecord.alwaysAllow) in plain words, for the
 * card's "Added to your Allow rules" row and the bot's settings. `nameOf`
 * turns a bot or room id into its name. */
export function describeAllowRule(key: string, words: ApprovalWords = ENGLISH_WORDS, nameOf?: (id: string) => string | undefined): string {
  const mcp = /^mcp:(.+)$/.exec(key);
  if (mcp) return words.t("approval.rule.tool", { action: capitalize(approvalAction(mcp[1], undefined, undefined, words)) });
  const peer = /^(ask_bot|delegate_bot|post_to_room):(.+)$/.exec(key);
  if (peer) {
    const target = nameOf?.(peer[2]!) ?? peer[2]!;
    const which = peer[1] === "ask_bot" ? "approval.rule.askBot" : peer[1] === "delegate_bot" ? "approval.rule.delegateBot" : "approval.rule.postToRoom";
    return words.t(which, { target });
  }
  return key;
}

/** The always-allow key for one MCP tool on one bot: this exact tool of
 * this exact server, any arguments. */
export function mcpAllowKey(mcpTool: string): string | undefined {
  const parsed = parseToolId(mcpTool);
  return parsed.server ? `mcp:${parsed.server}__${parsed.name}` : undefined;
}
