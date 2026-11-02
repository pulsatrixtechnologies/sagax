// Phone tools over HTTP (server/phone-tools.ts, shared/phone-tools.ts).
//
// The phone (a person's paired iPhone; never a bot, never another member):
//   POST   /api/me/phone-tools/device         { deviceName?, tools }  what this phone can do now
//   GET    /api/me/phone-tools/requests       the requests waiting on this person's phones
//   POST   /api/me/phone-tools/requests/:id   { decision, result?, error? }  the person's answer
//   GET    /api/me/phone-tools/grants         the "Toujours permettre" grants
//   DELETE /api/me/phone-tools/grants         { botId, key }  remove one
//
// The bot (INTERNAL_ROUTES, behind the per-turn capability):
//   POST /api/internal/phone-tools  { tool, args }        ask, and wait up to waitMs
//   POST /api/internal/phone-tools  { request_id }        keep waiting on an earlier ask
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { parsePhoneToolArgs, phoneAnswerSchema, phoneDeviceSchema, PHONE_TOOL_CALL_WAIT_MS } from "../../shared/phone-tools.ts";
import { PhoneToolUnavailable, type PhoneToolBroker } from "../phone-tools.ts";
import type { RequestAuth } from "../request-auth.ts";
import { isCardSealPublicKey } from "../../shared/phone-card-seal.ts";
import type { PhoneTransport } from "../../shared/phone-transport.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PREFIX = "/api/me/phone-tools";
const REQUEST_PATH = /^\/api\/me\/phone-tools\/requests\/([\w-]{1,64})$/;
/** Three picked photos, downscaled, base64: comfortably under this. */
const ANSWER_MAX_BYTES = 6_000_000;

const revokeBody = z.object({ botId: z.string().min(1).max(128), key: z.string().min(1).max(64) }).strict();
const internalBody = z.union([
  z.object({ request_id: z.string().regex(/^[\w-]{1,64}$/) }).strict(),
  z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).optional() }).strict(),
]);

export interface PhoneToolRouteDeps {
  broker(): PhoneToolBroker;
  /** The paired phone behind this request: its person, a stable id for the
   * device (the companion's vouched device, or the native app's bearer
   * session) and how it reached the server, read from the connection
   * (shared/phone-transport.ts), never from the body. Null for a bot, a
   * browser, a service, or anyone who is not a person. */
  phone(req: IncomingMessage, auth: RequestAuth): { person: string; deviceId: string; transport: PhoneTransport } | null;
  botName(botId: string): string | undefined;
  /** False when a bearer session was revoked while the body was still
   * arriving (port of upstream 035101e08). Loopback companion phones stay. */
  live?(auth: RequestAuth): boolean;
}

export function createPhoneToolRoutes(deps: PhoneToolRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // literal paths, so scripts/tool-policy reads them (admin rows: never a bot's)
    if (!(path === "/api/me/phone-tools/device" || path === "/api/me/phone-tools/requests" || path === "/api/me/phone-tools/grants") && !REQUEST_PATH.test(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (deps.live && !deps.live(auth)) return json(res, 401, { error: "Session expired" });
    const phone = deps.phone(req, auth);
    if (!phone) return json(res, 403, { error: "Only your paired phone uses phone tools.", code: "phone_required" });
    const broker = deps.broker();

    if (path === `${PREFIX}/device`) {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const parsed = phoneDeviceSchema.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "send { deviceName?, tools: [location, contacts, reminders, calendar, home, alarms, photos, shortcut, clipboard, status] }" });
      if (deps.live && !deps.live(auth)) return json(res, 401, { error: "Session expired" });
      // the transport is the connection's, whatever the body says (review of #960)
      broker.registerDevice(phone.person, phone.deviceId, { deviceName: parsed.data.deviceName, tools: parsed.data.tools, transport: phone.transport });
      return json(res, 200, { ok: true, tools: broker.availableTools(phone.person) });
    }

    if (path === `${PREFIX}/requests`) {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      if (deps.live && !deps.live(auth)) return json(res, 401, { error: "Session expired" });
      return json(res, 200, { requests: broker.pendingFor(phone.person) });
    }

    if (path === `${PREFIX}/grants`) {
      if (method === "GET") {
        const grants = broker.grants(phone.person).map(({ botId, key }) => {
          const [tool, access] = key.split(":");
          const name = deps.botName(botId);
          return { botId, ...(name ? { botName: name } : {}), tool, access, key };
        });
        return json(res, 200, { grants });
      }
      if (method === "DELETE") {
        const parsed = revokeBody.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "send { botId, key }" });
        return json(res, 200, { ok: true, removed: broker.revokeGrant(phone.person, parsed.data.botId, parsed.data.key) });
      }
      return json(res, 405, { error: "GET or DELETE" });
    }

    const match = REQUEST_PATH.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST" });
    const parsed = phoneAnswerSchema.safeParse(await readBody(req, ANSWER_MAX_BYTES));
    if (!parsed.success) return json(res, 400, { error: "send { decision: deny | once | always, result?, error? }" });
    if (deps.live && !deps.live(auth)) return json(res, 401, { error: "Session expired" });
    const outcome = broker.answer(phone.person, phone.deviceId, match[1]!, parsed.data);
    if (!outcome.ok) return json(res, outcome.status, { error: outcome.error });
    return json(res, 200, { ok: true });
  };
}

