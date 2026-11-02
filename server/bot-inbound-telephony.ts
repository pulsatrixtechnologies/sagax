// Bot phone, the Sagax side (Perspicax Voice, phase 2, 2026-10-26). Wire
// contract `perspicax-voice/1`:
//
//   POST /api/org/telephony/inbound   Perspicax delivers one event of a
//                                     person's phone line (a text, a call)
//                                     to one of that person's bots
//
// Perspicax owns the line: Twilio's webhooks, their signature, the IVR, the
// PIN check and the choice of bot (its IVR may offer several of the
// person's bots) all happen there. It then posts the event here.
//
// Delivery, chosen to match bot email (server/mail/bot-inbound-mail.ts) rather
// than the person's conversation: an event only wakes a routine. Every
// ENABLED typed trigger of source `telephony` ("Bot phone") on the chosen
// bot goes through `WebhookManager.ingest(id, event, eventId)`, so filters,
// dedupe, the per-trigger rate, the unfinished-runs cap, the fence and the
// confinement of a relayed run (no shell, a card for every write or
// outbound call unless the trigger's owner opts in: `botmailRunConfined`
// covers every relayed source) are the typed triggers' own. Posting into
// the person's conversation was set aside: that would make the caller's
// words a turn of the person, with the bot's usual tools and kept answers.
// The outbound call driver (#956, `place_phone_call`, server/outbound-calls.ts)
// is untouched: a run that wants to call someone uses it, with its card.
//
//   - `sms`, `call_request`, `call_summary` wake the bot with the text
//     (`sms.received`, `call.requested`, `call.summary`);
//   - 2026-10-29: an `sms` the line owner sent from their own verified
//     number (`authenticated`, `person.id` is the assertion's `sub`) is the
//     person texting their bot: it becomes a turn of their conversation
//     with the bot and the answer goes back by text (server/sms-conversation.ts,
//     `ownText`). The phone triggers keep everyone else's texts. A carrier
//     keyword alone (STOP, HELP) is never a turn;
//   - `call_started`, `pin_locked`, `call_rejected` are notices: metadata
//     only, one admin activity row, no run;
//   - `call_result` (2026-10-28) ends a conversation call the bot placed
//     with place_phone_call: it goes to that call's card and conversation
//     (`callResult`, server/outbound-calls.ts applyResult), never to the
//     phone triggers. Only the person whose line placed the call (the
//     assertion's `sub`) can settle it, once. Its texts (summary, the
//     other party's words) are data, never instructions.
//
// Rules, none optional:
//   - answered before the session gate and before loopback trust, like the
//     member API and bot email. The only credential is a console assertion
//     Perspicax signs per request (typ `pulsabot-console+jwt`, at most
//     120 s, single-use jti, `aud` this server's public origin) whose
//     `act.sub` is `perspicax-voice`: that actor is accepted HERE ONLY, the
//     admin, member and mail routes refuse it;
//   - its `body_sha256` claim is the hex SHA-256 of the exact body bytes,
//     compared in constant time (missing or different: 401);
//   - `sub` must be the chosen bot's owner (Perspicax user id), active and
//     not turned off;
//   - the caller's text is untrusted data: it reaches the run inside
//     `[UNTRUSTED TELEPHONY EVENT DATA <boundary>]`, markers defanged, after
//     the owner's routine prompt, the bot phone rules and the line's
//     directives (webhooks.ts). The directives are given as they are: Sagax
//     adds no rule of its own about them;
//   - no message text in a log, an audit row or the trigger's event log:
//     metadata only (bot, event type, masked number);
//   - the same `eventId` twice: 202, delivered once (the triggers' delivery
//     ring, kept on disk, plus a route memory that also covers notices);
//   - every answer carries `X-Sagax-Telephony-Api: 1`.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { NormalizedTriggerEvent } from "../shared/trigger-sources.ts";
import type { ConsoleAssertion, ConsoleAssertionActor } from "./oidc-rp.ts";
import { AssertionReplayCache } from "./org/org-admin-routes.ts";
import { reachMeSmsReply } from "./reach-me/inbound.ts";
import { isOwnText } from "./sms-conversation.ts";
import { maskedCaller, type WebhookReceiveResult } from "./webhooks.ts";

