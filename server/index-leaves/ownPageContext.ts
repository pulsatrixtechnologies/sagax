// @ts-nocheck
/** ownPageContext (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnPageContext(getHost: () => Host): any {
function ownPageContext(context: DataContext | undefined, botId: string, auth: RequestAuth) {
  const host = getHost();

  if (!context?.page) return context;
  const page = host.publishedPages.get(context.page.pageId);
  const owner = host.IDENTITY.kind === "perspicax" && auth.kind === "session" ? auth.session.principalId?.trim() || undefined : undefined;
  const mine = Boolean(page) && page!.botId === botId && (host.IDENTITY.kind === "perspicax"
    ? Boolean(owner) && (page!.ownerId ?? "").toLowerCase() === owner!.toLowerCase()
    : page!.ownerId === undefined);
  // #3128: a page shared in this bot's Library is also kept for a person who
  // uses the bot (they ask it to refresh the page)
  const shared = !mine && host.IDENTITY.kind === "perspicax" && Boolean(page) && page!.botId === botId && page!.botShared === true
    && Boolean(owner) && Boolean(host.store.bot(botId) && host.canOnBot(host.authzViewerFromId(owner!), "bot.use", host.botFacts(host.store.bot(botId))));
  if (mine || shared) return context;
  const { page: _dropped, ...rest } = context;
  return rest.cardId ? rest : undefined;

}
  return ownPageContext;
}
