// An outbound phone call a bot places for the person (parité Grok Bot V4,
// spec docs/specs/bot-telephony.md, section 4.4 and 6.5). The call goes out
// through the person's own Twilio profile on Perspicax (decision 1: Sagax
// keeps no Twilio key), after an approval card the person answers once per
// call: never an Always allow (5.7). Until the line's media pipeline exists
// (phase P2), a call speaks a fixed AI disclosure and the bot's message, then
// hangs up: one way, no conversation.
//
// Pure: no disk, no clock, no node built-ins.

import { normalizePhone } from "./allowed-recipients.ts";

export const PLACE_PHONE_CALL_TOOL = "place_phone_call";

/** Canadian area codes (R10: Canada only in the first version). Toll-free
 * and non-geographic codes are left out: they are not Canada's alone. */
const CANADIAN_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382", "387",
  "403", "416", "418", "428", "431", "437", "438", "450", "460", "468", "474", "506", "514", "519", "548", "579",
  "581", "584", "587", "604", "613", "639", "647", "672", "683", "705", "709", "742", "753", "778", "780", "782",
  "807", "819", "825", "867", "873", "879", "902", "905", "942",
]);

export const CALL_LIMITS = { purpose: 200, message: 600, minutes: 10 } as const;

export type CallLanguage = "fr" | "en";

export interface OutboundCallRequest {
  /** E.164, a Canadian number. */
  to: string;
  /** The person's Twilio number the call comes from, E.164. */
  from: string;
  /** Why the bot calls: shown on the card, said after the disclosure. */
  purpose: string;
  /** The words the bot says, as written. */
  message: string;
  language: CallLanguage;
  /** Optional Twilio account (AC...), when the profile serves more than one. */
  account?: string;
}

/** Whether a number is a Canadian geographic number. */
export function canadianNumber(e164: string): boolean {
  const match = /^\+1(\d{3})(\d{3})\d{4}$/.exec(e164);
  if (!match || !CANADIAN_AREA_CODES.has(match[1]!)) return false;
  // a real exchange: not 0 or 1 first, not N11 (211, 411, 911...), not 976 (premium)
  const exchange = match[2]!;
  return !/^[01]/.test(exchange) && !/^\d11$/.test(exchange) && exchange !== "976";
}

/** "+1 514 ••• •• 42": what a log line, an audit row or a transcript shows. */
export function maskPhone(e164: string): string {
  const match = /^\+1(\d{3})\d{5}(\d{2})$/.exec(e164);
  if (match) return `+1 ${match[1]} ••• •• ${match[2]}`;
  const digits = e164.replace(/\D/g, "");
  return digits.length > 4 ? `+${"•".repeat(digits.length - 2)}${digits.slice(-2)}` : "•••";
}

