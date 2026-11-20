// A bot's own background one-shots reach the same model as its turns: memory
// upkeep's capture, tidy and organize steps (on for every bot, the tidy
// nightly and a first pass a minute after start, server/memory/memory-upkeep.ts)
// the automatic skill review, the digest of a finished topic drafted when
// the next topic's turn starts (server/index-leaves/refreshStreamDigests.ts,
// #4105), and the soul sort that files what a write added to a soul, run
// right after a new bot or a profile is written (server/bots/soul-sort.ts,
// #5030). A fixture that records "the turn's
// request" tells them apart here, the one rule for every fake provider
// (#3671): the fake Claude CLI keeps them out of its turn dump, the fake
// chat-completion providers out of their turn list.
const BACKGROUND_STEP = /You are the (?:CAPTURE|TIDY|ORGANIZE) step of a memory system|You are the SKILL REVIEW step|^Write a digest of one finished topic of a conversation|^You sort the text a person just added to the soul \(SOUL\.md\) of an AI assistant/;

/** True when `prompt` is a background step's, not a person's turn. */
export function isBackgroundStepPrompt(prompt: string): boolean {
  return BACKGROUND_STEP.test(prompt);
}
