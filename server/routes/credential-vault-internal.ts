// request_login (server/drivers/agents-call.ts): a bot asks to use a login
// from the vault of the person its turn acts for.
//
//   POST /api/internal/credentials/request { domain?, name?, reason? }
//     200 { granted: [{ handle, name, domains, fields }] }  already allowed
//     201 { messageId }                                     a card was posted
//
//   POST /api/internal/credentials/http { handle, method?, url, headers?, body? }
//     200 { text, isError? }   vault_http_request (2026-10-26): the server
//     adds the API key to the request (server/credential-http.ts)
//
// The answer names handles, sites and which fields exist, never a value. A
// card is the person's to answer (server/routes/credential-vault.ts).
import { botVaultPrincipal, normalizeVaultDomain, vaultHandle, type VaultItemListing } from "../../shared/credential-vault.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { outcomeText, sendWithInjectedKey, type CredentialHttpOptions } from "../credential-http.ts";
import type { CredentialVault, OnePasswordFieldReader } from "../credential-vault.ts";
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
  /** Who answers a card for the bot's shared logins (its owner); null: the speaker. */
  botOwner?(botId: string): string | null;
  /** A new card replaces the open one: a person's own sign-in begun from it
   * ends (server/browser-runtime.ts endPersonSignIn). */
  endPersonSignIn?(botId: string, threadId: string): Promise<void>;
  /** vault_http_request: the resolver and address checks (tests inject them). */
  http?: CredentialHttpOptions;
  /** A 1Password API key, read at use (the conversation says it waits). */
  readOnePassword?(threadId: string): OnePasswordFieldReader;
  /** One line per request sent or refused: host, method, status, never the
   * key, the path or the query. */
  audit?(detail: { botId: string; host: string; method: string; status?: number; refused?: string }): void;
}

function hostOf(url: unknown): string {
  try { return typeof url === "string" ? new URL(url).host.slice(0, 253) : ""; } catch { return ""; }
}

function fieldsOf(item: VaultItemListing): string[] {
  return [item.username ? "username" : "", item.hasPassword ? "password" : "", item.hasTotp ? "totp" : "", item.hasApiKey ? "apiKey" : ""].filter(Boolean);
}

export function createCredentialVaultInternalRoutes(deps: CredentialVaultInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path === "/api/internal/credentials/http") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      const body = await readBody();
      if (deps.botName(capability.botId, capability.threadId) === null) return json(res, 403, { error: "source conversation does not belong to sender" });
      const principalId = deps.principalForThread(capability.threadId);
      if (!principalId) return json(res, 403, { error: "This turn does not act for a person whose vault could answer." });
      const requestMethod = typeof body.method === "string" ? body.method.toUpperCase().slice(0, 10) : "GET";
      const host = hostOf(body.url);
      const req = { handle: body.handle, botId: capability.botId, threadId: capability.threadId, url: typeof body.url === "string" ? body.url : "" };
      const reader = deps.readOnePassword?.(capability.threadId);
      let resolved = await deps.vault.resolveForRequest(botVaultPrincipal(capability.botId), req, reader);
      if (!resolved.ok && (resolved.code === "unknown_item" || resolved.code === "unavailable")) {
        resolved = await deps.vault.resolveForRequest(principalId, req, reader);
      }
      if (!resolved.ok) {
        deps.audit?.({ botId: capability.botId, host, method: requestMethod, refused: resolved.code });
        return json(res, 200, { text: resolved.message, isError: true });
      }
      const outcome = await sendWithInjectedKey({
        value: resolved.value,
        injection: resolved.injection,
        ...(resolved.username ? { username: resolved.username } : {}),
        domains: resolved.domains,
      }, { method: body.method, url: body.url, headers: body.headers, body: body.body }, deps.http);
      deps.audit?.({ botId: capability.botId, host, method: requestMethod, ...(outcome.ok ? { status: outcome.status } : { refused: outcome.code }) });
      return json(res, 200, outcomeText(outcome, resolved.label));
    }
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
    const query = { ...(domain ? { domain } : {}), ...(name ? { name } : {}) };
    const usable = (owner: string, item: VaultItemListing) =>
      (item.kind === "login" || item.kind === "apiKey") && deps.vault.granted(owner, item.id, capability.botId, capability.threadId);
    try {
      // Team bot shared vault first, then the person's own.
      const teamPrincipal = botVaultPrincipal(capability.botId);
      granted = deps.vault.find(teamPrincipal, query).filter((item) => usable(teamPrincipal, item));
      if (!granted.length) {
        granted = deps.vault.find(principalId, query).filter((item) => usable(principalId, item));
      }
    } catch {
      // A vault that cannot be opened now still lets the person answer a card.
    }
    if (granted.length) {
      return json(res, 200, { granted: granted.slice(0, 5).map((item) => ({ handle: vaultHandle(item.id), name: item.name, domains: item.domains, fields: fieldsOf(item), ...(item.kind === "apiKey" && item.injection ? { sentBySagax: true } : {}) })) });
    }
    // The bot's shared logins for this site need the owner's card first.
    let teamItems: Array<{ id: string; name: string; domains: string[] }> = [];
    try {
      teamItems = deps.vault.find(botVaultPrincipal(capability.botId), query)
        .filter((item) => item.kind === "login" || item.kind === "apiKey")
        .slice(0, 5).map((item) => ({ id: item.id, name: item.name, domains: item.domains }));
    } catch {}
    const messageId = deps.postCard(capability.botId, capability.threadId, vaultRequestCard({
      principalId: teamItems.length ? (deps.botOwner?.(capability.botId) ?? principalId) : principalId, botName,
      ...(teamItems.length ? { teamItems } : {}), ...(name ? { name } : {}), ...(domain ? { domain } : {}), ...(reason ? { reason } : {}),
    }));
    await deps.endPersonSignIn?.(capability.botId, capability.threadId);
    return json(res, 201, { messageId });
  };
}
