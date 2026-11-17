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
import type { RequestAuth } from "../auth/request-auth.ts";
import type { RecordCardLanguage, RecordCardsClient } from "../perspicax/record-cards.ts";
import { factsForCall } from "../rules/custom-rules-review.ts";
import { evaluateCustomRules, type CustomRule } from "../../shared/custom-rules.ts";
import { validRecordRef, type RecordCardAnswer, type RecordRef } from "../../shared/record-cards.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const RECORD_CARD_ROUTE = /^\/api\/me\/records\/([^/]{1,128})\/([^/]{1,128})\/([^/]{1,300})$/;

/** The organization's decision on a person's read of one record. */
export type RecordReadRule = { kind: "none" } | { kind: "deny"; rule: { id: string; text: string } };

/**
 * The organization's Refuse rules for a person's read of one record (an Ask
 * first rule never reaches this read, so it can not hide a Refuse): the facts of the read a bot makes of that product (its query tool,
 * read only), with the product named by its id and its name. Only enabled
 * organization rules count.
 */
export function recordReadOrgRule(rules: readonly CustomRule[], ref: RecordRef, productName?: string, home?: string): RecordReadRule {
  const org = rules.filter((rule) => rule.org === true && rule.enabled && rule.behavior === "deny");
  if (!org.length) return { kind: "none" };
  const tool = `${ref.product}_query`;
  const facts = factsForCall({ tool, mcpTool: `mcp__perspicax__${tool}`, input: JSON.stringify({ kind: ref.kind, id: ref.id }), hints: { readOnly: true } }, home);
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
  /** The organization's rule on this read (recordReadOrgRule). */
  orgRule(principalId: string, subjectToken: string, ref: RecordRef): Promise<RecordReadRule> | RecordReadRule;
  /** The person's app language. */
  language(auth: RequestAuth): string;
}

export function recordCardLanguage(asked: string | null, fallback: string): RecordCardLanguage {
  const wanted = (asked ?? fallback ?? "").trim().toLowerCase();
  return wanted.startsWith("fr") ? "fr" : "en";
}

export function createRecordCardsRoutes(deps: RecordCardsRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    if (method !== "GET") return PASS;
    const match = RECORD_CARD_ROUTE.exec(path);
    if (!match) return PASS;
    const send = (status: number, body: RecordCardAnswer | { error: string }) => {
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
    if (!deps.organization()) return send(200, { state: "unavailable" });
    const person = deps.person(auth);
    if (!person) return send(200, { state: "unavailable" });
    const token = await deps.subjectToken(person.principalId);
    if (!token) return send(200, { state: "sign_in" });
    const rule = await deps.orgRule(person.principalId, token, ref);
    if (rule.kind === "deny") return send(200, { state: "org_refused", rule: rule.rule });
    const lang = recordCardLanguage(url.searchParams.get("lang"), deps.language(auth));
    const read = await deps.client.get(person.principalId, token, ref, lang, url.searchParams.get("fresh") === "1");
    if (read.ok) return send(200, { card: read.card });
    const { ok: _ok, ...miss } = read;
    return send(200, miss);
  };
}
