// Mid-call controls for a live conversation outbound call: hang up, send
// DTMF, transfer. Sagax builds the Twilio Calls update itself (judged path,
// never a bot's own Twilio frame) through the person's Perspicax access,
// the same link place_phone_call already uses. Pure helpers plus the async
// runners that take a mocked or live Twilio write.
import { normalizePhone } from "../../shared/allowed-recipients.ts";
import { canadianNumber, formatPhone, maskPhone } from "../../shared/outbound-call.ts";
import { parseDtmfDigits, type PhoneCallEventKind, type PhoneCallLiveEvent, type PhoneCallPhase } from "../../shared/phone-call-live.ts";
import type { OutboundCallRecord, OutboundCalls } from "../outbound/outbound-calls.ts";

type ToolAnswer = { ok: true; isError: boolean; value: unknown } | { ok: false; code: string; error: string };

export interface CallControlDeps {
  calls: OutboundCalls;
  /** twilio_api_write as the person (harness path). */
  twilio(args: Record<string, unknown>): Promise<ToolAnswer>;
  /** Patch the live card after a control or a progress event. */
  patchLive(row: OutboundCallRecord, change: LiveCallPatch): void;
  now?: () => number;
  log?(line: string): void;
}

export interface LiveCallPatch {
  phase?: PhoneCallPhase;
  liveTranscript?: { speaker: "bot" | "callee" | "system"; text: string; at?: number }[];
  liveEvents?: PhoneCallLiveEvent[];
  calleeName?: string;
  recordingUrl?: string;
  liveStartedAt?: number;
}

function shortError(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : fallback;
  return text.replace(/\s+/g, " ").slice(0, 240) || fallback;
}

/** A conversation call that is placed and not yet settled with a result. */
export function findLiveCall(calls: OutboundCalls, input: {
  principalId: string;
  botId: string;
  threadId: string;
  callId?: string;
}): OutboundCallRecord | null {
  return calls.liveFor(input) ?? null;
}

function updateCallArgs(callSid: string, set: Record<string, unknown>): Record<string, unknown> {
  return {
    resource: "Calls",
    action: "update",
    id: callSid,
    set,
  };
}

function eventOf(kind: PhoneCallEventKind, detail: string, at: number): PhoneCallLiveEvent {
  return { kind, detail, at };
}

/** #4304: Twilio's answer when the call it is asked to end is already over
 * (error 21220, "Call is not in-progress"): the call ended, nothing failed. */
export function callAlreadyOver(value: unknown): boolean {
  const text = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : "";
  return /\b21220\b|not in-progress|not in progress/i.test(text);
}

export async function hangUpLiveCall(deps: CallControlDeps, input: {
  principalId: string;
  botId: string;
  threadId: string;
  callId?: string;
}): Promise<{ text: string; isError?: boolean }> {
  const row = findLiveCall(deps.calls, input);
  if (!row?.callSid) return { text: "No live conversation call to hang up in this conversation.", isError: true };
  const answer = await deps.twilio(updateCallArgs(row.callSid, { Status: "completed" }));
  const over = answer.ok && answer.isError && callAlreadyOver(answer.value);
  if ((!answer.ok || answer.isError) && !over) {
    return { text: `Could not hang up: ${answer.ok ? shortError(answer.value, "refused") : answer.error}.`, isError: true };
  }
  if (over) {
    // the call was already over: the card says so, no error and no event
    deps.patchLive(row, { phase: "ended" });
    return { text: `The call to ${maskPhone(row.request.to)} had already ended. The result card arrives when Perspicax reports the end.` };
  }
  const at = (deps.now ?? Date.now)();
  deps.patchLive(row, { phase: "ended", liveEvents: [...(row as { liveEvents?: PhoneCallLiveEvent[] }).liveEvents ?? [], eventOf("resume", "ended by you", at)] });
  deps.log?.(`outbound hang_up ${row.id}`);
  return { text: `Hung up the call to ${maskPhone(row.request.to)}. The result card arrives when Perspicax reports the end.` };
}

export async function sendDtmfLiveCall(deps: CallControlDeps, input: {
  principalId: string;
  botId: string;
  threadId: string;
  digits: unknown;
  callId?: string;
}): Promise<{ text: string; isError?: boolean }> {
  const digits = parseDtmfDigits(input.digits);
  if (!digits) return { text: "send_dtmf needs digits: 0-9, *, #, and optional w pauses (at most 32).", isError: true };
  const row = findLiveCall(deps.calls, input);
  if (!row?.callSid) return { text: "No live conversation call to send keys on.", isError: true };
  // Redirect briefly to play the digits, then Twilio resumes the previous TwiML
  // URL when Twiml is a complete Response with Hangup omitted: we use Play
  // digits alone via Status update with Twiml that plays and redirects back
  // is not available without Perspicax's stream URL. SendDigits on update is
  // accepted by Twilio for in-progress calls on some accounts; we send it as
  // Twiml Play digits which Twilio applies to the live leg.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play digits="${digits.replace(/"/g, "")}"/></Response>`;
  const answer = await deps.twilio(updateCallArgs(row.callSid, { Twiml: twiml }));
  if (!answer.ok || answer.isError) {
    return { text: `Could not send keys: ${answer.ok ? shortError(answer.value, "refused") : answer.error}.`, isError: true };
  }
  const at = (deps.now ?? Date.now)();
  deps.patchLive(row, {
    liveEvents: [...((row as { liveEvents?: PhoneCallLiveEvent[] }).liveEvents ?? []), eventOf("dtmf", digits, at)],
    liveTranscript: [
      ...((row as { liveTranscript?: LiveCallPatch["liveTranscript"] }).liveTranscript ?? []),
      { speaker: "system", text: `Keys pressed: ${digits}`, at },
    ],
  });
  deps.log?.(`outbound send_dtmf ${row.id}`);
  return { text: `Sent keys ${digits} on the call to ${maskPhone(row.request.to)}.` };
}

export async function transferLiveCall(deps: CallControlDeps, input: {
  principalId: string;
  botId: string;
  threadId: string;
  to: unknown;
  callId?: string;
}): Promise<{ text: string; isError?: boolean }> {
  const to = typeof input.to === "string" ? normalizePhone(input.to) : null;
  if (!to) return { text: "transfer needs to: a phone number such as +1 514 555 0142.", isError: true };
  if (!canadianNumber(to)) return { text: "Only Canadian numbers can be transferred to for now.", isError: true };
  const row = findLiveCall(deps.calls, input);
  if (!row?.callSid) return { text: "No live conversation call to transfer.", isError: true };
  if (to === row.request.to) return { text: "to is already the number on this call.", isError: true };
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${to}</Dial></Response>`;
  const answer = await deps.twilio(updateCallArgs(row.callSid, { Twiml: twiml }));
  if (!answer.ok || answer.isError) {
    return { text: `Could not transfer: ${answer.ok ? shortError(answer.value, "refused") : answer.error}.`, isError: true };
  }
  const at = (deps.now ?? Date.now)();
  deps.patchLive(row, {
    phase: "transferred",
    liveEvents: [...((row as { liveEvents?: PhoneCallLiveEvent[] }).liveEvents ?? []), eventOf("transfer", formatPhone(to), at)],
    liveTranscript: [
      ...((row as { liveTranscript?: LiveCallPatch["liveTranscript"] }).liveTranscript ?? []),
      { speaker: "system", text: `Transferred to ${formatPhone(to)}`, at },
    ],
  });
  deps.log?.(`outbound transfer ${row.id} to ${maskPhone(to)}`);
  return { text: `Transferred the call to ${maskPhone(to)}. Stay on the card for the new leg.` };
}
