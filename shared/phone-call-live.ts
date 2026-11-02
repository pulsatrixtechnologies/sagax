// Live outbound phone call state on the conversation card (reference parity
// structure, Sagax words). Pure: no disk, no clock, no node built-ins.
//
// Phases match what the person sees on the live card. Events (hold, DTMF,
// transfer) are shown as rows in the transcript stream. The recording URL
// is a Sagax proxy path, never a raw Twilio URL.

export const PHONE_CALL_PHASES = [
  "dialing",
  "ringing",
  "on_hold",
  "in_call",
  "transferred",
  "ended",
] as const;

export type PhoneCallPhase = (typeof PHONE_CALL_PHASES)[number];

export const PHONE_CALL_LIVE_PHASES: ReadonlySet<PhoneCallPhase> = new Set([
  "dialing",
  "ringing",
  "on_hold",
  "in_call",
  "transferred",
]);

export type PhoneCallEventKind = "hold" | "dtmf" | "transfer" | "resume";

export interface PhoneCallLiveLine {
  speaker: "bot" | "callee" | "system";
  text: string;
  /** epoch ms when the line arrived (optional for older cards). */
  at?: number;
}

export interface PhoneCallLiveEvent {
  kind: PhoneCallEventKind;
  /** Digits pressed, destination of a transfer, or a short note. */
  detail: string;
  at: number;
}

/** Mid-call control tools the bot uses while a conversation call is live. */
export const SEND_DTMF_TOOL = "send_dtmf";
export const TRANSFER_CALL_TOOL = "transfer";
export const HANG_UP_TOOL = "hang_up";
/** Alias of place_phone_call for the reference tool name; same card and path. */
export const PLACE_CALL_TOOL = "place_call";

export const DTMF_DIGITS = /^[0-9*#wW]{1,32}$/;

export function isPhoneCallPhase(value: unknown): value is PhoneCallPhase {
  return typeof value === "string" && (PHONE_CALL_PHASES as readonly string[]).includes(value);
}

/** Whole seconds since startedAt, capped at a day so a stuck card stays readable. */
export function liveCallElapsed(startedAt: number | undefined, now: number): number {
  if (!startedAt || !Number.isFinite(startedAt) || startedAt > now) return 0;
  return Math.min(86_400, Math.max(0, Math.floor((now - startedAt) / 1000)));
}

/** "4:07" for the live timer and the ended chip. */
export function formatLiveDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function parseDtmfDigits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.trim();
  return DTMF_DIGITS.test(digits) ? digits : null;
}

/** Tool specs offered beside place_phone_call while Perspicax is linked. */
export const PLACE_CALL_TOOL_SPEC = {
  name: PLACE_CALL_TOOL,
  description:
    "Same as place_phone_call: place a phone call for the person (message or conversation). Prefer place_phone_call; this name is kept for compatibility.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "The number to call, such as +1 514 555 0142. Canada only." },
      mode: { type: "string", enum: ["message", "conversation"], description: "message or conversation." },
      objective: { type: "string", description: "conversation: what you must obtain or say." },
      instructions: { type: "string", description: "conversation: guidance during the call." },
      max_minutes: { type: "integer", minimum: 1, maximum: 20 },
      voicemail: { type: "string" },
      from: { type: "string" },
      purpose: { type: "string" },
      message: { type: "string" },
      language: { type: "string", enum: ["fr", "en"] },
      account: { type: "string" },
    },
    required: ["to"],
  },
} as const;

export const SEND_DTMF_TOOL_SPEC = {
  name: SEND_DTMF_TOOL,
  description:
    "While a conversation call you placed is live, press keys (DTMF) for menus and hold queues. digits: 0-9, *, #, and w for a short pause. The live card shows the keys.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      digits: { type: "string", description: "Keys to send, such as 1 or 1234# or ww1." },
      call_id: { type: "string", description: "Optional call id when more than one live call exists." },
    },
    required: ["digits"],
  },
} as const;

export const TRANSFER_CALL_TOOL_SPEC = {
  name: TRANSFER_CALL_TOOL,
  description:
    "While a conversation call you placed is live, transfer it to another Canadian number. The live card shows Transferred.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "Number to transfer to, such as +1 514 555 0199." },
      call_id: { type: "string", description: "Optional call id when more than one live call exists." },
    },
    required: ["to"],
  },
} as const;

export const HANG_UP_TOOL_SPEC = {
  name: HANG_UP_TOOL,
  description:
    "Hang up the live conversation call you placed in this conversation. The person can also End call on the card.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      call_id: { type: "string", description: "Optional call id when more than one live call exists." },
    },
  },
} as const;
