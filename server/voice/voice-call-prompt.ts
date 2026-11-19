// The hidden instruction a bot gets while it is on a voice call
// (docs/voice-mode-xai.md, "The bot knows it is on the phone").
//
// A call turn is an ordinary send whose message carries Message.voiceCall.
// Its words came from speech recognition and its answer is read aloud, so
// the turn's system prompt gets a "voice-call" section (a volatile one,
// server/system-prompt.ts): every driver delivers it through its own
// channel for changed context (Claude's appended system prompt or the
// context note of a live session, Codex's developer instructions or note,
// the newest user message of an API driver, an ACP or pi session note).
// It is never stored as the person's text and never shown in the thread.
// The first written turn after a call gets a one-time note saying the call
// ended, so the bot goes back to its written register.
import type { Message } from "../store.ts";
import { isVoiceModeLanguage, VOICE_MODE_LANGUAGES } from "../../shared/voice-mode.ts";
import type { VoiceTopic } from "../../src/lib/voice-mode/voice-topics.ts";

export type VoiceCallMeta = NonNullable<Message["voiceCall"]>;

const CALL_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** Longest heard or unheard excerpt kept on a message (characters). */
export const VOICE_CALL_EXCERPT_MAX = 1_200;

function excerpt(value: unknown, field: string): string | undefined | { error: string } {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return { error: `voiceCall.${field} must be text` };
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > VOICE_CALL_EXCERPT_MAX ? `${text.slice(0, VOICE_CALL_EXCERPT_MAX - 1)}\u2026` : text;
}

/** The `voiceCall` field of a send body: undefined when absent, an error
 * message when malformed. */
export function parseVoiceCallMeta(value: unknown): VoiceCallMeta | undefined | { error: string } {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return { error: "voiceCall must be an object" };
  const record = value as Record<string, unknown>;
  if (typeof record.callId !== "string" || !CALL_ID.test(record.callId)) return { error: "voiceCall.callId must be a call id" };
  if (record.interrupted !== undefined && typeof record.interrupted !== "boolean") return { error: "voiceCall.interrupted must be a boolean" };
  if (record.continues !== undefined && typeof record.continues !== "boolean") return { error: "voiceCall.continues must be a boolean" };
  if (record.duplex !== undefined && typeof record.duplex !== "boolean") return { error: "voiceCall.duplex must be a boolean" };
  if (record.speculative !== undefined && typeof record.speculative !== "boolean") return { error: "voiceCall.speculative must be a boolean" };
  if (record.language !== undefined && (!isVoiceModeLanguage(record.language) || record.language === "auto")) {
    return { error: "voiceCall.language must be a voice mode language" };
  }
  if (record.utteranceId !== undefined && (typeof record.utteranceId !== "string" || !CALL_ID.test(record.utteranceId))) {
    return { error: "voiceCall.utteranceId must be an utterance id" };
  }
  const heard = excerpt(record.heard, "heard");
  if (typeof heard === "object") return heard;
  const unheard = excerpt(record.unheard, "unheard");
  if (typeof unheard === "object") return unheard;
  const interrupted = record.interrupted === true;
  return {
    callId: record.callId,
    ...(interrupted ? { interrupted: true } : {}),
    ...(typeof record.language === "string" ? { language: record.language } : {}),
    ...(typeof record.utteranceId === "string" ? { utteranceId: record.utteranceId } : {}),
    // what was heard only means something for words that cut the bot
    ...(interrupted && heard !== undefined ? { heard } : {}),
    ...(interrupted && unheard !== undefined ? { unheard } : {}),
    ...(record.continues === true ? { continues: true } : {}),
    ...(record.duplex === true ? { duplex: true } : {}),
    ...(record.speculative === true ? { speculative: true } : {}),
  };
}

/** A display name fit to be spoken: an account email reads as its name part. */
function spokenName(name: string | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "the person";
  return trimmed.includes("@") ? trimmed.split("@")[0]! : trimmed;
}

function languageName(code: string | undefined): string | null {
  if (!code) return null;
  return VOICE_MODE_LANGUAGES.find((entry) => entry.code === code)?.label ?? null;
}

/** A call turn runs on a fast model from a short view of the conversation
 * (server/voice/voice-turn.ts): real work goes to a parallel task on the bot's
 * main model, whose result comes back into the conversation and is read
 * aloud, so the call stays fluent. */
export const VOICE_CALL_DELEGATE_LINE =
  "- On this call you answer on a fast model with a shortened view of the conversation, so they hear you quickly. When they ask for real work (writing or changing code, a long search or a long read, many tool steps, anything that takes more than about half a minute), say in one short sentence that you are on it, then call start_thread with report_back true and a message that carries the complete request with every detail they gave and the context it needs. That task runs in the background on your main model with the whole conversation, and its result comes back here to be read to them. Do not do that work yourself on the call; quick lookups and short answers you give yourself.";

export const VOICE_CALL_INTERRUPTED_NOTE =
  "They interrupted your previous answer while you were speaking: stop that thought, do not finish or repeat it unless they ask, and answer what they just said. A brief, natural acknowledgement is fine.";

export const VOICE_CALL_CONTINUES_NOTE =
  "Their previous message was cut off mid-sentence by the speech recognition; this message is the complete version of it: answer this one, not the fragment.";

