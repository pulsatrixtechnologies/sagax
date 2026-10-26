// request_login (server/drivers/agents-call.ts): a bot asks to use a login
// from the vault of the person its turn acts for.
//
//   POST /api/internal/credentials/request { domain?, name?, reason? }
//     200 { granted: [{ handle, name, domains, fields }] }  already allowed
//     201 { messageId }                                     a card was posted
//
// The answer names handles, sites and which fields exist, never a value. A
// card is the person's to answer (server/routes/credential-vault.ts).
import { normalizeVaultDomain, vaultHandle, type VaultItemListing } from "../../shared/credential-vault.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import type { CredentialVault } from "../credential-vault.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";
import { vaultRequestCard } from "./credential-vault.ts";

export interface CredentialVaultInternalDeps {
  vault: CredentialVault;
  /** Whose vault this turn reads (its speaker, or a routine's owner); null
   * when the turn speaks for nobody it could ask. */
  principalForThread(threadId: string): string | null;
  /** The bot's display name, when the conversation is the bot's own. */
  botName(botId: string, threadId: string): string | null;
  postCard(botId: string, threadId: string, secret: SecretRequestCardData): string;
  /** A new card replaces the open one: a person's own sign-in begun from it
   * ends (server/browser-runtime.ts endPersonSignIn). */
  endPersonSignIn?(botId: string, threadId: string): Promise<void>;
}

function fieldsOf(item: VaultItemListing): string[] {
  return [item.username ? "username" : "", item.hasPassword ? "password" : "", item.hasTotp ? "totp" : "", item.hasApiKey ? "apiKey" : ""].filter(Boolean);
}

export function createCredentialVaultInternalRoutes(deps: CredentialVaultInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/credentials/request") return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    const body = await readBody();
    const rawDomain = typeof body.domain === "string" ? body.domain.trim() : "";
    const domain = rawDomain ? normalizeVaultDomain(rawDomain) : null;
    if (rawDomain && !domain) return json(res, 400, { error: "domain must be a site name such as example.com" });
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";
    if (!domain && !name) return json(res, 400, { error: "send the site (domain) or the login's name" });
    const botName = deps.botName(capability.botId, capability.threadId);
    if (botName === null) return json(res, 403, { error: "source conversation does not belong to sender" });
    const principalId = deps.principalForThread(capability.threadId);
    if (!principalId) return json(res, 403, { error: "This turn does not act for a person whose vault could answer." });
    let granted: VaultItemListing[] = [];
    try {
      granted = deps.vault.find(principalId, { ...(domain ? { domain } : {}), ...(name ? { name } : {}) })
        .filter((item) => (item.kind === "login" || item.kind === "apiKey") && deps.vault.granted(principalId, item.id, capability.botId, capability.threadId));
    } catch {
      // A vault that cannot be opened now still lets the person answer a card.
    }
    if (granted.length) {
      return json(res, 200, { granted: granted.slice(0, 5).map((item) => ({ handle: vaultHandle(item.id), name: item.name, domains: item.domains, fields: fieldsOf(item) })) });
    }
    const messageId = deps.postCard(capability.botId, capability.threadId, vaultRequestCard({
      principalId, botName, ...(name ? { name } : {}), ...(domain ? { domain } : {}), ...(reason ? { reason } : {}),
    }));
    await deps.endPersonSignIn?.(capability.botId, capability.threadId);
    return json(res, 201, { messageId });
  };
}
