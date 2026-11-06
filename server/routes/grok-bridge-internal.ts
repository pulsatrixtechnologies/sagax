// POST /api/internal/grok-bridge: grok_send / bridge_claim / bridge_release /
// bridge_list_leases for the bot turn (#2193).
//
// Not in ROUTES: listed in INTERNAL_ROUTES (server/routes/internal-route.ts).
import type { GrokBridgeService } from "../grok-bridge/service.ts";
import type { BridgeLease } from "../grok-bridge/store.ts";
import { type InternalCapabilityView, type InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface GrokBridgeInternalDeps {
  service: GrokBridgeService;
  listLeases(personId: string): BridgeLease[];
  /** Person the turn runs for (conversation speaker or routine owner). */
  personFor(capability: InternalCapabilityView): string | null;
  /** Display label of the calling bot. */
  botLabel(botId: string): string;
}

export function createGrokBridgeInternalRoutes(deps: GrokBridgeInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/grok-bridge")) return PASS;
    const personId = deps.personFor(capability);
    if (!personId) return json(res, 403, { error: "No person for this turn." });
    const body = await readBody();
    const tool = typeof body.tool === "string" ? body.tool : "";
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? body.args as Record<string, unknown>
      : {};
    const bot = deps.botLabel(capability.botId);

    if (tool === "grok_send") {
      const to = typeof args.to === "string" ? args.to : "";
      const task = typeof args.task === "string" ? args.task : "message";
      const result = deps.service.send({
        personId,
        fromBot: bot,
        to,
        task: task as "message",
        priority: args.priority === "low" || args.priority === "high" ? args.priority : "normal",
        threadId: typeof args.thread_id === "string" ? args.thread_id : undefined,
        payload: args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
          ? args.payload as Record<string, unknown>
          : typeof args.text === "string"
            ? { text: args.text }
            : undefined,
        replyTo: typeof args.reply_to === "string" ? args.reply_to : undefined,
      });
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      return json(res, 200, { ok: true, job_id: result.jobId, thread_id: result.thread_id, envelope_id: result.envelope_id });
    }

    if (tool === "bridge_claim") {
      const jobKey = typeof args.job_key === "string" ? args.job_key : typeof args.name === "string" ? args.name : "";
      if (!jobKey.trim()) return json(res, 400, { error: "job_key is required." });
      const ttl = typeof args.ttl_seconds === "number" && Number.isFinite(args.ttl_seconds)
        ? Math.min(86_400, Math.max(10, Math.floor(args.ttl_seconds)))
        : 900;
      const purpose = typeof args.purpose === "string" ? args.purpose.slice(0, 200) : undefined;
      const result = deps.service.claim(personId, jobKey.trim(), bot, ttl, purpose);
      if ("status" in result && result.ok === false) return json(res, result.status, { error: result.error });
      if (!result.ok) return json(res, 200, { ok: false, reason: "held_by_other", current: result.lease });
      return json(res, 200, { ok: true, lease: result.lease });
    }

    if (tool === "bridge_release") {
      const jobKey = typeof args.job_key === "string" ? args.job_key : typeof args.name === "string" ? args.name : "";
      if (!jobKey.trim()) return json(res, 400, { error: "job_key is required." });
      const result = deps.service.release(personId, jobKey.trim(), bot);
      if ("status" in result && result.ok === false) return json(res, result.status, { error: result.error });
      return json(res, 200, { ok: result.ok });
    }

    if (tool === "bridge_list_leases") {
      const live = deps.service.live(personId);
      if (!live.ok) return json(res, live.status, { error: live.error });
      return json(res, 200, { ok: true, leases: deps.listLeases(personId) });
    }

    return json(res, 400, { error: `Unknown bridge tool: ${tool}` });
  };
}
