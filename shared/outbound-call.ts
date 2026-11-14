// An outbound phone call a bot places for the person (parité the reference design V4,
// spec docs/specs/bot-telephony.md, section 4.4 and 6.5), after an approval
// card the person answers once per call (5.7). Every call is a live two-way
// conversation, never a spoken message (#4193): it goes out through
// Perspicax Voice on the person's own line (voice_call), the line says the AI
// disclosure, then the realtime voice talks with the callee and the result
// comes back to the conversation (server/outbound/outbound-calls.ts).
//
// Pure: no disk, no clock, no node built-ins.

import { normalizePhone } from "./allowed-recipients.ts";

export const PLACE_PHONE_CALL_TOOL = "place_phone_call";
/** Call the speaking person's own verified number with structured questions
 * (#2194). Resolves to a conversation `place_phone_call` on Perspicax Voice;
 * never a separate telephony stack. */
export const PHONE_CALL_OWNER_TOOL = "phone_call_owner";

/** Owner-call questions: short, one at a time on the line. */
export const OWNER_CALL_LIMITS = { questions: 8, question: 200, context: 600, defaultMinutes: 5 } as const;

/** Canadian area codes (R10: Canada only in the first version). Toll-free
 * and non-geographic codes are left out: they are not Canada's alone. */
const CANADIAN_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382", "387",
  "403", "416", "418", "428", "431", "437", "438", "450", "460", "468", "474", "506", "514", "519", "548", "579",
  "581", "584", "587", "604", "613", "639", "647", "672", "683", "705", "709", "742", "753", "778", "780", "782",
  "807", "819", "825", "867", "873", "879", "902", "905", "942",
]);

/** A conversation call (2026-10-28): the bot talks with the person it
 * calls, through Perspicax Voice on the person's own line. */
export const CONVERSATION_LIMITS = { objective: 200, instructions: 1000, voicemail: 300, defaultMinutes: 5, maxMinutes: 20 } as const;

export type CallLanguage = "fr" | "en";

