// The person's answer to a phone call card (server/outbound-calls.ts):
//
//   POST /api/me/phone-calls                  the calls waiting on this person
//   POST /api/me/phone-calls/:id/answer       {decision: "call" | "deny", stepUp?}
//
// Only the person, or their Primary Bot when they asked in this turn
// (ownerGate). No Always allow: one answer covers one call. A person who
// protects "money" with a security key steps up as for a purchase.
import { formatPhone } from "../../shared/outbound-call.ts";
import { OutboundCallError, type OutboundCallRecord, type OutboundCalls } from "../outbound-calls.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface OutboundCallRouteDeps {
  calls: OutboundCalls;
  principal(auth: RequestAuth): string | null;
  ownerGate?(auth: RequestAuth): { status: number; body: unknown } | null;
  stepUp?(auth: RequestAuth, detail: Record<string, unknown>, stepUp: unknown): { status: number; body: unknown } | null;
  viaPrimary?(): string | null;
  /** An organization admin (Settings > Organization > Phone calls). */
  isAdmin?(auth: RequestAuth): boolean;
  /** The card is updated and the bot told. */
  answered?(row: OutboundCallRecord): void;
  audit?(auth: RequestAuth, action: "phone.call.answer" | "phone.call.settings", detail: Record<string, unknown>): void;
}

const ANSWER = /^\/api\/me\/phone-calls\/(call_[a-f0-9]{16})\/answer$/;

export function createOutboundCallRoutes(deps: OutboundCallRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/org/phone-calls") {
      res.setHeader("cache-control", "private, no-store");
      if (!deps.isAdmin?.(auth)) return json(res, 403, { error: "Only an organization admin changes phone call settings.", code: "admin_only" });
      if (method === "GET") return json(res, 200, { settings: deps.calls.settings() });
      if (method !== "PUT") return json(res, 405, { error: "GET or PUT" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
      const parsed = await readBody(req);
      const input = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      try {
        const settings = deps.calls.updateSettings(input);
        // no number in the audit: what changed only
        deps.audit?.(auth, "phone.call.settings", { settings: Object.keys(input).filter((key) => ["enabled", "callbackNumber", "addDoNotCall", "removeDoNotCall"].includes(key)), enabled: settings.enabled, doNotCall: settings.doNotCall.length });
        return json(res, 200, { settings });
      } catch (error) {
        if (error instanceof OutboundCallError) return json(res, error.status, { error: error.message, code: error.code });
        throw error;
      }
    }
    if (path !== "/api/me/phone-calls" && !path.startsWith("/api/me/phone-calls/")) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 403, { error: "Sign in to answer a phone call card.", code: "no_person" });
    if (path === "/api/me/phone-calls") {
      return json(res, 200, {
        calls: deps.calls.pending(principalId).map((row) => ({
          id: row.id, botId: row.botId, threadId: row.threadId, destination: formatPhone(row.request.to),
          purpose: row.request.purpose, createdAt: row.createdAt,
        })),
      });
    }
    const match = ANSWER.exec(path);
    if (!match) return json(res, 404, { error: "not found" });
    const owned = deps.ownerGate?.(auth);
    if (owned) return json(res, owned.status, owned.body);
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
    const parsed = await readBody(req);
    const input = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    // the number is confirmed on the card by the person: a Primary Bot may
    // decline a call, never confirm one (ÉFVP pilot, re-review of #956)
    if (input.decision === "call" && deps.viaPrimary?.()) {
      return json(res, 403, { error: "A phone call is confirmed by the person on its card, not by a bot.", code: "person_only" });
    }
    if (input.decision === "call") {
      const stepped = deps.stepUp?.(auth, { callId: match[1], decision: "call" }, input.stepUp);
      if (stepped) return json(res, stepped.status, stepped.body);
    }
    try {
      const via = deps.viaPrimary?.() ?? undefined;
      const row = deps.calls.answer(principalId, match[1]!, input.decision, via, input.confirmedTo, input.confirmed);
      // ids and the decision only: never the number
      deps.audit?.(auth, "phone.call.answer", { callId: row.id, decision: row.status, ...(via ? { via: "primary-bot" } : {}) });
      deps.answered?.(row);
      return json(res, 200, { status: row.status });
    } catch (error) {
      if (error instanceof OutboundCallError) return json(res, error.status, { error: error.message, code: error.code });
      throw error;
    }
  };
}
