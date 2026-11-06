// An outbound phone call a bot places for the person (parité the reference design V4,
// spec docs/specs/bot-telephony.md, section 4.4 and 6.5). The call goes out
// through the person's own Twilio profile on Perspicax (decision 1: Sagax
// keeps no Twilio key), after an approval card the person answers once per
// call: never an Always allow (5.7). Mode `message` speaks a fixed AI
// disclosure and the bot's message, then hangs up: one way. Mode
// `conversation` (2026-10-28) goes out through Perspicax Voice on the
// person's own line: the line says the AI disclosure, then the realtime
// voice talks with the callee and the result comes back to the
// conversation (server/outbound/outbound-calls.ts).
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

export const CALL_LIMITS = { purpose: 200, message: 600, minutes: 10 } as const;

/** A conversation call (2026-10-28): the bot talks with the person it
 * calls, through Perspicax Voice on the person's own line. */
export const CONVERSATION_LIMITS = { objective: 200, instructions: 1000, voicemail: 300, defaultMinutes: 5, maxMinutes: 20 } as const;

export type CallLanguage = "fr" | "en";
export type CallMode = "message" | "conversation";

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
  /** `conversation`: the bot talks with the person it calls. `purpose` is
   * then the objective, `message` is empty, and `from` is empty: the call
   * leaves from the person's own Perspicax Voice line. */
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
  if (row.mode !== undefined && row.mode !== "message" && row.mode !== "conversation") return "mode is message (say a message and hang up) or conversation (talk with the person you call).";
  if (row.mode === "conversation") return parseConversation(row, to, fallbackLanguage);
  // 2026-10-28: no `from` is the person's own Perspicax Voice line
  const line = row.from === undefined || row.from === null || row.from === "";
  const from = line ? "" : typeof row.from === "string" ? normalizePhone(row.from) : null;
  if (from === null) return "from must be the person's Twilio number the call comes from (read it with twilio_api_query IncomingPhoneNumbers), or left out to call from their own Perspicax Voice line.";
  if (from === to) return "from and to are the same number.";
  const purpose = clean(row.purpose, CALL_LIMITS.purpose);
  if (!purpose) return `purpose: one short sentence, at most ${CALL_LIMITS.purpose} characters, saying why you call.`;
  const message = clean(row.message, CALL_LIMITS.message);
  if (!message) return `message: the words to say, at most ${CALL_LIMITS.message} characters.`;
  const language = row.language === "en" || row.language === "fr" ? row.language : fallbackLanguage;
  const account = typeof row.account === "string" && /^AC[0-9a-f]{32}$/.test(row.account.trim()) ? row.account.trim() : undefined;
  if (row.account !== undefined && !account) return "account must be the Twilio account sid (AC...), or left out.";
  if (line && account) return "account goes with from: a call from the person's own Perspicax Voice line names neither.";
  return { to, from, purpose, message, language, ...(account ? { account } : {}) };
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

/** The Perspicax twilio_api_write arguments for this call. */
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
  const base = [request.to, request.from, request.purpose, request.message, request.language, request.account ?? "", names?.botName ?? "", names?.personName ?? "", names?.callback ?? ""];
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

/** The Perspicax voice_call arguments of a conversation call (the person's
 * own Perspicax Voice line and Twilio key; the card already had their yes,
 * so `confirm` answers the line's own third party card). */
