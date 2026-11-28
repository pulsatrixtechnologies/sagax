// Whether a page reader may read the `bot` source (#5461, D-20261127-013).
// Owner and bot.use holders only. Page audience (visibleTo / everyone) is
// never enough on its own: a shared-page reader without bot.use must not
// receive the bot's name, mode, activity or routines.

export function pageBotSourceVisible(input: {
  botExists: boolean;
  /** canOnBot(viewer, "bot.use", botFacts(bot)); owner counts as may-use. */
  mayUseBot: boolean;
}): boolean {
  return input.botExists && input.mayUseBot;
}