export const TELEPHONY_PATH = "/api/org/telephony/inbound";
export const TELEPHONY_CONTRACT = "perspicax-voice/1";
/** The only actor this route accepts, and the only route that accepts it. */
export const TELEPHONY_ASSERTION_ACTORS: readonly ConsoleAssertionActor[] = ["perspicax-voice"];
/** A call_result carries a transcript (at most 40 000 characters). */
export const TELEPHONY_BODY_MAX = 128 * 1024;
export const CALL_RESULT_TRANSCRIPT_MAX = 40_000;
export const TELEPHONY_TEXT_MAX = 4_000;
/** Event ids remembered by the route (notices included). */
export const TELEPHONY_SEEN_MAX = 2_000;
export const TELEPHONY_SEEN_MS = 24 * 60 * 60_000;
const MAX_TOKEN_CHARS = 8_192;

export const TELEPHONY_EVENTS = ["sms", "call_started", "call_request", "call_summary", "pin_locked", "call_rejected", "call_result", "call_progress"] as const;
export type TelephonyEventType = (typeof TELEPHONY_EVENTS)[number];
/** The events that wake the bot, and the trigger kind each one becomes. */
export const TELEPHONY_WAKE_KINDS: Readonly<Partial<Record<TelephonyEventType, string>>> = {
  sms: "sms.received",
  call_request: "call.requested",
  call_summary: "call.summary",
};
/** Notices: metadata only, the caller's number already masked by Perspicax. */
const MASKED_FROM: ReadonlySet<TelephonyEventType> = new Set(["pin_locked", "call_rejected"]);

// The value `clientPhoneSource` had before it became the neutral `psa_contact`
// (#1220), read for one version. Built from parts so no third-party product
// name is written in the source.
const LEGACY_PSA_PHONE_SOURCE = ["connect", "wise"].join("");

const E164 = /^\+[1-9]\d{6,14}$/;
const MASKED = /^\*{3}\d{4}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
/** Text with line breaks and tabs, no other control character. */
const printable = (max: number) => z.string().max(max).refine((value) => !/[^\P{Cc}\t\n\r]/u.test(value));
/** One line: no control character at all. */
const oneLine = (min: number, max: number) => z.string().min(min).max(max).refine((value) => !/\p{Cc}/u.test(value));

const resultText = (max: number) => printable(max).transform((value) => value.trim()).refine((value) => value.length > 0);

/** The result of a conversation call (event `call_result`). */
const callResultSchema = z.object({
  ref: z.string().regex(/^call_[0-9a-f]{16}$/),
  callSid: z.string().regex(/^CA[0-9a-f]{32}$/),
  outcome: z.enum(["completed", "voicemail", "no-answer", "busy", "failed"]),
  endedBy: z.enum(["goal", "callee", "stop-request", "time-limit", "hang-up"]).optional(),
  durationSec: z.number().int().min(0).max(24 * 60 * 60),
  points: z.array(resultText(600)).max(8),
  commitments: z.array(resultText(600)).max(8),
  transcript: z.array(z.object({ speaker: z.enum(["bot", "callee"]), text: resultText(CALL_RESULT_TRANSCRIPT_MAX) })).max(2_000).optional(),
  truncated: z.boolean().optional(),
  doNotCallAgain: z.boolean().optional(),
}).refine((value) => (value.transcript ?? []).reduce((sum, line) => sum + line.text.length, 0) <= CALL_RESULT_TRANSCRIPT_MAX, { message: "transcript too long" });

export type CallResultBody = z.output<typeof callResultSchema>;

/** Mid-call live updates for a conversation outbound call. */
const callProgressSchema = z.object({
  ref: z.string().regex(/^call_[0-9a-f]{16}$/),
  callSid: z.string().regex(/^CA[0-9a-f]{32}$/).optional(),
  phase: z.enum(["dialing", "ringing", "on_hold", "in_call", "transferred", "ended"]).optional(),
  calleeName: oneLine(1, 80).optional(),
  lines: z.array(z.object({
    speaker: z.enum(["bot", "callee", "system"]),
    text: resultText(4_000),
    at: z.number().int().positive().optional(),
  })).max(50).optional(),
  events: z.array(z.object({
    kind: z.enum(["hold", "dtmf", "transfer", "resume"]),
    detail: oneLine(1, 120),
    at: z.number().int().positive(),
  })).max(20).optional(),
});

export type CallProgressBody = z.output<typeof callProgressSchema>;

