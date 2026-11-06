// @ts-nocheck
/** openApiToolsEnv (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOpenApiToolsEnv(getHost: () => Host): any {
function openApiToolsEnv(botId: string, threadId: string) {
  const host = getHost();

  if (host.store.groupByThread(threadId)) return "";
  const organization = host.IDENTITY.kind === "perspicax";
  // 2026-10-28: the operations of the person this turn is for (who speaks,
  // or a routine's owner), on their own bot or one shared with them: a
  // conversation uses the credentials of who speaks, never the owner's.
  const principal = organization ? host.vaultPrincipalForThread(threadId) : null;
  if (organization && (!host.store.bot(botId) || !principal)) return "";
  const scope = host.openApiScope(organization, principal);
  if (!scope) return "";
  const operations = host.openApiStore.publicOperations(scope);
  return operations.length ? JSON.stringify(operations) : "";

}
  return openApiToolsEnv;
}