/** "+1 514 555 0142": the full number, for the person's own card. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

/** Zero-width and bidi controls: they hide or reorder what the card shows. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.replace(INVISIBLE, "")) {
    const code = char.codePointAt(0) ?? 0;
    text += code >= 32 && code !== 127 ? char : " ";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
}

/** place_phone_call arguments. A string is the refusal, written for the bot. */
export function parseOutboundCall(args: unknown, fallbackLanguage: CallLanguage = "fr"): OutboundCallRequest | string {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  if (!row) return "place_phone_call needs to, from, purpose and message.";
  const to = typeof row.to === "string" ? normalizePhone(row.to) : null;
  if (!to) return "to must be a phone number, such as +1 514 555 0142.";
  if (!canadianNumber(to)) return "Only Canadian numbers can be called for now. Nothing was placed.";
  const from = typeof row.from === "string" ? normalizePhone(row.from) : null;
  if (!from) return "from must be the person's Twilio number the call comes from (read it with twilio_api__query IncomingPhoneNumbers).";
  if (from === to) return "from and to are the same number.";
  const purpose = clean(row.purpose, CALL_LIMITS.purpose);
  if (!purpose) return `purpose: one short sentence, at most ${CALL_LIMITS.purpose} characters, saying why you call.`;
  const message = clean(row.message, CALL_LIMITS.message);
  if (!message) return `message: the words to say, at most ${CALL_LIMITS.message} characters.`;
  const language = row.language === "en" || row.language === "fr" ? row.language : fallbackLanguage;
  const account = typeof row.account === "string" && /^AC[0-9a-f]{32}$/.test(row.account.trim()) ? row.account.trim() : undefined;
  if (row.account !== undefined && !account) return "account must be the Twilio account sid (AC...), or left out.";
  return { to, from, purpose, message, language, ...(account ? { account } : {}) };
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A number as it is said: "4 3 8, 5 5 5, 0 1 0 0". */
export function spokenNumber(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  const groups = match ? [match[1]!, match[2]!, match[3]!] : [e164.replace(/\D/g, "")];
  return groups.map((group) => group.split("").join(" ")).join(", ");
}

export interface CallNames {
  botName: string;
  /** On whose behalf: the person, else the organization. */
  personName: string;
  /** The organization's callback number, E.164 (required: no number, no call). */
  callback: string;
}

/** The fixed opening (spec 5.4, ÉFVP 2026-10-22): an AI assistant, on whose
 * behalf, how to call back, and how to stop the calls. The bot can neither
 * change it nor leave it out. */
export function callDisclosure(input: CallNames & { language: CallLanguage }): string {
  const bot = clean(input.botName, 80) || (input.language === "fr" ? "un assistant" : "an assistant");
  const person = clean(input.personName, 80);
  const number = spokenNumber(input.callback);
  return input.language === "fr"
    ? `Bonjour. Ceci est un appel automatisé de ${bot}, un assistant d'intelligence artificielle, au nom de ${person}. Pour nous joindre, composez le ${number}. Pour ne plus recevoir d'appels, dites-le au ${number}.`
    : `Hello. This is an automated call from ${bot}, an artificial intelligence assistant, calling on behalf of ${person}. To reach us, call ${number}. To stop receiving these calls, say so at ${number}.`;
}

/** The whole call, as TwiML: the opening, the purpose, the message twice,
 * the callback number again. Built here, never taken from the bot (R16):
 * no Url, no Twiml of its own. */
export function callTwiml(request: Pick<OutboundCallRequest, "purpose" | "message" | "language">, names: CallNames): string {
  const voice = request.language === "fr" ? "fr-CA" : "en-CA";
  const say = (text: string) => `<Say language="${voice}">${xml(text)}</Say>`;
  const again = request.language === "fr" ? "Je répète." : "Once again.";
  const number = spokenNumber(names.callback);
  const bye = request.language === "fr"
    ? `Pour nous joindre ou ne plus recevoir d'appels : ${number}. Au revoir.`
    : `To reach us or stop these calls: ${number}. Goodbye.`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(callDisclosure({ ...names, language: request.language }))}<Pause length="1"/>${say(request.purpose)}<Pause length="1"/>${say(request.message)}<Pause length="1"/>${say(again)}${say(request.message)}${say(bye)}<Hangup/></Response>`;
}

/** The Perspicax twilio_api__write arguments for this call. */
export function createCallArgs(request: OutboundCallRequest, twiml: string, dryRun: boolean): Record<string, unknown> {
  return {
    resource: "Calls",
    action: "create",
    ...(request.account ? { parent: request.account } : {}),
    // no answering machine detection: it costs per call and a one-way
    // message says the same thing to a person or a voicemail
    set: { To: request.to, From: request.from, Twiml: twiml, TimeLimit: CALL_LIMITS.minutes * 60 },
    ...(dryRun ? { _dry_run: true } : {}),
  };
}

/** What one approval covers: the same number, the same words. */
export function callDigestSource(request: OutboundCallRequest, names?: { botName: string; personName: string; callback?: string }): string {
  return JSON.stringify([request.to, request.from, request.purpose, request.message, request.language, request.account ?? "", names?.botName ?? "", names?.personName ?? "", names?.callback ?? ""]);
}

export const PLACE_PHONE_CALL_TOOL_SPEC = {
  name: PLACE_PHONE_CALL_TOOL,
  description:
    "Place a phone call for the person through their Twilio profile on Perspicax, to a Canadian number. The call says a fixed opening (an automated call from you, an AI assistant, for the person), then your purpose and your message, repeats the message once and hangs up: the other side cannot talk with you yet. The first call shows the person an approval card with the number, the purpose and the exact words (a dry run checks the request; nothing is placed). After they choose Call, call place_phone_call again with the very same arguments to place it. One approval places one call; any change asks again. Never call twilio_api__write Calls yourself.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "The number to call, such as +1 514 555 0142. Canada only." },
      from: { type: "string", description: "The person's Twilio number the call comes from (twilio_api__query IncomingPhoneNumbers)." },
      purpose: { type: "string", description: "One short sentence: why you call, said after the opening and shown on the card." },
      message: { type: "string", description: "The exact words to say, at most 600 characters. Nothing confidential." },
      language: { type: "string", enum: ["fr", "en"], description: "The call's language. Defaults to the person's." },
      account: { type: "string", description: "Optional Twilio account sid (AC...), when the profile serves more than one." },
    },
    required: ["to", "from", "purpose", "message"],
  },
} as const;