export interface OutboundCallRequest {
  /** E.164, a Canadian number. */
  to: string;
  /** Empty: the call leaves from the person's own Perspicax Voice line. A
   * record of an older one-way call (before #4193) may still hold a number. */
  from: string;
  /** The call's goal: what the bot must obtain or say (shown on the card). */
  purpose: string;
  /** Empty: a call never reads a text aloud (#4193). A record of an older
   * one-way call may still hold its words; nothing shows or says them. */
  message: string;
  language: CallLanguage;
  /** An older one-way call's Twilio account (records before #4193 only). */
  account?: string;
  /** `conversation` for every call since #4193; absent only on a record of
   * an older one-way call. */
  mode?: "conversation";
  /** A conversation: the bot's guidance during the call. */
  instructions?: string;
  /** A conversation: the most it may last, in minutes. */
  maxMinutes?: number;
  /** A conversation: the short message left on a voicemail. */
  voicemail?: string;
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

/** "514 555-0142": a North American number as a person reads it on a chat
 * line, from its E.164 form or from formatPhone's. Anything else (a name, a
 * number from elsewhere) comes back as it is. */
export function readablePhone(label: string): string {
  const match = /^\+1\s?(\d{3})\s?(\d{3})\s?(\d{4})$/.exec(label.trim());
  return match ? `${match[1]} ${match[2]}-${match[3]}` : label.trim();
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

/** place_phone_call arguments. A string is the refusal, written for the bot.
 * Every call is a live conversation (#4193): `mode` may be left out (or
 * `conversation`, or `live` as voice_call names it); an older one-way call's
 * `purpose` is its objective, and its `from`, `account` and `message` are
 * not used (the call leaves from the person's line and reads no text). */
export function parseOutboundCall(args: unknown, fallbackLanguage: CallLanguage = "fr"): OutboundCallRequest | string {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  if (!row) return "place_phone_call needs to and objective.";
  const to = typeof row.to === "string" ? normalizePhone(row.to) : null;
  if (!to) return "to must be a phone number, such as +1 514 555 0142.";
  if (!canadianNumber(to)) return "Only Canadian numbers can be called for now. Nothing was placed.";
  if (row.mode !== undefined && row.mode !== "conversation" && row.mode !== "live") {
    return "Every call is a live conversation: leave mode out and give the objective (what you must obtain or say). A call never reads a message aloud. Nothing was placed.";
  }
  return parseConversation(row, to, fallbackLanguage);
}

/** Optional text: undefined when absent or blank, null when too long. */
function optional(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined;
  const text = clean(value, max);
  return text ? text : null;
}

function parseConversation(row: Record<string, unknown>, to: string, fallbackLanguage: CallLanguage): OutboundCallRequest | string {
  const objective = clean(row.objective ?? row.purpose, CONVERSATION_LIMITS.objective);
  if (!objective) return `objective: what you must obtain or say on this call, one or two sentences, at most ${CONVERSATION_LIMITS.objective} characters.`;
  const instructions = optional(row.instructions, CONVERSATION_LIMITS.instructions);
  if (instructions === null) return `instructions: at most ${CONVERSATION_LIMITS.instructions} characters.`;
  const voicemail = optional(row.voicemail, CONVERSATION_LIMITS.voicemail);
  if (voicemail === null) return `voicemail: the short message left on a voicemail, at most ${CONVERSATION_LIMITS.voicemail} characters.`;
  const minutes = row.max_minutes ?? row.maxMinutes;
  if (minutes !== undefined && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > CONVERSATION_LIMITS.maxMinutes)) {
    return `max_minutes: a whole number of minutes from 1 to ${CONVERSATION_LIMITS.maxMinutes} (${CONVERSATION_LIMITS.defaultMinutes} when left out).`;
  }
  const language = row.language === "en" || row.language === "fr" ? row.language : fallbackLanguage;
  return {
    to, from: "", purpose: objective, message: "", language, mode: "conversation",
    maxMinutes: typeof minutes === "number" ? minutes : CONVERSATION_LIMITS.defaultMinutes,
    ...(instructions ? { instructions } : {}),
    ...(voicemail ? { voicemail } : {}),
  };
}

/** What one approval covers: the same number, the same goal and guidance. */
export function callDigestSource(request: OutboundCallRequest, names?: { botName: string; personName: string }): string {
  const base = [request.to, request.from, request.purpose, request.message, request.language, request.account ?? "", names?.botName ?? "", names?.personName ?? ""];
  // a conversation's approval covers its guidance, its length and its voicemail too
  return JSON.stringify(request.mode === "conversation"
    ? [...base, "conversation", request.instructions ?? "", request.maxMinutes ?? 0, request.voicemail ?? ""]
    : base);
}

/** The fixed AI disclosure Perspicax Voice says first on a conversation
 * call, before the bot says a word (shown on the card as it is said). */
export function conversationDisclosure(input: { botName: string; personName: string; language: CallLanguage }): string {
  const bot = clean(input.botName, 80) || (input.language === "fr" ? "un assistant" : "an assistant");
  const person = clean(input.personName, 80);
  return input.language === "fr"
    ? `Bonjour, ici ${bot}, un assistant IA qui appelle au nom ${/^[aeiouyàâäéèêëîïôöùûüh]/i.test(person) ? "d'" : "de "}${person}.`
    : `Hello, this is ${bot}, an AI assistant calling on behalf of ${person}.`;
}

/** The Perspicax voice_call arguments of a call (the person's own Perspicax
 * Voice line and Twilio key; the card already had their yes, so `confirm`
 * answers the line's own third party card). Always a conversation, never a
 * message to read (#4193). */
export function voiceCallArgs(request: OutboundCallRequest, input: { botName: string; ref: string; dryRun: boolean }): Record<string, unknown> {
  return {
    to: request.to,
    purpose: request.purpose,
    mode: "conversation",
    ...(request.instructions ? { instructions: request.instructions } : {}),
    max_minutes: request.maxMinutes ?? CONVERSATION_LIMITS.defaultMinutes,
    language: request.language,
    bot_name: clean(input.botName, 80) || "Assistant",
    ref: input.ref,
    ...(request.voicemail ? { voicemail: request.voicemail } : {}),
    confirm: true,
    ...(input.dryRun ? { dry_run: true } : {}),
  };
}

export const PLACE_PHONE_CALL_TOOL_SPEC = {
  name: PLACE_PHONE_CALL_TOOL,
  description:
    "Place a phone call for the person to a Canadian number. Every call is a live two-way conversation with your voice, never a recorded or spoken message: it leaves from the person's own Perspicax Voice line, which opens with \"Hello, this is <you>, an AI assistant calling on behalf of <the person>\"; then you talk live, pursue the objective (the conversation goal, never a script read aloud), follow the instructions, and hang up politely when it is reached, when asked, or at max_minutes (5 by default, 20 at most); a voicemail gets your short message; a callee who asks not to be called again is never called again. Needs objective. When the live voice cannot take the call, nothing is dialed and the answer says why and who can fix it: tell the person. The first call shows the person an approval card (number, objective, guidance, maximum duration; a dry run checks it, nothing is placed). After they choose Call, call again with the very same arguments to place it; one approval places one call. The result returns in a new turn as a card: end your turn after placing it. Never call twilio_api_write Calls or voice_call yourself. To call the person with structured questions, prefer phone_call_owner.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "The number to call, such as +1 514 555 0142. Canada only." },
      objective: { type: "string", description: "The conversation goal: what you must obtain or say on this call, at most 200 characters. Shown on the card." },
      instructions: { type: "string", description: "Your guidance during the call (what you may say or accept, what to avoid), at most 1000 characters." },
      max_minutes: { type: "integer", minimum: 1, maximum: 20, description: "The most the call may last, in minutes (5 when left out)." },
      voicemail: { type: "string", description: "The short message left if a voicemail answers, at most 300 characters. Nothing confidential." },
      language: { type: "string", enum: ["fr", "en"], description: "The call's language. Defaults to the person's." },
    },
    required: ["to", "objective"],
  },
} as const;

