// The resource usage card (shared/resource-usage.ts).
//
// Person routes (ROUTES), for the one who asked only:
//   GET  /api/resource-usage/:id          the card's state and last minute
//   GET  /api/resource-usage/:id/live     its frames as server-sent events
//   POST /api/resource-usage/:id/resume   Reprendre (the target's rights are checked again)
//   POST /api/resource-usage/:id/pause
// Bot route (INTERNAL_ROUTES, behind the turn's capability):
//   POST /api/internal/resource-usage/start   resource_usage: post the card
import { z } from "zod";

import {
  askedForResources,
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  type ResourceFrame,
  type ResourceHost,
  type ResourceUsageView,
} from "../../shared/resource-usage.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { ResourceSamplers } from "../resource-usage/sampler.ts";
import { RESOURCE_TARGETS, type ResolvedResourceTarget, type ResourceTargetRefusal, type ResourceTargetRequest } from "../resource-usage/targets.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ONE = /^\/api\/resource-usage\/(ru_[a-f0-9]{18})(?:\/(live|resume|pause))?$/;
/** A stream ends on its own after this; the card reconnects on Reprendre. */
const STREAM_MAX_MS = 12 * 60_000;

export function createResourceUsageRoutes(deps: {
  samplers: ResourceSamplers;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    const match = ONE.exec(path);
    if (!match) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to see this card." });
    const id = match[1]!;
    const action = match[2];
    if (!action) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const snapshot = deps.samplers.snapshot(id, principalId);
      return snapshot ? json(res, 200, { snapshot }) : json(res, 404, { error: "gone" });
    }
    if (action === "live") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      const write = (payload: unknown) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const unsubscribe = deps.samplers.subscribe(id, principalId, write);
      if (!unsubscribe) {
        // an unknown card, or someone else's: the same answer
        write({ kind: "state", state: "stopped", error: "gone" });
        res.end();
        return;
      }
      const ping = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 15_000);
      ping.unref?.();
      const cap = setTimeout(() => res.end(), STREAM_MAX_MS);
      cap.unref?.();
      const done = () => {
        clearInterval(ping);
        clearTimeout(cap);
        unsubscribe();
      };
      req.on("close", done);
      res.on("close", done);
      return;
    }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (action === "pause") {
      const snapshot = deps.samplers.pause(id, principalId);
      return snapshot ? json(res, 200, { snapshot }) : json(res, 404, { error: "gone" });
    }
    const resumed = await deps.samplers.resume(id, principalId);
    if (!resumed) return json(res, 404, { error: "gone" });
    if ("error" in resumed) return json(res, 409, { error: resumed.error });
    return json(res, 200, { snapshot: resumed });
  };
}

const startBody = z.object({
  target: z.enum(RESOURCE_TARGETS),
  host: z.string().trim().max(200).optional(),
  session: z.string().trim().max(200).optional(),
}).strict();

/** What the bot reads back: the first full sample in plain words. */
export function resourceSummary(host: ResourceHost, frame: ResourceFrame | null, hostLabel: string): string {
  const name = host.hostname || hostLabel;
  if (!frame) return `The usage card for ${name} is in the chat; the first sample has not arrived yet.`;
  const parts: string[] = [];
  if (frame.cpu) parts.push(`CPU ${formatPercent(frame.cpu.total, "en")}${frame.cpu.cores?.length ? ` across ${frame.cpu.cores.length} cores (busiest ${formatPercent(Math.max(...frame.cpu.cores), "en")})` : ""}`);
  if (frame.mem) {
    const swap = frame.mem.swapTotal ? `, swap ${formatBytes(frame.mem.swapUsed ?? 0, "en")} of ${formatBytes(frame.mem.swapTotal, "en")}` : "";
    parts.push(`memory ${formatBytes(frame.mem.used, "en")} of ${formatBytes(frame.mem.total, "en")}${swap}`);
  }
  if (frame.disk) parts.push(`disk read ${formatRate(frame.disk.readBps, "en")}, write ${formatRate(frame.disk.writeBps, "en")}`);
  if (frame.net) parts.push(`network in ${formatRate(frame.net.rxBps, "en")}, out ${formatRate(frame.net.txBps, "en")}`);
  for (const volume of frame.volumes ?? []) {
    parts.push(`${volume.name} ${formatPercent((volume.used / (volume.total || 1)) * 100, "en")} used of ${formatBytes(volume.total, "en")}`);
  }
  const about = [host.os, host.uptimeSec !== undefined ? `up ${formatUptime(host.uptimeSec, "en")}` : ""].filter(Boolean).join(", ");
  return `${name}${about ? ` (${about})` : ""}: ${parts.join("; ")}.`;
}

