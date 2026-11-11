// A bot's own background one-shots reach the same model as its turns: memory
// upkeep's capture, tidy and organize steps (on for every bot, the tidy
// nightly and a first pass a minute after start, server/memory/memory-upkeep.ts)
// and the automatic skill review. A fixture that records "the turn's
// request" tells them apart here, the one rule for every fake provider
// (#3671): the fake Claude CLI keeps them out of its turn dump, the fake
// chat-completion providers out of their turn list.
const BACKGROUND_STEP = /You are the (?:CAPTURE|TIDY|ORGANIZE) step of a memory system|You are the SKILL REVIEW step/;

/** True when `prompt` is a background step's, not a person's turn. */
export function isBackgroundStepPrompt(prompt: string): boolean {
  return BACKGROUND_STEP.test(prompt);
}