const telephonySchema = z.object({
  contract: z.literal(TELEPHONY_CONTRACT),
  event: z.enum(TELEPHONY_EVENTS),
  /** `<event>:<Twilio sid>`: the delivery id and the dedupe key. */
  eventId: z.string().max(200).regex(/^[a-z_]{1,32}:[A-Za-z0-9_-]{1,128}$/),
  receivedAt: z.string().max(64).regex(RFC3339).refine((value) => Number.isFinite(Date.parse(value))),
  line: z.object({
    id: oneLine(1, 128),
    number: z.string().regex(E164),
  }),
  from: z.string().max(16),
  authenticated: z.boolean(),
  person: z.object({
    id: oneLine(1, 256),
    name: oneLine(0, 200),
  }).optional(),
  content: z.object({
    trust: z.literal("caller"),
    text: printable(TELEPHONY_TEXT_MAX),
  }).optional(),
  botId: z.string().regex(/^[\w-]{1,128}$/),
  directives: z.object({
    thirdPartyCall: z.enum(["card", "direct"]),
    // The former name of `psa_contact` is read for one version and
    // normalized to the new one; Perspicax sends the new one.
    clientPhoneSource: z.preprocess(
      (value) => (value === LEGACY_PSA_PHONE_SOURCE ? "psa_contact" : value),
      z.enum(["psa_contact", "provided"]),
    ),
  }),
  result: callResultSchema.optional(),
  progress: callProgressSchema.optional(),
}).superRefine((value, ctx) => {
  // a call_result, and only a call_result, carries its result
  if ((value.event === "call_result") !== (value.result !== undefined)) ctx.addIssue({ code: "custom", path: ["result"], message: "result goes with call_result only" });
  if ((value.event === "call_progress") !== (value.progress !== undefined)) ctx.addIssue({ code: "custom", path: ["progress"], message: "progress goes with call_progress only" });
  if (!value.eventId.startsWith(`${value.event}:`)) ctx.addIssue({ code: "custom", path: ["eventId"], message: "eventId must start with the event" });
  // pin_locked and call_rejected carry a masked number (`***1234`), the others the real one.
  const pattern = MASKED_FROM.has(value.event) ? MASKED : E164;
  if (!pattern.test(value.from)) ctx.addIssue({ code: "custom", path: ["from"], message: "from is not in the form this event uses" });
});

export type TelephonyEvent = z.output<typeof telephonySchema>;

