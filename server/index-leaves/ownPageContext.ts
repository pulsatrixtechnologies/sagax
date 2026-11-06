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
  if (mine) return context;
  const { page: _dropped, ...rest } = context;
  return rest.cardId ? rest : undefined;

}
  return ownPageContext;
}
