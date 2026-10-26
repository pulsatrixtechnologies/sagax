// The Approvals screen's data (2026-10-19, shared/approvals-inbox.ts):
//
//   GET  /api/approvals          { pending, history, scopes } for this person
//                                (history only with ?history=1)
//   POST /api/approvals/bulk     { decision: "allow" | "deny", items: [{ threadId, requestId }] }
//
// The list and the answers come from server/index.ts (deps below): the same
// cards, owners, refusals and security-key gate as answering one card in a
// conversation. A bulk answer is a plain Allow once or Deny, nothing more:
// a body that tries to remember anything else (always, a command, a
// step-up) is refused whole; `rule: "allow"` keeps each card's own Always
// allow (2026-10-19), and the server decides again, card by card,
// which ones a bulk answer may cover (bulkPlan): never a question, a
// proposal, a card in a confidential thread, a card someone else answers,
// nor an Allow that needs a security key.
import {
  bulkPlan,
  INBOX_BULK_MAX,
  inboxKey,
  type InboxApproval,
  type InboxBulkRefusal,
  type InboxPayload,
} from "../../shared/approvals-inbox.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { liveDecisionRefusal } from "../../shared/live-approval.ts";
import { approvalTypeOf } from "../approval-type.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface InboxViewer {
  principalId: string;
}

export type InboxAnswer = { ok: true } | { ok: false; status: number; code: string; message: string };

export interface ApprovalsInboxDeps {
  /** The person asking, or null when no person is (a local service, a
   * bot's act session, an AI client): they get nothing here. */
  viewer(auth: RequestAuth): InboxViewer | null;
  /** Every card this person sees on the screen, decidable or not. */
  pending(auth: RequestAuth, viewer: InboxViewer): InboxApproval[];
  history(auth: RequestAuth, viewer: InboxViewer): InboxPayload["history"];
  scopes(auth: RequestAuth, viewer: InboxViewer): InboxPayload["scopes"];
  /** Answer one card, allow or deny, as this person; `rule` "allow" also
   * keeps that card's own Always allow (its exact scope). */
  answer(auth: RequestAuth, item: { threadId: string; requestId: string }, decision: "allow" | "deny", rule?: "allow"): Promise<InboxAnswer>;
}

/** A card answered on its own only, never in a bulk answer: a send in the
 * person's name (outboundRequest, "Send as you?"), an admin's card, a bot
 * act, a team memory, a terminal, a meeting, anything that is not a plain
 * tool card or that a spoken answer could not settle either
 * (liveDecisionRefusal). */
export function inboxSpecialCard(card: OptionCardData): boolean {
  return Boolean(card.outboundRequest || card.adminApproval || card.heldCode || card.botActRequest || card.cwActionRequest || card.emailSendRequest
    || card.teamMemoryRequest || card.confidentialMemoryRequest || card.terminalRequest || card.meetingRequest
    || card.routineRequest || card.skillRequest || (card as { tighteningRequest?: unknown }).tighteningRequest
    || approvalTypeOf(card) !== "tool" || liveDecisionRefusal(card));
}

/** Fields a single card's answer may carry and a bulk answer never does.
 * 2026-10-19 (JC): `rule: "allow"` is the one widening a bulk Allow takes:
 * each card keeps its own Always allow, its exact scope, never a wider one. */
const WIDENING_FIELDS = ["always", "alwaysAllow", "rememberCommand", "stepUp", "message", "autoApprove", "refreshPermissions"] as const;
const ID = /^[\w-]{1,120}$/;
const REQUEST_ID = /^[\w:.-]{1,200}$/;

export type BulkResult =
  | { key: string; ok: true }
  | { key: string; ok: false; code: InboxBulkRefusal | "gone" | string; message?: string };

