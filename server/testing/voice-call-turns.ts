// Turn fixtures for the per-driver voice call tests: the system prompt
// halves a turn gets before, during and after a voice call, built by the
// same code the server uses (buildSystemPrompt + voiceCallSection).
import type { SendTurnInput } from "../contracts.ts";
import { buildSystemPrompt } from "../system-prompt.ts";
import { voiceCallSection, type VoiceCallMeta } from "../voice/voice-call-prompt.ts";

export const CALL_MARK = "You are on a live phone call with Ada.";
export const ENDED_MARK = "The phone call with Ada has ended";
export const INTERRUPTED_MARK = "They interrupted your previous answer";

export type VoiceCallTurnKind = "written" | "call" | "interrupted" | "after";

const CALL: VoiceCallMeta = { callId: "call-0123456789" };

/** The prompt halves of one turn, as the server hands them to a driver. */
export function voiceCallTurn(kind: VoiceCallTurnKind): Pick<SendTurnInput, "system" | "systemStable" | "systemVolatile" | "mentionTurn"> {
  const message = kind === "call" ? { voiceCall: CALL } : kind === "interrupted" ? { voiceCall: { ...CALL, interrupted: true } } : {};
  const previous = kind === "after" ? { voiceCall: CALL } : {};
  const prompt = buildSystemPrompt("You are Testy.", "", [
    { id: "memory", label: "Memory", text: "\n\nMemory: likes tea." },
    { id: "voice-call", label: "Phone call", text: voiceCallSection(message, previous, "Ada") },
  ]);
  return {
    system: prompt.text,
    systemStable: prompt.stable,
    systemVolatile: prompt.volatile,
    ...(kind === "interrupted" ? { mentionTurn: true } : {}),
  };
}
