// @ts-nocheck
/** migrateGithubCredentials (#1388). Pure move from server/index.ts. */
import { ORG_OWNER, LOCAL_OWNER } from "../github/github-credentials.ts";
export type Host = Record<string, any>;

export function createMigrateGithubCredentials(getHost: () => Host): any {
function migrateGithubCredentials(): void {
  const host = getHost();
  if (host.githubCredentialsMigrated) return;
  try {
    const { imported } = host.githubCredentials.migrate({
      orgTokens: host.legacyOrgGithubTokens,
      marketplaceTokens: host.legacyMarketplaceTokens,
      workspaceOwner: host.IDENTITY.kind === "perspicax" ? ORG_OWNER : LOCAL_OWNER,
      ownerOfBot: (botId) => host.store.bot(botId)?.ownerUserId?.trim().toLowerCase() || undefined,
      botName: (botId) => host.store.bot(botId)?.name,
      fallbackOwner: host.IDENTITY.kind === "perspicax" ? ORG_OWNER : LOCAL_OWNER,
      personOwner: (principalId) => host.credentialOwner(principalId) ?? principalId
    });
    host.githubCredentialsMigrated = true;
    if (imported) console.log(`[github-credentials] moved ${imported} saved credential(s) into the one list`);
  } catch (error) {
    console.warn(`[github-credentials] migration deferred: ${(error as { code?: string })?.code ?? "unreadable"}`);
  }
}
  return migrateGithubCredentials;
}
