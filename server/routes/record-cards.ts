// Record cards (#4507): the card of one record a bot's message links to,
// read as the signed-in person:
//
//   GET /api/me/records/:product/:kind/:id[?lang=fr|en][&fresh=1]
//     -> 200 { card } | 200 { state, code?, retryAfter?, productState?, rule? }
//
// The read is the session's own person's, with their own sign-in token
// (server/perspicax/record-cards.ts): nothing in the request names a person,
// so nobody reads with another person's access. No approval card and no
// administrator: hovering a record is the person reading their own product.
// Only the organization's own rules apply, as for a bot's read of that
// product (shared/custom-rules.ts, rules marked `org`): a Refuse rule blocks
// the read (`org_refused`). An Ask first rule does not stop it: hovering or
// pinning a record reads it at once, with no button and no extra click
// (the owner's decision, #4566). Personal rules and a bot's rules are about
// bots and are not read here.
//
// The language is the request's (`lang`), else the person's app language.
// Every answer is `private, no-store`; nothing of a card is written anywhere.
//
// A write from the record window (M-20261127-101) is the person's own:
// `POST .../detail` with a field change (`{ field, value }`) or one action
// of shared/record-actions.ts (`{ action, id?, set }`: a note, a time entry,
// an expense, a planned entry, a configuration, an attachment). Both go
// through the organization's Refuse rules as a write of that product, then
// to the console, which writes as the person.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { RecordCardLanguage, RecordCardsClient } from "../perspicax/record-cards.ts";
import { factsForCall } from "../rules/custom-rules-review.ts";
import { evaluateCustomRules, type CustomRule } from "../../shared/custom-rules.ts";
import { RECORD_TITLE_FIELD, recordTitleValue, validRecordRef, type RecordRef } from "../../shared/record-cards.ts";
import { RECORD_FILE_BASE64_MAX, parseRecordAction, type RecordAction } from "../../shared/record-actions.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** A field change the route accepts: a field name, and either a title (one
 * line of 1 to 100 characters, trimmed) or the id of a choice. */
export function fieldChange(body: unknown): { field: string; value: string } | null {
  const raw = body as { field?: unknown; value?: unknown } | null | undefined;
  if (typeof raw?.field !== "string" || !/^[a-z]{1,32}$/.test(raw.field) || typeof raw.value !== "string") return null;
  if (raw.field === RECORD_TITLE_FIELD) {
    const value = recordTitleValue(raw.value);
    return value === null ? null : { field: raw.field, value };
  }
  return /^[1-9][0-9]*$/.test(raw.value) ? { field: raw.field, value: raw.value } : null;
}

/** A write of the record window: a field change, or one action. */
export type RecordWrite = { field: string; value: string } | RecordAction;

/** The most a write's body may be: an attachment's base64 and its few fields. */
export const RECORD_WRITE_BODY_MAX = RECORD_FILE_BASE64_MAX + 64 * 1024;

/** The write a body asks: a field change first, else an action. `recordKind` is the fiche's kind from the route (a ticket's note.add needs its kind). */
export function recordWrite(body: unknown, recordKind?: string): RecordWrite | null {
  return fieldChange(body) ?? parseRecordAction(body, recordKind);
}

/** The verb a rule reads for an action. */
function actionVerb(action: RecordAction): string {
  return action.action.endsWith(".add") ? "create" : action.action.endsWith(".remove") ? "delete" : "update";
}

/** The console's code of a refused detail call, kept so the app tells a
 * refused section from a route that is not there (M-20261119-084). */
function consoleCode(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : undefined;
}

export const RECORD_CARD_ROUTE = /^\/api\/me\/records\/([^/]{1,128})\/([^/]{1,128})\/([^/]{1,300})(\/detail)?$/;
const RECORD_DETAIL_WRITE_ROUTE = /^\/api\/me\/records\/([^/]{1,128})\/([^/]{1,128})\/([^/]{1,300})(\/detail)$/;

/** What a rule reads of a read or a write: the record, and for a write what it is, the entry it names and what it sets (a file by its name and size, never its bytes). */
export function recordRuleInput(ref: RecordRef, change?: RecordWrite): Record<string, unknown> {
  if (!change) return { kind: ref.kind, id: ref.id };
  if ("action" in change) {
    const { base64, ...set } = change.set ?? {};
    return { kind: ref.kind, id: ref.id, action: actionVerb(change), entry: change.action, ...(change.id ? { entryId: change.id } : {}), set: { ...set, ...(typeof base64 === "string" ? { bytes: Math.floor(base64.length * 3 / 4) } : {}) } };
  }
  // the title is written as text, every other field as the id of a choice
  return { kind: ref.kind, id: ref.id, action: "update", set: { [change.field]: change.field === RECORD_TITLE_FIELD ? change.value : { id: change.value } } };
}

