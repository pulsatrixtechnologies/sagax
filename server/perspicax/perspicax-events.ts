// Product events, the Sagax side (#4250, lot S4 of the proactive plan).
// Wire contract `perspicax-events/1`:
//
//   POST /api/org/perspicax-events    the organization server tells this
//                                     server that something changed for
//                                     one person: a product's health, the
//                                     person's phone line, or a resource
//                                     the person watches
//
// The organization server keeps its one poller and its health test; it
// posts an event on a transition only, once per person and key, and retries
// a delivery that got no marked answer. This side raises or retires ONE item
// per key and starts the routines bound to a watched resource:
//
//   - `product_health` (key `product:<api id>`, `to` healthy | failing) and
//     `voice_line` (key `voice-line`, `to` live | not_live |
//     out_of_credits, or `gone` for both): a state that is neither the good
//     one nor `gone` raises the keyed
//     fix card of that product for that person (the existing ask_choice
//     form, keys of server/widgets/ask-choice-keys.ts), in the person's
//     conversation with their Primary Bot. The card rings once as a
//     question when raised and holds nothing; a later failing event
//     replaces its words in place; the good state or `gone` (the product is
//     no longer the person's, the line no longer watched) retires it, silently
//     (nothing left to do). See server/perspicax/product-fix-cards.ts;
//   - `resource_changed` (key `watch:<uri>`): every ENABLED typed trigger of
//     source `perspicax` the person owns goes through
//     `WebhookManager.ingest(id, event, eventId)`, so filters (the watched
//     URI), dedupe, the per-trigger rate, the unfinished-runs cap and the
//     fence are the typed triggers' own. A routine "when something changes
//     in a product" owns such a trigger (shared/routine-product-event.ts):
//     no turn until the event.
//
// Rules, none optional:
//   - answered before the session gate and before loopback trust, like bot
//     email and bot phone. The only credential is a console assertion the
//     organization server signs per request for the person the event is
//     about (typ `pulsabot-console+jwt`, at most 120 s, single-use jti,
//     `aud` this server's public origin) whose `act.sub` is
//     `perspicax-events`: that actor is accepted HERE ONLY;
//   - its `body_sha256` claim is the hex SHA-256 of the exact body bytes,
//     compared in constant time (missing or different: 401);
//   - the body's `person` is the assertion's `sub` (else 403), a person of
//     this server (else 422 `no_person`, never 404, which the sender reads
//     as a server without this route), active and not turned off.
//     Isolation between people: an
//     event only ever reaches that person's card and that person's
//     triggers;
//   - the same `eventId` twice: 202, applied once;
//   - every answer carries `X-Sagax-Events-Api: 1`, so the sender tells
//     this route from an older server without it (which it then stops
//     retrying).
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { SignalLevel } from "../../shared/signal-levels.ts";
import type { NormalizedTriggerEvent } from "../../shared/trigger-sources.ts";
import type { ConsoleAssertion, ConsoleAssertionActor } from "../auth/oidc-rp.ts";
import { AssertionReplayCache } from "../org/org-admin-routes.ts";
import type { WebhookReceiveResult } from "../triggers/webhooks.ts";

export const PERSPICAX_EVENTS_PATH = "/api/org/perspicax-events";
export const PERSPICAX_EVENTS_CONTRACT = "perspicax-events/1";
export const PERSPICAX_EVENTS_HEADER = "x-sagax-events-api";
/** The only actor this route accepts, and the only route that accepts it. */
export const PERSPICAX_EVENTS_ACTORS: readonly ConsoleAssertionActor[] = ["perspicax-events"];
export const PERSPICAX_EVENTS_BODY_MAX = 16 * 1024;
/** Event ids remembered by the route. */
export const PERSPICAX_EVENTS_SEEN_MAX = 2_000;
export const PERSPICAX_EVENTS_SEEN_MS = 24 * 60 * 60_000;
const MAX_TOKEN_CHARS = 8_192;
const REASON_MAX = 1_000;

/** The key of a product's fix card: `product:<api id>`. */
export const PRODUCT_KEY_PREFIX = "product:";
export const productFixKey = (api: string): string => `${PRODUCT_KEY_PREFIX}${api}`;
/** The key of the person's phone line fix card (one line per person). */
export const VOICE_LINE_KEY = "voice-line";
/** The key of a watched resource's change: `watch:<uri>`. */
export const WATCH_KEY_PREFIX = "watch:";

/** One line: no control character at all. */
const oneLine = (max: number) => z.string().max(max).refine((value) => !/\p{Cc}/u.test(value));
const API_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const URI = /^perspicax:\/\/\S{1,188}$/i;

const productSubject = z.object({ type: z.literal("product"), api: z.string().regex(API_ID) }).passthrough();
const voiceSubject = z.object({ type: z.literal("voice_line"), line: oneLine(128).optional(), number: oneLine(32).optional() }).passthrough();
const resourceSubject = z.object({ type: z.literal("resource"), uri: z.string().regex(URI) }).passthrough();