export function voiceCallArgs(request: OutboundCallRequest, input: { botName: string; ref: string; dryRun: boolean }): Record<string, unknown> {
  // a one-way message from the line: the arguments every Perspicax Voice
  // release takes (the line says who calls, the purpose, the message twice)
  if (request.mode !== "conversation") {
    return { to: request.to, purpose: request.purpose, message: request.message, confirm: true, ...(input.dryRun ? { dry_run: true } : {}) };
  }
  return {
    to: request.to,
    purpose: request.purpose,
    message: "",
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
    "Place a phone call for the person to a Canadian number. Two modes. message (default): through their Twilio profile on Perspicax, a fixed opening (an automated call from you, an AI assistant, for the person), then your purpose and your message, said twice, then it hangs up; needs purpose and message, and from (a Twilio number of their profile) or nothing (their own Perspicax Voice line). conversation: from the person's own Perspicax Voice line, the line first says \"Hello, this is <you>, an AI assistant calling on behalf of <the person>\", then you talk with the person you call in real time, pursue the objective, follow the instructions, and hang up politely when the objective is reached, when asked, or at max_minutes (5 by default, 20 at most); a voicemail gets your short voicemail message; a callee who asks not to be called again is never called again for this person; needs objective. Either way the first call shows the person an approval card (number, objective or words, maximum duration; a dry run checks it; nothing is placed). After they choose Call, call place_phone_call again with the very same arguments to place it. One approval places one call; any change asks again. A conversation's result (status, duration, summary points, commitments, transcript) comes back to you in a new turn when the call ends, as a card in the conversation: end your turn after placing it, then give the person the summary they asked for. Never call twilio_api_write Calls or voice_call yourself: Sagax turns a voice_call into this tool, with its card. To call the person themself with structured questions, prefer phone_call_owner.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", description: "The number to call, such as +1 514 555 0142. Canada only." },
      mode: { type: "string", enum: ["message", "conversation"], description: "message (default): say a message and hang up. conversation: talk with the person you call." },
      objective: { type: "string", description: "conversation: what you must obtain or say on this call, at most 200 characters. Shown on the card." },
      instructions: { type: "string", description: "conversation: your guidance during the call (what you may say or accept, what to avoid), at most 1000 characters." },
      max_minutes: { type: "integer", minimum: 1, maximum: 20, description: "conversation: the most the call may last, in minutes (5 when left out)." },
      voicemail: { type: "string", description: "conversation: the short message left if a voicemail answers, at most 300 characters. Nothing confidential." },
      from: { type: "string", description: "message: the person's Twilio number the call comes from (twilio_api_query IncomingPhoneNumbers); left out, the call leaves from the person's own Perspicax Voice line. Not used by a conversation, which always leaves from that line." },
      purpose: { type: "string", description: "message: one short sentence, why you call, said after the opening and shown on the card." },
      message: { type: "string", description: "message: the exact words to say, at most 600 characters. Nothing confidential." },
      language: { type: "string", enum: ["fr", "en"], description: "The call's language. Defaults to the person's." },
      account: { type: "string", description: "message: optional Twilio account sid (AC...), when the profile serves more than one." },
    },
    required: ["to"],
  },
} as const;

export const PHONE_CALL_OWNER_TOOL_SPEC = {
  name: PHONE_CALL_OWNER_TOOL,
  description:
    "Call the person themself on their own verified Perspicax Voice number with structured questions (#2194). Goes out through place_phone_call conversation mode on their line (Perspicax voice_call): one short opening, then one question at a time, then hang up. Answers come back as the conversation call_result (points, commitments, transcript) in this same chat. Needs questions (1 to 8 short ones). Optional context is extra brief for the call. Optional to is their E.164 number; when left out, Sagax uses the number they set under Reach me by text, after voice_line confirms it is verified on their line. Same approval card as place_phone_call (one yes places one call; Always call and Auto still apply). Never invent a second phone stack, and never call voice_call yourself.",
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
    language === "fr"
      ? "Langue: suis le français ou l'anglais du dernier tour de la personne; un oui/non/ok d'un mot ne change pas la langue. Registre québécois en français."
      : "Language: follow French or English from the person's last turn; a one-word yes/no/ok does not flip the language. Quebec French register when speaking French.",
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
 * same call: a conversation, or a one-way message from the person's own
 * line. Nothing is dropped: an argument place_phone_call does not know is
 * refused by its parser, never silently lost. */
export function placeArgsFromVoiceCall(args: unknown): Record<string, unknown> {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const conversation = row.mode === "conversation";
  const out: Record<string, unknown> = { to: row.to };
  if (conversation) {
    out.mode = "conversation";
    out.objective = row.purpose;
    for (const key of ["instructions", "max_minutes", "voicemail"] as const) if (row[key] !== undefined) out[key] = row[key];
  } else {
    if (row.mode !== undefined && row.mode !== "message") out.mode = row.mode;
    out.purpose = row.purpose;
    out.message = row.message;
  }
  if (row.language !== undefined) out.language = row.language;
  return out;
}
