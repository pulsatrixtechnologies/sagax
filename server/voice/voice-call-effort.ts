// The reasoning effort of a voice call turn (docs/voice-mode-xai.md,
// "Latency"): on a call the person waits in silence for the first word, so
// a call turn (and the warm that prepares its process) runs at the lowest
// effort the engine offers, "low" where it exists. "none" is not picked on
// its own: it turns reasoning off, which is a different answer, not a
// faster one. A bot already set below that keeps its own level.
//
// The model of a call turn (a fast one) is picked in server/voice/voice-turn.ts
// (pickVoiceModel); only the effort is decided here.
import { EFFORT_LEVELS, type EffortLevel } from "../../shared/wire.ts";

const rank = (level: EffortLevel) => EFFORT_LEVELS.indexOf(level);

export function callTurnEffort(input: {
  driverKind: string;
  /** what the engine accepts (capabilities.effortLevels); absent = no control */
  levels?: readonly EffortLevel[];
  /** the bot's own effort, if it set one */
  effort?: EffortLevel;
}): EffortLevel | undefined {
  const levels = input.levels ?? [];
  if (!levels.length) return input.effort;
  // Codex keeps an omitted effort from the previous turn of its thread: a
  // bot that sets none would stay on the call's level after the call.
  if (input.driverKind === "codex" && input.effort === undefined) return undefined;
  const offered = [...levels].sort((a, b) => rank(a) - rank(b));
  const call = offered.includes("low") ? "low" : offered.find((level) => level !== "none") ?? offered[0]!;
  return input.effort !== undefined && rank(input.effort) < rank(call) ? input.effort : call;
}