const eventSchema = z.object({
  contract: z.literal(PERSPICAX_EVENTS_CONTRACT),
  eventId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  kind: z.enum(["product_health", "voice_line", "resource_changed"]),
  person: z.string().min(1).max(256),
  key: oneLine(256).refine((value) => value.trim().length > 0),
  level: z.enum(["fyi", "card", "urgent"]),
  subject: z.union([productSubject, voiceSubject, resourceSubject]),
  from: oneLine(64).nullable().optional(),
  to: oneLine(64),
  reason: z.string().max(REASON_MAX).optional().default(""),
  at: z.string().max(64).refine((value) => Number.isFinite(Date.parse(value))),
}).passthrough();

export interface PerspicaxEvent {
  eventId: string;
  kind: "product_health" | "voice_line" | "resource_changed";
  person: string;
  key: string;
  level: SignalLevel;
  subject:
    | { type: "product"; api: string }
    | { type: "voice_line"; line?: string; number?: string }
    | { type: "resource"; uri: string };
  from: string | null;
  to: string;
  reason: string;
  at: string;
}

/** The contract's body, or null when it is not one this server can act on:
 * its key must be the one its subject names. */
export function parsePerspicaxEvent(value: unknown): PerspicaxEvent | null {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return null;
  const body = parsed.data;
  const subject = body.subject;
  let clean: PerspicaxEvent["subject"];
  if (body.kind === "product_health") {
    if (subject.type !== "product" || body.key !== productFixKey(subject.api)) return null;
    clean = { type: "product", api: subject.api };
  } else if (body.kind === "voice_line") {
    if (subject.type !== "voice_line" || body.key !== VOICE_LINE_KEY) return null;
    clean = { type: "voice_line", ...(subject.line ? { line: subject.line } : {}), ...(subject.number ? { number: subject.number } : {}) };
  } else {
    if (subject.type !== "resource" || body.key !== `${WATCH_KEY_PREFIX}${subject.uri}`) return null;
    clean = { type: "resource", uri: subject.uri };
  }
  return {
    eventId: body.eventId,
    kind: body.kind,
    person: body.person,
    key: body.key,
    level: body.level,
    subject: clean,
    from: body.from ?? null,
    to: body.to,
    // a reason is one paragraph of plain words: no control character
    reason: body.reason.replace(/\p{Cc}+/gu, " ").trim(),
    at: new Date(Date.parse(body.at)).toISOString(),
  };
}

/** The good state of a health event's key. */
export function healthGood(kind: "product_health" | "voice_line"): string {
  return kind === "product_health" ? "healthy" : "live";
}

/** The state that retires a key: the product is no longer the person's to
 * use, or the line is no longer watched. Nothing to fix. */
export const HEALTH_GONE = "gone";

/** True when the state needs a fix: neither the good state nor `gone`. */
export function healthFailing(kind: "product_health" | "voice_line", state: string): boolean {
  return state !== healthGood(kind) && state !== HEALTH_GONE;
}

/** A product or phone line health change, as the fix cards take it. */
export interface ProductHealthChange {
  principalId: string;
  key: string;
  kind: "product_health" | "voice_line";
  /** The product's api id (product_health). */
  api?: string;
  /** The line's number, as the organization server sent it (voice_line). */
  number?: string;
  failing: boolean;
  state: string;
  level: SignalLevel;
  reason: string;
}

export function healthChangeOf(event: PerspicaxEvent, principalId: string): ProductHealthChange | null {
  if (event.kind === "resource_changed") return null;
  const subject = event.subject;
  return {
    principalId,
    key: event.key,
    kind: event.kind,
    ...(subject.type === "product" ? { api: subject.api } : {}),
    ...(subject.type === "voice_line" && subject.number ? { number: subject.number } : {}),
    failing: healthFailing(event.kind, event.to),
    state: event.to,
    level: event.level,
    reason: event.reason,
  };
}

/** The normalized event every `perspicax` trigger receives: the watched URI
 * as its `resource` filter field; what changed is read by the run itself. */
export function productChangeEvent(event: PerspicaxEvent): NormalizedTriggerEvent | null {
  if (event.subject.type !== "resource") return null;
  const uri = event.subject.uri;
  return {
    source: "perspicax",
    kind: "resource.changed",
    title: `Changed: ${uri}`,
    occurredAt: event.at,
    fields: { resource: uri },
    ...(event.reason ? { text: event.reason } : {}),
    resource: uri,
  };
}

export interface PerspicaxEventsRouteDeps {
  identity(): "solo" | "perspicax";
  publicOrigin(): string | null;
  linkServerId(): string | null;
  /** Throws on any failure; accepts PERSPICAX_EVENTS_ACTORS only. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  /** The person this server knows by that Perspicax user id: their
   * principal id and whether they are active (listed, not turned off). */
  person(sub: string): { principalId: string; active: boolean } | null;
  /** Raise (failing) or retire (good again) the fix card of that key for
   * that person. "none": nothing to do (no card open to retire, or no
   * conversation to raise it in). */
  health(change: ProductHealthChange): "raised" | "retired" | "none";
  /** Ids of the ENABLED `perspicax` triggers that belong to the person:
   * their own bots' triggers and routines that run as them. */
  triggers(principalId: string): string[];
  /** WebhookManager.ingest: throws an Error with `status` on a refusal. */
  ingest(triggerId: string, event: NormalizedTriggerEvent, dedupeKey: string): WebhookReceiveResult | null;
  now?(): number;
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json", [PERSPICAX_EVENTS_HEADER]: "1", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
  return true;
}

