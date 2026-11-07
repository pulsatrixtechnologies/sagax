// The person's answer to a phone call card (server/outbound/outbound-calls.ts):
//
//   POST /api/me/phone-calls                  the calls waiting on this person
//   POST /api/me/phone-calls/:id/answer       {decision: "call" | "deny", stepUp?}
//   POST /api/me/phone-calls/:id/hangup       End a live conversation call
//   GET  /api/me/phone-calls/:id/recording   Recording proxy (30-day retention)
//
// Only the person, or their Primary Bot when they asked in this turn
// (ownerGate). Call, Always call (#2091: the next calls to this confirmed
// number are approved as they open) or deny; the number is confirmed on
// the card, by the person or by their Primary Bot on their behalf (the maintainer
// 2026-11-06: the Primary Bot does everything, no human click exception).
// Always is refused while the organization turned "Toujours permettre"
// off. A person who protects "money" with a security key steps up as for
// a purchase.
import { formatPhone } from "../../shared/outbound-call.ts";
import { OutboundCallError, type OutboundCallRecord, type OutboundCalls } from "../outbound/outbound-calls.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { ORG_ALWAYS_ALLOW_OFF, standingGrantsAllowed } from "../rules/custom-rules-org.ts";

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
  audit?(auth: RequestAuth, action: "phone.call.answer" | "phone.call.settings" | "phone.call.hangup", detail: Record<string, unknown>): void;
  /** Person End call on the live card. */
  hangUp?(principalId: string, callId: string): Promise<{ ok: true } | { error: string; status: number; code: string }>;
  /** Fetch the call's recording bytes for the person (Twilio via Perspicax). */
  recording?(principalId: string, callId: string): Promise<{ ok: true; body: Buffer; contentType: string } | { error: string; status: number; code: string }>;
}

const ANSWER = /^\/api\/me\/phone-calls\/(call_[a-f0-9]{16})\/answer$/;
const HANGUP = /^\/api\/me\/phone-calls\/(call_[a-f0-9]{16})\/hangup$/;
const RECORDING = /^\/api\/me\/phone-calls\/(call_[a-f0-9]{16})\/recording$/;

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
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 403, { error: "Sign in to answer a phone call card.", code: "no_person" });

    const hangup = HANGUP.exec(path);
    if (hangup) {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const owned = deps.ownerGate?.(auth);
      if (owned) return json(res, owned.status, owned.body);
      if (!deps.hangUp) return json(res, 501, { error: "Hang up is not available on this server.", code: "unavailable" });
      const outcome = await deps.hangUp(principalId, hangup[1]!);
      if ("error" in outcome) return json(res, outcome.status, { error: outcome.error, code: outcome.code });
      deps.audit?.(auth, "phone.call.hangup", { callId: hangup[1] });
      return json(res, 200, { ok: true });
    }

    const recording = RECORDING.exec(path);
    if (recording) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const row = deps.calls.get(recording[1]!);
      if (!row || row.principalId !== principalId) return json(res, 404, { error: "No such recording.", code: "unknown_call" });
      if (!row.result) return json(res, 409, { error: "The call has no recording yet.", code: "not_ready" });
      if (!deps.recording) {
        // Synthetic empty body keeps the player mountable in gallery / tests
        res.writeHead(204, { "cache-control": "private, no-store" });
        res.end();
        return;
      }
      const file = await deps.recording(principalId, recording[1]!);
      if ("error" in file) return json(res, file.status, { error: file.error, code: file.code });
      res.writeHead(200, {
        "content-type": file.contentType,
        "cache-control": "private, max-age=300",
        "content-length": file.body.length,
      });
      res.end(file.body);
      return;
    }

    if (method !== "POST") return json(res, 405, { error: "POST only" });
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
    const places = input.decision === "call" || input.decision === "always";
    if (input.decision === "always" && !standingGrantsAllowed()) return json(res, 403, ORG_ALWAYS_ALLOW_OFF);
    if (places) {
      const stepped = deps.stepUp?.(auth, { callId: match[1], decision: input.decision }, input.stepUp);
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