export function createApprovalsInboxRoutes(deps: ApprovalsInboxDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/approvals") {
      const viewer = deps.viewer(auth);
      if (!viewer) return json(res, 403, { error: "Sign in to see your approvals.", code: "no_person" });
      res.setHeader("cache-control", "no-store");
      const payload: InboxPayload = {
        pending: deps.pending(auth, viewer),
        // the answered cards are read from the log only when asked for
        history: url.searchParams.get("history") === "1" ? deps.history(auth, viewer) : [],
        scopes: deps.scopes(auth, viewer),
      };
      return json(res, 200, payload);
    }

    if (!(method === "POST" && path === "/api/approvals/bulk")) return PASS;
    const viewer = deps.viewer(auth);
    if (!viewer) return json(res, 403, { error: "Sign in to answer approvals.", code: "no_person" });
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "body must be a JSON object" });
    const record = body as Record<string, unknown>;
    // never "always" in bulk but each card's own Always allow (rule), which keeps that card's exact scope
    const widening = WIDENING_FIELDS.find((field) => record[field] !== undefined);
    if (widening) return json(res, 400, { error: `A bulk answer is Allow once or Deny only (${widening} is answered one card at a time).`, code: "bulk_once_only" });
    const decision = record.decision;
    if (decision !== "allow" && decision !== "deny") return json(res, 400, { error: "decision must be allow or deny" });
    if (record.rule !== undefined && !(record.rule === "allow" && decision === "allow")) {
      return json(res, 400, { error: "A bulk answer keeps Always allow only, with Allow.", code: "bulk_once_only" });
    }
    const rule = record.rule === "allow" ? "allow" as const : undefined;
    const items = record.items;
    if (!Array.isArray(items) || items.length === 0) return json(res, 400, { error: "items must list at least one approval" });
    if (items.length > INBOX_BULK_MAX) return json(res, 400, { error: `At most ${INBOX_BULK_MAX} approvals at once.` });
    const wanted: Array<{ threadId: string; requestId: string }> = [];
    for (const item of items) {
      const row = item as { threadId?: unknown; requestId?: unknown } | null;
      if (!row || typeof row.threadId !== "string" || typeof row.requestId !== "string" || !ID.test(row.threadId) || !REQUEST_ID.test(row.requestId)) {
        return json(res, 400, { error: "each item needs a threadId and a requestId" });
      }
      wanted.push({ threadId: row.threadId, requestId: row.requestId });
    }

    // What the screen showed is not trusted: plan again from the live cards.
    const live = new Map(deps.pending(auth, viewer).map((entry) => [entry.key, entry]));
    const results: BulkResult[] = [];
    const selected: InboxApproval[] = [];
    const seen = new Set<string>();
    for (const item of wanted) {
      const key = inboxKey(item.threadId, item.requestId);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = live.get(key);
      if (!entry) results.push({ key, ok: false, code: "gone" });
      else selected.push(entry);
    }
    const plan = bulkPlan(selected, decision);
    // 2026-10-20 (security review): a bulk Always allow is the same action on
    // targets of the same type, each card with its own rule, or nothing
    if (rule) {
      const kinds = new Set(plan.answered.map((entry) => entry.alwaysKind ?? ""));
      if (kinds.has("") || kinds.size > 1) {
        return json(res, 409, { error: "A bulk Always allow takes the same action on targets of the same type only, each card with its own Always allow.", code: "bulk_mixed" });
      }
    }
    for (const { entry, reason } of plan.skipped) results.push({ key: entry.key, ok: false, code: reason });
    // One after the other, never in parallel: each answer settles its card
    // (and may resume a turn) before the next one is looked at.
    for (const entry of plan.answered) {
      const answer = await deps.answer(auth, { threadId: entry.threadId, requestId: entry.requestId }, decision, rule);
      results.push(answer.ok ? { key: entry.key, ok: true } : { key: entry.key, ok: false, code: answer.code, message: answer.message });
    }
    const answered = results.filter((result) => result.ok).length;
    return json(res, 200, { decision, answered, results });
  };
}