/** The raw body, null when it is over `max` or the stream fails. */
function readRaw(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > max) {
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on("error", () => resolve(null));
  });
}

const statusOf = (error: unknown): number => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 500;
};

/** The handler: true when the request was this route's (answered). */
export function createPerspicaxEventsRoute(deps: PerspicaxEventsRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const now = deps.now ?? Date.now;
  /** eventId -> when it was applied. */
  const seen = new Map<string, number>();
  const remember = (id: string, at: number) => {
    for (const [key, when] of seen) if (at - when > PERSPICAX_EVENTS_SEEN_MS) seen.delete(key);
    while (seen.size >= PERSPICAX_EVENTS_SEEN_MAX) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
    seen.set(id, at);
  };
  const answer = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== PERSPICAX_EVENTS_PATH) return false;
    if ((req.method ?? "GET") !== "POST") {
      res.setHeader("allow", "POST");
      return send(res, 405, { error: "method_not_allowed" });
    }
    const unauthorized = () => send(res, 401, { error: "unauthorized" });
    // A solo server has no organization server: no assertion can name it.
    if (deps.identity() !== "perspicax") return unauthorized();
    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
    const audience = deps.publicOrigin();
    if (!bearer || !audience || bearer.length > MAX_TOKEN_CHARS) return unauthorized();
    let assertion: ConsoleAssertion;
    try {
      assertion = await deps.verify(bearer, audience, deps.linkServerId());
    } catch {
      return unauthorized();
    }
    // Defense in depth: the verifier was given this actor alone.
    if (assertion.actor !== "perspicax-events") return unauthorized();
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) return unauthorized();

    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > PERSPICAX_EVENTS_BODY_MAX) {
      req.resume();
      return send(res, 400, { error: "invalid" });
    }
    // The assertion signs this exact body. Missing or different: 401.
    if (!assertion.bodySha256 || !/^[0-9a-f]{64}$/.test(assertion.bodySha256)) return unauthorized();
    const raw = await readRaw(req, PERSPICAX_EVENTS_BODY_MAX);
    if (!raw) return send(res, 400, { error: "invalid" });
    const digest = createHash("sha256").update(raw).digest();
    if (!timingSafeEqual(digest, Buffer.from(assertion.bodySha256, "hex"))) return unauthorized();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(res, 400, { error: "invalid" });
    }
    const event = parsePerspicaxEvent(parsedBody);
    if (!event) return send(res, 400, { error: "invalid" });
    // An event names one person and is signed for that person alone.
    if (event.person !== assertion.sub) return send(res, 403, { error: "not_person" });
    const person = deps.person(assertion.sub);
    // Not 404: under perspicax-events/1 a 404 means "no such route here,
    // resend on the next pass". A person this server does not know is a
    // marked refusal the sender stops on.
    if (!person) return send(res, 422, { error: "no_person" });
    if (!person.active) return send(res, 403, { error: "person_inactive" });
    if (seen.has(event.eventId)) return send(res, 202, { duplicate: true });

    const health = healthChangeOf(event, person.principalId);
    if (health) {
      const outcome = deps.health(health);
      remember(event.eventId, now());
      return send(res, 202, { card: outcome });
    }
    const normalized = productChangeEvent(event)!;
    const triggers = deps.triggers(person.principalId);
    let delivered = 0;
    let duplicate = 0;
    let ignored = 0;
    let rateLimited = 0;
    for (const id of triggers) {
      try {
        const result = deps.ingest(id, normalized, event.eventId);
        if (!result) ignored += 1;
        else if (result.duplicate) duplicate += 1;
        else if (result.ignored || result.captured || !result.runId) ignored += 1;
        else delivered += 1;
      } catch (error) {
        // The refusal is in that trigger's event log.
        if (statusOf(error) === 429) rateLimited += 1;
        else ignored += 1;
      }
    }
    // Every trigger that would take it is at its rate: the sender retries.
    if (triggers.length > 0 && rateLimited === triggers.length) return send(res, 429, { error: "rate_limited" });
    remember(event.eventId, now());
    return send(res, 202, {
      triggers: triggers.length,
      delivered,
      duplicate,
      ignored: ignored + rateLimited,
      ...(triggers.length ? {} : { reason: "no_trigger" }),
    });
  };
  return async (req, res, url) => {
    try {
      return await answer(req, res, url);
    } catch (error) {
      // The route name only: never the body or the assertion.
      console.error(`[perspicax-events] unhandled: ${error instanceof Error ? error.name : "error"}`);
      if (!res.headersSent) send(res, 500, { error: "server_error" });
      else if (!res.writableEnded) res.end();
      return true;
    }
  };
}