export const PHONE_CALL_OWNER_TOOL_SPEC = {
  name: PHONE_CALL_OWNER_TOOL,
  description:
    "Call the person themself on their own verified Perspicax Voice number with structured questions (#2194). Goes out through place_phone_call conversation mode on their line (Perspicax voice_call): one short opening, then one question at a time, then hang up. Answers come back as the call_result in this chat. Needs questions (1 to 8 short ones). Optional context briefs the call. Optional to is their E.164 number; when left out, Sagax uses the number they set under Reach me by text, after voice_line confirms it is verified on their line. Same approval card as place_phone_call (one yes, one call). Never call voice_call yourself.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: OWNER_CALL_LIMITS.questions,
        items: { type: "string", description: `One short question, at most ${OWNER_CALL_LIMITS.question} characters.` },
        description: "The questions to ask, one at a time, in order.",
      },
      context: { type: "string", description: `Optional brief for the call (why you call, what you already know), at most ${OWNER_CALL_LIMITS.context} characters.` },
      to: { type: "string", description: "Optional: the person's own verified number to call. When left out, uses their Reach me SMS number once voice_line verifies it." },
      language: { type: "string", enum: ["fr", "en"], description: "The call's language. Defaults to the person's." },
      max_minutes: { type: "integer", minimum: 1, maximum: 20, description: `At most how long the call may last, in minutes (${OWNER_CALL_LIMITS.defaultMinutes} when left out).` },
    },
    required: ["questions"],
  },
} as const;

/** Build the place_phone_call conversation args for an owner questions call.
 * `to` must already be a Canadian E.164 of the person. A string is the
 * refusal for the bot. */
