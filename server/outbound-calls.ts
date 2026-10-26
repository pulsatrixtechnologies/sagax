// Outbound phone calls a bot places for the person (parité Grok Bot V4,
// spec docs/specs/bot-telephony.md 4.4, 5.7 and 6.5; shared/outbound-call.ts).
//
// One approval places one call:
//   1. the bot calls place_phone_call: Sagax builds the call (fixed AI
//      disclosure, the bot's words, no Url or Twiml of the bot's), checks it
//      with a dry run of twilio_api__write on the person's Perspicax profile,
//      and shows the card "Call +1 514 555 0142?" in the conversation;
//   2. the person (or their Primary Bot, when they ask) answers Call or Do
//      not call. There is no Always allow;
//   3. the bot calls place_phone_call again with the same arguments, in its
//      next turn (the Perspicax access is the turn's): the approved record is
//      consumed and the real call is placed, once.
// A changed number or word is another call and another card. An approval
// is good for 15 minutes. Records are kept 30 days (decision 5), with the
// number; logs and audit rows only ever carry the masked number.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { normalizePhone } from "../shared/allowed-recipients.ts";
import {
  callDigestSource, callTwiml, canadianNumber, createCallArgs, formatPhone, maskPhone, parseOutboundCall,
  type CallLanguage, type CallNames, type OutboundCallRequest,
} from "../shared/outbound-call.ts";
import type { OutboundCard } from "../shared/wire.ts";

export const CALL_APPROVAL_MS = 15 * 60_000;
export const CALL_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** A card nobody answered in a day is stale: asking again shows a new one. */
export const CALL_PENDING_MS = 24 * 60 * 60_000;
const MAX_RECORDS = 2_000;

/** Pilot limits per person and day (ÉFVP 2026-10-22, review): cards asked
 * (each one is a Twilio dry run) and calls placed. */
export const CALL_LIMITS_PER_DAY = { cards: 20, calls: 10 } as const;
const DAY_MS = 24 * 60 * 60_000;
export const MAX_DO_NOT_CALL = 2_000;

/** The organization's pilot settings (Settings > Organization > Phone
 * calls): off until an admin turns them on; a callback number is required
 * before any call; numbers on the do-not-call list are never called. */
export interface OutboundCallSettings {
  enabled: boolean;
  callbackNumber?: string;
  doNotCall: string[];
}

export type CallStatus = "pending" | "approved" | "placing" | "denied" | "placed" | "failed";

export interface OutboundCallRecord {
  id: string;
  principalId: string;
  botId: string;
  threadId: string;
  messageId?: string;
  request: OutboundCallRequest;
  digest: string;
  status: CallStatus;
  createdAt: number;
  answeredAt?: number;
  expiresAt?: number;
  via?: string;
  callSid?: string;
  error?: string;
}

export class OutboundCallError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function digestOf(request: OutboundCallRequest, names?: { botName: string; personName: string; callback?: string }): string {
  return createHash("sha256").update(callDigestSource(request, names)).digest("hex");
}

