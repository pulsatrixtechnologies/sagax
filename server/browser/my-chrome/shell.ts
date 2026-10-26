// My Chrome and a bot's shell (JC, 2026-10-20, after #838).
//
// A bot with a command tool (a shell) on the SAME computer as the person's
// Chrome could connect to Chrome's DevTools itself and walk around the
// per-site agreement. So such a bot is never given My Chrome: it keeps its own
// bot browser. A bot with no shell on this computer (it works on a cloud
// computer, or a team computer) drives My Chrome as usual.

/** What decides whether a bot's turn has a shell on the computer of the
 * person's Chrome. Every engine brings a command tool, so the shell is
 * elsewhere only when the bot's work is held on a cloud or team computer. */
export interface ShellFacts {
  /** The bot always runs as a cloud run (cloud-only bots). */
  cloudOnly: boolean;
  /** The bot works on a team computer. */
  teamComputer: boolean;
}

export function hasShellOnThisComputer(facts: ShellFacts): boolean {
  return !(facts.cloudOnly || facts.teamComputer);
}

/** The sentence a bot reads (browser prompt, tool refusal) and the person sees on the bot's card. */
export const MY_CHROME_SHELL_NOTE = "This bot has a terminal on your computer: it uses its own browser.";
export const MY_CHROME_SHELL_NOTE_FR = "Ce bot a un terminal sur ton ordinateur : il utilise son propre navigateur.";

export const MY_CHROME_SHELL_PROMPT = " My Chrome is not available to you: you have a terminal on the person's computer, which could reach their Chrome around the sites they allowed. You use your own bot browser. Do not try to connect to the person's Chrome.";