export interface PhoneToolInternalDeps {
  broker(): PhoneToolBroker;
  /** Whose phone this turn may use: the person speaking, in their own 1:1
   * conversation with a bot they own, in a turn of their own. Anything else
   * (a room, another member's bot, a routine, a bot asked by a bot) gets the
   * refusal sentence. */
  turn(capability: InternalCapabilityView): { person: string; botName: string } | { error: string };
  waitMs?: number;
}

export function createPhoneToolInternalRoutes(deps: PhoneToolInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/phone-tools") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const turn = deps.turn(capability);
    if ("error" in turn) return json(res, 403, { error: turn.error });
    const parsedBody = internalBody.safeParse(await readBody());
    if (!parsedBody.success) return json(res, 400, { error: "send { tool, args } or { request_id }" });
    const broker = deps.broker();
    const owner = { botId: capability.botId, threadId: capability.threadId };
    const waitMs = deps.waitMs ?? PHONE_TOOL_CALL_WAIT_MS;
    let requestId: string;
    if ("request_id" in parsedBody.data) {
      requestId = parsedBody.data.request_id;
    } else {
      const args = parsePhoneToolArgs(parsedBody.data.tool, parsedBody.data.args ?? {});
      if (!args.ok) return json(res, 400, { error: args.error });
      try {
        requestId = broker.request({ person: turn.person, botId: capability.botId, botName: turn.botName, threadId: capability.threadId, tool: args.tool, args: args.args }).id;
      } catch (error) {
        if (error instanceof PhoneToolUnavailable) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const outcome = await broker.wait(requestId, owner, waitMs);
    if (outcome.status === "unknown") return json(res, 404, { error: "No such phone request in this conversation." });
    return json(res, 200, outcome);
  };
}

// "Scanner avec l'iPhone" (audit row 84): the person's own computer, in the
// vault's New card form, asks their iPhone to read a card (Vision, on the
// phone). Never a bot: the request has no bot and no conversation.
//   GET    /api/me/phone-tools/card-scan            { available }
//   POST   /api/me/phone-tools/card-scan            { publicKey } start: { requestId }
//   POST   /api/me/phone-tools/card-scan/:id/wait   { status, sealed? }
//   DELETE /api/me/phone-tools/card-scan/:id        the form gave up
// The phone seals the number, the expiry and the name for the form's
// one-time key (shared/phone-card-seal.ts); this route relays that envelope
// once and never holds the number in clear (never the security code).
const CARD_SCAN_ID = /^\/api\/me\/phone-tools\/card-scan\/([\w-]{1,64})(\/wait)?$/;

export interface PhoneCardScanRouteDeps {
  broker(): PhoneToolBroker;
  /** The person at their own computer (the desktop app, or their signed-in
   * session); null for a bot's shell or session, a phone, or a service. */
  desktop(req: IncomingMessage, auth: RequestAuth): string | null;
  waitMs?: number;
}

export function createPhoneCardScanRoutes(deps: PhoneCardScanRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = CARD_SCAN_ID.exec(path);
    // a literal path, so scripts/tool-policy reads it (an admin row: never a bot's)
    if (path !== "/api/me/phone-tools/card-scan" && !match) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = deps.desktop(req, auth);
    if (!person) return json(res, 403, { error: "Only you, at your computer, can ask your phone to scan a card." });
    const broker = deps.broker();
    const owner = { botId: "", threadId: `card-scan:${person.trim().toLowerCase()}` };
    if (path === "/api/me/phone-tools/card-scan") {
      if (method === "GET") return json(res, 200, { available: broker.availableTools(person).includes("card_scan") });
      if (method !== "POST") return json(res, 405, { error: "GET or POST" });
      // the form's one-time key: the phone seals the card for it alone
      const body = (await readBody(req).catch(() => ({}))) as { publicKey?: unknown };
      if (!isCardSealPublicKey(body.publicKey)) return json(res, 400, { error: "send { publicKey }: the form's one-time P-256 key, base64url" });
      try {
        const request = broker.request({ person, botId: owner.botId, botName: "", threadId: owner.threadId, tool: "card_scan", args: { publicKey: body.publicKey } });
        return json(res, 200, { requestId: request.id, expiresAt: request.expiresAt });
      } catch (error) {
        if (error instanceof PhoneToolUnavailable) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const requestId = match![1]!;
    if (match![2]) {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const outcome = await broker.wait(requestId, owner, deps.waitMs ?? PHONE_TOOL_CALL_WAIT_MS);
      if (outcome.status === "unknown") return json(res, 404, { error: "No such scan." });
      // the sealed envelope as the phone sent it: only the form can open it
      if (outcome.status === "done") return json(res, 200, { status: "done", sealed: outcome.result });
      return json(res, 200, outcome);
    }
    if (method !== "DELETE") return json(res, 405, { error: "DELETE" });
    return json(res, 200, { ok: true, cancelled: broker.cancel(person, requestId) });
  };
}
