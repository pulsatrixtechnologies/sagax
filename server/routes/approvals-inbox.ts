// The Approvals screen's data (2026-10-19, shared/approvals-inbox.ts):
//
//   GET  /api/approvals          { pending, history, scopes } for this person
//                                (history only with ?history=1; with
//                                ?waiting=1, `waiting`: what waits on the
//                                person, shared/waiting-items.ts, one bot's
//                                with &botId=, #3512)
//   POST /api/approvals/bulk     { decision: "allow" | "deny", items: [{ threadId, requestId }] }
//   GET  /api/approvals/journal  ?days=7|30: the Journal, every action of
//                                this person's own bots with what decided it
//                                (2026-10-26, shared/action-journal.ts)
//   POST /api/approvals/handled { botId, threadId, messageId, skip? }: a bot's
//                                "needs you" card marked handled (#2689);
//                                with skip, a question in words skipped (#3471)
//   POST /api/approvals/journal/test { rule: { id?, when, behavior, botId, riskScope } }:
//                                that rule replayed on the last 7 days
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
import { journalDays, type JournalPayload, type RuleTestDraft, type RuleTestResult } from "../../shared/action-journal.ts";
import type { JournalChain } from "../action-journal.ts";
import { isCustomRuleBehavior, isRiskClass, MAX_RULE_TEXT } from "../../shared/custom-rules.ts";
import { liveDecisionRefusal } from "../../shared/live-approval.ts";
import { approvalTypeOf } from "../approvals/approval-type.ts";
import { waitingItemsFrom, waitingItemsOfBot } from "../../shared/waiting-items.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
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
  /** The Journal: this person's own bots' actions over `days`. */
  journal?(auth: RequestAuth, viewer: InboxViewer, days: number): JournalPayload;
  /** The chain sealed when each line was written. Export does not rehash. */
  sealedJournal?(): JournalChain;
  /** A rule (saved or a draft) replayed on the Journal's last 7 days with
   * the real matcher; a string is a refusal (400). */
  testRule?(auth: RequestAuth, viewer: InboxViewer, draft: RuleTestDraft): RuleTestResult | { error: string; status: number };
  /** #2689: mark one of the viewer's "needs you" cards handled; false when
   * it is not one of their open cards. */
  handled?(auth: RequestAuth, viewer: InboxViewer, item: { botId: string; threadId: string; messageId: string }): boolean;
  /** #3471: the person skipped a question in words (`skip: true`): closed
   * as skipped, the waiting work told there is no answer. */
  skip?(auth: RequestAuth, viewer: InboxViewer, item: { botId: string; threadId: string; messageId: string }): boolean;
  /** The clock of the waiting items' age (tests). */
  now?: () => number;
}

/** A rule test's body, or why not. Nothing is saved. */
export function parseRuleTestDraft(body: unknown): RuleTestDraft | string {
  const rule = body && typeof body === "object" && !Array.isArray(body) ? (body as { rule?: unknown }).rule : undefined;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "rule must be an object";
  const value = rule as Record<string, unknown>;
  if (typeof value.when !== "string" || !value.when.trim() || value.when.length > MAX_RULE_TEXT) return `rule.when must be 1 to ${MAX_RULE_TEXT} characters`;
  if (!isCustomRuleBehavior(value.behavior)) return "rule.behavior must be allow, ask or deny";
  if (value.botId !== null && value.botId !== undefined && (typeof value.botId !== "string" || !ID.test(value.botId))) return "rule.botId must be a bot id or null";
  if (value.id !== undefined && (typeof value.id !== "string" || !ID.test(value.id))) return "rule.id must be a rule id";
  const risks = value.riskScope ?? [];
  if (!Array.isArray(risks) || !risks.every(isRiskClass)) return "rule.riskScope must list risk classes";
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    when: value.when.trim(),
    behavior: value.behavior,
    botId: typeof value.botId === "string" ? value.botId : null,
    riskScope: [...new Set(risks)],
  };
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
 * 2026-10-19: `rule: "allow"` is the one widening a bulk Allow takes:
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
      const pending = deps.pending(auth, viewer);
      const payload: InboxPayload = {
        pending,
        // the answered cards are read from the log only when asked for
        history: url.searchParams.get("history") === "1" ? deps.history(auth, viewer) : [],
        scopes: deps.scopes(auth, viewer),
      };
      // #3512: what waits on the person, read from the same rows (the pinned
      // row asks for one bot's): Today, the pinned row and the connector's
      // list count the same items
      if (url.searchParams.get("waiting") === "1") {
        const items = waitingItemsFrom(pending, (deps.now ?? Date.now)());
        const botId = url.searchParams.get("botId");
        payload.waiting = botId ? waitingItemsOfBot(items, botId) : items;
      }
      return json(res, 200, payload);
    }

    if (method === "GET" && path === "/api/approvals/journal") {
      const viewer = deps.viewer(auth);
      if (!viewer || !deps.journal) return json(res, 403, { error: "Sign in to see your bots' journal.", code: "no_person" });
      res.setHeader("cache-control", "no-store");
      const payload = deps.journal(auth, viewer, journalDays(url.searchParams.get("days")));
      if (url.searchParams.get("export") === "1") return json(res, 200, deps.sealedJournal?.() ?? { version: 1 as const, genesis: "0".repeat(64), entries: [] });
      return json(res, 200, payload);
    }
    if (method === "POST" && path === "/api/approvals/handled") {
      const viewer = deps.viewer(auth);
      if (!viewer || !deps.handled) return json(res, 403, { error: "Sign in to mark a card handled.", code: "no_person" });
      const body = await readBody(req) as Record<string, unknown> | null;
      const botId = body?.botId, threadId = body?.threadId, messageId = body?.messageId;
      if (typeof botId !== "string" || !ID.test(botId) || typeof threadId !== "string" || !ID.test(threadId) || typeof messageId !== "string" || !ID.test(messageId)) {
        return json(res, 400, { error: "botId, threadId and messageId are required" });
      }
      if (body?.skip === true) {
        if (!deps.skip?.(auth, viewer, { botId, threadId, messageId })) return json(res, 404, { error: "no such card", code: "gone" });
        return json(res, 200, { ok: true, outcome: "skipped" });
      }
      if (!deps.handled(auth, viewer, { botId, threadId, messageId })) return json(res, 404, { error: "no such card", code: "gone" });
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/api/approvals/journal/test") {
      const viewer = deps.viewer(auth);
      if (!viewer || !deps.testRule) return json(res, 403, { error: "Sign in to test a rule.", code: "no_person" });
      const draft = parseRuleTestDraft(await readBody(req));
      if (typeof draft === "string") return json(res, 400, { error: draft });
      const result = deps.testRule(auth, viewer, draft);
      if ("error" in result) return json(res, result.status, { error: result.error });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, result);
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
