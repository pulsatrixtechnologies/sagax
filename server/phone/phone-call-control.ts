// Mid-call controls for a live conversation outbound call: hang up and send
// DTMF (Sagax builds the Twilio Calls update itself, judged path, never a
// bot's own Twilio frame), and take over (Perspicax voice_call control
// take_over, which owns the transfer and its failure path), all through the
// person's Perspicax access, the same link place_phone_call already uses.
// Pure helpers plus the async runners that take a mocked or live write.
import { normalizePhone } from "../../shared/allowed-recipients.ts";
import { maskPhone } from "../../shared/outbound-call.ts";
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
  liveAnsweredAt?: number;
  /** The take over's state on the card; null clears it (nobody answered). */
  takeOver?: { state: "transferring" | "answered"; at: number } | null;
  /** Lines added after the card's own (deduped), such as a system line. */
  appendLines?: { speaker: "bot" | "callee" | "system"; text: string; at?: number }[];
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

/** Perspicax's refusal of a take over, in plain words (never a key, never an id). */
export function takeOverRefusal(value: unknown): { code: string; text: string } {
  const said = shortError(value, "refused");
  if (/no_take_over_number/.test(said)) return { code: "no_take_over_number", text: "There is no verified number of the person's own on their Perspicax Voice line to ring (voice_number verify adds one)." };
  if (/taken_over/.test(said)) return { code: "taken_over", text: "This call is already being handed to the person." };
  if (/not_live/.test(said)) return { code: "not_live", text: "This call is not under way with the bot's voice (not answered yet, or over)." };
  if (/no_call/.test(said)) return { code: "unknown_call", text: "Perspicax has no call of the person's with this card." };
  return { code: "takeover_failed", text: `Perspicax could not transfer the call: ${said}` };
}

/** The number a take over rang, from Perspicax's `taken_over` answer. */
function rangNumber(value: unknown): string | undefined {
  let record: unknown = value;
  if (typeof value === "string") {
    try { record = JSON.parse(value); } catch { record = null; }
  }
  const to = record && typeof record === "object" ? (record as Record<string, unknown>).to : undefined;
  return typeof to === "string" && /^\+[1-9]\d{6,14}$/.test(to) ? to : undefined;
}

export interface TakeOverDeps {
  calls: OutboundCalls;
  /** Perspicax voice_call as the person (their own line). */
  voice(args: Record<string, unknown>): Promise<ToolAnswer>;
  patchLive(row: OutboundCallRecord, change: LiveCallPatch): void;
  now?: () => number;
  log?(line: string): void;
}

/** The person takes the live call over (live call card lot 4): Perspicax
 * voice_call `control: "take_over"` with the call's `ref` rings their own
 * verified number at once (`takeOverTo`, their "Reach me" number, when it
 * is verified on the line; else their first verified one). The card shows
 * the transfer ringing; Perspicax brings the call back to the bot when
 * nobody answers. A refusal changes nothing: the bot keeps talking. One
 * path for the person's Take over and the bot's `transfer` tool. */
export async function takeOverLiveCall(deps: TakeOverDeps, input: {
  principalId: string;
  botId: string;
  threadId: string;
  callId?: string;
  takeOverTo?: string;
}): Promise<{ text: string; isError?: boolean; code?: string; to?: string }> {
  const row = findLiveCall(deps.calls, input);
  if (!row) return { text: "No live conversation call to take over in this conversation.", isError: true, code: "not_live" };
  const takeOverTo = input.takeOverTo ? normalizePhone(input.takeOverTo) : null;
  const answer = await deps.voice({ control: "take_over", ref: row.id, ...(takeOverTo ? { take_over_to: takeOverTo } : {}) });
  if (!answer.ok) return { text: `Could not transfer the call: ${answer.error}.`, isError: true, code: "takeover_failed" };
  if (answer.isError) {
    const refused = takeOverRefusal(answer.value);
    return { text: refused.text, isError: true, code: refused.code };
  }
  const to = rangNumber(answer.value) ?? row.takeOverNumber;
  const at = (deps.now ?? Date.now)();
  deps.patchLive(row, { phase: "transferred", takeOver: { state: "transferring", at } });
  deps.log?.(`outbound take_over ${row.id}${to ? ` to ${maskPhone(to)}` : ""}`);
  return {
    text: `The call to ${maskPhone(row.request.to)} is being handed to the person: their own phone${to ? ` (${maskPhone(to)})` : ""} rings now. Once they answer, your voice leaves the call and they talk with the other party; if nobody answers within 15 seconds, the call comes back to your voice. The result arrives in a new turn.`,
    ...(to ? { to } : {}),
  };
}