/** The organization's decision on a person's read of one record. */
export type RecordReadRule = { kind: "none" } | { kind: "deny"; rule: { id: string; text: string } };

/**
 * The organization's Refuse rules for a person's read of one record (an Ask
 * first rule never reaches this read, so it can not hide a Refuse): the facts of the read a bot makes of that product (its query tool,
 * read only), with the product named by its id and its name. Only enabled
 * organization rules count.
 */
export function recordReadOrgRule(rules: readonly CustomRule[], ref: RecordRef, productName?: string, home?: string, change?: RecordWrite): RecordReadRule {
  const org = rules.filter((rule) => rule.org === true && rule.enabled && rule.behavior === "deny");
  if (!org.length) return { kind: "none" };
  const tool = `${ref.product}_${change ? "tickets_write" : "query"}`;
  const facts = factsForCall({ tool, mcpTool: `mcp__perspicax__${tool}`, input: JSON.stringify(recordRuleInput(ref, change)), hints: { readOnly: !change } }, home);
  if (!facts.products.includes(ref.product)) facts.products.push(ref.product);
  const decision = evaluateCustomRules(org, facts, {
    products: [{ id: ref.product, ...(productName ? { name: productName } : {}) }],
    startedBy: "person",
    ...(home ? { home } : {}),
  });
  return decision.kind === "deny" ? { kind: "deny", rule: { id: decision.rule.id, text: decision.rule.when } } : { kind: "none" };
}

export interface RecordCardsRouteDeps {
  /** A server signed in with the organization console and linked to it. */
  organization(): boolean;
  /** The session's own person, or null. */
  person(auth: RequestAuth): { principalId: string } | null;
  /** The person's live sign-in access token (never logged). */
  subjectToken(principalId: string): Promise<string | null>;
  client: RecordCardsClient;
  /** The organization's rule on this read or write (recordReadOrgRule). */
  orgRule(principalId: string, subjectToken: string, ref: RecordRef, change?: RecordWrite): Promise<RecordReadRule> | RecordReadRule;
  /** The person's app language. */
  language(auth: RequestAuth): string;
}

export function recordCardLanguage(asked: string | null, fallback: string): RecordCardLanguage {
  const wanted = (asked ?? fallback ?? "").trim().toLowerCase();
  return wanted.startsWith("fr") ? "fr" : "en";
}

export function createRecordCardsRoutes(deps: RecordCardsRouteDeps): RouteHandler {
  return async ({ req, readBody, res, url, path, method, auth, json }) => {
    const match = method === "GET" ? RECORD_CARD_ROUTE.exec(path)
      : method === "POST" ? RECORD_DETAIL_WRITE_ROUTE.exec(path) : null;
    if (!match) return PASS;
    const detail = Boolean(match[4]);
    const send = (status: number, body: unknown) => {
      res.setHeader("cache-control", "private, no-store");
      return json(res, status, body);
    };
    let ref: RecordRef;
    try {
      ref = { product: decodeURIComponent(match[1]!), kind: decodeURIComponent(match[2]!), id: decodeURIComponent(match[3]!) };
    } catch {
      return send(400, { error: "not a record link" });
    }
    if (!validRecordRef(ref)) return send(400, { error: "not a record link" });
    if (!deps.organization()) return send(detail ? 404 : 200, { state: "unavailable" });
    const person = deps.person(auth);
    if (!person) return send(detail ? 403 : 200, { state: "unavailable" });
    const token = await deps.subjectToken(person.principalId);
    if (!token) return send(detail ? 403 : 200, { state: "sign_in" });
    let change: RecordWrite | undefined;
    if (method === "POST") {
      let body;
      try { body = await readBody(req, RECORD_WRITE_BODY_MAX); } catch { return send(400, { error: "invalid field change" }); }
      const asked = recordWrite(body, ref.kind);
      if (!asked) return send(400, { error: "invalid field change" });
      change = asked;
    }
    const rule = await deps.orgRule(person.principalId, token, ref, change);
    if (rule.kind === "deny") return send(detail ? 403 : 200, { state: "org_refused", rule: rule.rule });
    const lang = recordCardLanguage(url.searchParams.get("lang"), deps.language(auth));
    if (detail) {
      const query = new URLSearchParams({ lang });
      for (const key of ["section", "field", "page", "fresh"]) {
        const value = url.searchParams.get(key);
        if (value !== null) query.set(key, value);
      }
      const result = await deps.client.detail(token, ref, query, change);
      if (result.ok) return send(200, result.body);
      const code = consoleCode(result.body);
      return send(result.status && result.status >= 400 ? result.status : 502, { state: "unavailable", ...(code ? { code } : {}) });
    }
    const read = await deps.client.get(person.principalId, token, ref, lang, url.searchParams.get("fresh") === "1");
    if (read.ok) return send(200, { card: read.card });
    const { ok: _ok, ...miss } = read;
    return send(200, miss);
  };
}
