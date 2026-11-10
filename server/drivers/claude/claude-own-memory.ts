// Claude Code keeps an auto-memory of its own: a folder per working folder,
// named in about 4k tokens of system prompt. A bot's memory is Sagax's, and a
// bot's working folder is per thread, so that second memory split notes by
// thread (a note saved in one is gone in the next), sent bots searching the
// wrong folder for their notes, and put a per-thread path in the system
// prompt, which made every new thread write the rest of the prompt to the
// provider's cache again. Port of upstream 0.1.141 (#3302).
export const CLAUDE_OWN_MEMORY_OFF = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } as const;