export class OutboundCalls {
  private readonly file: string;
  private readonly now: () => number;
  private records: Record<string, OutboundCallRecord> | null = null;
  private config: OutboundCallSettings | null = null;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.file = join(dataDir, "outbound-calls.json");
    this.now = now;
  }

  private load(): Record<string, OutboundCallRecord> {
    if (this.records) return this.records;
    let records: Record<string, OutboundCallRecord> = {};
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { records?: Record<string, OutboundCallRecord>; settings?: Partial<OutboundCallSettings> };
        if (parsed && typeof parsed.records === "object" && parsed.records) records = parsed.records;
        const saved = parsed?.settings;
        if (saved && typeof saved === "object") {
          this.config = {
            enabled: saved.enabled === true,
            ...(typeof saved.callbackNumber === "string" && normalizePhone(saved.callbackNumber) ? { callbackNumber: normalizePhone(saved.callbackNumber)! } : {}),
            doNotCall: Array.isArray(saved.doNotCall) ? saved.doNotCall.filter((n): n is string => typeof n === "string" && normalizePhone(n) === n) : [],
          };
        }
      }
    } catch {
      records = {};
    }
    this.records = records;
    return records;
  }

  private save(): void {
    const records = this.load();
    const cutoff = this.now() - CALL_RETENTION_MS;
    const kept = Object.values(records)
      .filter((row) => row.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_RECORDS);
    this.records = Object.fromEntries(kept.map((row) => [row.id, row]));
    writeFileAtomic(this.file, JSON.stringify({ version: 1, records: this.records, settings: this.settings() }), { mode: 0o600 });
  }

  settings(): OutboundCallSettings {
    this.load();
    const config = this.config ?? { enabled: false, doNotCall: [] };
    return { enabled: config.enabled, ...(config.callbackNumber ? { callbackNumber: config.callbackNumber } : {}), doNotCall: [...config.doNotCall] };
  }

  /** An admin's change. Throws OutboundCallError on a bad number. */
  updateSettings(patch: { enabled?: unknown; callbackNumber?: unknown; addDoNotCall?: unknown; removeDoNotCall?: unknown }): OutboundCallSettings {
    const next = this.settings();
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") throw new OutboundCallError("enabled is true or false", "invalid_settings");
      next.enabled = patch.enabled;
    }
    if (patch.callbackNumber !== undefined) {
      if (patch.callbackNumber === null || patch.callbackNumber === "") delete next.callbackNumber;
      else {
        const number = typeof patch.callbackNumber === "string" ? normalizePhone(patch.callbackNumber) : null;
        if (!number || !canadianNumber(number)) throw new OutboundCallError("The callback number must be a Canadian phone number.", "invalid_callback");
        next.callbackNumber = number;
      }
    }
    if (patch.addDoNotCall !== undefined) {
      const number = typeof patch.addDoNotCall === "string" ? normalizePhone(patch.addDoNotCall) : null;
      if (!number) throw new OutboundCallError("The do-not-call entry must be a phone number.", "invalid_number");
      if (!next.doNotCall.includes(number)) {
        if (next.doNotCall.length >= MAX_DO_NOT_CALL) throw new OutboundCallError("The do-not-call list is full.", "list_full");
        next.doNotCall.push(number);
      }
    }
    if (patch.removeDoNotCall !== undefined) {
      const number = typeof patch.removeDoNotCall === "string" ? normalizePhone(patch.removeDoNotCall) : null;
      next.doNotCall = next.doNotCall.filter((entry) => entry !== number);
    }
    this.config = next;
    this.save();
    return this.settings();
  }

  /** Why this person may not ask for another call now, or null. */
  overLimit(principalId: string, kind: "cards" | "calls"): string | null {
    const since = this.now() - DAY_MS;
    const rows = Object.values(this.load()).filter((row) => row.principalId === principalId);
    const count = kind === "cards"
      ? rows.filter((row) => row.createdAt >= since).length
      : rows.filter((row) => row.status === "placed" && (row.answeredAt ?? row.createdAt) >= since).length;
    return count >= CALL_LIMITS_PER_DAY[kind]
      ? `The pilot allows ${CALL_LIMITS_PER_DAY[kind]} ${kind === "cards" ? "call cards" : "calls"} per person per day. Nothing was placed; try again tomorrow.`
      : null;
  }

  get(id: string): OutboundCallRecord | undefined {
    return this.load()[id];
  }

  private live(row: OutboundCallRecord): boolean {
    return row.status === "pending" && row.createdAt + CALL_PENDING_MS > this.now();
  }

  /** Calls waiting on this person, newest first. */
  pending(principalId: string): OutboundCallRecord[] {
    return Object.values(this.load())
      .filter((row) => row.principalId === principalId && this.live(row))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The approved, unused record that covers this exact call, if any. */
  approvedFor(input: { principalId: string; botId: string; threadId: string; request: OutboundCallRequest; names?: { botName: string; personName: string; callback?: string } }): OutboundCallRecord | undefined {
    const digest = digestOf(input.request, input.names);
    const now = this.now();
    return Object.values(this.load()).find((row) => row.status === "approved" && row.principalId === input.principalId
      && row.botId === input.botId && row.threadId === input.threadId && row.digest === digest && (row.expiresAt ?? 0) > now);
  }

  /** A new pending call, or the one already waiting for these same words. */
  open(input: { principalId: string; botId: string; threadId: string; request: OutboundCallRequest; names?: { botName: string; personName: string; callback?: string } }): { record: OutboundCallRecord; already: boolean; replaced: OutboundCallRecord[] } {
    const records = this.load();
    const digest = digestOf(input.request, input.names);
    const waiting = Object.values(records).find((row) => this.live(row) && row.principalId === input.principalId
      && row.botId === input.botId && row.threadId === input.threadId && row.digest === digest);
    if (waiting) return { record: waiting, already: true, replaced: [] };
    // a newer ask from the same bot in the same conversation replaces an
    // older one, and a stale card is closed
    const replaced: OutboundCallRecord[] = [];
    for (const row of Object.values(records)) {
      if (row.status === "pending" && row.principalId === input.principalId && row.botId === input.botId && row.threadId === input.threadId) {
        row.status = "denied";
        row.answeredAt = this.now();
        row.error = "replaced";
        replaced.push(row);
      }
    }
    let id = "";
    for (let attempt = 0; attempt < 5 && (!id || records[id]); attempt += 1) id = `call_${randomBytes(8).toString("hex")}`;
    if (records[id]) throw new OutboundCallError("The call could not be saved.", "unavailable", 503);
    const record: OutboundCallRecord = {
      id, principalId: input.principalId, botId: input.botId, threadId: input.threadId,
      request: input.request, digest, status: "pending", createdAt: this.now(),
    };
    records[id] = record;
    this.save();
    return { record, already: false, replaced };
  }

  attachMessage(id: string, messageId: string): void {
    const row = this.load()[id];
    if (!row) return;
    row.messageId = messageId;
    this.save();
  }

  /** The person's answer: call (this once, the number confirmed on the
   * card) or deny. */
  answer(principalId: string, id: string, decision: unknown, via?: string, confirmedTo?: unknown, confirmed?: unknown): OutboundCallRecord {
    if (decision !== "call" && decision !== "deny") throw new OutboundCallError("decision must be call or deny", "invalid_decision");
    const row = this.load()[id];
    if (!row || row.principalId !== principalId) throw new OutboundCallError("No such call", "unknown_call", 404);
    if (decision === "call" && (confirmed !== true || typeof confirmedTo !== "string" || normalizePhone(confirmedTo) !== row.request.to)) {
      throw new OutboundCallError("Check and confirm the number on the card before calling.", "confirm_number");
    }
    if (row.status !== "pending") throw new OutboundCallError("This call was already answered.", "not_pending", 409);
    if (!this.live(row)) throw new OutboundCallError("This call card is more than a day old. Ask the bot again.", "expired", 409);
    row.status = decision === "call" ? "approved" : "denied";
    row.answeredAt = this.now();
    if (decision === "call") row.expiresAt = this.now() + CALL_APPROVAL_MS;
    if (via) row.via = via.slice(0, 80);
    this.save();
    return row;
  }

  /** Take the approval before the call leaves: a second, concurrent try
   * finds nothing to use. False when another took it first. */
  claim(id: string): boolean {
    const row = this.load()[id];
    if (!row || row.status !== "approved") return false;
    row.status = "placing";
    this.save();
    return true;
  }

  /** The approval is used: placed with Twilio's call sid, or failed. */
  settle(id: string, outcome: { callSid?: string } | { error: string }): OutboundCallRecord | undefined {
    const row = this.load()[id];
    if (!row) return undefined;
    if (!("error" in outcome)) {
      row.status = "placed";
      if (outcome.callSid) row.callSid = outcome.callSid.slice(0, 64);
    } else {
      row.status = "failed";
      row.error = outcome.error.slice(0, 240);
    }
    this.save();
    return row;
  }
}

