// Team bot vault: shared logins, cards and contacts for one team bot.
// Managers of that bot (owner, manage grant, org admin) add/edit/remove;
// the bot fills by handle after request_login finds a matching item.
//
//   POST   /api/bots/:botId/credentials/list
//   POST   /api/bots/:botId/credentials
//   PATCH  /api/bots/:botId/credentials/:id
//   DELETE /api/bots/:botId/credentials/:id
//
// Same sealed store as the person's vault (server/credential-vault.ts),
// under bots/<botId>/credential-vault.enc. Listings never carry a value.
import { botVaultPrincipal, type VaultItemKind } from "../../shared/credential-vault.ts";
import { CredentialVaultError, type CredentialVault, type VaultItemInput } from "../credential-vault.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BOT_LIST = /^\/api\/bots\/([\w-]+)\/credentials\/list$/;
const BOT_ROOT = /^\/api\/bots\/([\w-]+)\/credentials$/;
const BOT_ITEM = /^\/api\/bots\/([\w-]+)\/credentials\/([a-z0-9]{8,40})$/;

export interface TeamBotVaultRouteDeps {
  vault: CredentialVault;
  /** Whether this caller may manage the bot's shared vault. */
  mayManage(auth: RequestAuth, botId: string): boolean;
  botExists(botId: string): boolean;
  audit?(action: "team_vault.create" | "team_vault.update" | "team_vault.delete", auth: RequestAuth, detail: Record<string, unknown>): void;
}

/** Kinds a team bot fills today; card, address and contact fields are not read here. */
const TEAM_KINDS: readonly VaultItemKind[] = ["login", "apiKey", "note"];

/** Who may manage a shared vault when the server is not an organization
 * (mono-person or shared workspace): the bot's owner or an admin, never a
 * bot's act session, an ephemeral session, or a local service unless the
 * same opt-in as the personal vault is set. */
export function soloMayManage(
  auth: RequestAuth,
  facts: { ownerOrAdmin: boolean; actOrEphemeral: boolean; loopbackOptIn: boolean },
): boolean {
  if (auth.kind === "loopback") return auth.trust !== "service" || facts.loopbackOptIn;
  if (facts.actOrEphemeral) return false;
  return facts.ownerOrAdmin;
}

function itemInput(body: Record<string, unknown>, creating: boolean): VaultItemInput {
  const kind = (TEAM_KINDS as readonly unknown[]).includes(body.kind) ? body.kind as VaultItemKind : creating ? "login" : undefined;
  const input: VaultItemInput = {
    ...(kind ? { kind } : {}),
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(body.domains !== undefined ? { domains: body.domains as string[] } : {}),
  };
  for (const field of ["username", "password", "totpSeed", "apiKey", "notes"] as const) {
    if (body[field] !== undefined) input[field] = typeof body[field] === "string" ? body[field] : "";
  }
  return input;
}

function vaultError(error: unknown): { status: number; body: unknown } | null {
  if (error instanceof CredentialVaultError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  return null;
}

export function createTeamBotVaultRoutes(deps: TeamBotVaultRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = BOT_LIST.exec(path);
    const root = list ? null : BOT_ROOT.exec(path);
    const item = list || root ? null : BOT_ITEM.exec(path);
    const match = list ?? root ?? item;
    if (!match) return PASS;
    const botId = match[1]!;
    const itemId = item?.[2];
    res.setHeader("cache-control", "private, no-store");
    if (!deps.botExists(botId)) return json(res, 404, { error: "no such bot", code: "unknown_bot" });
    if (!deps.mayManage(auth, botId)) {
      return json(res, 403, { error: "Only this bot's managers can change its shared vault.", code: "not_manager" });
    }
    const principalId = botVaultPrincipal(botId);

    if (list && method === "POST") {
      try {
        const items = deps.vault.list(principalId);
        return json(res, 200, { items, botId });
      } catch (error) {
        const refused = vaultError(error);
        if (refused) return json(res, refused.status, refused.body);
        throw error;
      }
    }

    if (root && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const created = deps.vault.createForTeamBot(botId, itemInput(body, true));
        deps.audit?.("team_vault.create", auth, { botId, itemId: created.id, kind: created.kind });
        return json(res, 201, { item: created });
      } catch (error) {
        const refused = vaultError(error);
        if (refused) return json(res, refused.status, refused.body);
        throw error;
      }
    }

    if (itemId && method === "PATCH") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const updated = deps.vault.update(principalId, itemId, itemInput(body, false));
        deps.audit?.("team_vault.update", auth, { botId, itemId });
        return json(res, 200, { item: updated });
      } catch (error) {
        const refused = vaultError(error);
        if (refused) return json(res, refused.status, refused.body);
        throw error;
      }
    }

    if (itemId && method === "DELETE") {
      try {
        if (!deps.vault.remove(principalId, itemId)) return json(res, 404, { error: "No such item", code: "unknown_item" });
        deps.audit?.("team_vault.delete", auth, { botId, itemId });
        return json(res, 200, { ok: true });
      } catch (error) {
        const refused = vaultError(error);
        if (refused) return json(res, refused.status, refused.body);
        throw error;
      }
    }

    return json(res, 405, { error: "method not allowed" });
  };
}