export function createResourceUsageInternalRoutes(deps: {
  samplers: ResourceSamplers;
  /** The conversation belongs to this bot. */
  ownsThread(botId: string, threadId: string): boolean;
  /** The person speaking in this turn. */
  principal(botId: string, threadId: string): string | undefined;
  /** The person's own message that started this turn, or undefined when no
   * person asked directly (a routine, a webhook, a continuation). */
  personText(threadId: string, generation: string): string | undefined;
  resolve(request: ResourceTargetRequest): Promise<ResolvedResourceTarget | ResourceTargetRefusal>;
  /** Puts the card in the conversation. */
  post(input: { botId: string; threadId: string; view: ResourceUsageView }): void;
  firstFrameMs?: number;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/resource-usage/start") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = deps.principal(capability.botId, capability.threadId)?.trim().toLowerCase();
    if (!principalId) return json(res, 403, { error: "No person speaks in this turn, so there is nobody to show the card to." });
    const parsed = startBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: `target must be one of ${RESOURCE_TARGETS.join(", ")}; host names a server host, session a remote session's code or computer name.` });
    // the person's own message of this very turn: never an older line, never a routine's
    const text = deps.personText(capability.threadId, capability.generation);
    if (text === undefined) {
      return json(res, 409, { error: "There is no direct message from a person in this turn (a routine, a webhook or a continuation), so no usage card is shown. Answer in words." });
    }
    if (!askedForResources(text)) {
      return json(res, 409, { error: "The person did not ask about a computer's usage in this message, so no card was shown. Answer in words." });
    }
    const resolved = await deps.resolve({
      principalId,
      botId: capability.botId,
      threadId: capability.threadId,
      target: parsed.data.target,
      ...(parsed.data.host ? { host: parsed.data.host } : {}),
      ...(parsed.data.session ? { session: parsed.data.session } : {}),
    });
    if ("error" in resolved) {
      return json(res, resolved.code === "forbidden" ? 403 : resolved.code === "unknown" ? 404 : 409, { error: resolved.error });
    }
    const started = await deps.samplers.start({ principalId, botId: capability.botId, threadId: capability.threadId, open: resolved.open });
    if ("error" in started) {
      return json(res, 409, { error: started.error === "forbidden" ? "This person may not read that computer's usage." : "That computer did not answer. Check that it is on and reachable, then ask again." });
    }
    const view: ResourceUsageView = { samplerId: started.id, ...resolved.view };
    deps.post({ botId: capability.botId, threadId: capability.threadId, view });
    const frame = await deps.samplers.firstFrame(started.id, deps.firstFrameMs ?? 7_000);
    const snapshot = deps.samplers.snapshot(started.id, principalId);
    if (snapshot?.state === "error") {
      return json(res, 200, { ok: false, hostLabel: view.hostLabel, summary: `The usage card for ${view.hostLabel} is in the chat, but the computer did not answer. Tell the person; they can tap Reprendre on the card once it is reachable.` });
    }
    return json(res, 200, { ok: true, hostLabel: view.hostLabel, summary: resourceSummary(snapshot?.host ?? {}, frame, view.hostLabel) });
  };
}