/** The card the conversation shows for a call: no id in its words. */
export function callCard(row: OutboundCallRecord, botName: string, callback?: string): OutboundCard {
  return {
    kind: "call",
    id: row.id,
    status: row.status === "approved" || row.status === "placing" ? "approved" : row.status === "denied" ? "denied" : row.status === "placed" ? "done" : row.status === "failed" ? "failed" : "pending",
    botName,
    destination: formatPhone(row.request.to),
    from: formatPhone(row.request.from),
    ...(callback ? { callback: formatPhone(callback) } : {}),
    purpose: row.request.purpose,
    script: row.request.message,
    language: row.request.language,
    ...(row.via ? { via: row.via } : {}),
    ...(row.error && row.status === "failed" ? { error: row.error } : {}),
  };
}

/** The text a client without the card reads. */
export function callCardText(row: OutboundCallRecord): string {
  const to = formatPhone(row.request.to);
  if (row.status === "placed") return `Phone call placed to ${to}.`;
  if (row.status === "failed") return `Phone call to ${to} failed.`;
  if (row.status === "denied") return `Phone call to ${to}: not placed.`;
  if (row.status === "approved" || row.status === "placing") return `Phone call to ${to}: allowed, placing it.`;
  return `Phone call to ${to}? ${row.request.purpose}`;
}

/** What the bot is told after the person answered. */
export function callAnswerNote(row: OutboundCallRecord): string {
  const to = maskPhone(row.request.to);
  return row.status === "approved"
    ? `Sagax phone call update: the person allowed the call to ${to}. Place it now: call place_phone_call again with exactly the same to, from, purpose, message and language. The approval is used once and ends in 15 minutes.`
    : `Sagax phone call update: the person declined the call to ${to}. Do not call. Continue without it, or tell them what you could not do.`;
}

export interface PlaceCallDeps {
  calls: OutboundCalls;
  /** twilio_api__write as the person who speaks in this turn (perspicaxMcp.callTool). */
  twilio(args: Record<string, unknown>): Promise<{ ok: true; isError: boolean; value: unknown } | { ok: false; code: string; error: string }>;
  /** The bot, and on whose behalf it calls (the person, else the organization). */
  names: { botName: string; personName: string };
  language: CallLanguage;
  /** Write the card row, or update it; returns the row's id. */
  card(row: OutboundCallRecord, existingMessageId?: string): string | undefined;
  log?(line: string): void;
}