/** The interruption, with how much of the cut answer the person heard. */
export function voiceCallInterruptedNote(meta: VoiceCallMeta): string {
  if (!meta.interrupted) return "";
  const parts = [VOICE_CALL_INTERRUPTED_NOTE];
  if (meta.heard !== undefined || meta.unheard !== undefined) {
    parts.push(meta.heard ? `They heard up to: "${meta.heard}".` : "They heard none of it.");
    if (meta.unheard) parts.push(`They did not hear: "${meta.unheard}". If any of it matters for what they ask now, say it briefly.`);
  }
  return parts.join(" ");
}

/** The call instruction for one call turn. */
export function voiceCallInstruction(person: string | undefined, meta: VoiceCallMeta): string {
  const name = spokenName(person);
  const language = languageName(meta.language);
  const lines = [
    `You are on a live phone call with ${name}. What they say reaches you through speech recognition, and everything you write is read aloud to them.`,
    "- Their words may contain transcription errors, mishearings, missing punctuation or filler words: infer what they meant. Never comment on the transcription, never ask them to type, and never mention a transcript, dictation or voice mode.",
    "- Voice output: put the answer or the verdict in your first sentence, then at most three more short spoken sentences, one to four in all, then stop and let them talk. Stay conversational; details belong in the chat, not on the call.",
    "- No markdown, lists, tables, code blocks, emojis, URLs or file paths: none of it can be heard. Summarize instead, and offer to send the details in the chat after the call.",
    "- Never read an identifier aloud: no ids, UUIDs, hashes, commit or ticket numbers, tokens or keys. Name the thing instead (the ticket about the printer, the latest commit, the person's name). If they need the identifier itself, offer to put it in the chat.",
    "- Say times, dates, numbers, amounts and units the way a person says them aloud, in the language of their last message (\"quinze heures trente\", \"half past three\", \"environ deux mille\", \"about two thousand\"). Round when the exact figure does not matter.",
    "- Ask at most one question per turn, and only when you need a real decision from them; otherwise go on with the obvious reading of what they asked.",
    VOICE_CALL_DELEGATE_LINE,
    "- Keep using your tools normally. Before a step that will take more than a few seconds, first say one short sentence in your own words about what you are checking, then do it; on a long task, a brief progress line only at a real milestone (three of ten done). Never a stock phrase, never one line per step, and never a long silence with nothing said.",
    "- When something fails or you cannot do it, say so in one clear sentence with what they can do next, then stop: no error codes, no stack traces, no retry narration.",
    "- When the person is done, or asks to hang up, say one short goodbye and call end_call. The call ends when you finish this turn. Do not start new work after it.",
    "- When they wrap up the call and written details would help, say a short goodbye, then write a line with only --- and, below it, a concise written follow-up for the chat. Nothing after that line is read aloud.",
    `- Speak the language of their last message, Québec French or English included${language ? ` (their call is set to ${language})` : ""}. Keep your own persona and instructions: this call changes only how you format and pace your answers.`,
  ];
  // a duplex call may speak an opener before this answer
  if (meta.duplex) lines.splice(3, 0, "- A short first sentence may already have been spoken aloud. Do not repeat that acknowledgement; continue the answer.");
  if (meta.interrupted) lines.push(voiceCallInterruptedNote(meta));
  if (meta.continues) lines.push(VOICE_CALL_CONTINUES_NOTE);
  return lines.join("\n");
}

export function voiceCallEndedNote(person: string | undefined): string {
  return `The phone call with ${spokenName(person)} has ended: you are back in the written chat and your usual formatting applies again. If you offered to send details after the call and have not written them yet, include them now.`;
}

/** The "voice-call" system prompt section for a turn: the call instruction
 * for a call turn, the ended note for the first written turn after a call,
 * empty otherwise. `previous` is the person's message before this one. */
export function voiceCallSection(
  message: Pick<Message, "voiceCall"> | undefined,
  previous: Pick<Message, "voiceCall"> | undefined,
  person: string | undefined,
  _topics?: VoiceTopic[],
): string {
  if (message?.voiceCall) {
    return `\n\nPhone call:\n${voiceCallInstruction(person, message.voiceCall)}`;
  }
  if (previous?.voiceCall) return `\n\nPhone call:\n${voiceCallEndedNote(person)}`;
  return "";
}

/** The mark every call turn's own words carry to the engine. The system
 * prompt section is volatile, and a live session gets a volatile change only
 * when it differs from the last turn's (server/drivers/claude.ts): from the
 * second call turn on, the section is not sent again. So each turn said on
 * the call says so itself, in a short bracket the stored message never
 * holds. */
export const VOICE_CALL_TURN_MARK =
  "[Said on the live phone call, through speech recognition: answer in one to four short spoken sentences, verdict first, no markdown, tables, lists, paths or identifiers.";

function turnMark(meta: VoiceCallMeta): string {
  const notes = [voiceCallInterruptedNote(meta), meta.continues ? VOICE_CALL_CONTINUES_NOTE : ""].filter(Boolean);
  return `${VOICE_CALL_TURN_MARK}${notes.length ? ` ${notes.join(" ")}` : ""}]`;
}

/** A call turn's prompt: the person's words behind the call mark. */
export function voiceCallTurnPrompt(prompt: string, meta: VoiceCallMeta | undefined): string {
  if (!meta) return prompt;
  // an engine command typed while on the call stays a command
  if (prompt.startsWith("/")) return prompt;
  return `${turnMark(meta)}\n\n${prompt}`;
}

/** Words said on a call that join a turn already running: the running turn
 * may not carry the call instruction, so the steer says where they came
 * from (the stored message keeps only the words). */
export function voiceCallSteerPrompt(prompt: string, meta: VoiceCallMeta | undefined): string {
  if (!meta) return prompt;
  return `${turnMark(meta)}\n\n${prompt}`;
}