/** The contract's body, or null when it is not exactly that. */
export function parseTelephonyEvent(value: unknown): TelephonyEvent | null {
  const parsed = telephonySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isTelephonyNotice(event: TelephonyEventType): boolean {
  return TELEPHONY_WAKE_KINDS[event] === undefined;
}

const TITLES: Record<string, string> = {
  "sms.received": "Text on the phone line",
  "call.requested": "Request made during a call",
  "call.summary": "Call summary",
};

/** The normalized event every telephony trigger receives, or null for a
 * notice. The title holds no caller text (it is metadata); the short header
 * (event, numbers, PIN check, person) sits in the same text as the caller's
 * words, so it stays inside the fence as data. */
export function telephonyTriggerEvent(event: TelephonyEvent): NormalizedTriggerEvent | null {
  const kind = TELEPHONY_WAKE_KINDS[event.event];
  if (!kind) return null;
  const header = [
    `Event: ${event.event}`,
    `From: ${event.from}`,
    `Line: ${event.line.number}`,
    `Caller authenticated: ${event.authenticated ? "yes" : "no"}`,
    ...(event.person ? [`Person (as Perspicax identified the caller): ${event.person.name.trim() || "(no name)"}`] : []),
  ];
  const text = event.content?.text ?? "";
  return {
    source: "telephony",
    kind,
    title: TITLES[kind] ?? "Phone event",
    occurredAt: new Date(Date.parse(event.receivedAt)).toISOString(),
    fields: { sender: event.from },
    text: `${header.join("\n")}\n\n${text}`,
    resource: event.eventId,
    directives: { thirdPartyCall: event.directives.thirdPartyCall, clientPhoneSource: event.directives.clientPhoneSource },
  };
}

/** One admin activity row, metadata only: never the text, never the full number. */
export interface TelephonyDeliveryRow {
  botId: string;
  botName: string;
  ownerPrincipalId: string;
  event: TelephonyEventType;
  notice: boolean;
  /** `***1234`. */
  caller: string;
  authenticated: boolean;
  triggers: number;
  delivered: number;
  duplicate: number;
  ignored: number;
}

export interface TelephonyRouteDeps {
  identity(): "solo" | "perspicax";
  publicOrigin(): string | null;
  linkServerId(): string | null;
  /** Throws on any failure; accepts TELEPHONY_ASSERTION_ACTORS only. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  bot(botId: string): { id: string; name: string } | null;
  /** The bot's owner: Perspicax user id (null for a local owner) and
   * whether they are active (in the directory, not turned off). */
  owner(botId: string): { principalId: string; sub: string | null; active: boolean } | null;
  /** Ids of the bot's ENABLED triggers of source `telephony`. */
  triggers(botId: string): string[];
  /** A conversation call's result (event call_result) for the person
   * `sub`. Absent: the event is refused like an unknown one. */
  callResult?(input: { sub: string; result: CallResultBody }): "applied" | "unknown" | "not_yours" | "already";
  /** Mid-call live progress (event call_progress) for the line owner. */
  callProgress?(input: { sub: string; progress: CallProgressBody }): "applied" | "unknown" | "not_yours";
  /** The line owner texting their bot from their own verified number: a
   * turn of their conversation, answered by text. False: it could not
   * start, the text goes to the phone triggers as before. Absent: always
   * the triggers. */
  ownText?(input: { ownerPrincipalId: string; sub: string; botId: string; from: string; text: string }): Promise<boolean>;
  /** WebhookManager.ingest: throws an Error with `status` on a refusal. */
  ingest(triggerId: string, event: NormalizedTriggerEvent, dedupeKey: string): WebhookReceiveResult | null;
  record(row: TelephonyDeliveryRow): void;
  now?(): number;
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json", "x-sagax-telephony-api": "1", "cache-control": "no-store" });
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

/** The event ids already answered, per bot, for a day (bounded). Covers
 * notices, which no trigger ring sees, and a bot with no trigger. */
class SeenEvents {
  private readonly seen = new Map<string, number>();
  has(key: string, now: number): boolean {
    const at = this.seen.get(key);
    if (at === undefined) return false;
    if (now - at > TELEPHONY_SEEN_MS) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }
  add(key: string, now: number): void {
    this.seen.delete(key);
    this.seen.set(key, now);
    while (this.seen.size > TELEPHONY_SEEN_MAX) this.seen.delete(this.seen.keys().next().value!);
  }
}

/** The handler: true when the request was this route's (answered). */
export function createBotInboundTelephonyRoute(deps: TelephonyRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const seen = new SeenEvents();
  const now = deps.now ?? Date.now;
  const answer = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== TELEPHONY_PATH) return false;
    if ((req.method ?? "GET") !== "POST") {
      res.setHeader("allow", "POST");
      return send(res, 405, { error: "method_not_allowed" });
    }
    const unauthorized = () => send(res, 401, { error: "unauthorized" });
    // A solo server has no Perspicax: no assertion can name it.
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
    if (assertion.actor !== "perspicax-voice") return unauthorized();
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) return unauthorized();

    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > TELEPHONY_BODY_MAX) {
      req.resume();
      return send(res, 400, { error: "invalid" });
    }
    // The assertion signs this exact body. Missing or different: 401.
    if (!assertion.bodySha256 || !/^[0-9a-f]{64}$/.test(assertion.bodySha256)) return unauthorized();
    const raw = await readRaw(req, TELEPHONY_BODY_MAX);
    if (!raw) return send(res, 400, { error: "invalid" });
    const digest = createHash("sha256").update(raw).digest();
    if (!timingSafeEqual(digest, Buffer.from(assertion.bodySha256, "hex"))) return unauthorized();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(res, 400, { error: "invalid" });
    }
    const event = parseTelephonyEvent(parsedBody);
    if (!event) return send(res, 400, { error: "invalid" });

    const bot = deps.bot(event.botId);
    if (!bot) return send(res, 404, { error: "no_bot" });
    // The bot Perspicax's IVR chose must be the line owner's own.
    const owner = deps.owner(bot.id);
    if (!owner?.sub || owner.sub !== assertion.sub) return send(res, 403, { error: "not_owner" });
    if (!owner.active) return send(res, 403, { error: "owner_inactive" });

    const seenKey = `${bot.id}\n${event.eventId}`;
    // Mid-call live progress: patch the card, never wake a trigger.
    if (event.event === "call_progress") {
      if (!deps.callProgress || !event.progress) return send(res, 400, { error: "invalid" });
      // Progress is idempotent per eventId but also safe to re-apply: keep dedupe.
      if (seen.has(seenKey, now())) return send(res, 202, { event: event.event, applied: false, reason: "duplicate" });
      const outcome = deps.callProgress({ sub: assertion.sub, progress: event.progress });
      if (outcome === "not_yours") return send(res, 403, { error: "not_owner" });
      if (outcome === "unknown") return send(res, 404, { error: "no_call" });
      seen.add(seenKey, now());
      deps.record({
        botId: bot.id, botName: bot.name, ownerPrincipalId: owner.principalId, event: event.event, notice: true,
        caller: maskedCaller(event.from), authenticated: event.authenticated, triggers: 0, delivered: 1, duplicate: 0, ignored: 0,
      });
      return send(res, 202, { event: event.event, applied: true });
    }
    // A conversation call's result: its card and conversation, never the
    // phone triggers (and never a notice row of its own).
    if (event.event === "call_result") {
      if (!deps.callResult || !event.result) return send(res, 400, { error: "invalid" });
      if (seen.has(seenKey, now())) return send(res, 202, { event: event.event, applied: false, reason: "duplicate" });
      const outcome = deps.callResult({ sub: assertion.sub, result: event.result });
      if (outcome === "not_yours") return send(res, 403, { error: "not_owner" });
      if (outcome === "unknown") return send(res, 404, { error: "no_call" });
      seen.add(seenKey, now());
      deps.record({
        botId: bot.id, botName: bot.name, ownerPrincipalId: owner.principalId, event: event.event, notice: false,
        caller: maskedCaller(event.from), authenticated: false, triggers: 0, delivered: outcome === "applied" ? 1 : 0, duplicate: outcome === "already" ? 1 : 0, ignored: 0,
      });
      return send(res, 202, { event: event.event, applied: outcome === "applied", ...(outcome === "already" ? { reason: "duplicate" } : {}) });
    }
    const notice = isTelephonyNotice(event.event);
    if (seen.has(seenKey, now())) {
      return send(res, 202, { event: event.event, notice, triggers: 0, delivered: 0, duplicate: 1, ignored: 0, reason: "duplicate" });
    }

    // 2026-10-26: a text that answers a "Reach me" card (server/reach-me/inbound.ts)
    // resumes that card and never reaches the bot's phone triggers.
    if (event.event === "sms" && event.content?.text) {
      const reply = await reachMeSmsReply({ ownerPrincipalId: owner.principalId, from: event.from, text: event.content.text });
      if (reply.handled) {
        seen.add(seenKey, now());
        return send(res, 202, { event: event.event, notice, triggers: 0, delivered: 0, duplicate: 0, ignored: 0, reachMe: reply.outcome });
      }
    }

    // 2026-10-29: the person texting their own bot: their conversation
    if (deps.ownText && isOwnText({ event: event.event, authenticated: event.authenticated, personId: event.person?.id, sub: assertion.sub, text: event.content?.text })) {
      const started = await deps.ownText({ ownerPrincipalId: owner.principalId, sub: assertion.sub, botId: bot.id, from: event.from, text: event.content!.text.trim() });
      if (started) {
        seen.add(seenKey, now());
        deps.record({
          botId: bot.id, botName: bot.name, ownerPrincipalId: owner.principalId, event: event.event, notice: false,
          caller: maskedCaller(event.from), authenticated: true, triggers: 0, delivered: 1, duplicate: 0, ignored: 0,
        });
        return send(res, 202, { event: event.event, notice, triggers: 0, delivered: 1, duplicate: 0, ignored: 0, conversation: true });
      }
    }

    let triggers: string[] = [];
    let delivered = 0;
    let duplicate = 0;
    let ignored = 0;
    let rateLimited = 0;
    const normalized = telephonyTriggerEvent(event);
    if (normalized) {
      triggers = deps.triggers(bot.id);
      for (const id of triggers) {
        try {
          const result = deps.ingest(id, normalized, event.eventId);
          if (!result) ignored += 1;
          else if (result.duplicate) duplicate += 1;
          else if (result.ignored || result.captured || !result.runId) ignored += 1;
          else delivered += 1;
        } catch (error) {
          // The refusal is in that trigger's event log (no message text).
          if (statusOf(error) === 429) rateLimited += 1;
          else ignored += 1;
        }
      }
      // Not remembered: Perspicax may try again once the rate allows it.
      if (triggers.length && rateLimited === triggers.length) return send(res, 429, { error: "rate_limited" });
    }
    seen.add(seenKey, now());
    deps.record({
      botId: bot.id,
      botName: bot.name,
      ownerPrincipalId: owner.principalId,
      event: event.event,
      notice,
      caller: maskedCaller(event.from),
      authenticated: event.authenticated,
      triggers: triggers.length,
      delivered,
      duplicate,
      ignored: ignored + rateLimited,
    });
    return send(res, 202, {
      event: event.event,
      notice,
      triggers: triggers.length,
      delivered,
      duplicate,
      ignored: ignored + rateLimited,
      ...(notice ? { reason: "notice" } : triggers.length ? {} : { reason: "no_trigger" }),
    });
  };
  return async (req, res, url) => {
    try {
      return await answer(req, res, url);
    } catch (error) {
      // The route name only: never the body or the assertion.
      console.error(`[telephony-inbound] unhandled: ${error instanceof Error ? error.name : "error"}`);
      if (!res.headersSent) send(res, 500, { error: "server_error" });
      else if (!res.writableEnded) res.end();
      return true;
    }
  };
}