/** A name said on the call: visible characters, cut at 80 on a word, never
 * emptied by its length. */
function shortName(raw: string): string {
  let visible = "";
  for (const char of raw.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")) {
    const code = char.codePointAt(0) ?? 0;
    visible += code >= 32 && code !== 127 ? char : " ";
  }
  const text = visible.replace(/\s+/g, " ").trim();
  if (text.length <= 80) return text;
  const cut = text.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

/** Twilio's call sid, wherever the connector put it. */
function sidOf(value: unknown): string | undefined {
  let text = "";
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  } catch {
    return undefined;
  }
  return /\bCA[0-9a-f]{32}\b/.exec(text)?.[0];
}

function shortError(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : fallback;
  return text.replace(/\s+/g, " ").slice(0, 240) || fallback;
}

/** One place_phone_call: a card the first time, the call once approved. */
export async function placePhoneCall(deps: PlaceCallDeps, context: { principalId: string; botId: string; threadId: string }, args: unknown): Promise<{ text: string; isError?: boolean }> {
  const request = parseOutboundCall(args, deps.language);
  if (typeof request === "string") return { text: request, isError: true };
  // the pilot gate (ÉFVP 2026-10-22), checked again when the call leaves
  const settings = deps.calls.settings();
  if (!settings.enabled) return { text: "Phone calls are off for this organization: an admin turns the pilot on in Settings > Organization > Phone calls. Nothing was placed.", isError: true };
  if (!settings.callbackNumber) return { text: "No callback number is set: an admin adds it in Settings > Organization > Phone calls. Every call says it, so none is placed without it.", isError: true };
  if (settings.doNotCall.includes(request.to)) return { text: `${maskPhone(request.to)} is on the organization's do-not-call list. Nothing was placed; do not call it another way.`, isError: true };
  const names: CallNames = { botName: shortName(deps.names.botName), personName: shortName(deps.names.personName), callback: settings.callbackNumber };
  if (!names.personName) return { text: "Sagax cannot say on whose behalf this call is made. Nothing was placed.", isError: true };
  const twiml = callTwiml(request, names);
  const approved = deps.calls.approvedFor({ ...context, request, names });
  if (approved && deps.calls.overLimit(context.principalId, "calls")) return { text: deps.calls.overLimit(context.principalId, "calls")!, isError: true };
  if (approved && deps.calls.claim(approved.id)) {
    // used now, whatever Twilio answers: a retry asks again
    const answer = await deps.twilio(createCallArgs(request, twiml, false));
    // a write Twilio did not refuse is a placed call, even when its sid
    // cannot be read: never "failed", or the person would approve it twice
    const placed = answer.ok && !answer.isError;
    const sid = placed ? sidOf(answer.value) : undefined;
    const settled = deps.calls.settle(approved.id, placed ? (sid ? { callSid: sid } : {}) : { error: answer.ok ? shortError(answer.value, "Twilio refused the call") : answer.error })!;
    deps.card(settled, settled.messageId);
    deps.log?.(`outbound call ${settled.status} to ${maskPhone(request.to)}`);
    if (!placed) return { text: `The call to ${maskPhone(request.to)} was not placed: ${settled.error ?? "no answer from Twilio"}. Tell the person; do not retry without a new approval.`, isError: true };
    return { text: `Call placed to ${maskPhone(request.to)}: it says the AI disclosure, your purpose and your message, then hangs up. Tell the person it was placed. The outcome shows in Twilio's call log (twilio_api__query Calls).` };
  }
  const waiting = deps.calls.pending(context.principalId).some((row) => row.botId === context.botId && row.threadId === context.threadId && row.request.to === request.to && row.request.message === request.message && row.request.purpose === request.purpose);
  const capped = waiting ? null : deps.calls.overLimit(context.principalId, "cards");
  if (capped) return { text: capped, isError: true };
  const dry = await deps.twilio(createCallArgs(request, twiml, true));
  if (!dry.ok) return { text: `The call cannot be checked: ${dry.error}. It needs the person's Twilio profile on Perspicax. Nothing was placed.`, isError: true };
  if (dry.isError) return { text: `Twilio's dry run refused this call: ${shortError(dry.value, "refused")}. Fix it, then call place_phone_call again. Nothing was placed.`, isError: true };
  const opened = deps.calls.open({ ...context, request, names });
  for (const old of opened.replaced) deps.card(old, old.messageId);
  const messageId = deps.card(opened.record, opened.record.messageId);
  if (messageId && !opened.record.messageId) deps.calls.attachMessage(opened.record.id, messageId);
  return {
    text: `${opened.already ? "The card is still waiting" : "Sagax showed the person a card"}: call ${formatPhone(request.to)}, "${request.purpose}". Nothing was placed. End your turn now; when they choose Call you are told, then call place_phone_call again with the same arguments.`,
  };
}
