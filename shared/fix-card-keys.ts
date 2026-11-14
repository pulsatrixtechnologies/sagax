// #4250: the keys of the cards the server raises for the person itself (no
// model), in one place, so the server that raises them and the app that
// lists them (the bot panel's Suggestions card, src/lib/bot-suggestions.ts)
// read the same words. Each is the existing keyed ask_choice card
// (server/widgets/ask-choice-keys.ts).
//
// - a fix: something only the person can put right, retired by the server
//   the moment the cause is gone: a routine's lasting problem
//   (`routine-problem:<routineId>`, server/routines/routine-problem-card.ts),
//   a product failing for the person (`product:<api id>`) or their phone line
//   (`voice-line`, server/perspicax/perspicax-events.ts);
// - a saving (S6): a routine that could run without waking its bot
//   (`routine-cheap-path:<routineId>`, server/routines/routine-cheap-path.ts).

export const ROUTINE_PROBLEM_KEY_PREFIX = "routine-problem:";
export const PRODUCT_KEY_PREFIX = "product:";
export const VOICE_LINE_KEY = "voice-line";
export const CHEAP_PATH_KEY_PREFIX = "routine-cheap-path:";

export type ServerCardKind = "fix" | "saving";

/** What a keyed card of the server is, or null for a bot's own key. */
export function serverCardKind(key: string | null | undefined): ServerCardKind | null {
  if (!key) return null;
  if (key.startsWith(ROUTINE_PROBLEM_KEY_PREFIX) || key.startsWith(PRODUCT_KEY_PREFIX) || key === VOICE_LINE_KEY) return "fix";
  if (key.startsWith(CHEAP_PATH_KEY_PREFIX)) return "saving";
  return null;
}

/** The routine a routine's server card names (`routine-problem:<id>`,
 * `routine-cheap-path:<id>`), or null. */
export function serverCardRoutineId(key: string | null | undefined): string | null {
  for (const prefix of [ROUTINE_PROBLEM_KEY_PREFIX, CHEAP_PATH_KEY_PREFIX]) {
    if (key?.startsWith(prefix) && key.length > prefix.length) return key.slice(prefix.length);
  }
  return null;
}