export function ownerCallToPlaceArgs(
  args: unknown,
  fallbackLanguage: CallLanguage = "fr",
): { to: string; mode: "conversation"; objective: string; instructions: string; language: CallLanguage; max_minutes: number } | string {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  if (!row) return "phone_call_owner needs questions (an array of short questions).";
  const rawQuestions = Array.isArray(row.questions) ? row.questions : null;
  if (!rawQuestions || rawQuestions.length < 1) return "questions: at least one short question.";
  if (rawQuestions.length > OWNER_CALL_LIMITS.questions) return `questions: at most ${OWNER_CALL_LIMITS.questions}.`;
  const questions: string[] = [];
  for (const item of rawQuestions) {
    const text = clean(item, OWNER_CALL_LIMITS.question);
    if (!text) return `each question: one short sentence, at most ${OWNER_CALL_LIMITS.question} characters.`;
    questions.push(text);
  }
  const context = optional(row.context, OWNER_CALL_LIMITS.context);
  if (context === null) return `context: at most ${OWNER_CALL_LIMITS.context} characters.`;
  const to = typeof row.to === "string" ? normalizePhone(row.to) : null;
  if (row.to !== undefined && row.to !== null && row.to !== "" && !to) return "to must be the person's own phone number, such as +1 514 555 0142.";
  if (to && !canadianNumber(to)) return "Only Canadian numbers can be called for now. Nothing was placed.";
  const minutes = row.max_minutes ?? row.maxMinutes;
  if (minutes !== undefined && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > CONVERSATION_LIMITS.maxMinutes)) {
    return `max_minutes: a whole number of minutes from 1 to ${CONVERSATION_LIMITS.maxMinutes} (${OWNER_CALL_LIMITS.defaultMinutes} when left out).`;
  }
  const language = row.language === "en" || row.language === "fr" ? row.language : fallbackLanguage;
  const objective = questions[0]!.length <= CONVERSATION_LIMITS.objective
    ? questions[0]!
    : questions[0]!.slice(0, CONVERSATION_LIMITS.objective);
  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const instructions = [
    language === "fr"
      ? "Tu appelles la personne elle-même. Une seule ouverture courte (\"petite question pour toi\"), puis une question à la fois, dans l'ordre. Après chaque réponse, redis ce que tu as noté, puis passe à la suivante. Quand toutes sont répondues, raccroche poliment. Jamais de ton centre d'appels."
      : "You are calling the person themself. Say one short opening once (\"quick question for you\"), then ask one question at a time, in order. After each answer, read back what you recorded, then move on. When every question is answered, hang up politely. Never help-desk phrasing.",
    language === "fr" ? "Questions :" : "Questions:",
    numbered,
    ...(context ? [language === "fr" ? `Contexte : ${context}` : `Context: ${context}`] : []),
  ].join("\n");
  if (instructions.length > CONVERSATION_LIMITS.instructions) {
    return `questions and context together are too long for the call (at most ${CONVERSATION_LIMITS.instructions} characters of guidance). Shorten them.`;
  }
  return {
    to: to ?? "",
    mode: "conversation",
    objective,
    instructions,
    language,
    max_minutes: typeof minutes === "number" ? minutes : OWNER_CALL_LIMITS.defaultMinutes,
  };
}

/** The Perspicax Voice tools a bot never calls itself (2026-10-28): every
 * call goes through place_phone_call (its card, the AI disclosure, the
 * organization's pilot and do-not-call list). */
export const VOICE_CALL_TOOL = "voice_call";

/** A bot's own voice_call arguments, as the place_phone_call that makes the
 * same call: always a live conversation (#4193), its `purpose` the
 * objective; a `message` is not used (voice_call ignores it too). A mode
 * voice_call does not know is passed on, so the parser refuses it. */
export function placeArgsFromVoiceCall(args: unknown): Record<string, unknown> {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const out: Record<string, unknown> = { to: row.to, objective: row.purpose };
  if (row.mode !== undefined && row.mode !== "live" && row.mode !== "conversation") out.mode = row.mode;
  for (const key of ["instructions", "max_minutes", "voicemail", "language"] as const) if (row[key] !== undefined) out[key] = row[key];
  return out;
}
